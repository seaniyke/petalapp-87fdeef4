/**
 * DNS sanity check for a custom domain.
 *
 * Queries authoritative public resolvers (Cloudflare DoH + Google DoH) for
 * the records we need to be live before Cloudflare for SaaS can finish
 * verification + SSL issuance:
 *   - The routing record (CNAME/ALIAS → fallback.buildwithpetal.com)
 *   - Any explicit TXT validation records Cloudflare returns for wildcard or
 *     pre-validation flows. Normal hostnames use automatic HTTP DCV, so no TXT
 *     record should be required.
 *
 * Returns a per-record result the UI can render as ✅ / ❌ so users can
 * self-diagnose "stuck on Verifying" without leaving Petal. Read-only,
 * authenticated, scoped to a domain the user owns.
 *
 * Why DoH instead of node:dns? The Worker runtime doesn't expose a real
 * resolver — fetch() to Cloudflare's 1.1.1.1 DoH endpoint is the supported
 * path and returns globally-propagated answers identical to what Let's
 * Encrypt sees.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  PETAL_DOMAIN_CNAME_TARGET as PETAL_DOMAIN_CNAME_TARGET_FALLBACK,
} from "@/lib/domains";

const Input = z.object({
  projectId: z.string().uuid(),
  domainId: z.string().uuid(),
});

type DohAnswer = { name: string; type: number; TTL: number; data: string };
type DohResponse = { Status: number; Answer?: DohAnswer[] };

const TYPE_A = 1;
const TYPE_CNAME = 5;
const TYPE_TXT = 16;

async function authorize(request: Request): Promise<string | Response> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return new Response("Server misconfigured", { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
  const token = auth.slice("Bearer ".length);
  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) return new Response("Unauthorized", { status: 401 });
  return data.claims.sub;
}

/** Query Cloudflare DoH for a (name, type). Returns the raw record values. */
async function doh(name: string, type: number): Promise<string[]> {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(
    name,
  )}&type=${type}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/dns-json" },
      // DoH should return quickly; cap at 4s so a slow resolver can't hang.
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as DohResponse;
    return (json.Answer ?? [])
      .filter((a) => a.type === type)
      .map((a) => a.data);
  } catch {
    return [];
  }
}

/** TXT values come back from DoH wrapped in quotes — strip them. */
function unquoteTxt(raw: string): string {
  // DoH can return concatenated quoted segments: `"part1" "part2"` → join.
  const parts = raw.match(/"([^"]*)"/g);
  if (parts) return parts.map((p) => p.slice(1, -1)).join("");
  return raw.replace(/^"(.*)"$/s, "$1");
}

/** CNAME values often have a trailing dot — normalise both sides for compare. */
function normHost(s: string): string {
  return s.toLowerCase().replace(/\.$/, "").trim();
}

type CheckRecord = {
  kind: "routing" | "txt";
  type: "A" | "ALIAS" | "CNAME" | "TXT";
  host: string;
  expected: string;
  found: string[];
  status: "ok" | "missing" | "wrong";
  hint: string | null;
};

async function checkRouting(hostname: string): Promise<CheckRecord> {
  // Petal Cloudflare for SaaS routing must target the SaaS hostname. For apex
  // domains, registrars such as Namecheap expose this as ALIAS/ANAME and then
  // flatten it to A records publicly, so a raw A lookup alone is not enough.
  const labels = hostname.split(".");
  const isApex = labels.length === 2;
  const wanted = normHost(PETAL_DOMAIN_CNAME_TARGET_FALLBACK);

  if (isApex) {
    const [cnames, aRecords, targetARecords] = await Promise.all([
      doh(hostname, TYPE_CNAME),
      doh(hostname, TYPE_A),
      doh(PETAL_DOMAIN_CNAME_TARGET_FALLBACK, TYPE_A),
    ]);
    const targetAs = new Set(targetARecords.map(normHost));
    const ok =
      cnames.some((c) => normHost(c) === wanted) ||
      (targetAs.size > 0 && aRecords.some((a) => targetAs.has(normHost(a))));
    return {
      kind: "routing",
      type: "ALIAS",
      host: hostname,
      expected: PETAL_DOMAIN_CNAME_TARGET_FALLBACK,
      found: cnames.length > 0 ? cnames.map(normHost) : aRecords,
      status: ok ? "ok" : "wrong",
      hint: ok
        ? null
        : `Remove the A record and add an ALIAS/ANAME record for @ pointing to ${PETAL_DOMAIN_CNAME_TARGET_FALLBACK}.`,
    };
  }

  // Subdomain → CNAME.
  const cnames = await doh(hostname, TYPE_CNAME);
  if (cnames.length === 0) {
    return {
      kind: "routing",
      type: "CNAME",
      host: hostname,
      expected: PETAL_DOMAIN_CNAME_TARGET_FALLBACK,
      found: [],
      status: "missing",
      hint: `No CNAME found at ${hostname}. Add one pointing to ${PETAL_DOMAIN_CNAME_TARGET_FALLBACK}.`,
    };
  }
  const ok = cnames.some((c) => normHost(c) === wanted);
  return {
    kind: "routing",
    type: "CNAME",
    host: hostname,
    expected: PETAL_DOMAIN_CNAME_TARGET_FALLBACK,
    found: cnames.map(normHost),
    status: ok ? "ok" : "wrong",
    hint: ok
      ? null
      : `CNAME points to ${cnames.map(normHost).join(", ")} — change it to ${PETAL_DOMAIN_CNAME_TARGET_FALLBACK}.`,
  };
}

async function checkTxt(name: string, expected: string): Promise<CheckRecord> {
  const txts = (await doh(name, TYPE_TXT)).map(unquoteTxt);
  if (txts.length === 0) {
    return {
      kind: "txt",
      type: "TXT",
      host: name,
      expected,
      found: [],
      status: "missing",
      hint: `No TXT records found at ${name}. Most registrars want only the part before .${name.split(".").slice(1).join(".")} as the host.`,
    };
  }
  const ok = txts.some((t) => t === expected);
  return {
    kind: "txt",
    type: "TXT",
    host: name,
    expected,
    found: txts,
    status: ok ? "ok" : "wrong",
    hint: ok
      ? null
      : `Found TXT(s) but none match. Check for stray quotes/spaces in the value.`,
  };
}

export const Route = createFileRoute("/api/domains/dns-check")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorize(request);
        if (auth instanceof Response) return auth;

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON body", { status: 400 });
        }
        const parsed = Input.safeParse(body);
        if (!parsed.success) return new Response(parsed.error.message, { status: 400 });

        // Verify ownership + load the records we expect.
        const { data: project, error: pErr } = await supabaseAdmin
          .from("projects")
          .select("id, owner_id")
          .eq("id", parsed.data.projectId)
          .maybeSingle();
        if (pErr) return new Response(pErr.message, { status: 500 });
        if (!project) return new Response("Project not found", { status: 404 });
        if (project.owner_id !== auth) return new Response("Forbidden", { status: 403 });

        const { data: domain, error: dErr } = await supabaseAdmin
          .from("project_domains")
          .select(
            "id, project_id, hostname, verification_txt_name, verification_txt_value, verification_records",
          )
          .eq("id", parsed.data.domainId)
          .maybeSingle();
        if (dErr) return new Response(dErr.message, { status: 500 });
        if (!domain || domain.project_id !== parsed.data.projectId) {
          return new Response("Domain not found", { status: 404 });
        }

        const txtRecords = (domain.verification_records as
          | Array<{ name: string; value: string }>
          | null) ?? [];
        const expectedTxts = (
          txtRecords.length > 0
            ? txtRecords
            : domain.verification_txt_name && domain.verification_txt_value
            ? [
                {
                  name: domain.verification_txt_name,
                  value: domain.verification_txt_value,
                },
              ]
            : []
        ).filter((r) => !r.value.toLowerCase().includes("no txt record required"));

        // Run all lookups in parallel — total time bounded by slowest DoH call.
        const [routing, ...txts] = await Promise.all([
          checkRouting(domain.hostname),
          ...expectedTxts.map((r) => checkTxt(r.name, r.value)),
        ]);

        const allOk =
          routing.status === "ok" && txts.every((t) => t.status === "ok");

        return Response.json({
          checkedAt: new Date().toISOString(),
          allOk,
          routing,
          txts,
        });
      },
    },
  },
});
