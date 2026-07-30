/**
 * POST /api/billing/initialize
 *
 * Starts a Paystack hosted-checkout transaction for either a plan or a
 * top-up pack, in the user's chosen currency.
 *
 * Body: { purpose: 'plan'|'pack', itemCode: string, currency: string }
 * Returns: { authorizationUrl, reference }
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { initializeTransaction, getEnvironment, fetchPlan, createPlan } from "@/server/paystack.server";
import { resolvePrice } from "@/server/billing-pricing.server";

const SUPPORTED_CURRENCIES = ["NGN", "GHS", "KES", "ZAR", "USD"] as const;

const Body = z.object({
  purpose: z.enum(["plan", "pack", "addon", "runtime_topup"]),
  itemCode: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  currency: z.enum(SUPPORTED_CURRENCIES),
  returnUrl: z.string().url().max(500),
  projectId: z.string().uuid().optional(),
  // For runtime_topup with custom amount: amount in display-currency minor units (e.g. kobo)
  customAmountMinor: z.number().int().positive().max(100_000_000).optional(),
});

export const Route = createFileRoute("/api/billing/initialize")({
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

        let parsed: z.infer<typeof Body>;
        try {
          parsed = Body.parse(await request.json());
        } catch {
          return new Response("Invalid body", { status: 400 });
        }

        try {
          // Credit packs are pay-as-you-go: any signed-in user can buy one
          // without a subscription. Project add-ons and Cloud + AI runtime
          // top-ups require full access — a paid plan OR purchased credits
          // still remaining. Gated server-side so the UI can't be bypassed.
          if (parsed.purpose === "addon" || parsed.purpose === "runtime_topup") {
            const { hasFullAccess } = await import("@/server/entitlements.server");
            if (!(await hasFullAccess(userData.user.id))) {
              return new Response(
                JSON.stringify({
                  error:
                    parsed.purpose === "runtime_topup"
                      ? "Buy credits or upgrade to a paid plan to top up your Cloud + AI balance."
                      : "Buy credits or upgrade to a paid plan to add this.",
                  code: "upgrade_required",
                }),
                { status: 403, headers: { "Content-Type": "application/json" } },
              );
            }
          }


          // Add-on purchases must be tied to a project the caller owns.
          if (parsed.purpose === "addon") {
            if (!parsed.projectId) {
              return new Response("projectId required for add-on", { status: 400 });
            }
            const { data: proj } = await supabaseAdmin
              .from("projects")
              .select("id, owner_id")
              .eq("id", parsed.projectId)
              .maybeSingle();
            if (!proj) return new Response("Project not found", { status: 404 });
            if (proj.owner_id !== userData.user.id) {
              return new Response("Forbidden", { status: 403 });
            }
          }

          // Resolve price. Runtime top-ups have a separate path because they
          // can be either a fixed pack (custom_amount_minor unset) or a
          // user-typed custom amount.
          let price: { amountMinor: number; usdAmountCents: number };
          if (parsed.purpose === "runtime_topup") {
            if (parsed.customAmountMinor) {
              // Custom amount: itemCode === "custom". Convert minor → USD cents.
              const { data: cur_row } = await supabaseAdmin
                .from("billing_currencies")
                .select("usd_rate, is_active")
                .eq("code", parsed.currency)
                .maybeSingle();
              if (!cur_row || !cur_row.is_active) {
                return new Response("Currency not available", { status: 400 });
              }
              const rate = Number(cur_row.usd_rate);
              if (rate <= 0) return new Response("Bad currency rate", { status: 500 });
              const localMajor = parsed.customAmountMinor / 100; // assumes 2-decimal
              const usdMajor = localMajor / rate;
              const usdCents = Math.floor(usdMajor * 100);
              // Enforce a sane minimum so we don't pay Paystack fees on a
              // sub-dollar charge. $1 USD floor.
              if (usdCents < 100) {
                return new Response(
                  JSON.stringify({
                    error: "Minimum top-up is $1.00 USD equivalent.",
                  }),
                  { status: 400, headers: { "Content-Type": "application/json" } },
                );
              }
              price = {
                amountMinor: parsed.customAmountMinor,
                usdAmountCents: usdCents,
              };
            } else {
              const { data: pack } = await supabaseAdmin
                .from("runtime_topup_packs")
                .select("amount_cents, currency_code, display_amount_minor, is_active")
                .eq("code", parsed.itemCode)
                .maybeSingle();
              if (!pack || !pack.is_active) {
                return new Response("Unknown runtime pack", { status: 400 });
              }
              if (pack.currency_code !== parsed.currency) {
                return new Response(
                  `This pack is priced in ${pack.currency_code}, not ${parsed.currency}`,
                  { status: 400 },
                );
              }
              price = {
                amountMinor: Number(pack.display_amount_minor),
                usdAmountCents: Number(pack.amount_cents),
              };
            }
          } else {
            price = await resolvePrice(parsed.purpose, parsed.itemCode, parsed.currency);
          }

          // For plan checkouts, we need a Paystack plan whose amount EXACTLY
          // matches the price we just resolved. Paystack ignores the `amount`
          // we pass to /transaction/initialize when a `plan` is also passed —
          // it always charges the plan's amount. Plans are immutable on
          // amount, so when admin changes the price we must create a new plan
          // and overwrite the stored code. We also fetch the plan's interval
          // and name from billing_plans (interval) and admin (display name).
          let paystackPlanCode: string | undefined;
          if (parsed.purpose === "plan") {
            const col = `paystack_plan_code_${parsed.currency.toLowerCase()}` as
              | "paystack_plan_code_ngn"
              | "paystack_plan_code_ghs"
              | "paystack_plan_code_kes"
              | "paystack_plan_code_zar"
              | "paystack_plan_code_usd";
            const { data: planRow } = await supabaseAdmin
              .from("billing_plans")
              .select(`code, name, paystack_interval, ${col}`)
              .eq("code", parsed.itemCode)
              .maybeSingle();
            if (!planRow) {
              return new Response(
                JSON.stringify({ error: "Plan not found.", code: "plan_not_found" }),
                { status: 400, headers: { "Content-Type": "application/json" } },
              );
            }
            const row = planRow as Record<string, string | null>;
            const storedCode = row[col];
            const interval = row.paystack_interval || "monthly";
            const planName = `${row.name ?? parsed.itemCode} (${parsed.currency})`;

            // Check whether the stored plan matches the resolved price.
            let needsNewPlan = !storedCode;
            if (storedCode) {
              const existing = await fetchPlan(storedCode);
              if (
                !existing ||
                Number(existing.amount) !== price.amountMinor ||
                existing.currency?.toUpperCase() !== parsed.currency
              ) {
                needsNewPlan = true;
              }
            }

            if (needsNewPlan) {
              const created = await createPlan({
                name: planName,
                amountMinor: price.amountMinor,
                currency: parsed.currency,
                interval,
              });
              await supabaseAdmin
                .from("billing_plans")
                .update({ [col]: created.plan_code } as never)
                .eq("code", parsed.itemCode);
              paystackPlanCode = created.plan_code;
            } else {
              paystackPlanCode = storedCode!;
            }
          }


          const reference = `pt_${crypto.randomUUID().replace(/-/g, "")}`;
          const env = getEnvironment();

          // Record the pending transaction first.
          const { error: insertErr } = await supabaseAdmin
            .from("paystack_transactions")
            .insert({
              user_id: userData.user.id,
              reference,
              purpose: parsed.purpose,
              item_code: parsed.itemCode,
              currency_code: parsed.currency,
              amount_minor: price.amountMinor,
              usd_amount_cents: price.usdAmountCents,
              status: "pending",
              environment: env,
              project_id: parsed.projectId ?? null,
            });
          if (insertErr) throw new Error(insertErr.message);

          let init;
          try {
            init = await initializeTransaction({
              email: userData.user.email,
              amountMinor: price.amountMinor,
              currency: parsed.currency,
              reference,
              callbackUrl: parsed.returnUrl,
              metadata: {
                user_id: userData.user.id,
                purpose: parsed.purpose,
                item_code: parsed.itemCode,
                project_id: parsed.projectId ?? null,
              },
              plan: paystackPlanCode,
            });
          } catch (e) {
            // Roll back the orphan pending row so the user can retry cleanly
            // and we don't accumulate dead pending transactions.
            await supabaseAdmin
              .from("paystack_transactions")
              .delete()
              .eq("reference", reference);
            throw e;
          }

          // Remember preferred currency.
          await supabaseAdmin
            .from("user_wallets")
            .upsert(
              { user_id: userData.user.id, preferred_currency: parsed.currency },
              { onConflict: "user_id" },
            );

          return new Response(
            JSON.stringify({
              authorizationUrl: init.authorizationUrl,
              reference: init.reference,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        } catch (err) {
          console.error("[paystack initialize] failed", err);
          return new Response(
            JSON.stringify({
              error: err instanceof Error ? err.message : "Failed to start checkout",
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
