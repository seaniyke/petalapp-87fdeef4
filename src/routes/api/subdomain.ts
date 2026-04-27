/**
 * /api/subdomain — claim/check/release a `<slug>.buildwithpetal.com` for a project.
 *
 * Routes (action via query string):
 *   POST /api/subdomain?action=check    -> { available, reason? }
 *   POST /api/subdomain?action=claim    -> { hostname, status }
 *   POST /api/subdomain?action=release  -> { ok: true }
 *
 * Auth: bearer token. Owner-only.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  PETAL_ROOT_DOMAIN,
  claimSubdomain,
  isSlugAvailable,
  releaseSubdomain,
  validateSlug,
} from "@/server/petal-subdomain.server";

const ProjectIdInput = z.object({ projectId: z.string().uuid() });
const SlugInput = z.object({
  projectId: z.string().uuid(),
  slug: z.string().min(1).max(64),
});

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

async function assertOwnsProject(projectId: string, userId: string): Promise<Response | null> {
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

async function handleCheck(userId: string, body: unknown): Promise<Response> {
  const parsed = SlugInput.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { available: false, reason: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 200 },
    );
  }
  const ownerErr = await assertOwnsProject(parsed.data.projectId, userId);
  if (ownerErr) return ownerErr;

  const v = validateSlug(parsed.data.slug);
  if (!v.ok) {
    return Response.json({ available: false, reason: v.reason });
  }
  try {
    const free = await isSlugAvailable(v.slug, parsed.data.projectId);
    return Response.json({
      available: free,
      reason: free ? null : "That subdomain is already taken.",
      hostname: `${v.slug}.${PETAL_ROOT_DOMAIN}`,
    });
  } catch (e) {
    return Response.json(
      { available: false, reason: e instanceof Error ? e.message : "Check failed" },
      { status: 500 },
    );
  }
}

async function handleClaim(userId: string, body: unknown): Promise<Response> {
  const parsed = SlugInput.safeParse(body);
  if (!parsed.success) {
    return new Response(parsed.error.issues[0]?.message ?? "Invalid input", { status: 400 });
  }
  const ownerErr = await assertOwnsProject(parsed.data.projectId, userId);
  if (ownerErr) return ownerErr;

  // Release any previously-claimed slug for this project (slug change flow).
  const { data: existing } = await supabaseAdmin
    .from("projects")
    .select("subdomain")
    .eq("id", parsed.data.projectId)
    .maybeSingle();
  const desired = parsed.data.slug.trim().toLowerCase();
  if (existing?.subdomain && existing.subdomain !== desired) {
    await releaseSubdomain(parsed.data.projectId).catch(() => {});
  } else if (existing?.subdomain === desired) {
    // Already claimed — short-circuit.
    return Response.json({
      hostname: `${desired}.${PETAL_ROOT_DOMAIN}`,
      status: "active",
      slug: desired,
    });
  }

  try {
    const result = await claimSubdomain({
      projectId: parsed.data.projectId,
      slug: desired,
    });
    return Response.json({ ...result, slug: desired });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Claim failed", { status: 400 });
  }
}

async function handleRelease(userId: string, body: unknown): Promise<Response> {
  const parsed = ProjectIdInput.safeParse(body);
  if (!parsed.success) return new Response(parsed.error.message, { status: 400 });
  const ownerErr = await assertOwnsProject(parsed.data.projectId, userId);
  if (ownerErr) return ownerErr;
  try {
    await releaseSubdomain(parsed.data.projectId);
    return Response.json({ ok: true });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Release failed", { status: 500 });
  }
}

export const Route = createFileRoute("/api/subdomain")({
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
          case "check":
            return handleCheck(auth, body);
          case "claim":
            return handleClaim(auth, body);
          case "release":
            return handleRelease(auth, body);
          default:
            return new Response("Unknown action", { status: 400 });
        }
      },
    },
  },
});
