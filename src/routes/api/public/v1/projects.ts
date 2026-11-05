import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { json, preflight, serviceUserId, verifyServiceKey } from "@/server/service-api.server";

const CreateBody = z.object({ title: z.string().trim().min(1).max(120).optional() });

export const Route = createFileRoute("/api/public/v1/projects")({
  server: {
    handlers: {
      OPTIONS: async () => preflight(),
      GET: async ({ request }) => {
        const denied = verifyServiceKey(request);
        if (denied) return denied;
        const owner = await serviceUserId();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("projects")
          .select("id, title, revision, created_at, updated_at")
          .eq("owner_id", owner)
          .order("updated_at", { ascending: false })
          .limit(200);
        if (error) return json({ error: "list_failed" }, 500);
        return json({ projects: data ?? [] });
      },
      POST: async ({ request }) => {
        const denied = verifyServiceKey(request);
        if (denied) return denied;
        const parsed = CreateBody.safeParse(await request.json().catch(() => ({})));
        if (!parsed.success) return json({ error: "invalid_body", issues: parsed.error.issues }, 400);
        const owner = await serviceUserId();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("projects")
          .insert({ owner_id: owner, title: parsed.data.title ?? "Untitled project", slug: "" })
          .select("id, title, revision, created_at")
          .single();
        if (error || !data) return json({ error: "create_failed", detail: error?.message }, 500);
        return json({ project: data }, 201);
      },
    },
  },
});
