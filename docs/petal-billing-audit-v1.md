# Petal Monetization & Credit System Audit v1.0

Evidence-only. Every claim below cites a file:line or a live database object.
Anything not found in code is marked **NOT IMPLEMENTED**.

Audit date: 2026-08-07. Live data snapshot: 20 wallets, 301 ledger rows,
0 paid subscriptions, 1 wallet holding top-up credits, $0 revenue from
subscriptions to date.

---

## 1. Credit Wallet

### Schema (live DB)

`public.user_wallets` (PK `user_id`, FK → `auth.users`, RLS: owner or admin SELECT only):

| column | meaning |
|---|---|
| `plan_code` → `billing_plans.code` | subscription tier |
| `monthly_credits_remaining numeric(10,2)` | subscription grant bucket |
| `topup_credits_remaining numeric(10,2)` | purchased pack bucket |
| `daily_free_used` / `daily_free_reset_at` | free daily bucket |
| `monthly_free_used` / `monthly_free_reset_at` | monthly cap on free bucket |
| `credit_debt numeric(10,2)` | unpaid settlement remainder |
| `runtime_free_balance_cents`, `runtime_topup_balance_cents` | separate **cloud runtime** wallet (not AI credits) |
| `stripe_customer_id`, `stripe_subscription_id`, `subscription_status`, `current_period_end` | legacy Stripe columns, unused by the Paystack path |

`public.credit_ledger`: `id, user_id, delta numeric, reason, balance_after, project_id, metadata jsonb, created_at, turn_id`. Immutable append-only; no UPDATE path except `settle_build_charge` stamping `turn_id`.

`public.topup_lots`: `pack_code, credits_granted, credits_remaining, stripe_session_id (UNIQUE), environment, expires_at`.

`public.credit_packs` (8 live rows): `micro 10cr/$2`, `starter 20cr/$3`, `basic 35cr/$5`, `plus 110cr/$20`, `growth 450cr/$75`, plus legacy `pack_50/pack_200/pack_1000`.

`public.billing_plans` (3 live rows): `free` (0 monthly, 5 daily, cap 30/mo, $0), `pro` (100 monthly, $15), `business` (150 monthly, $25).

### Balance math

`public.available_credits(uuid)` and `public.check_credit_balance(uuid, numeric)` both compute:

```
free_avail = LEAST(plan.daily_free_credits - daily_used, plan.monthly_free_cap - monthly_used)
total      = free_avail + monthly_credits_remaining + topup_credits_remaining
```

Free buckets are lazily rolled over by date comparison, no cron needed.

### Spend

`public.spend_credit(user, amount, reason, project, metadata)` — `SECURITY DEFINER`, takes `SELECT ... FOR UPDATE` on the wallet row (row-level lock = the concurrency primitive), drains **free → monthly grant → top-up**, writes one ledger row with a `sources` breakdown array. Returns `NULL` (not an exception) when `total_avail < amount`.

Server wrapper: `src/server/credits.server.ts:54`.

### Refund

`public.refund_credit(user, ledger_id, reason, metadata)` — reverses per-bucket using the recorded `sources`, and refuses to double-refund by checking for an existing ledger row with `metadata->>'refund_of' = ledger_id`. Wrapper `src/server/credits.server.ts:93` retries 3× with backoff and writes a `pipeline_failures` breadcrumb (`surface: 'credit_refund'`) if all attempts fail.

### Expiration

`topup_lots.expires_at = now() + interval '12 months'` (`apply_topup_purchase`). `public.expire_topup_lots()` zeroes expired lots and debits the wallet.

**BUG (confirmed on live data):** `spend_credit` decrements `user_wallets.topup_credits_remaining` but never decrements `topup_lots.credits_remaining`. Live evidence — user `7156fed0…` has three `micro` lots all still showing `credits_remaining = 10.00` while the wallet shows `63.18`. When those lots expire, `expire_topup_lots()` will subtract 30 credits that were, in part, already spent. **Lot accounting is decorative today.**

### Bonus / promotional / referral credits

- Bonus: ledger reason `early_user_bonus` exists (1 row, 100 credits) — granted manually, no code path found. **No automated bonus engine.**
- Promotional codes / coupons: **NOT IMPLEMENTED** (no table, no route).
- Referral credits: `waitlist_referrals` + `src/lib/referral.ts` grant **queue position only**. `src/routes/api/public/waitlist.ts:191` increments `referral_count`; no credit grant anywhere. **Referral → credits: NOT IMPLEMENTED.**
- Admin adjustments: `admin_grant_credit`, `admin_grant_credits`, `admin_deduct_credits`, `admin_refund_ledger` exist as DB functions; wired at `src/routes/api/admin/credits.ts:248` (`action: "grant"`). 8 live `admin_grant` rows totalling 560 credits.

### Actual lifecycle (as coded)

```
Paystack checkout  →  webhook charge.success (src/routes/api/public/paystack/webhook.ts)
        ↓
apply_topup_purchase()  → topup_lots row + wallet.topup_credits_remaining += credits
        ↓                  + ledger row (reason 'topup_purchase')
User prompt → /api/generate
        ↓
check_credit_balance(BUILD_FLOOR = 1.0)   ← src/routes/api/generate.ts:1489  (READ ONLY, no hold)
        ↓
acquireBuildLock(userId)                  ← generate.ts:1508 / 4925
        ↓
AI generation + repair + verification (NOT charged per step)
        ↓
priceTurn(turnUsages)                     ← generate.ts:4308
        ↓
settle_build_charge(user, amount, turn_id) ← generate.ts:4352  (single debit, end of turn)
        ↓
shortfall > 0 → wallet.credit_debt += shortfall
```

There is **no reservation/hold and no post-hoc refund** on the build path. `BUILD_HOLD = 1.5` in `src/server/credit-pricing.server.ts:26` is dead — no reference outside that file. The "credits returned on failure" branch of your diagram does not exist for builds because credits are never taken before success. It *does* exist for `/api/discuss` (`src/routes/api/discuss.ts:111` reserve → `:218/:245/:252` refund), `/api/coach` (`coach.ts:75/90`) and `/api/generate-image` (`generate-image.ts:142/233`).

---

## 2. Subscription System

- **Use without subscribing:** yes. `free` plan gives 5 credits/day capped at 30/month (`billing_plans` row). `available_credits` includes the free bucket, and `settle_build_charge` drains it.
- **Buy credits only:** yes. `src/server/entitlements.server.ts:27` — `hasFullAccess = plan_code <> 'free' OR topup_credits_remaining > 0`, mirrored in SQL by `public.has_full_access(uuid)`.
- **Subscribe + monthly credits:** yes. `apply_monthly_renewal(user, plan, period_end)` **sets** `monthly_credits_remaining = plan.monthly_credits` (a reset, not an accumulate — unused grant does not roll over) and writes ledger reason `monthly_renewal`.
- **Cancel:** yes. `src/routes/api/billing/subscription/cancel.ts`, UI at `src/components/BillingSheet.tsx:166` ("you keep access until the period ends"). Webhook `subscription.disable` / `subscription.not_renew` handled at `webhook.ts:145/149`.
- **Keep purchased credits after cancelling:** yes — cancellation touches `plan_code`/`subscriptions`, never `topup_credits_remaining`, and `has_full_access` keeps returning true while top-ups remain.

Gap: `apply_period_end_changes` / `expire_paystack_plans` exist, but **there is no scheduled renewal reconciliation you can prove is running** — `cron.job` is not readable from the app role, so renewal depends entirely on Paystack webhooks arriving.

---

## 3. Build Charging Logic — exact answers

| Question | Answer | Evidence |
|---|---|---|
| Deducted before generation? | **No** for builds. Read-only floor check only. | generate.ts:1489 |
| After generation? | **Yes** — single debit at end of turn, before the SSE stream closes. | generate.ts:4343-4380 |
| After deployment? | **No.** Settlement happens in `/api/generate`; deployment runs later via `/api/builds/trigger`. A build that generates fine and fails to deploy is still charged. | generate.ts:4352 vs `src/routes/api/builds/trigger.ts` |
| After preview? | No. |  |
| Repair charged? | **No** — repair/auto-fix is on Petal's tab. `if (!body.isAutoFix)` guards settlement (generate.ts:4343); internal QA usages are deliberately excluded from `turnUsages` (comment block generate.ts:4290-4305). Bounded by `TURN_REPAIR_COST_CEILING_USD = 0.35` in `src/server/turn-cost-ceiling.server.ts:22`. |

Failure matrix:

- **OpenRouter fails / AI times out:** no usage → the throw path skips settlement entirely (charge happens only after a completed stream). User pays nothing.
- **Empty stream / upstream timeout:** handled as `upstream_timeout`; no settlement.
- **Deployment fails:** user **is** charged (generation already settled). This is the one place users can feel cheated, and it is by design today.
- **Repair fails:** not charged.
- **User refreshes / closes browser mid-stream:** the settlement runs inside the stream body. If the client disconnects, the worker stream is cancelled — settlement is likely skipped. Loss is Petal's, not the user's. Turn reaping exists (`reap_stalled_turns`, `reap_stalled_builds`).
- **Edge function crashes:** catch at generate.ts:4383 calls `recordUnpaidBuild()` → `pipeline_failures` row, user not charged.
- **Do users lose credits unfairly?** Two real cases:
  1. Deployment failure after a successful generation (charged, no shippable app).
  2. **BUG:** `settle_build_charge`'s idempotency branch reads `existing.amount`, but `credit_ledger` has no `amount` column (it is `delta`). Verified against live schema. Any retried turn hits `record "existing" has no field "amount"` → the RPC throws → generate.ts:4383 books a **false** unpaid-build failure. It fails *safe* (no double charge) but idempotency reporting is broken and telemetry is polluted.

---

## 4. Token Cost Calculation

Implemented, token-based, not flat: `src/server/credit-pricing.server.ts`.

```
raw = BUILD_BASE(1.0) + prompt_tokens/1000 × 0.06 + completion_tokens/1000 × 0.28
amount = clamp(max(raw, BUILD_FLOOR 1.0), ≤ BUILD_CAP 20.0)
```

- Prompt tokens: yes (`PROMPT_RATE`, line 29).
- Completion tokens: yes, weighted 4.7× (line 30).
- Missing usage: flat `MISSING_USAGE_FALLBACK = 1.5` (line 34).
- Multi-call turns: `priceTurn()` sums all billable sub-calls, charges once (line 96).
- **Cached-prompt discount: NOT IMPLEMENTED for billing.** Cached tokens are *measured* (`generate.ts:4320`, logged as `[prompt-cache] hit=%`) and stored on `ai_call_log.cached_prompt_tokens`, but `priceBuild()` never subtracts them. Users pay full price for tokens Petal got at a discount — margin upside, fairness downside.
- Model tier: **not a pricing input.** A build on `gemini-flash-lite` and one on `gpt-5` cost the user the same per token.
- Repair / retries / deployment: not billed to the user (§3).

Live mean per build: 999.93 credits over 276 `ai_build_charge` rows = **3.62 credits/build**, matching the stated 3–4 target.

---

## 5. Pricing Engine

**There is no per-workload pricing engine.** All build types run through the same `priceBuild()` formula, so differentiation happens only implicitly via token volume.

| Workload | Differentiated price? |
|---|---|
| Landing page / complex SaaS / backend / mobile / enterprise | No — same formula, tokens only |
| Chat edits (`/api/discuss`) | Yes, flat 1.00 (`discuss.ts:111`) |
| Coach (`/api/coach`) | Yes, `COACH_TURN_COST` |
| Transcribe | Yes, `TRANSCRIBE_COST` (`transcribe.ts:49`) |
| Image generation | Yes, flat 1.00 (`generate-image.ts:142`) |
| Deployment | Free (no charge path) |
| Bug fixing / auto-fix | Free by policy |
| Website redesign / API generation | No |

Related but separate: `src/server/preflight-estimate.server.ts` classifies a prompt into 7 kinds with cent baselines *for display only* — it never feeds the charge. `src/server/billing-pricing.server.ts` + `billing_price_overrides` + `billing_currencies` handle **currency/regional price overrides for packs and plans**, not per-workload rates.

**Missing:** a `pricing_rules` table keyed by (workload kind × model tier × target platform), and multipliers applied inside `priceBuild()`.

---

## 6. OpenRouter Cost Protection

Implemented, with evidence:

- **Context budgeting:** `src/server/context-budget.server.ts` (249 lines) — priority-based compression with token estimation.
- **File budgeting / selective loading:** `src/server/file-budget.server.ts` (146 lines); `promptBudget.files` is what gets sent, logged as `filesSent` on `ai_call_log`.
- **Targeted single-file edits:** `src/server/edit-intent.server.ts` (405 lines) — LLM anchors so edits don't resend/regenerate whole projects.
- **Diff/patch output mode:** `SYSTEM_PROMPT_PATCH`, cited in `credit-pricing.server.ts:20` as the reason completion rates could be lowered.
- **Model routing / economy mode:** `src/server/ai-provider.server.ts:194-206` (`profiles.economy_mode`), `:363` budget-tier model list, `:586-638` `budgetAware` routing with admin shadow testing and `ai_router_config`.
- **Prompt caching:** static prefix is hashed and measured (`staticPrefixChars`, `staticPrefixHash`, `ai_provider.server.ts:458-503`); hit rate logged per call.
- **Pipeline budgets:** `src/server/pipeline-budgets.ts` (round/tool caps), `turn-cost-ceiling.server.ts` (USD ceiling, soft $0.22 / hard $0.35).
- **Memory:** `project_memory` table + `learning-injector.server.ts`.
- **Observability:** `ai_call_log` (23 cols incl. cached tokens), `ai_call_outcomes`, admin page `src/routes/admin.ai-spend.tsx`.

Gap: no cross-request semantic cache (identical prompt → replay), and cached-token savings are not passed through to price (§4).

---

## 7. Credit Packages

Packs live in `credit_packs` (DB rows, not code) and are read at runtime by `src/components/BillingSheet.tsx:93` via `fetchCreditPacks()`. Price/credits/active flags are therefore **editable without redeploying** — but only via SQL: `src/routes/api/admin/credits.ts` exposes `list_transactions`, `list_ledger`, `grant`, `dashboard`, `crypto_payments`… and **no pack CRUD action**. Regional pricing is data-driven through `billing_currencies` + `billing_price_overrides` (`src/server/billing-pricing.server.ts`).

- Change price / credits without deploy: **yes, via DB only** — admin UI: NOT IMPLEMENTED.
- Bonuses on packs: NOT IMPLEMENTED (no `bonus_credits` column).
- Promotions / limited-time pricing: NOT IMPLEMENTED (no validity window on `billing_price_overrides` beyond `is_active`).
- Named tiers Starter/Creator/Builder/Studio/Enterprise: partially — current names are `micro/starter/basic/plus/growth`, no Enterprise pack.

---

## 8. Regional Payments

| Gateway | Status | Evidence |
|---|---|---|
| **Paystack** | **Production-ready.** Checkout init `src/routes/api/billing/initialize.ts`, verify `billing/verify.ts`, signed webhook `api/public/paystack/webhook.ts` (HMAC-SHA512, line 80-83; dedupe via `paystack_events`, line 113-131), plans per currency `paystack_plan_code_{ngn,ghs,kes,zar,usd}`, subscription cancel/manage-link routes. | ✅ |
| **Crypto (USDT/BTC/ETH)** | **Production-ready path.** `crypto_payments` table, `src/server/crypto-credit.server.ts` (atomic pending→confirmed claim, rollback on failure, receipt email once), background verifier `src/server/crypto-verify.server.ts` + cron route `api/public/cron/crypto-verify.ts`, admin review action `admin/credits.ts:1240`. | ✅ |
| **Stripe** | **Legacy/dormant.** Columns `stripe_customer_id`, `stripe_price_id`, `topup_lots.stripe_session_id` exist; no Stripe checkout route for Petal's own billing. `src/server/integrations/stripe.integration.ts` is a **generator integration for user-built apps**, not Petal billing. | ⚠️ vestigial |
| **Flutterwave** | Same — `src/server/integrations/flutterwave.integration.ts` is a scaffolding integration for generated apps. **Petal billing: NOT IMPLEMENTED.** | ❌ |
| LemonSqueezy / Paddle | NOT IMPLEMENTED | ❌ |
| Bank transfer | Only insofar as Paystack channels allow; no dedicated flow | ❌ |
| Apple Pay / Google Pay | NOT IMPLEMENTED | ❌ |

---

## 9. Admin Dashboard

`src/routes/admin.billing.tsx` (1587 lines), `admin.users.tsx`, `admin.ai-spend.tsx`, `admin.index.tsx`, backed by `src/routes/api/admin/credits.ts` (1325 lines, admin-token scoped).

| Capability | Status | Evidence |
|---|---|---|
| Add credits | ✅ | `action: "grant"` → `admin_grant_credit` (credits.ts:235) |
| Remove credits | ⚠️ DB function `admin_deduct_credits` exists; no route action found | |
| Refund credits | ⚠️ `admin_refund_ledger` exists; no route action found | |
| Audit transactions | ✅ | `list_transactions` (:357), `list_ledger` (:398) |
| Search users | ✅ | `lookup` / `list_users` (:122), `user_detail` (:185) |
| Usage history | ✅ | `dashboard` (:437), `project_ai_spend` (:759), `cloud_cost` (:1158) |
| Crypto review | ✅ | `crypto_payments` (:1217), `crypto_payment_review` (:1240) |
| Freeze wallets | ❌ NOT IMPLEMENTED (only `suspend_user`, :262) | |
| Reverse failed charges | ❌ NOT IMPLEMENTED — `pipeline_failures` rows must be reconciled by hand | |
| Edit packs/plans/prices | ❌ NOT IMPLEMENTED | |

---

## 10. Abuse Prevention

| Vector | Control | Evidence | Verdict |
|---|---|---|---|
| Double charging | `settle_build_charge` idempotent on `turn_id` | `generate.ts:4348`, SQL | **Broken** — idempotent branch throws (`existing.amount`, §3). Fails safe. |
| Race conditions | `SELECT … FOR UPDATE` on wallet row inside `spend_credit` | SQL | ✅ correct primitive |
| Two tabs / parallel builds | In-memory `buildLocks` map, TTL | `generate.ts:4925-4939` | ⚠️ **per-worker only.** Cloudflare runs N isolates → N concurrent builds per user are possible. |
| Refresh exploits | Charge is post-success, so refresh costs Petal, not the user | generate.ts:4343 | ✅ user-safe |
| Rate limiting | 30/min, 500/hr sliding window | `src/server/rate-limit.server.ts` | ⚠️ in-memory per worker, by its own docstring |
| Replay attacks (payments) | HMAC-SHA512 verify + `paystack_events` insert-once | `webhook.ts:80-131` | ✅ |
| Duplicate webhooks | `paystack_events.id` PK + `apply_topup_purchase` early-return on existing `stripe_session_id` | SQL | ✅ |
| Duplicate crypto credit | Conditional `pending → confirmed` update; only the winner credits | `crypto-credit.server.ts:74-120` | ✅ |
| Double refund | `metadata->>'refund_of'` guard | `refund_credit` SQL | ✅ |

**The single biggest structural weakness: both the build lock and the rate limiter are process-local.** At any real scale they are advisory only. The wallet row lock is the only true billing boundary — and because the floor check is read-only, the worst case is a user going negative into `credit_debt`, not free unlimited builds.

---

## 11. User Experience — screens that exist

| Step | Screen / component |
|---|---|
| Sign up | `src/routes/auth.tsx` (waitlist-gated) |
| No subscription, 5 free credits/day | `billing_plans.free`, badge `src/components/CreditBadge.tsx`, `src/hooks/use-wallet.ts` |
| See cost before sending | `src/components/PreflightCostChip.tsx` |
| Buy credits | `src/components/BillingSheet.tsx` (packs + currency picker), `src/routes/billing.index.tsx`, crypto via `CryptoCheckoutPanel.tsx` |
| Checkout return | `src/routes/billing.return.tsx` → `api/billing/verify.ts` |
| Build | `src/routes/builder.tsx` |
| Out of credits | 402 from `generate.ts:1491` → "Add credits in Settings → Plans & Credits"; `RuntimeLowBalanceBanner.tsx`, `RuntimeTopupModal.tsx` (runtime wallet) |
| Subscribe later | plan cards in `BillingSheet.tsx` |
| Monthly credits | `apply_monthly_renewal` on webhook |
| Cancel | `BillingSheet.tsx:166` → `api/billing/subscription/cancel.ts` |
| Keeps purchased credits | `has_full_access` (§2) |
| Receipts / invoices | `src/lib/receipt-pdf.ts`, email templates `payment-success`, `crypto-payment-confirmed`, `subscription-*` |

Missing screens: no per-build credit breakdown ("this build cost 3.6 credits, here's why"), no debt/arrears surface for `credit_debt > 0` (currently $1.99 outstanding, invisible to both user and admin UI), no pack-bonus or promo-code entry.

---

## 12. Scalability

Already built:
- Numeric ledger + row-locked wallet: correct to millions of rows; `credit_ledger` is append-only and indexed by user.
- Currency abstraction (`billing_currencies`, `billing_price_overrides`) for emerging markets.
- Separate runtime wallet (`runtime_ledger`, `runtime_topup_packs`, `charge_runtime`, `credit_runtime`) — usage-based infrastructure billing already exists as a second meter.
- Per-turn cost telemetry (`ai_call_log`, `ai_call_outcomes`, `turns`, `turn_events`) — the data needed for usage-based invoicing exists.

Not built:
- **Team workspaces / shared credit pools:** NOT IMPLEMENTED. Every wallet is keyed by `user_id` with no org dimension. This is the single largest schema change required.
- **API billing / API keys:** NOT IMPLEMENTED.
- **Enterprise invoicing (net terms, PO, monthly arrears):** NOT IMPLEMENTED. `credit_debt` is the only arrears primitive.
- **Marketplace purchases:** NOT IMPLEMENTED.
- **Premium model tiers as a paid upgrade:** routing exists (`ai_router_config`), price differentiation does not (§4).
- **White-label partners:** NOT IMPLEMENTED.
- **Distributed locking / rate limiting:** in-memory only (§10) — this breaks first, at roughly the point you run more than a handful of concurrent workers.

At 100k users the ledger and wallet design holds. At 1M, `credit_ledger` needs monthly partitioning and the admin `dashboard` aggregate queries need materialized rollups (they currently scan).

---

## 13. Scorecard

| Area | Grade | Why |
|---|---|---|
| Wallet Architecture | **B+** | Correct 3-bucket model, row-locked, append-only ledger. Loses points: `topup_lots` never decremented, so expiry double-debits. |
| Credit Settlement | **B−** | Charge-after-success is user-fair and well-reasoned, but idempotency is broken (`existing.amount`), deployment failures still bill, and stream cancellation silently loses revenue. |
| Subscription System | **B** | All lifecycle states handled via Paystack webhooks; no independent renewal reconciliation, and unused monthly credits are reset not rolled over without that being surfaced. |
| Pricing Flexibility | **C** | One token formula for every workload; no model-tier or platform multipliers; no promo/bonus engine. |
| Cost Optimization | **A−** | Genuinely strong: context/file budgets, patch output, economy routing, prompt-cache measurement, USD repair ceiling. Missing: cache discount pass-through, semantic cache. |
| Fraud Protection | **C+** | Payment side is solid (HMAC, dedupe, atomic crypto claim). Build side relies on process-local locks. |
| Admin Tools | **C+** | Rich read/audit surface; write surface is grant-only. No freeze, no reversal UI, no catalog editing. |
| User Experience | **B** | Full purchase→build→cancel journey ships. No cost breakdown per build, no debt visibility. |
| Enterprise Readiness | **D** | No orgs, no shared pools, no invoicing, no API billing. |
| Scalability | **B−** | Data model scales; coordination primitives and admin aggregates do not. |

### Below-A items, ranked by impact

**P0 — correctness, ship this week**
1. `settle_build_charge`: `existing.amount` → `existing.delta`. Impact: every retried turn logs a false unpaid build and loses idempotency reporting. File: DB function only.
2. `spend_credit`: decrement `topup_lots.credits_remaining` FIFO alongside the wallet. Impact: expiry will wrongly claw back spent credits from paying users. File: DB function `spend_credit` + backfill migration reconciling existing lots.
3. Distributed build lock + settlement guard. Replace `generate.ts:4925` in-memory map with a DB advisory lock (`pg_try_advisory_xact_lock(hashtextextended(user_id))`) or a `build_locks` table row. Impact: parallel-tab free builds at scale.

**P1 — money left on the table**
4. Charge on deploy-verified success, not stream end: move settlement behind `deploy-verify.server.ts`, or auto-refund when `/api/builds/trigger` reports failure within N minutes. Files: `generate.ts:4343`, `src/routes/api/builds/trigger.ts`.
5. Pass cached-prompt discount into `priceBuild()` (`prompt_tokens - cached_tokens` at full rate, cached at 25%). Files: `credit-pricing.server.ts`, `generate.ts:4320`.
6. Workload/model multipliers: `pricing_rules` table + multiplier arg to `priceBuild()`. Files: new migration, `credit-pricing.server.ts`, `generate.ts:4308`.

**P2 — operations**
7. Admin write actions: `deduct`, `refund_ledger`, `freeze_wallet`, `reverse_failed_charge`, catalog CRUD. File: `src/routes/api/admin/credits.ts` + `admin.billing.tsx`.
8. Surface `credit_debt` in `BillingSheet.tsx` and settle it on next top-up inside `apply_topup_purchase`.
9. Partition `credit_ledger` monthly; materialize the admin `dashboard` aggregates.

**P3 — growth surface**
10. Referral → credits (grant on referred user's first paid pack, both sides), promo codes, pack bonus credits.
11. Org/workspace dimension: `organizations`, `org_members`, `org_wallets`, and a `wallet_id` indirection so `spend_credit` can charge a pool.

---

## Prioritized roadmap

**Phase A — Trust (weeks 1–2).** P0 1–3 plus per-build cost breakdown in the UI. Outcome: no user can be wrongly debited and no user can get free parallel builds. This is table stakes versus Lovable/Bolt, both of which have been publicly criticised for exactly the failure you avoid by charging after success — make that a marketing claim once it is provably airtight.

**Phase B — Margin (weeks 3–4).** P1 4–6. Cached-token pass-through plus workload multipliers is where you get both fairer pricing for landing pages and correct pricing for SaaS builds. Add "never-expiring credit packs" as your differentiator: today lots expire at 12 months (`apply_topup_purchase`) — for emerging markets, extend to 36 months or remove expiry entirely and market it.

**Phase C — Operations (weeks 5–6).** P2 7–9 plus Flutterwave as a second African rail (Paystack single-rail is a real availability risk in NG/GH/KE), and M-Pesa via Flutterwave for Kenya.

**Phase D — Expansion (weeks 7–12).** P3 10–11, then API billing on top of the org wallet, then enterprise usage invoicing reusing the existing `runtime_ledger` meter pattern.

**Where this beats the competition once done:** none of Lovable, Bolt, v0, Replit or Cursor sells non-expiring local-currency credit packs with crypto and bank rails and charge-after-success. That combination — not the subscription tier — is Petal's wedge in Africa.
