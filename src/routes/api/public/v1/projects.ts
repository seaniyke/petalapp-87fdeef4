import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { json, preflight, serviceUserId, verifyApiCaller } from "@/server/service-api.server";

const ExternalId = z.string().trim().min(1).max(128);
const CreateBody = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  externalUserId: ExternalId.optional(),
});
const COLS = "id, title, revision, external_user_id, created_at, updated_at";

export const Route = createFileRoute("/api/public/v1/projects")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request }) => {
        const denied = await verifyApiCaller(request);
        if (denied) return denied;
        const ext = new URL(request.url).searchParams.get("externalUserId");
        if (ext !== null && !ExternalId.safeParse(ext).success) return json({ error: "invalid_external_user_id" }, 400);
        const owner = await serviceUserId();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let q = supabaseAdmin.from("projects").select(COLS).eq("owner_id", owner);
        if (ext !== null) q = q.eq("external_user_id", ext.trim());
        const { data, error } = await q.order("updated_at", { ascending: false }).limit(200);
        if (error) return json({ error: "list_failed" }, 500);
        return json({ projects: data ?? [] });
      },
      POST: async ({ request }) => {
        const denied = await verifyApiCaller(request);
        if (denied) return denied;
        const parsed = CreateBody.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) return json({ error: "invalid_body", issues: parsed.error.issues }, 400);
        const owner = await serviceUserId();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("projects")
          .insert({
            owner_id: owner,
            title: parsed.data.title ?? "Untitled project",
            slug: "",
            external_user_id: parsed.data.externalUserId ?? null,
          })
          .select(COLS)
          .single();
        if (error || !data) return json({ error: "create_failed", detail: error?.message }, 500);
        return json({ project: data }, 201);
      },
    },
  },
});
