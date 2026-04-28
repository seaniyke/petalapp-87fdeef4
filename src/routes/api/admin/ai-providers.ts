/**
 * Admin API for the /admin/ai-providers console.
 *
 * Implemented as a route (not `createServerFn`) because `createServerFn` does
 * NOT forward the user's Supabase access token to the server, so the
 * `requireSupabaseAuth` middleware always returned 401.
 *
 * Actions (all POST with `{ action: ..., ... }`):
 *   - "list"       → list all features + provider settings
 *   - "set"        → upsert one feature's provider/model/fallback
 *   - "costs"      → 7-day (or `days` arg) usage rollup
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  assertAdmin,
  listProviderSettings,
  setProviderSetting,
  getCostSummary,
  type SetProviderInput,
} from "@/server/ai-provider-admin.server";
import type { AiFeature } from "@/server/ai-provider.server";

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

export const Route = createFileRoute("/api/admin/ai-providers")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const userIdOrResp = await authorize(request);
        if (userIdOrResp instanceof Response) return userIdOrResp;
        const userId = userIdOrResp;

        try {
          await assertAdmin(userId);
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : "Forbidden" },
            { status: 403 },
          );
        }

        let body: { action?: string; [k: string]: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: "Invalid JSON" }, { status: 400 });
        }

        try {
          switch (body.action) {
            case "list": {
              const result = await listProviderSettings();
              return Response.json(result);
            }
            case "set": {
              const input = body as unknown as { input: SetProviderInput };
              if (!input.input || typeof input.input !== "object") {
                return Response.json({ error: "Missing input" }, { status: 400 });
              }
              await setProviderSetting(userId, input.input);
              return Response.json({ ok: true });
            }
            case "costs": {
              const days =
                typeof body.days === "number" ? (body.days as number) : undefined;
              const result = await getCostSummary(days);
              return Response.json(result);
            }
            default:
              return Response.json({ error: "Unknown action" }, { status: 400 });
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Server error";
          return Response.json({ error: msg }, { status: 500 });
        }
      },
    },
  },
});

// Re-export for typed client wrapper consumers.
export type { AiFeature };
