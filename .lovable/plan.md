## Goal

- Hide all Stripe UI/code paths.
- Use **Paystack** for every purchase.
- Support **NGN, GHS, KES, ZAR, USD**.
- Per-currency price overrides set by admin (USD is the default; admin can set exact local amounts, otherwise an exchange rate is applied).
- **No recurring subscriptions** — Pro/Business become one-time monthly top-ups that grant a month of credits per purchase.
- User picks billing currency in the billing sheet.

---

## 1. Database changes (one migration)

### New tables

- `billing_currencies`
  - `code` (PK, text — `NGN`, `GHS`, `KES`, `ZAR`, `USD`)
  - `name` (text)
  - `symbol` (text)
  - `usd_rate` (numeric — units of this currency per 1 USD; admin-edited; `USD` row = 1)
  - `is_active` (bool)
  - `paystack_supported` (bool)
  - `sort_order` (int)

- `billing_price_overrides` — optional admin-set local price (overrides rate-based math)
  - `(item_kind, item_code, currency_code)` PK where `item_kind in ('plan','pack')`
  - `amount_minor` (bigint — kobo/pesewas/cents in that currency)
  - `updated_at`

- `paystack_events` — webhook idempotency (mirror of `stripe_events`)
  - `id` (text PK = Paystack event reference)
  - `type`, `payload`, `processed_at`

- `paystack_transactions` — every initiated purchase
  - `id` (uuid PK)
  - `user_id`, `reference` (unique — what we send to Paystack), `purpose` (`plan` or `pack`), `item_code`, `currency_code`
  - `amount_minor`, `usd_amount_cents` (locked at init for audit), `status` (`pending|success|failed|abandoned`)
  - `paystack_reference` (returned by Paystack), `channel`, `paid_at`, `created_at`

### Wallet additions

- `user_wallets.preferred_currency` (text, default `USD`) — last currency the user picked.

### RPC changes

- New `apply_paystack_topup(_user_id, _pack_code, _reference, _environment)` — same shape as `apply_topup_purchase` but keyed on Paystack reference; idempotent.
- New `apply_paystack_plan_grant(_user_id, _plan_code, _reference)` — grants `monthly_credits` for the plan to `monthly_credits_remaining`, sets `plan_code`, `current_period_end = now() + 30 days`, `subscription_status = 'active'`. Idempotent on reference.
- Daily cron call (server-side, in existing `apply_period_end_changes` style) to **revert plans to `free`** when `current_period_end < now()` and there is no fresh Paystack grant — gives the "monthly top-up" feel without recurring billing.

### RLS

- Public `SELECT` on `billing_currencies` and `billing_price_overrides` (read-only catalog).
- Admin-only `INSERT/UPDATE` via service role / admin policies on currencies + overrides.
- `paystack_events` and `paystack_transactions`: service role only; users can `SELECT` their own `paystack_transactions`.

### Seed data

- Five rows in `billing_currencies` with a sensible starting `usd_rate` (e.g. NGN 1600, GHS 15, KES 130, ZAR 18, USD 1) — admin will tune these.

> Stripe tables (`stripe_events`, `subscriptions`, existing `stripe_*` columns on `user_wallets`) are **kept in place** to preserve history but become unused. No destructive drops.

---

## 2. Server: hide Stripe, add Paystack

### Files to remove from active routing (delete files)

- `src/server/stripe.server.ts`
- `src/server/stripe-tax-setup.server.ts`
- `src/lib/stripe.ts`
- `src/components/StripeEmbeddedCheckout.tsx`
- `src/components/PaymentTestModeBanner.tsx`
- `src/routes/api/billing/create-checkout.ts`
- `src/routes/api/billing/create-portal-session.ts`
- `src/routes/api/billing/setup-tax-codes.ts`
- `src/routes/api/public/billing/webhook.ts`
- `src/routes/checkout.return.tsx`

(All Stripe imports in `__root.tsx`, `BillingSheet.tsx`, `CreditBadge.tsx` get rewired to Paystack equivalents.)

### New Paystack server module

- `src/server/paystack.server.ts`
  - Reads `PAYSTACK_SECRET_KEY` (test or live based on `PAYSTACK_ENV` secret).
  - `initializeTransaction({ email, amount_minor, currency, reference, callback_url, metadata })` → returns `authorization_url` + `access_code` + `reference`.
  - `verifyTransaction(reference)` — used by callback + webhook for double-confirmation.
  - `verifyWebhookSignature(rawBody, signatureHeader)` — HMAC-SHA512 with `PAYSTACK_SECRET_KEY` (Paystack standard).

### New routes

- `POST /api/billing/initialize` (auth required)
  - Body: `{ purpose: 'plan'|'pack', itemCode: string, currency: 'NGN'|'GHS'|'KES'|'ZAR'|'USD' }`
  - Resolves USD price from `billing_plans`/`credit_packs`, looks up override or applies `usd_rate` from `billing_currencies`, rounds up to whole minor unit.
  - Inserts `paystack_transactions` row with `status='pending'` and a generated `reference` (`pt_<uuid>`).
  - Calls Paystack initialize; returns `{ authorization_url, reference }`.
  - Updates `user_wallets.preferred_currency`.

- `POST /api/public/paystack/webhook`
  - Verifies signature.
  - Looks up `paystack_transactions` by reference.
  - On `charge.success`: marks success, runs `apply_paystack_topup` or `apply_paystack_plan_grant` based on `purpose`.
  - Records in `paystack_events` for idempotency.

- `GET /api/billing/verify?reference=...` (auth required) — used by the return page to surface result immediately even if webhook hasn't fired yet (calls Paystack verify, then runs the same RPC under a unique-event guard).

### Replacement of "manage subscription"

- Remove the Stripe portal link.
- Add a small **"Renew now"** button when `current_period_end < now() + 5 days` or status is `expired`. It just opens the same plan checkout.

---

## 3. Client UI

### `BillingSheet.tsx` rewrite

- **Currency selector** (segmented control: NGN ₦ / GHS ₵ / KES KSh / ZAR R / USD $) — defaults to `wallet.preferred_currency` or geo guess (cheap, optional: skip geo for v1, just default `USD`).
- Plan/pack cards display the **converted local price** based on the selected currency (using overrides + rates fetched from `billing_currencies` / `billing_price_overrides`).
- Buy button → calls `/api/billing/initialize`, then `window.location.assign(authorization_url)` for Paystack hosted checkout (simplest, avoids the React 19 / embedded race we just fixed).
- Drop the embedded-checkout view entirely.

### New return page

- `src/routes/billing.return.tsx` (`/billing/return?reference=...`)
  - Calls `GET /api/billing/verify`, shows success/failed state, refreshes wallet a couple times like the old `/checkout/return`.

### `CreditBadge.tsx`

- No structural change beyond removing Stripe imports.

### `__root.tsx`

- Remove `<PaymentTestModeBanner />`. Optionally add a tiny "Paystack test mode" badge driven by `VITE_PAYSTACK_ENV === 'test'` (reads a non-secret `VITE_PAYSTACK_PUBLIC_KEY` so users see a banner in test).

### `src/lib/billing.ts`

- Drop `stripe_price_id` from `CreditPack`.
- Add `fetchCurrencies()`, `fetchPriceOverrides()`, and a `convertUsdToLocal(usdCents, currency, rates, overrides, item)` helper.
- Add `BillingCurrency` and `PriceOverride` types.

### `use-wallet.ts`

- No structural change. The wallet still exposes `current_period_end` and `subscription_status`; UI uses them to show "expires in N days / Renew".

---

## 4. Admin settings (exchange rates + overrides)

New page: `src/routes/admin.billing.tsx` (gated by `useIsAdmin`) with two sections:

1. **Currencies** table: edit `usd_rate`, toggle `is_active`. Saves via a small admin-only server route `POST /api/admin/billing/currencies` that `requireSupabaseAuth` + `has_role('admin')` checks before writing with `supabaseAdmin`.
2. **Price overrides** table: for each `(plan|pack) × currency`, optional explicit `amount_minor`. Empty = use rate. Saves via `POST /api/admin/billing/price-overrides`.

Both routes validate input with Zod (currency in enum, amounts positive, etc.).

Add a "Billing settings" entry to admin nav (wherever existing admin tools live — if none, this page is reachable directly at `/admin/billing`).

---

## 5. Secrets needed

After plan approval (default mode), I'll prompt for:

- `PAYSTACK_SECRET_KEY` — single key works for test (`sk_test_...`) or live (`sk_live_...`); webhook signature uses the same key.
- `PAYSTACK_ENV` — `test` or `live` (informational, for UI banner + log labels).
- `VITE_PAYSTACK_PUBLIC_KEY` — public key, used only to show the test-mode banner client-side. Optional.

Existing Stripe secrets (`STRIPE_SANDBOX_API_KEY`, `PAYMENTS_SANDBOX_WEBHOOK_SECRET`) are **left untouched** but no code reads them anymore.

---

## 6. Webhook configuration

After deploying, the user (you) will need to add this URL in the Paystack dashboard:

- `https://buildwithpetal.com/api/public/paystack/webhook`

(I'll surface this URL in the success message after implementation.)

---

## 7. Rollout / verification

1. Migration creates new tables, seeds currencies, adds `preferred_currency`.
2. New routes + components shipped; old Stripe files removed in same change.
3. Build and typecheck.
4. End-to-end manual check (you sign in, open billing sheet, switch currency to NGN, click a pack → land on Paystack hosted page; on test card success, return page shows "credits added" and badge updates).
5. Admin page lets you tune rates without a redeploy.

## Open items I'm NOT doing unless you say so

- True recurring Paystack subscriptions (would only work for NGN/GHS reliably — you chose the simpler one-time monthly model, so I'm skipping plans/subscriptions API entirely).
- Refunds UI.
- Multi-currency price display on the marketing landing page (only inside the billing sheet for v1).
- Migration of existing Stripe customers (none in production yet based on the schema).