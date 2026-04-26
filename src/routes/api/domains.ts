/**
 * Custom-domain management — HTTP endpoints.
 *
 * v1 records the user's intent and surfaces the DNS records they need to add
 * at their registrar. The actual DNS-side verification + SSL issuance happens
 * out of band (see plan: Cloudflare for SaaS) and flips status server-side.
 *
 * Routes:
 *   POST /api/domains?action=list        -> list domains for a project
 *   POST /api/domains?action=add         -> add a hostname (returns DNS records)
 *   POST /api/domains?action=verify      -> bump status to "verifying" + last_checked_at
 *   POST /api/domains?action=set-primary -> mark one domain primary
 *   POST /api/domains?action=remove      -> delete a domain
 *
 * All actions require a Bearer token and verify project ownership.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
): Promise<{ row: { id: string; project_id: string } } | Response> {
  const ownerErr = await assertOwnsProject(projectId, userId);
  if (ownerErr) return ownerErr;
  const { data, error } = await supabaseAdmin
    .from("project_domains")
    .select("id, project_id")
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
    .select(
      "id, hostname, status, is_primary, verification_txt_name, verification_txt_value, ssl_status, last_checked_at, error_message, created_at",
    )
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

  const txtName = "_petal-verify";
  // 32-char URL-safe nonce. crypto.randomUUID exists in the Worker runtime.
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const txtValue = `petal-verify=${nonce}`;

  const { data, error } = await supabaseAdmin
    .from("project_domains")
    .insert({
      project_id: parsed.data.projectId,
      hostname: parsed.data.hostname,
      status: "pending",
      verification_txt_name: txtName,
      verification_txt_value: txtValue,
    })
    .select(
      "id, hostname, status, is_primary, verification_txt_name, verification_txt_value, ssl_status, last_checked_at, error_message, created_at",
    )
    .single();
  if (error) {
    // Friendly message for unique-violation on hostname.
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

  // For now we just mark as "verifying" + bump last_checked_at. The real
  // DNS/SSL check runs in the provider integration (see plan).
  const { data, error } = await supabaseAdmin
    .from("project_domains")
    .update({
      status: "verifying",
      last_checked_at: new Date().toISOString(),
      error_message: null,
    })
    .eq("id", parsed.data.domainId)
    .select(
      "id, hostname, status, is_primary, verification_txt_name, verification_txt_value, ssl_status, last_checked_at, error_message, created_at",
    )
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
    .select(
      "id, hostname, status, is_primary, verification_txt_name, verification_txt_value, ssl_status, last_checked_at, error_message, created_at",
    )
    .single();
  if (error) return new Response(error.message, { status: 500 });
  return Response.json(data);
}

async function handleRemove(userId: string, body: unknown): Promise<Response> {
  const parsed = DomainIdInput.safeParse(body);
  if (!parsed.success) return new Response(parsed.error.message, { status: 400 });
  const own = await assertOwnsDomain(parsed.data.projectId, parsed.data.domainId, userId);
  if (own instanceof Response) return own;

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
