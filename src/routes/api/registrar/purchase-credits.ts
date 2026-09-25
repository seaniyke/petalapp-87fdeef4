/**
 * /api/registrar/purchase-credits — buy a domain with Kimble Credits.
 *
 * GET  → { usdCentsPerCredit }  (so the dialog can show a credit price)
 * POST → { projectId, hostname } → spends credits, then kicks off the
 *        Cloudflare registration exactly like the paid-by-card path.
 *
 * Money safety:
 *   - price is re-quoted server side (never trusted from the client)
 *   - credits are spent BEFORE registration starts; any failure between the
 *     charge and a successfully recorded purchase row refunds them.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { searchDomains, applyMarkup } from "@/server/cloudflare-registrar.server";
import { checkRateLimit, rateLimitResponse } from "@/server/rate-limit.server";
import { economicsValue } from "@/server/economics-config.server";
import { spendCredit, refundCredit } from "@/server/credits.server";
import { startDomainRegistration } from "@/server/domain-purchase.server";

const Body = z.object({
  projectId: z.string().uuid(),
  hostname: z
    .string()
    .trim()
    .toLowerCase()
    .min(4)
    .max(253)
    .regex(
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/,
      "Enter a valid domain like acme.com",
    ),
});

/** Cash cost in USD cents → whole credits, rounded up. */
export function creditsForUsdCents(usdCents: number, usdCentsPerCredit: number): number {
  const rate = usdCentsPerCredit > 0 ? usdCentsPerCredit : 20;
  return Math.max(1, Math.ceil(usdCents / rate));
}

async function authUser(request: Request) {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(auth.slice(7));
  if (error || !data.user) return null;
  return data.user;
}

export const Route = createFileRoute("/api/registrar/purchase-credits")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await authUser(request);
        if (!user) return new Response("Unauthorized", { status: 401 });
        const usdCentsPerCredit = await economicsValue("credit_retail_usd_cents");
        return Response.json({ usdCentsPerCredit });
      },

      POST: async ({ request }) => {
        const user = await authUser(request);
        if (!user) return new Response("Unauthorized", { status: 401 });
        const userId = user.id;

        const rl = checkRateLimit("registrar-purchase", userId, 5, 30);
        if (!rl.ok) return rateLimitResponse(rl);

        let parsed: z.infer<typeof Body>;
        try {
          parsed = Body.parse(await request.json());
        } catch (e) {
          return new Response(e instanceof Error ? e.message : "Invalid input", { status: 400 });
        }

        const { data: proj } = await supabaseAdmin
          .from("projects")
          .select("id, owner_id")
          .eq("id", parsed.projectId)
          .maybeSingle();
        if (!proj) return new Response("Project not found", { status: 404 });
        if (proj.owner_id !== userId) return new Response("Forbidden", { status: 403 });

        const { data: dup } = await supabaseAdmin
          .from("purchased_domains")
          .select("id")
          .eq("hostname", parsed.hostname)
          .in("status", ["pending_payment", "registering", "polling", "active"])
          .maybeSingle();
        if (dup) {
          return new Response("That domain is already being registered.", { status: 409 });
        }

        // Re-quote with Cloudflare so the price can't be tampered with.
        let wholesaleCents: number;
        try {
          const results = await searchDomains(parsed.hostname);
          const hit = results.find((r) => r.hostname === parsed.hostname);
          if (!hit || !hit.available || hit.wholesaleCents == null) {
            return new Response("That domain isn't available anymore.", { status: 409 });
          }
          wholesaleCents = hit.wholesaleCents;
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Couldn't reach registrar";
          return new Response(`Couldn't price that domain: ${msg}`, { status: 502 });
        }

        const chargedUsdCents = applyMarkup(wholesaleCents);
        const usdCentsPerCredit = await economicsValue("credit_retail_usd_cents");
        const credits = creditsForUsdCents(chargedUsdCents, usdCentsPerCredit);

        const spent = await spendCredit({
          userId,
          amount: credits,
          reason: "domain_purchase",
          projectId: parsed.projectId,
          metadata: { hostname: parsed.hostname, usd_cents: chargedUsdCents },
        });
        if (!spent.ok) {
          if (spent.reason === "insufficient_credits") {
            return new Response(
              JSON.stringify({ error: "Not enough credits", code: "insufficient_credits", credits }),
              { status: 402, headers: { "Content-Type": "application/json" } },
            );
          }
          return new Response("Couldn't take payment. Please try again.", { status: 500 });
        }

        const reference = `cr_${crypto.randomUUID().replace(/-/g, "")}`;
        const { error: purchErr } = await supabaseAdmin.from("purchased_domains").insert({
          project_id: parsed.projectId,
          user_id: userId,
          hostname: parsed.hostname,
          wholesale_cost_cents: wholesaleCents,
          charged_cents: chargedUsdCents,
          charged_minor: chargedUsdCents,
          currency_code: "USD",
          status: "pending_payment",
          paystack_reference: reference,
        });
        if (purchErr) {
          await refundCredit({ userId, ledgerId: spent.ledgerId, reason: "refund" });
          return new Response(`Couldn't record purchase: ${purchErr.message}`, { status: 500 });
        }

        try {
          await startDomainRegistration({ reference });
        } catch (e) {
          console.error("[domain] credit registration kickoff failed", e);
          // The row stays for the reconciler; surface a soft error.
          return Response.json({
            ok: true,
            credits,
            hostname: parsed.hostname,
            pending: true,
          });
        }

        return Response.json({ ok: true, credits, hostname: parsed.hostname, pending: false });
      },
    },
  },
});
