/**
 * Developer key management — master key (Custard AI) only.
 * GET  /api/public/v1/keys  → list keys (never the secret)
 * POST /api/public/v1/keys  → create; the plain key is returned ONCE.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { json, preflight, requireServiceCaller, verifyApiCaller } from "@/server/service-api.server";

const CreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  ownerLabel: z.string().trim().max(200).optional(),
  scopes: z.array(z.string()).optional(),
});
const COLS = "id, name, owner_label, key_prefix, scopes, created_at, last_used_at, revoked_at";

async function guard(request: Request) {
  const denied = await verifyApiCaller(request);
  if (denied) return denied;
  return requireServiceCaller(request);
}

export const Route = createFileRoute("/api/public/v1/keys")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request }) => {
        const blocked = await guard(request);
        if (blocked) return blocked;
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("developer_api_keys")
          .select(COLS)
          .order("created_at", { ascending: false })
          .limit(500);
        if (error) return json({ error: "list_failed" }, 500);
        return json({ keys: data ?? [] });
      },
      POST: async ({ request }) => {
        const blocked = await guard(request);
        if (blocked) return blocked;
        const parsed = CreateBody.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) return json({ error: "invalid_body", issues: parsed.error.issues }, 400);
        const { generateKey, hashKey, displayPrefix, normalizeScopes } = await import("@/server/developer-keys");
        const scopes = normalizeScopes(parsed.data.scopes);
        if (!scopes) return json({ error: "invalid_scopes", allowed: ["projects:read", "projects:write"] }, 400);
        const key = generateKey();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("developer_api_keys")
          .insert({
            name: parsed.data.name,
            owner_label: parsed.data.ownerLabel ?? null,
            key_prefix: displayPrefix(key),
            key_hash: await hashKey(key),
            scopes,
          })
          .select(COLS)
          .single();
        if (error || !data) return json({ error: "create_failed" }, 500);
        return json({ key: data, secret: key, note: "Store this key now; it cannot be shown again." }, 201);
      },
    },
  },
});
