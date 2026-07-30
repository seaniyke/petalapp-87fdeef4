# Pay-as-you-go credits (buy once, no subscription)

Subscriptions stay exactly as they are. On top of them, any signed-in user — including free-tier — can buy a one-off credit pack with card (Paystack) or crypto. While a user still has purchased credits left, they get the same feature access a paid plan gives (managed backend, email, custom domains, private projects, mobile builds). When purchased credits run out, they drop back to free-tier access until they buy again. Purchased credits keep the existing 12-month expiry.

## What changes for users

- Free users can buy credit packs directly from the billing sheet and the crypto checkout — no upgrade wall.
- Buying a pack unlocks Pro-level features for as long as purchased credits remain above zero.
- A clear line in billing: "Pay as you go — buy credits, no subscription. Features stay unlocked while you have credits."
- Subscribers see no behaviour change; their monthly credits, renewals and features work as before.
- Nobody is blocked from building: entry checks stay based on available balance (daily free + monthly + purchased), not on having a subscription.

## Access rule (single source of truth)

"Has full access" = subscription plan is not `free` **OR** purchased (top-up) credit balance > 0.

This is defined once in the database and reused everywhere so the UI and server can never disagree.

## Technical plan

### 1. Database migration
- Replace `public.is_paid_plan(_user_id)` with: plan_code <> 'free' OR `COALESCE(topup_credits_remaining,0) > 0`. This automatically fixes the private-project trigger and any policy using it.
- Add `public.has_full_access(_user_id uuid) returns boolean` (security definer, stable) with the same logic, as the explicit name used by new code; keep `is_paid_plan` as a thin wrapper for backward compatibility.
- No table changes; `credit_packs`, `topup_lots` and `apply_topup_purchase` / `apply_paystack_topup` already work for free users (they upsert the wallet and keep the 12-month lot expiry).

### 2. Server gates
- `src/routes/api/billing/initialize.ts`: drop `purpose === "pack"` from the free-plan 403 block. `addon` and `runtime_topup` become allowed when `has_full_access` is true (subscription **or** purchased credits) instead of requiring a subscription.
- `src/routes/api/billing/crypto.ts`: same change to the mirrored gate, so crypto pack purchases work for free users.
- `src/routes/api/backend.ts`, `src/routes/api/builds/trigger.ts`, `src/routes/api/builds/watchdog.ts`: replace the local `plan_code !== "free"` derivations with a shared helper `hasFullAccess(userId)` in a new `src/server/entitlements.server.ts` that reads plan_code + topup balance (one query, RPC to `has_full_access`).
- Verify the Paystack webhook and crypto verifier pack paths (`apply_paystack_topup`, `crypto-credit.server.ts`) credit free users correctly — they already call the RPC with no plan check.

### 3. Client
- `src/lib/billing.ts`: add `hasFullAccess(wallet)` helper (plan_code !== 'free' || topup_credits_remaining > 0).
- `src/components/BillingSheet.tsx`: remove the "Top-up packs are available on Pro and Business plans" block; always show the pack picker plus the crypto option, with pay-as-you-go copy. Show an "Access: pay as you go" state when unlocked by credits rather than a plan.
- `src/routes/builder.tsx`: `isPaidPlan` becomes `hasFullAccess(currentWallet)` so all suggestion chips (backend, email, domains, mobile, private project) unlock for credit buyers.
- Suggestion chips / dialogs that say "Upgrade to Pro" get a second action: "or buy credits" opening the billing sheet at the packs section.
- `src/routes/billing.index.tsx`: surface purchased-credit balance and its expiry, and a pay-as-you-go buy button for free users.

### 4. Copy and marketing
- Pricing/landing and docs get a short "No subscription? Just buy credits" line next to the plans.

### 5. Verification
- Confirm a free-tier wallet can start a pack checkout (card and crypto) without a 403.
- Confirm `is_paid_plan` returns true for a free wallet with topup credits and false at zero, and that the private-project trigger follows.
- Confirm subscribers are unaffected: plan features, renewals, and monthly credit grants unchanged.
