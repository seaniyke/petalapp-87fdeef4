# Paystack recurring subscriptions for plans

## What Paystack actually requires (from their docs)

1. **You can't push-charge a card without an authorization.** Cards must be tokenized through a real, customer-authenticated first transaction (2FA / 3DS). Minimum first charge: NGN 50, GHS 0.10, ZAR 1, KES 3, USD 2.
2. **Two ways to subscribe a customer:**
   - **Plan-on-transaction** (simplest): create a Plan once, then call `/transaction/initialize` with `plan: "PLN_xxx"` and Paystack auto-creates the subscription on success. The amount you pass is overridden by the plan amount.
   - **Subscription endpoint**: requires the customer to already have an `authorization_code` from a prior transaction. Useful for plan switches.
3. **Renewals are automatic.** Paystack runs the cron, sends `invoice.create` 3 days before, then `charge.success` (or `invoice.payment_failed`) on the renewal date. **Failed charges are NOT retried** — the subscription moves to `attention` and we must surface a "update card" link.
4. **Hosted card-update page**: `GET /subscription/:code/manage/link` returns a Paystack-hosted URL where the customer adds a new card; Paystack tokenizes (and refunds) the small charge automatically. This is what we point users to when status goes to `attention` or a card expires.
5. **Cancellation**: `POST /subscription/disable` with `code` + `email_token`. The sub stays active until `next_payment_date`, then `subscription.disable` fires.
6. **Required webhook events**: `subscription.create`, `charge.success`, `invoice.create`, `invoice.update`, `invoice.payment_failed`, `subscription.not_renew`, `subscription.disable`, `subscription.expiring_cards`.
7. **Monthly billing day quirk**: subs created on the 29th–31st bill on the 28th of every subsequent month.

## What we have today vs. what's missing

Audit of current code:

- `paystack.server.ts` only wraps `transaction/initialize`, `transaction/verify`, and webhook signature. **No plan, subscription, manage-link, or disable helpers.**
- `/api/billing/initialize` does a one-shot transaction. For `purpose: "plan"` it charges the price once and the webhook calls `apply_paystack_plan_grant`. **Nothing creates a Paystack subscription** — so the user gets one month of access and is never billed again. This is the bug we're fixing.
- `billing_plans` has no `paystack_plan_code_*` columns. We need one column per currency we sell plans in, because Paystack Plans are currency-locked (a Plan created in NGN can only subscribe NGN customers).
- `subscriptions` table exists but is Stripe-shaped (`stripe_subscription_id`, `price_id`). It has `plan_code`, `status`, `current_period_end`, `cancel_at_period_end`, `pending_plan_code`, `environment` — most of what we need. We'll add Paystack columns alongside the Stripe ones (don't drop Stripe — it's still wired into integration code).
- Webhook only handles `charge.success / failed / abandoned`. **No subscription / invoice events**, so renewals would silently grant nothing even if a sub existed.

## Design

### 1. Schema (one migration)

`billing_plans`: add nullable text columns for Paystack plan codes per supported currency:
- `paystack_plan_code_ngn`, `paystack_plan_code_ghs`, `paystack_plan_code_kes`, `paystack_plan_code_zar`, `paystack_plan_code_usd`
- Plus `paystack_interval` (default `monthly`) so admins can later sell annual.

`subscriptions`: add Paystack-specific columns (additive, nullable):
- `paystack_subscription_code text` (e.g. `SUB_xxx`)
- `paystack_email_token text` (needed to disable)
- `paystack_customer_code text`
- `paystack_authorization_code text` (last good auth, for plan switches)
- `next_payment_date timestamptz`
- `provider text` check `('stripe','paystack')` default `'stripe'` — disambiguates the row source
- Unique index on `(paystack_subscription_code)` where not null

`paystack_invoices` (new — audit trail for renewals):
- `id` uuid pk, `subscription_code` text, `invoice_code` text unique, `user_id` uuid, `amount_minor` int, `currency_code` text, `status` text, `paid_at` timestamptz, `description` text, `event_payload` jsonb, `created_at` timestamptz default now()

Backfill `subscriptions.provider = 'stripe'` for existing rows.

### 2. Plan provisioning (admin-side, one-time per plan)

New server function `provisionPaystackPlans` in `src/server/paystack.server.ts`:
- For each `(billing_plan, currency)` where the corresponding `paystack_plan_code_*` is NULL and we sell the plan in that currency, call `POST /plan` with the converted amount in minor units, `interval: "monthly"`, name `"Petal {Plan} ({CCY})"`.
- Save the returned `plan_code` back to the row.

Trigger this from the admin Billing page with a "Sync Paystack plans" button. Idempotent — only creates missing plans. Don't auto-run at boot.

### 3. Initialize flow change (`/api/billing/initialize`)

When `purpose === "plan"`:
- Look up `billing_plans.paystack_plan_code_<currency>`. If missing, return 400 with a clear "Plan not yet available in this currency" message (admin must run sync).
- Call `initializeTransaction` with the **same arguments PLUS `plan: planCode`**. Paystack will charge the plan's authoritative amount and create the subscription on success. We still pass our `reference` and metadata.
- Persist the existing `paystack_transactions` row as today.

For `pack`, `runtime_topup`, `addon`, `domain_purchase`: **no change** — those stay one-shot.

### 4. Verify route + webhook: handle subscription events

Extend `paystack.server.ts` with:
- `fetchTransactionAuthorization(reference)` — pulls `authorization` + `customer` + `subscription` from `/transaction/verify`
- `fetchSubscription(code)` — for status reconciliation
- `disableSubscription(code, emailToken)`
- `getSubscriptionManageLink(code)` — for the "update card" CTA

Update `/api/public/paystack/webhook.ts`:
- Add to `KNOWN_EVENTS`: `subscription.create`, `subscription.disable`, `subscription.not_renew`, `subscription.expiring_cards`, `invoice.create`, `invoice.update`, `invoice.payment_failed`
- On `subscription.create`: upsert into `subscriptions` (provider='paystack', status='active', store sub_code, email_token, customer_code, authorization_code, next_payment_date, plan_code from our internal mapping by matching the Paystack `plan_code` back to our `billing_plans` row).
- On `charge.success` for a subscription renewal (payload has `plan` object): credit the user via `apply_paystack_plan_grant` (idempotent on event id), update `subscriptions.current_period_end` and `next_payment_date`, log to `paystack_invoices`.
- On `invoice.payment_failed`: set `subscriptions.status = 'attention'`, send a "your payment failed — update your card" email containing the manage link.
- On `subscription.not_renew`: set `cancel_at_period_end = true`.
- On `subscription.disable`: set `status = 'cancelled'`, downgrade the user to `free` (call existing `apply_paystack_plan_grant` with `_plan_code = 'free'` — verify that path works or add a `cancel_paystack_plan` RPC).
- On `subscription.expiring_cards`: email the user a manage link.

Idempotency: keep using `paystack_events` (event id). Renewal grants must also be guarded by the RPC (it already inserts a ledger row by reference).

### 5. Customer-facing UI

`BillingSheet`: when the user is on a paid plan and `subscriptions.provider = 'paystack'`:
- Show next billing date and amount.
- "Manage card" button → calls a new `POST /api/billing/subscription/manage-link` server function → returns the Paystack hosted URL → opens in a new tab.
- "Cancel subscription" button → confirm dialog → `POST /api/billing/subscription/cancel` → calls `disableSubscription`. UI shows "Cancels on {date}" until the disable webhook fires.
- Banner when `status = 'attention'`: "Your last payment failed. Update your card to keep your plan."

`payment-failed` email template: when the failure is a recurring invoice (not first charge), include the manage link.

### 6. Plan switching (Pro ↔ Business)

Two paths, simplest first:
- **MVP (this PR)**: cancel current Paystack sub at period end + start a fresh checkout for the new plan. User pays now; new sub starts immediately, old one finishes its period.
- Later: use `/subscription` create endpoint with the saved `authorization_code` for a same-card upgrade (no re-checkout). Defer.

## Your "must enter card details" comment — clarification

Yes, Paystack requires **the very first charge to be customer-authenticated** (3DS / 2FA). After that, renewals are silent push-charges on the saved authorization — no further prompts unless the card fails or expires. So the UX is:

- First subscription: user fills card on Paystack hosted checkout (same UX as today's one-shot)
- Every month after: silent. We just receive `charge.success` and credit them.
- Card fails / expires: we email a "tap here to update your card" link → Paystack hosted page → done.

This matches what users expect from Netflix/Spotify on Nigerian cards.

## Out of scope

- Direct Debit (bank account) authorizations — different flow, can add later
- Annual billing — schema supports it via `paystack_interval` but we won't expose UI yet
- Proration on plan switches (Paystack doesn't natively prorate; we'd need to compute it ourselves)
- Migrating existing Stripe subscribers (none in production today; the column split keeps both alive)

## Files touched

- New migration: `billing_plans` columns, `subscriptions` columns, `paystack_invoices` table
- `src/server/paystack.server.ts` — add plan, subscription, manage-link, disable helpers
- `src/server/billing-pricing.server.ts` — expose plan code lookup per currency
- `src/routes/api/billing/initialize.ts` — pass `plan` to Paystack for `purpose: "plan"`
- `src/routes/api/public/paystack/webhook.ts` — handle subscription + invoice events
- `src/routes/api/billing/subscription/manage-link.ts` (new)
- `src/routes/api/billing/subscription/cancel.ts` (new)
- `src/routes/api/admin/paystack-plans.ts` (new — sync button target)
- `src/components/BillingSheet.tsx` — manage card / cancel UI, attention banner
- `src/lib/email-templates/payment-failed.tsx` — include manage link when present
- `src/routes/admin.billing.tsx` — "Sync Paystack plans" button
