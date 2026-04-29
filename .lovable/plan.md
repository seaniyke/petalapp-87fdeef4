## Paystack flow audit

I traced every entry point that touches money: `POST /api/billing/initialize`, `POST /api/registrar/purchase`, `POST /api/public/paystack/webhook`, `GET /api/billing/verify`, the `/billing/return` page, the `paystack.server.ts` SDK wrapper, and the `apply_paystack_*` SQL RPCs. Below are the issues found, ranked by severity. Each item lists the exact file and the fix.

### What's already solid (do not change)
- Webhook verifies HMAC-SHA512 with constant-time compare before touching DB.
- All grant RPCs are `SECURITY DEFINER` and idempotent (each keyed off the Paystack reference in their respective ledger / lots / slots tables).
- `paystack_transactions.reference` is `UNIQUE`, references are server-generated UUIDs (clients can't choose them), prices are re-resolved server-side from `billing_plans` / `credit_packs` / `runtime_topup_packs` / Cloudflare wholesale — never trusted from the client body.
- Project ownership is checked for `addon` and `domain_purchase`. Auth via Supabase bearer token on initialize and verify.

### Critical (real money / privilege risk)

1. **`/api/billing/verify` cannot finish a `runtime_topup` or `domain_purchase`.** The handler only branches on `pack` / `addon` / else-plan. If a Cloud + AI top-up payment succeeds and the webhook is delayed or fails, the user lands on `/billing/return`, we hit verify, and we silently fall through to `apply_paystack_plan_grant` with `_plan_code = <runtime pack code>`, which throws `Unknown plan`. The user is charged but never credited, and the `paystack_transactions` row stays `pending`.
   - **Fix**: in `src/routes/api/billing/verify.ts`, add explicit branches for `runtime_topup` (call `apply_paystack_runtime_topup` with `tx.usd_amount_cents` and metadata) and `domain_purchase` (kick off the same `handleDomainPurchase` job the webhook uses, or just no-op and tell user "registering"). Replace the `else` fallback with an explicit `purpose === "plan"` check and return 500 for unknown purposes so we fail loud, not silent.

2. **Paystack `verify` does not check the amount or currency match.** Both webhook and verify call the grant RPC purely off our stored `tx` row, but never compare `data.amount` / `data.currency` from Paystack to `tx.amount_minor` / `tx.currency_code`. A malicious user who can re-use a real Paystack reference (e.g. via an old test charge, or a tampered checkout where they edited the amount in the Paystack URL flow) could in theory trigger a grant for a higher value than they paid.
   - **Fix**: in `src/server/paystack.server.ts` `verifyTransaction`, return amount + currency. In both `verify.ts` and `webhook.ts`, after fetching tx, assert `data.amount === tx.amount_minor && data.currency.toUpperCase() === tx.currency_code.toUpperCase()` before granting. On mismatch: mark tx `failed`, log, return 400 / ack 200, do **not** credit.

3. **Webhook trusts `paystack_transactions` even though the row was created by us at initialize time and could be re-used.** Specifically, an attacker who finds a leaked test webhook secret could replay an old `charge.success` payload with a new `data.id` (the idempotency key) but the same `reference` — current code re-grants only because `apply_paystack_*` RPCs are themselves idempotent on `reference`. That's good defense in depth, but the webhook handler itself should also refuse to re-process a tx that's already `success`.
   - **Fix**: in `webhook.ts`, before the grant branches, `if (tx.status === "success") return ok`. Same guard in `verify.ts` is already present — keep it.

4. **Webhook does not require `tx.status === "pending"` and does not lock the row.** Two concurrent deliveries (webhook + return-page verify) can both pass the "not yet success" check, both call the RPC, and both update `paystack_transactions`. RPCs are idempotent so balance is safe, but the `paystack_transactions.status` and `paid_at` fields can race. Add a conditional update: `update(...).eq('reference', ref).eq('status', 'pending')` so only the first writer wins.

### High (reliability / silent failure)

5. **`/api/billing/initialize` inserts the pending `paystack_transactions` row before calling Paystack, but on Paystack failure the row is left behind.** Compare to `registrar/purchase.ts` which does roll back. Result: orphan `pending` rows the user can never complete. Wrap the Paystack init in try/catch and delete the orphan (or update to `failed`) on error.

6. **Webhook `try { ... grant ... } catch { console.error }` always returns 200.** If the RPC throws (unknown pack code, DB outage), Paystack will not retry because we acked success. Combined with #1 this is how a real charge becomes "lost". Either return non-200 on grant failure (Paystack auto-retries with backoff) or write the failure to a `paystack_grant_failures` table for an admin queue. Recommended: return 500 on grant failure so Paystack retries.

7. **`apply_paystack_topup` keys idempotency off `topup_lots.stripe_session_id = _reference`.** That's a legacy column name re-used for Paystack refs. It's correct today (because `pt_*` refs are unique across providers), but it's confusing and risks collision if Stripe is ever re-enabled. Rename / add a `paystack_reference` column with a UNIQUE index, or at minimum check `metadata->>'paystack_reference'` in `credit_ledger` like `apply_paystack_runtime_topup` does.

8. **`apply_paystack_plan_grant` always sets `current_period_end = now() + 30 days` and overwrites `monthly_credits_remaining` on every successful charge.** A user who pays for a renewal on day 25 loses their 5 unused days and any unspent monthly credits get reset (might be intended — but resetting credits **down** if the new plan grants fewer is a refund-fight risk). Confirm with product; if "monthly credits don't accumulate" is the rule, leave it but document; if not, switch to `GREATEST(monthly_credits_remaining, _monthly)` and `current_period_end = GREATEST(current_period_end, now()) + interval '30 days'`.

### Medium (defense in depth)

9. **`paystack_events.id = String(payload.data.id ?? ref)`.** If `data.id` is missing (some Paystack event types) we fall back to `reference`, which means a later `charge.success` for the same reference would be skipped as "already processed" even though it's a different event. Low risk because reference is single-use, but prefer event-id only and 200-ack with a log when missing.

10. **No rate limiting on `/api/billing/initialize` or `/api/registrar/purchase`.** A logged-in attacker can spam pending tx rows / Paystack inits. Add a simple per-user-per-minute cap (in-memory map keyed by `userId`, e.g. 10/min) and return 429 over the cap. Acceptable for current Worker runtime.

11. **`customAmountMinor` in initialize trusts client-supplied amount with only `>0` and `<= 100_000_000` minor units.** That means a user can top up `$0.01` worth → we still create a tx and pay Paystack fees on near-zero charges. Add a sane minimum (e.g. equivalent of $1 USD) computed from the same `usd_rate`.

12. **Webhook accepts any `payload.event` other than `charge.success` silently.** Add an allow-list (`charge.success`, `charge.failed`, `transfer.*` if used) and log unknowns so we notice if Paystack starts sending us events we didn't subscribe to.

13. **`getEnvironment()` is read off the secret prefix at runtime.** If the operator rotates from test to live keys mid-flight, an in-flight pending tx will be created with `environment='test'` then granted under `environment='live'` (or vice versa). Snapshot environment at initialize (already done) and assert `tx.environment === getEnvironment()` in verify/webhook before granting; otherwise mark `failed` so we don't credit live money under a test ledger.

### Tech-details section

Files touched:
- `src/routes/api/billing/verify.ts` — add `runtime_topup` and `domain_purchase` branches; assert amount+currency+environment match; update only WHERE status='pending'.
- `src/routes/api/public/paystack/webhook.ts` — early-return when `tx.status='success'`; assert amount+currency+env; allow-list events; return 500 on grant failure (or write to failure queue); use event id only for idempotency.
- `src/routes/api/billing/initialize.ts` — rollback orphan tx row on Paystack init failure; add per-user rate limit; enforce minimum custom topup amount.
- `src/routes/api/registrar/purchase.ts` — add per-user rate limit (already has rollback).
- `src/server/paystack.server.ts` — extend `VerifyResponse.data` typings + return amount/currency/status to callers.
- DB migration: add `paystack_reference` UNIQUE column to `topup_lots` and backfill from `stripe_session_id`; optionally add a `paystack_grant_failures` table for #6.
- `apply_paystack_plan_grant` (migration): clarify renewal semantics per product decision.

Out of scope (will note but not change without confirmation):
- Switching plan-grant accumulation rules (#8) — needs product call.
- Building an admin "stuck transaction" UI — separate task.

Once you approve, I'll implement the Critical and High items in one pass, then Medium items in a follow-up commit so you can review separately.
