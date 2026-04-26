## Goal
Gate the "Add custom domain" flow behind a one-time Paystack payment. Each purchased slot is **valid for 12 months** from the date of purchase. After 12 months, the slot expires and the attached domain is automatically deactivated until the user renews.

This is consistent with the existing Paystack top-up model (one-time purchases, no recurring subscriptions) and with how `topup_lots` already track a 12-month expiry.

---

## 1. Database migration

### New table: `domain_slots`
Tracks each purchased slot, which project it belongs to, when it expires, and which domain (if any) is currently consuming it.

```
id                    uuid PK
user_id               uuid not null
project_id            uuid not null  -- slot is bound to a project
purchased_at          timestamptz not null default now()
expires_at            timestamptz not null  -- purchased_at + 12 months
consumed_by_domain_id uuid null   -- FK-style reference to project_domains.id
paystack_reference    text not null unique  -- idempotency
amount_minor          bigint not null
currency_code         text not null
environment           text not null default 'test'
created_at / updated_at
```

RLS: users can `SELECT` their own rows; only service role writes.

### New table: `billing_addons`
Catalog row for the domain slot SKU so admins can change the base USD price without code edits.

```
code         text PK   -- e.g. 'domain_slot'
name         text      -- 'Custom domain (12 months)'
price_cents  integer   -- USD base price, default 1200 ($12)
duration_days integer  -- 365
is_active    boolean
```

RLS: public `SELECT`; admin-only writes.

### Extend existing tables
- `billing_price_overrides.item_kind`: allow value `'addon'` (currently allows `'plan' | 'pack'`).
- `paystack_transactions.purpose`: allow value `'addon'`. Add nullable `project_id uuid` column so we know which project a slot purchase is for.

### New RPC: `apply_paystack_domain_slot(_user_id, _project_id, _addon_code, _reference, _amount_minor, _currency_code, _environment)`
- Idempotent on `paystack_reference` (early return if a row already exists).
- Looks up `duration_days` from `billing_addons`.
- Inserts a `domain_slots` row with `expires_at = now() + duration_days * interval '1 day'`.
- `SECURITY DEFINER`, `search_path = public`.

### New RPC: `expire_domain_slots()`
Daily maintenance — to be called from the existing daily cron alongside `expire_paystack_plans`:
- For each `domain_slots` row where `expires_at < now()` and `consumed_by_domain_id is not null`:
  - Set the linked `project_domains.status = 'offline'` and `error_message = 'Domain slot expired — renew to reactivate'`.
  - Null out `consumed_by_domain_id` so the slot is fully closed.
- Leaves the domain row in place so the user can renew and reattach it without re-entering DNS records.

### Seed data
Insert one row in `billing_addons`:
- `code = 'domain_slot'`, `name = 'Custom domain (12 months)'`, `price_cents = 1200`, `duration_days = 365`.

---

## 2. Server-side changes

### `src/server/billing-pricing.server.ts`
Extend `ItemKind` to `'plan' | 'pack' | 'addon'` and add an `'addon'` branch that reads from `billing_addons` (mirrors the existing plan/pack branches, including override lookup).

### `src/routes/api/billing/initialize.ts`
- Add `'addon'` to the `purpose` enum.
- Require `projectId` in the request body when `purpose === 'addon'`; verify the caller owns the project.
- Pass `project_id` into the inserted `paystack_transactions` row.
- Metadata sent to Paystack includes `project_id` and `addon_code` so the webhook can fulfill correctly.

### `src/routes/api/billing/verify.ts` and `src/routes/api/public/paystack/webhook.ts`
Add a third fulfillment branch:
- If `purpose === 'addon'` and `item_code === 'domain_slot'`, call `apply_paystack_domain_slot(...)` with the transaction's `user_id`, `project_id`, `reference`, `amount_minor`, `currency_code`, and `environment`.

### `src/routes/api/domains.ts` — gate `handleAdd`
Before calling Cloudflare:
1. Count available slots for the project: `domain_slots` where `project_id = ?`, `expires_at > now()`, `consumed_by_domain_id IS NULL`.
2. If zero, return **HTTP 402** with JSON `{ error: "payment_required", code: "no_domain_slot" }`.
3. If a slot is available, proceed with `createCustomHostname` as today, then in the same transaction set `consumed_by_domain_id = <new domain id>` on the oldest available slot.

In `handleRemove`: when a domain is deleted, free its slot (set `consumed_by_domain_id = null`) so the slot can be reused for a different domain within its 12-month window.

### Daily cron
Add `SELECT public.expire_domain_slots();` to the existing daily expiry cron (alongside `expire_paystack_plans`).

---

## 3. Client-side changes

### `src/lib/domains.ts`
- New helper `purchaseDomainSlot(projectId, currency)` that calls `/api/billing/initialize` with `purpose: 'addon'`, `itemCode: 'domain_slot'`, `projectId`, and a `returnUrl` of `/billing/return?next=/projects/<id>/settings`.
- New helper `listDomainSlots(projectId)` returning active/expired slots so the UI can show "1 slot available" or "Expires in 47 days".
- Update `addDomain` to detect a 402 response and surface a typed `PaymentRequiredError` so the UI can react.

### `src/components/DomainsSection.tsx`
- Show a "Domain slots" summary near the top: e.g. *"You have 1 unused slot (expires Apr 26, 2027)"* or *"Buy a slot to add a custom domain — $12 for 12 months"*.
- When the user clicks "Add custom domain":
  - If a free slot exists, open the existing `AddDomainDialog` unchanged.
  - Otherwise, open a new `BuyDomainSlotDialog` with currency selector (reuses `fetchCurrencies` + `convertPrice` + `formatMoney` from `src/lib/billing.ts`), a "$12 / 12 months" headline, and a "Pay with Paystack" button that redirects to the Paystack checkout URL.
- Catch the `PaymentRequiredError` from `addDomain` and route the user into `BuyDomainSlotDialog` automatically.
- After returning from `/billing/return` with `next=...`, refresh the slots list and reopen the add-domain dialog.

### `src/routes/billing.return.tsx`
Already verifies the transaction. Add support for the optional `next` search param so users land back on the project's domain settings after paying.

---

## 4. Admin UI

### `src/routes/admin.billing.tsx`
- Add an **"Add-ons"** tab listing `billing_addons`. Admins can edit `price_cents` (USD) and `duration_days` for `domain_slot` (and any future addons) inline.
- The existing **Price overrides** tab already supports per-currency overrides; extend its `item_kind` selector to include `'addon'` so admins can pin, e.g., `domain_slot` to ₦18,000 in NGN.

---

## 5. Files touched

**New**
- `supabase/migrations/<timestamp>_domain_slots.sql`
- `src/components/BuyDomainSlotDialog.tsx`

**Edited**
- `src/server/billing-pricing.server.ts` — add `'addon'` branch
- `src/routes/api/billing/initialize.ts` — accept `purpose: 'addon'` + `projectId`
- `src/routes/api/billing/verify.ts` — fulfill addon
- `src/routes/api/public/paystack/webhook.ts` — fulfill addon
- `src/routes/api/domains.ts` — gate add, free slot on remove
- `src/lib/domains.ts` — new helpers, 402 handling
- `src/lib/billing.ts` — extend `ItemKind` to `'addon'` in `convertPrice`
- `src/components/DomainsSection.tsx` — slots summary + paywall flow
- `src/routes/billing.return.tsx` — honor `next` param
- `src/routes/admin.billing.tsx` — Add-ons tab + extend overrides selector

---

## 6. Behavior summary
- **Buy once, valid 12 months.** Paying $12 (or local equivalent) gives the project one domain slot good for 365 days from purchase.
- **Reusable within the window.** Removing a domain frees its slot so a different domain can take its place until the slot expires.
- **Auto-deactivation at expiry.** A daily job marks expired slots' domains as `offline`; the DNS/Cloudflare record is left intact so renewal reactivates instantly.
- **Admin-controlled pricing.** Base price (USD) and per-currency overrides are editable from `/admin/billing` without a redeploy.
- **No subscriptions.** Renewal is a fresh one-time purchase, matching the rest of the Paystack billing model.