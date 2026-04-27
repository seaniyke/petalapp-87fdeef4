/**
 * Integrations Marketplace API.
 *
 *   GET  /api/integrations?action=catalog                 -> list available integrations
 *   POST /api/integrations  { action: "list", projectId } -> list installed for a project
 *   POST /api/integrations  { action: "install", ... }    -> install one
 *   POST /api/integrations  { action: "remove", ... }     -> remove one
 *
 * All write actions require the caller to own the target project.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { publicCatalog } from "@/server/integrations/registry.server";
import {
  installIntegration,
  listInstalled,
  removeIntegration,
} from "@/server/integrations/installer.server";

const ProjectId = z.object({ projectId: z.string().uuid() });
const InstallInput = z.object({
  projectId: z.string().uuid(),
  integrationCode: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/),
  fields: z.record(z.string().min(1).max(64), z.string().max(2000)),
});
const RemoveInput = z.object({
  projectId: z.string().uuid(),
  integrationCode: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/),
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
  if (error || !data?.claims?.sub) return new Response("Unauthorized", { status: 401 });
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

export const Route = createFileRoute("/api/integrations")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("action") === "catalog") {
          return Response.json({ integrations: publicCatalog() });
        }
        return new Response("Unknown action", { status: 400 });
      },
      POST: async ({ request }) => {
        const auth = await authorize(request);
        if (auth instanceof Response) return auth;

        let body: unknown;
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON body", { status: 400 });
        }
        const action = (body as { action?: string }).action;

        if (action === "list") {
          const parsed = ProjectId.safeParse(body);
          if (!parsed.success) return new Response(parsed.error.message, { status: 400 });
          const ownerErr = await assertOwnsProject(parsed.data.projectId, auth);
          if (ownerErr) return ownerErr;
          return Response.json({ installed: await listInstalled(parsed.data.projectId) });
        }

        if (action === "install") {
          const parsed = InstallInput.safeParse(body);
          if (!parsed.success) {
            return new Response(parsed.error.issues[0]?.message ?? "Invalid input", {
              status: 400,
            });
          }
          const ownerErr = await assertOwnsProject(parsed.data.projectId, auth);
          if (ownerErr) return ownerErr;
          const result = await installIntegration(parsed.data);
          if (!result.ok) return new Response(result.error, { status: 400 });
          return Response.json({ ok: true, view: result.view });
        }

        if (action === "remove") {
          const parsed = RemoveInput.safeParse(body);
          if (!parsed.success) return new Response(parsed.error.message, { status: 400 });
          const ownerErr = await assertOwnsProject(parsed.data.projectId, auth);
          if (ownerErr) return ownerErr;
          const result = await removeIntegration(parsed.data);
          if (!result.ok) return new Response(result.error, { status: 400 });
          return Response.json({ ok: true });
        }

        return new Response("Unknown action", { status: 400 });
      },
    },
  },
});
