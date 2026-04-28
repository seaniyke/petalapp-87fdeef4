/**
 * POST /api/registrar/purchase — start a domain-purchase Paystack checkout.
 *
 * Flow:
 *   1. Verify auth + project ownership.
 *   2. Re-verify the domain is available and look up the wholesale price
 *      (so the user can't tamper with the price they POST).
 *   3. Apply our 25% markup → USD cents.
 *   4. Convert to the user's chosen currency via the existing currencies table.
 *   5. Insert a `pending_payment` row in `purchased_domains` AND a pending
 *      `paystack_transactions` row with `purpose='domain_purchase'`.
 *   6. Hand back the Paystack authorization URL.
 *
 * The Paystack webhook (see api/public/paystack/webhook.ts) handles what
 * happens after payment succeeds — it calls registerDomain() and then
 * connects the new hostname to the project.
 *
 * Body: { projectId, hostname, currency, returnUrl }
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { initializeTransaction, getEnvironment } from "@/server/paystack.server";
import {
  searchDomains,
  applyMarkup,
} from "@/server/cloudflare-registrar.server";

const SUPPORTED_CURRENCIES = ["NGN", "GHS", "KES", "ZAR", "USD"] as const;

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
  currency: z.enum(SUPPORTED_CURRENCIES),
  returnUrl: z.string().url().max(500),
});

export const Route = createFileRoute("/api/registrar/purchase")({
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
        if (authErr || !userData.user?.email) {
          return new Response("Unauthorized", { status: 401 });
        }
        const userId = userData.user.id;
        const userEmail = userData.user.email;

        let parsed: z.infer<typeof Body>;
        try {
          parsed = Body.parse(await request.json());
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Invalid input";
          return new Response(msg, { status: 400 });
        }

        // 1) Project ownership check.
        const { data: proj } = await supabaseAdmin
          .from("projects")
          .select("id, owner_id")
          .eq("id", parsed.projectId)
          .maybeSingle();
        if (!proj) return new Response("Project not found", { status: 404 });
        if (proj.owner_id !== userId) {
          return new Response("Forbidden", { status: 403 });
        }

        // 2) Confirm the hostname isn't already purchased.
        const { data: dup } = await supabaseAdmin
          .from("purchased_domains")
          .select("id, status")
          .eq("hostname", parsed.hostname)
          .in("status", ["pending_payment", "registering", "active"])
          .maybeSingle();
        if (dup) {
          return new Response("That domain is already in someone's cart or registered.", {
            status: 409,
          });
        }

        // 3) Re-check availability + price with Cloudflare.
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

        // 4) Apply markup → user-facing USD cents.
        const chargedUsdCents = applyMarkup(wholesaleCents);

        // 5) Convert to chosen currency.
        const { data: cur } = await supabaseAdmin
          .from("billing_currencies")
          .select("usd_rate, is_active, paystack_supported")
          .eq("code", parsed.currency)
          .maybeSingle();
        if (!cur || !cur.is_active || !cur.paystack_supported) {
          return new Response("Currency not available", { status: 400 });
        }
        const rate = Number(cur.usd_rate);
        if (rate <= 0) return new Response("Bad currency rate", { status: 500 });
        // chargedUsdCents → local minor units (assumes 2 decimal currencies — Paystack supported set is).
        const chargedMinor = Math.max(100, Math.round((chargedUsdCents / 100) * rate * 100));

        // 6) Persist pending records.
        const reference = `pt_${crypto.randomUUID().replace(/-/g, "")}`;
        const env = getEnvironment();

        const { data: purchaseRow, error: purchErr } = await supabaseAdmin
          .from("purchased_domains")
          .insert({
            project_id: parsed.projectId,
            user_id: userId,
            hostname: parsed.hostname,
            wholesale_cost_cents: wholesaleCents,
            charged_cents: chargedUsdCents,
            charged_minor: chargedMinor,
            currency_code: parsed.currency,
            status: "pending_payment",
            paystack_reference: reference,
          })
          .select("id")
          .single();
        if (purchErr) {
          return new Response(`Couldn't record purchase: ${purchErr.message}`, {
            status: 500,
          });
        }

        const { error: txErr } = await supabaseAdmin
          .from("paystack_transactions")
          .insert({
            user_id: userId,
            reference,
            purpose: "domain_purchase",
            item_code: parsed.hostname.slice(0, 64), // keep within column limit
            currency_code: parsed.currency,
            amount_minor: chargedMinor,
            usd_amount_cents: chargedUsdCents,
            status: "pending",
            environment: env,
            project_id: parsed.projectId,
          });
        if (txErr) {
          // Roll back the purchase row so the user can retry cleanly.
          await supabaseAdmin
            .from("purchased_domains")
            .delete()
            .eq("id", purchaseRow.id);
          return new Response(`Couldn't start checkout: ${txErr.message}`, {
            status: 500,
          });
        }

        // 7) Hand off to Paystack.
        try {
          const init = await initializeTransaction({
            email: userEmail,
            amountMinor: chargedMinor,
            currency: parsed.currency,
            reference,
            callbackUrl: parsed.returnUrl,
            metadata: {
              user_id: userId,
              purpose: "domain_purchase",
              hostname: parsed.hostname,
              project_id: parsed.projectId,
              purchased_domain_id: purchaseRow.id,
            },
          });
          return Response.json({
            authorizationUrl: init.authorizationUrl,
            reference: init.reference,
          });
        } catch (e) {
          // Clean up so the user can retry.
          await supabaseAdmin
            .from("purchased_domains")
            .delete()
            .eq("id", purchaseRow.id);
          await supabaseAdmin
            .from("paystack_transactions")
            .delete()
            .eq("reference", reference);
          const msg = e instanceof Error ? e.message : "Paystack error";
          return new Response(`Couldn't start checkout: ${msg}`, { status: 502 });
        }
      },
    },
  },
});
