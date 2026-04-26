# Credit & Billing System — Full Plan

## Goals
- Every AI message (`/api/generate`, `/api/discuss`) costs **1 credit**.
- Every user gets **5 free credits/day, capped at 30/month** (Free plan).
- Paid users (Pro / Business) get monthly credit grants + can buy top-up packs.
- Stripe handles checkout, subscriptions, and top-ups. Petal handles the ledger.
- Admins can grant/revoke credits manually.

## Why this shape
This mirrors **Lovable** almost verbatim (5 daily / 30 monthly free, monthly grants, top-ups in 50-credit increments). It's the proven pattern for this category and it's what your users will expect.

---

## Phase 1 — Database (foundation)

A clean **wallet + ledger + plans** model. The wallet is a fast-read cache; the ledger is the source of truth.

### New tables

**`billing_plans`** — seeded catalog of plans (no user data)
```
code (text, PK)         -- 'free', 'pro_100', 'pro_500', 'business_500', 'business_2000'
name (text)
tier (text)             -- 'free' | 'pro' | 'business'
monthly_credits (int)   -- granted on each renewal (0 for free)
daily_free_credits (int)-- 5 for everyone
monthly_free_cap (int)  -- 30 for free, NULL for paid (no cap)
stripe_price_id (text)  -- nullable for free
price_cents (int)
features (jsonb)        -- { custom_domain: true, hide_badge: true, ... }
sort_order (int)
is_active (bool)
```

**`credit_packs`** — top-up SKUs
```
code (text, PK)         -- 'pack_50', 'pack_200', 'pack_1000'
credits (int)
price_cents (int)
stripe_price_id (text)
is_active (bool)
```

**`user_wallets`** — one row per user (fast-read snapshot)
```
user_id (uuid, PK, FK auth.users)
plan_code (text, FK billing_plans, default 'free')
balance (int)                     -- monthly + topup combined for fast reads
monthly_credits_remaining (int)   -- resets on renewal
topup_credits_remaining (int)     -- 12-month rolling
daily_free_used (int)             -- resets at UTC midnight
daily_free_reset_at (date)
monthly_free_used (int)           -- resets at calendar month
monthly_free_reset_at (date)
stripe_customer_id (text)
stripe_subscription_id (text)
subscription_status (text)        -- 'active' | 'past_due' | 'canceled' | 'trialing' | null
current_period_end (timestamptz)
created_at, updated_at
```

**`credit_ledger`** — append-only audit trail
```
id (uuid PK)
user_id (uuid FK)
delta (int)                       -- negative for spend, positive for grant/topup
reason (text)                     -- 'ai_message' | 'monthly_grant' | 'topup' | 'daily_free' | 'admin_grant' | 'refund' | 'rollover'
balance_after (int)
project_id (uuid, nullable)       -- which project burned it
metadata (jsonb)                  -- { route, model, stripe_invoice_id, admin_id, ... }
created_at (timestamptz)
```

**`stripe_events`** — webhook idempotency (every event id stored once)
```
id (text PK)                      -- Stripe event id
type (text)
processed_at (timestamptz)
payload (jsonb)
```

### Triggers / functions
- **`handle_new_user`** (extend existing) → also create `user_wallets` row on signup with `plan_code='free'`.
- **`spend_credit(user_id, reason, project_id, metadata) returns boolean`** — single SQL function that:
  1. Locks the wallet row (`FOR UPDATE`).
  2. Refills daily/monthly free buckets if reset dates passed.
  3. Tries free → monthly → top-up in that order.
  4. Returns `false` if nothing available; otherwise writes ledger row + decrements balance.
  5. Atomic — no race conditions even with concurrent AI calls.
- **`grant_credits(user_id, amount, reason, metadata)`** — admin / webhook entry point.

### RLS
- `user_wallets` — users SELECT their own; only service role writes (via `spend_credit` / webhooks).
- `credit_ledger` — users SELECT their own; INSERT only via security-definer functions.
- `billing_plans`, `credit_packs` — public read.
- `stripe_events` — service role only.

---

## Phase 2 — Stripe integration

Use Lovable's built-in Stripe (`enable_stripe_payments`). Zero account setup, test mode out of the box.

### Setup steps (in order)
1. Run `recommend_payment_provider` → confirm Stripe fits (Petal is SaaS).
2. Run `enable_stripe_payments`.
3. Choose tax mode: **option 2 (calculation only, +0.5%)** — recommended default for a global SaaS without the burden of full filing yet.
4. Use `batch_create_product` to create Stripe products that mirror `billing_plans` and `credit_packs`. Each product gets a tax code.
5. Store the returned `stripe_price_id` values back into our seed data.

### Server routes (TanStack `/api/*`)
- **`POST /api/billing/checkout`** — creates a Stripe checkout session for a `plan_code` or `pack_code`. Auth-gated. Sets `client_reference_id = user_id`.
- **`POST /api/billing/portal`** — creates a Stripe Customer Portal session (manage card, cancel sub).
- **`POST /api/public/stripe/webhook`** — public endpoint, signature-verified with `STRIPE_WEBHOOK_SECRET`. Handles:
  - `checkout.session.completed` → grant initial credits
  - `invoice.paid` → monthly grant on renewal (Lovable-style: unused monthly credits roll over while sub active)
  - `invoice.payment_failed` → mark `past_due`, freeze paid credits but keep free daily
  - `customer.subscription.updated` / `.deleted` → update plan / downgrade to free
  - All events stored in `stripe_events` for idempotency

### Secrets needed
- `STRIPE_SECRET_KEY` — auto-set by `enable_stripe_payments`
- `STRIPE_WEBHOOK_SECRET` — auto-set by `enable_stripe_payments`

---

## Phase 3 — Wire credits into the AI endpoints (the deduction)

Smallest, safest change. Both `/api/generate` and `/api/discuss` already authorize the user — we add **one call** before the AI request:

```ts
const { data: ok } = await supabaseAdmin.rpc('spend_credit', {
  _user_id: userId,
  _reason: 'ai_message',
  _project_id: projectId,
  _metadata: { route: 'generate', model }
});
if (!ok) {
  return new Response(JSON.stringify({ error: 'OUT_OF_CREDITS' }), { status: 402 });
}
```

- 402 = the standard "Payment Required" status; frontend uses it to show the upgrade dialog.
- "Try to fix" calls (when the user clicks the auto-fix button) skip the deduction, matching Lovable.
- Failures **after** the spend (model errors) do **not** auto-refund in v1 — Lovable doesn't either. Refunds happen via admin tool when a user reports an issue.

---

## Phase 4 — UI

### Header credit badge (`SiteHeader.tsx`)
- Pill showing `{balance} credits`, color shifts amber <10, red <3.
- Hover shows breakdown: `5 daily · 25 monthly · 100 top-up`.
- Click → opens billing sheet.

### New `BillingSheet.tsx` (sheet, opened from header + settings)
- **Current plan** card — name, renewal date, balance breakdown, "Manage subscription" → portal.
- **Upgrade** section — three plan cards (Free / Pro / Business) with credit allowance, features, "Choose plan" button.
- **Top-up** section (paid users only) — pack_50 / pack_200 / pack_1000 buttons.
- **Usage history** — last 30 ledger entries (date, reason, delta, project link).

### `OutOfCreditsDialog.tsx`
- Triggered globally when any AI call returns 402.
- Shows current plan, free credits reset countdown, "Upgrade" CTA opening `BillingSheet`.

### `/auth/success` route
- Stripe `success_url` → confirms checkout, polls wallet for the granted credits, then redirects to last project.

---

## Phase 5 — Admin tools

In existing admin surface (gated by `has_role('admin')`):
- **Users page** — table of users + plan + balance + last activity.
- Per-user actions: **Grant credits** (amount + reason note), **View ledger**, **Reset daily**, **Switch plan manually** (for refund cases).
- **Plans editor** — toggle plans active/inactive, edit credit allotments. Stripe prices stay in Stripe.
- **Stripe events log** — last 100 webhook events, status, retry button.

Server route: `POST /api/admin/credits` (action: grant | reset | switch_plan), guarded by `has_role`.

---

## Phase 6 — Background jobs

One scheduled job (pg_cron or external cron hitting `/api/public/cron/billing`):
- **Daily** (00:05 UTC) — reset `daily_free_used = 0` for everyone, log `daily_free` ledger rows lazily on next spend.
- **Monthly** (1st 00:10 UTC) — reset `monthly_free_used = 0` for free-tier users; expire top-ups older than 12 months.

Stripe handles the monthly subscription grant via `invoice.paid` webhook — no cron needed for that.

---

## Files I'll create / modify

**New migrations**
- `xxx_billing_plans.sql` — tables, indexes, RLS
- `xxx_billing_seed.sql` — seed plans + packs
- `xxx_billing_functions.sql` — `spend_credit`, `grant_credits`, wallet trigger

**New server routes**
- `src/routes/api/billing/checkout.ts`
- `src/routes/api/billing/portal.ts`
- `src/routes/api/public/stripe/webhook.ts`
- `src/routes/api/public/cron/billing.ts`
- `src/routes/api/admin/credits.ts`

**Modified server routes**
- `src/routes/api/generate.ts` — add `spend_credit` call + 402 path
- `src/routes/api/discuss.ts` — same

**New client modules**
- `src/lib/billing.ts` — fetch wallet, fetch plans, start checkout, open portal
- `src/hooks/use-wallet.ts` — TanStack Query hook with realtime subscription on `user_wallets`

**New components**
- `src/components/CreditBadge.tsx` (header pill)
- `src/components/BillingSheet.tsx`
- `src/components/OutOfCreditsDialog.tsx`
- `src/components/admin/CreditAdminPanel.tsx`

**Modified components**
- `src/components/SiteHeader.tsx` — mount `CreditBadge`
- `src/lib/auth.tsx` — wrap app with `OutOfCreditsDialog` provider (listens to 402 globally)

---

## Rollout strategy (live-system safety)

Because Petal is in production, I'll ship in **3 deploys**, each independently safe:

1. **Deploy 1 — Schema + ledger only.** New tables, `spend_credit` function, wallet auto-created on signup. Backfill wallets for existing users with `plan_code='free'` and 5 daily / 30 monthly free credits. **No deduction enforced yet.** Header badge ships in "preview" mode showing balance but with no gating. Zero risk to existing flows.

2. **Deploy 2 — Enable enforcement + Stripe.** Turn on `spend_credit` in `/api/generate` + `/api/discuss`. Ship `BillingSheet`, `OutOfCreditsDialog`, Stripe checkout, webhook. Existing users land on Free plan and immediately have 30 free monthly credits, so nobody is blocked on day one.

3. **Deploy 3 — Top-ups + admin tools + cron.** Lower-risk polish.

After each deploy I'll verify the build is clean and ask you to spot-check the preview before moving to the next phase.

---

## Open decisions to confirm before I start
1. **Plan pricing.** I'll seed Lovable-style defaults (Pro $25/mo for 100 credits, Pro $50/mo for 250, Business $100/mo for 500, etc.) — confirm or send me your numbers.
2. **Free monthly cap.** 30 credits/month (Lovable's number) or different?
3. **Top-up sizes.** 50 / 200 / 1000 with proportional pricing — confirm?
4. **Backfill for existing users** — give everyone the standard Free plan, or grant a one-time bonus (e.g. 50 credits) as a thank-you to early users?

I'll wait for your confirmation on these four, then proceed with Deploy 1.