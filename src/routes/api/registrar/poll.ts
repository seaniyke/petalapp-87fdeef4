/**
 * POST /api/registrar/poll — owner-triggered poll for domain registrations
 * that are still in flight.
 *
 * Body: { projectId: string }
 *
 * Auth: caller must be the project owner. Polls all of the project's
 * `purchased_domains` rows that are in `registering` or `polling` and
 * reports back their latest status. Safe to spam from the UI.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { pollDomainRegistration } from "@/server/domain-purchase.server";

const Body = z.object({
  projectId: z.string().uuid(),
});

export const Route = createFileRoute("/api/registrar/poll")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization");
        if (!auth?.startsWith("Bearer ")) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { data: userData, error: authErr } = await supabaseAdmin.auth.getUser(
          auth.slice(7),
        );
        if (authErr || !userData.user?.id) {
          return new Response("Unauthorized", { status: 401 });
        }
        const userId = userData.user.id;

        let parsed: z.infer<typeof Body>;
        try {
          parsed = Body.parse(await request.json());
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Invalid input";
          return new Response(msg, { status: 400 });
        }

        const { data: proj } = await supabaseAdmin
          .from("projects")
          .select("id, owner_id")
          .eq("id", parsed.projectId)
          .maybeSingle();
        if (!proj) return new Response("Project not found", { status: 404 });
        if (proj.owner_id !== userId) {
          return new Response("Forbidden", { status: 403 });
        }

        const { data: rows } = await supabaseAdmin
          .from("purchased_domains")
          .select("id, hostname, status")
          .eq("project_id", parsed.projectId)
          .in("status", ["registering", "polling"]);

        const updates: Array<{ id: string; hostname: string; status: string }> = [];
        for (const r of rows ?? []) {
          const row = r as { id: string; hostname: string; status: string };
          try {
            const { status } = await pollDomainRegistration({ rowId: row.id });
            updates.push({ id: row.id, hostname: row.hostname, status });
          } catch (e) {
            console.error("[registrar/poll] failed", row.hostname, e);
            updates.push({ id: row.id, hostname: row.hostname, status: row.status });
          }
        }

        return Response.json({ updates });
      },
    },
  },
});
