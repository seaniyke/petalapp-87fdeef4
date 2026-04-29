/**
 * Custom-domain management — HTTP endpoints.
 *
 * Wires user-facing domain actions to Cloudflare for SaaS. Cloudflare handles
 * ownership verification (TXT) and SSL issuance automatically; we mirror its
 * status into project_domains so the UI can show progress.
 *
 * Routes:
 *   POST /api/domains?action=list        -> list domains for a project
 *   POST /api/domains?action=add         -> register hostname with Cloudflare + return DNS records
 *   POST /api/domains?action=verify      -> poll Cloudflare and sync status/SSL
 *   POST /api/domains?action=set-primary -> mark one domain primary
 *   POST /api/domains?action=remove      -> delete from Cloudflare + DB
 *
 * All actions require a Bearer token and verify project ownership.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  createCustomHostname,
  getCustomHostname,
  recheckCustomHostname,
  deleteCustomHostname,
  mapCfStatus,
  extractAllTxtValidations,
} from "@/server/cloudflare-saas.server";

// FQDN-ish: 4..253 chars, lowercase letters/digits/dot/hyphen, must include a dot.
const HOSTNAME_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const ProjectIdInput = z.object({ projectId: z.string().uuid() });

const AddInput = z.object({
  projectId: z.string().uuid(),
  hostname: z
    .string()
    .trim()
    .toLowerCase()
    .min(4)
    .max(253)
    .regex(HOSTNAME_RE, "Enter a valid domain like acme.com or blog.acme.com"),
});

const DomainIdInput = z.object({
  projectId: z.string().uuid(),
  domainId: z.string().uuid(),
});

const DOMAIN_COLS =
  "id, hostname, status, is_primary, verification_txt_name, verification_txt_value, verification_records, ssl_status, last_checked_at, error_message, created_at, provider_hostname_id";

async function authorize(request: Request): Promise<string | Response> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return new Response("Server misconfigured", { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }
  const token = auth.slice("Bearer ".length);
  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    return new Response("Unauthorized", { status: 401 });
  }
  return data.claims.sub;
}

async function assertOwnsProject(
  projectId: string,
  userId: string,
): Promise<Response | null> {
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select("id, owner_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error) return new Response(error.message, { status: 500 });
  if (!data) return new Response("Project not found", { status: 404 });
  if (data.owner_id !== userId) return new Response("Forbidden", { status: 403 });
  return null;
}

async function assertOwnsDomain(
  projectId: string,
  domainId: string,
  userId: string,
): Promise<{ row: { id: string; project_id: string; provider_hostname_id: string | null } } | Response> {
  const ownerErr = await assertOwnsProject(projectId, userId);
  if (ownerErr) return ownerErr;
  const { data, error } = await supabaseAdmin
    .from("project_domains")
    .select("id, project_id, provider_hostname_id")
    .eq("id", domainId)
    .maybeSingle();
  if (error) return new Response(error.message, { status: 500 });
  if (!data) return new Response("Domain not found", { status: 404 });
  if (data.project_id !== projectId) {
    return new Response("Forbidden", { status: 403 });
  }
  return { row: data };
}

/* ---------------------------- handlers ---------------------------- */

async function handleList(userId: string, body: unknown): Promise<Response> {
  const parsed = ProjectIdInput.safeParse(body);
  if (!parsed.success) return new Response(parsed.error.message, { status: 400 });
  const ownerErr = await assertOwnsProject(parsed.data.projectId, userId);
  if (ownerErr) return ownerErr;

  const { data, error } = await supabaseAdmin
    .from("project_domains")
    .select(DOMAIN_COLS)
    .eq("project_id", parsed.data.projectId)
    .order("created_at", { ascending: true });
  if (error) return new Response(error.message, { status: 500 });
  return Response.json(data ?? []);
}

async function handleAdd(userId: string, body: unknown): Promise<Response> {
  const parsed = AddInput.safeParse(body);
  if (!parsed.success) {
    return new Response(parsed.error.issues[0]?.message ?? "Invalid input", {
      status: 400,
    });
  }
  const ownerErr = await assertOwnsProject(parsed.data.projectId, userId);
  if (ownerErr) return ownerErr;

  // Connecting a domain the user already owns is free — no slot required.
  // (Paid `domain_slots` are now reserved for domains *purchased* through
  // Petal via the Cloudflare registrar integration.)

  // 1) Register with Cloudflare for SaaS.
  let cf;
  try {
    cf = await createCustomHostname(parsed.data.hostname);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Cloudflare error";
    if (msg.includes("1414") || msg.toLowerCase().includes("already exists")) {
      return new Response(
        "That domain is already connected on Petal — remove it first or contact support.",
        { status: 409 },
      );
    }
    return new Response(`Couldn't register with Cloudflare: ${msg}`, {
      status: 502,
    });
  }

  // Cloudflare's correct real-time validation path for normal SaaS hostnames
  // is HTTP DCV: once DNS routes to Petal, Cloudflare serves the CA token at
  // the edge. TXT records are only expected for wildcard/pre-validation flows,
  // but keep support in case Cloudflare returns them for an edge case.
  let txts = extractAllTxtValidations(cf);
  for (let attempt = 0; attempt < 4 && cf.ssl?.status === "initializing"; attempt++) {
    await new Promise((r) => setTimeout(r, 750));
    try {
      cf = await getCustomHostname(cf.id);
      const next = extractAllTxtValidations(cf);
      if (next.length > txts.length) txts = next;
    } catch {
      break;
    }
  }
  const firstTxt = txts[0];
  const txtName = firstTxt?.name ?? `_cf-http-validation.${parsed.data.hostname}`;
  const txtValue =
    firstTxt?.value ?? "Automatic HTTP validation — no TXT record required";
  const mapped = mapCfStatus(cf);

  const { data, error } = await supabaseAdmin
    .from("project_domains")
    .insert({
      project_id: parsed.data.projectId,
      hostname: parsed.data.hostname,
      status: mapped.status,
      ssl_status: mapped.ssl_status,
      error_message: mapped.error_message,
      verification_txt_name: txtName,
      verification_txt_value: txtValue,
      verification_records: txts,
      provider_hostname_id: cf.id,
      last_checked_at: new Date().toISOString(),
    })
    .select(DOMAIN_COLS)
    .single();
  if (error) {
    await deleteCustomHostname(cf.id).catch(() => {});
    if (error.code === "23505") {
      return new Response("That domain is already connected to a project.", {
        status: 409,
      });
    }
    if (error.message.includes("at most 5")) {
      return new Response(error.message.replace(/^.*?at most/, "At most"), {
        status: 400,
      });
    }
    return new Response(error.message, { status: 400 });
  }

  return Response.json(data);
}

async function handleVerify(userId: string, body: unknown): Promise<Response> {
  const parsed = DomainIdInput.safeParse(body);
  if (!parsed.success) return new Response(parsed.error.message, { status: 400 });
  const own = await assertOwnsDomain(parsed.data.projectId, parsed.data.domainId, userId);
  if (own instanceof Response) return own;

  // If we somehow have no Cloudflare ID (legacy row), bail with a hint.
  const cfId = own.row.provider_hostname_id;
  if (!cfId) {
    return new Response(
      "This domain wasn't registered with our SSL provider. Remove it and add it again.",
      { status: 409 },
    );
  }

  let cf;
  try {
    cf = await getCustomHostname(cfId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Cloudflare error";
    return new Response(`Couldn't reach Cloudflare: ${msg}`, { status: 502 });
  }

  const mapped = mapCfStatus(cf);
  const txts = extractAllTxtValidations(cf);

  // Build the patch — only overwrite TXT fields if Cloudflare has issued any.
  const patch: Database["public"]["Tables"]["project_domains"]["Update"] = {
    status: mapped.status,
    ssl_status: mapped.ssl_status,
    error_message: mapped.error_message,
    last_checked_at: new Date().toISOString(),
  };
  if (txts.length > 0) {
    patch.verification_txt_name = txts[0].name;
    patch.verification_txt_value = txts[0].value;
    patch.verification_records = txts;
  }

  const { data, error } = await supabaseAdmin
    .from("project_domains")
    .update(patch)
    .eq("id", parsed.data.domainId)
    .select(DOMAIN_COLS)
    .single();
  if (error) return new Response(error.message, { status: 500 });
  return Response.json(data);
}

async function handleSetPrimary(
  userId: string,
  body: unknown,
): Promise<Response> {
  const parsed = DomainIdInput.safeParse(body);
  if (!parsed.success) return new Response(parsed.error.message, { status: 400 });
  const own = await assertOwnsDomain(parsed.data.projectId, parsed.data.domainId, userId);
  if (own instanceof Response) return own;

  // Unset any existing primary first (partial unique index would otherwise reject).
  const { error: clearErr } = await supabaseAdmin
    .from("project_domains")
    .update({ is_primary: false })
    .eq("project_id", parsed.data.projectId)
    .eq("is_primary", true);
  if (clearErr) return new Response(clearErr.message, { status: 500 });

  const { data, error } = await supabaseAdmin
    .from("project_domains")
    .update({ is_primary: true })
    .eq("id", parsed.data.domainId)
    .select(DOMAIN_COLS)
    .single();
  if (error) return new Response(error.message, { status: 500 });
  return Response.json(data);
}

async function handleRemove(userId: string, body: unknown): Promise<Response> {
  const parsed = DomainIdInput.safeParse(body);
  if (!parsed.success) return new Response(parsed.error.message, { status: 400 });
  const own = await assertOwnsDomain(parsed.data.projectId, parsed.data.domainId, userId);
  if (own instanceof Response) return own;

  // Best-effort delete from Cloudflare first; if it fails we still remove the
  // row so the user isn't stuck with a "ghost" domain in the UI.
  if (own.row.provider_hostname_id) {
    await deleteCustomHostname(own.row.provider_hostname_id).catch(() => {});
  }

  const { error } = await supabaseAdmin
    .from("project_domains")
    .delete()
    .eq("id", parsed.data.domainId);
  if (error) return new Response(error.message, { status: 500 });
  return Response.json({ ok: true });
}

export const Route = createFileRoute("/api/domains")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authorize(request);
        if (auth instanceof Response) return auth;

        const url = new URL(request.url);
        const action = url.searchParams.get("action");

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON body", { status: 400 });
        }

        switch (action) {
          case "list":
            return handleList(auth, body);
          case "add":
            return handleAdd(auth, body);
          case "verify":
            return handleVerify(auth, body);
          case "set-primary":
            return handleSetPrimary(auth, body);
          case "remove":
            return handleRemove(auth, body);
          default:
            return new Response("Unknown action", { status: 400 });
        }
      },
    },
  },
});
