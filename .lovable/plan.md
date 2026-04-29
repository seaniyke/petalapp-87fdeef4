## Goal

Stop forcing every user through a $10 Cloud top-up before they can use backend / email / domains. Instead:

1. Free users hitting any paid capability (backend, email, custom domain) are routed to **Upgrade plan** — not to a top-up screen.
2. The first time a user upgrades to a paid plan, they get a **one-time $5 runtime grant** (covers both Cloud usage and AI usage — same wallet).
3. Existing low-balance alerts and grace-period logic stay exactly as they are.
4. Paid users with $0 runtime balance still get alerted and can top up — that path stays alive, it's just no longer the gate for first-time access.

This removes the worst current UX cliff (a brand-new user being asked to put down $10 before they can do anything backend-related) without eroding monetization — they still have to pay for the plan.

---

## Scope of changes

### A. Database / SQL (one new migration)

1. Add a column `runtime_first_plan_grant_at TIMESTAMPTZ` on `user_wallets` so the one-time grant is idempotent across re-subscribes / plan switches.
2. New SQL function `grant_first_paid_plan_runtime_credit(_user_id, _plan_code, _reference)`:
   - No-op if `plan_code = 'free'`.
   - No-op if `runtime_first_plan_grant_at IS NOT NULL` (already granted once, ever).
   - Otherwise: set `runtime_topup_qualified_at = now()` (so they qualify for the existing monthly $5 reset), set `runtime_first_plan_grant_at = now()`, and **add 500¢ ($5) to `runtime_free_balance_cents`** (capped — don't add if already > 500).
   - Insert a `credit_ledger` / runtime ledger row tagged `reason='first_plan_grant'` with the paystack reference for audit.
3. Update `apply_paystack_plan_grant` to call the new function at the end (so paying for any paid plan triggers it once, ever).

Why a separate function: keeps the grant logic auditable and reusable by admin tools. Why qualify them: the existing monthly $5 free reset only fires for `runtime_topup_qualified_at IS NOT NULL` wallets — paying for a plan should count as "qualified" so they keep getting the monthly $5 going forward.

### B. Backend gate (`src/routes/api/backend.ts`)

`handleEnableManaged` currently rejects with `topup_required` whenever `runtime_topup_balance_cents < $10`. Replace that gate with a **plan gate**:

- Read `plan_code` from `user_wallets`.
- If `plan_code === 'free'` → return 402 with `code: 'plan_upgrade_required'`, `requiredPlan: 'pro'`, and a message ("Backends are included with paid plans.").
- If paid plan:
  - If `runtime_topup_balance_cents + runtime_free_balance_cents > 0` → allow activation.
  - If both are $0 → return 402 with `code: 'balance_empty'` (existing path) so they top up. This shouldn't happen right after upgrade thanks to the $5 grant, but covers the edge case where they spent it all.
- Drop `PROVISIONING_FLOOR_CENTS = 1000` entirely. The $10 floor is gone.

Mirror the same logic in the SQL helper `can_enable_managed_backend()` so server-side enforcement matches.

### C. Client gating UI

Three suggestion-chip flows + their dialogs need to learn the new rule. The pattern is identical for each: if `plan.code === 'free'`, the primary CTA opens `BillingSheet` (upgrade), not the top-up modal.

1. **`EnableBackendSuggestionChip` / `EnableBackendFromCloudDialog`**
   - Take `isPaidPlan` from `useWallet()` (already available — the prop exists, just unused).
   - Free plan: chip CTA reads "Upgrade to add backend" and opens `BillingSheet`.
   - Paid plan: existing flow (open dialog, provision from balance).
   - Inside `EnableBackendFromCloudDialog`, remove the "$10 minimum" copy and the `setTopupOpen` fallback for first-time users; only show top-up UI when a paid user genuinely has $0.

2. **`AddDomainSuggestionChip` / `BuyDomainSlotDialog`**
   - Free plan: hide "Buy" button (or replace with "Upgrade to buy"), keep "Connect" disabled with an upgrade tooltip.
   - Inside `BuyDomainSlotDialog`, if free plan: render an upgrade CTA instead of the Paystack init form.

3. **`EnableEmailSuggestionChip`** (and the email section inside `ProjectSettingsSheet`)
   - Free plan: chip CTA reads "Upgrade to send email" and opens `BillingSheet`.
   - Paid plan: existing behavior.

4. **Server settings / project settings sheet** — wherever an "Enable email" / "Connect domain" / "Add backend" button lives in `ProjectSettingsSheet.tsx`, mirror the same paid-plan check.

### D. Verify route (`src/routes/api/billing/verify.ts`)

Already calls `apply_paystack_plan_grant` for `purpose === 'plan'`. Once that SQL function is updated to include the one-time runtime grant, the verify route needs no JS changes — the grant happens atomically inside the RPC. Webhook (`/api/public/paystack/webhook.ts`) needs the same audit (it also calls `apply_paystack_plan_grant`).

### E. Copy & comms

- Update upgrade success toast / billing-return page: "Welcome to {plan}. We've added $5 of runtime credit so you can spin up backends, email, and domains right away."
- Update `EnableBackendFromCloudDialog` body copy: drop "$10 minimum" — replace with "Backends are included with your plan. You'll spend ~$0.02/hr from your runtime balance while it's running."
- Update memory files (`mem://feature/cloud-activation-per-project.md` and `mem://feature/cloud-ai-billing-model.md`) to reflect the new rules: plan-gated, not balance-gated; $5 one-time on first paid plan + monthly $5 thereafter.

### F. Out of scope (intentionally not changing)

- Top-up flow itself — paid users with $0 balance keep using it.
- Monthly $5 free reset — keep as-is for qualified wallets.
- Low-balance banners and grace-period cron — keep as-is.
- Build-credit pricing (per-message credits) — separate system, untouched.

---

## Technical details

**Why $5 lives in `runtime_free_balance_cents` and not a new column**: it's the same wallet the rest of the runtime system already drains in the right order (free → top-up). No new spend logic needed.

**Why `runtime_first_plan_grant_at` is separate from `runtime_topup_qualified_at`**: a user could in theory pay for a top-up first, then later upgrade to a plan. We still want to give them the one-time $5 plan-upgrade gift exactly once. Tracking the two events independently keeps that clean.

**Idempotency**: the new RPC checks both `runtime_first_plan_grant_at` and the existence of a ledger row keyed by the paystack reference, so a verify+webhook race can't double-credit.

**No regression for current paid users**: the migration backfills `runtime_first_plan_grant_at = now()` for any wallet where `plan_code != 'free'`. They don't get a retroactive $5 (avoids surprise grants), but they're correctly marked as "already received" so a future plan switch doesn't trigger it.

**Security**: gate is enforced server-side in `/api/backend.ts` and in `can_enable_managed_backend()`. Client UI changes are UX only; a free user calling the API directly still gets 402.

---

## Acceptance check

- New free user clicks "Add backend" → sees upgrade prompt, not a top-up screen.
- User upgrades to Pro → wallet shows $5 runtime balance immediately, can enable backend in one click without topping up.
- Existing paid user with balance > $0 → no behavior change.
- Existing paid user with balance = $0 → still sees top-up prompt (unchanged).
- User downgrades and re-upgrades → does NOT get a second $5 grant.

---

## Open question

For domain **slot purchases** (`addon` purpose, paid via Paystack on top of the plan): do you want free users blocked entirely (must upgrade first), or do you want to allow paid-plan users to buy extra domain slots? The plan above assumes: free → must upgrade; paid → can buy slots as today. Confirm if that matches.
