/**
 * Labs feature flags API. Read/write the current user's `labs_flags` row.
 *   GET  /api/labs           -> { flags: { ... } }
 *   POST /api/labs  { flags } -> upsert
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const FlagsInput = z.object({
  flags: z.record(z.string().min(1).max(64).regex(/^[a-z0-9_]+$/), z.boolean()),
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

export const Route = createFileRoute("/api/labs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authorize(request);
        if (auth instanceof Response) return auth;
        const { data } = await supabaseAdmin
          .from("labs_flags")
          .select("flags")
          .eq("user_id", auth)
          .maybeSingle();
        return Response.json({ flags: (data?.flags as Record<string, boolean> | null) ?? {} });
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
        const parsed = FlagsInput.safeParse(body);
        if (!parsed.success) {
          return new Response(parsed.error.issues[0]?.message ?? "Invalid input", {
            status: 400,
          });
        }
        const { error } = await supabaseAdmin
          .from("labs_flags")
          .upsert(
            { user_id: auth, flags: parsed.data.flags, updated_at: new Date().toISOString() },
            { onConflict: "user_id" },
          );
        if (error) return new Response(error.message, { status: 500 });
        return Response.json({ ok: true, flags: parsed.data.flags });
      },
    },
  },
});
