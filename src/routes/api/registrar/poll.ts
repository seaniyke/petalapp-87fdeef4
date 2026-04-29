/**
 * POST /api/registrar/poll — owner-triggered poll for domain registrations
 * that are still in flight.
 *
 * Body shape (one of):
 *   { projectId: string }  → poll all in-flight rows for the project
 *   { reference: string }  → poll a single purchase by paystack reference
 *
 * Auth: caller must be the project owner. Safe to spam from the UI.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  pollDomainRegistration,
  startDomainRegistration,
} from "@/server/domain-purchase.server";

const Body = z.union([
  z.object({ projectId: z.string().uuid() }),
  z.object({ reference: z.string().min(1).max(128) }),
]);

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

        // Resolve target rows + verify ownership.
        let rows: Array<{ id: string; hostname: string; status: string; project_id: string; paystack_reference: string | null }> = [];
        if ("reference" in parsed) {
          const { data: row } = await supabaseAdmin
            .from("purchased_domains")
            .select("id, hostname, status, project_id, user_id, paystack_reference")
            .eq("paystack_reference", parsed.reference)
            .maybeSingle();
          if (!row) return new Response("Not found", { status: 404 });
          if ((row as { user_id: string }).user_id !== userId) {
            return new Response("Forbidden", { status: 403 });
          }
          rows = [row as typeof rows[number]];
        } else {
          const { data: proj } = await supabaseAdmin
            .from("projects")
            .select("id, owner_id")
            .eq("id", parsed.projectId)
            .maybeSingle();
          if (!proj) return new Response("Project not found", { status: 404 });
          if (proj.owner_id !== userId) {
            return new Response("Forbidden", { status: 403 });
          }
          const { data: list } = await supabaseAdmin
            .from("purchased_domains")
            .select("id, hostname, status, project_id, paystack_reference")
            .eq("project_id", parsed.projectId)
            .in("status", ["pending_payment", "registering", "polling"]);
          rows = (list ?? []) as typeof rows;
        }

        const updates: Array<{ id: string; hostname: string; status: string }> = [];
        for (const row of rows) {
          try {
            // Self-heal: if the row is still `pending_payment` but the
            // Paystack transaction is `success`, kick off registration now.
            // (Webhook background promises can be killed by the Worker.)
            if (row.status === "pending_payment" && row.paystack_reference) {
              const { data: tx } = await supabaseAdmin
                .from("paystack_transactions")
                .select("status")
                .eq("reference", row.paystack_reference)
                .maybeSingle();
              if ((tx as { status: string } | null)?.status === "success") {
                await startDomainRegistration({ reference: row.paystack_reference });
              }
            }
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
