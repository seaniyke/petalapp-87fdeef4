/**
 * Connector Hub API (one-click sign-in).
 *   POST { action: "list", projectId }                -> connected accounts + ready providers
 *   POST { action: "start", projectId, connectorId }  -> { url } to the provider consent screen
 *   POST { action: "disconnect", projectId, connectorId }
 * Caller must own the project. Tokens never leave the server.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import {
  CALLBACK_PATH,
  OAUTH_PROVIDERS,
  buildAuthorizeUrl,
  providerReady,
  signState,
} from "@/server/connectors/oauth.server";

const Input = z.object({
  action: z.enum(["list", "start", "disconnect"]),
  projectId: z.string().uuid(),
  connectorId: z.string().regex(/^[a-z0-9_]+$/).max(64).optional(),
});

async function userIdFrom(request: Request): Promise<string | null> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const sb = createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await sb.auth.getClaims(auth.slice(7));
  return data?.claims?.sub ?? null;
}

export const Route = createFileRoute("/api/connectors")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userId = await userIdFrom(request);
        if (!userId) return new Response("Unauthorized", { status: 401 });
        const parsed = Input.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return new Response("Bad request", { status: 400 });
        const { action, projectId, connectorId } = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: project } = await supabaseAdmin
          .from("projects").select("owner_id").eq("id", projectId).maybeSingle();
        if (!project) return new Response("Project not found", { status: 404 });
        if (project.owner_id !== userId) return new Response("Forbidden", { status: 403 });
        // connector_accounts is newer than the generated types.
        const table = () => (supabaseAdmin as unknown as { from: (t: string) => any }).from("connector_accounts");

        if (action === "list") {
          const { data } = await table()
            .select("connector_id, external_account, status, updated_at")
            .eq("project_id", projectId);
          const ready = Object.keys(OAUTH_PROVIDERS).filter((id) => providerReady(id));
          return Response.json({ accounts: data ?? [], ready });
        }

        if (!connectorId || !OAUTH_PROVIDERS[connectorId]) return new Response("Unknown connector", { status: 400 });

        if (action === "disconnect") {
          await table().delete().eq("project_id", projectId).eq("connector_id", connectorId);
          return Response.json({ ok: true });
        }

        if (!providerReady(connectorId)) {
          return new Response("This connection isn't switched on yet.", { status: 409 });
        }
        const p = OAUTH_PROVIDERS[connectorId];
        const origin = new URL(request.url).origin;
        const state = await signState(process.env.CONNECTOR_TOKEN_KEY!, {
          u: userId, p: projectId, c: connectorId, r: origin, exp: Date.now() + 10 * 60_000,
        });
        const url = buildAuthorizeUrl(p, process.env[p.clientIdEnv]!, origin + CALLBACK_PATH, state);
        return Response.json({ url });
      },
    },
  },
});
