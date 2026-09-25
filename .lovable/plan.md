# Custom credit amounts — buy any amount, $3 minimum

Replace fixed credit packs with a "choose your amount" purchase. Users type how much they want to pay (in their currency) and receive the matching credits. The old fixed ₦5,000 minimum is removed and replaced with a $3.00 USD-equivalent floor.

## What the user sees

- In the Credits sheet, "Top up credits" becomes an amount field: type an amount (e.g. $5, ₦7,500), see instantly how many credits it buys, tap Buy.
- Amounts below the $3 equivalent show a clear message: "The smallest purchase is $3.00" (shown in their currency).
- Existing preset packs are kept as quick-pick chips ($5 / $10 / $25 style shortcuts) that simply fill the amount field — no separate pack checkout.
- Crypto checkout gets the same custom amount + $3 floor.

## Changes

### 1. Remove the ₦5,000 fixed minimum
- Delete `src/server/purchase-minimum.server.ts` and its call in `src/routes/api/billing/initialize.ts`.
- Remove the `min_purchase_ngn` key from `src/server/economics-config.server.ts` and the Admin → Economics screen (`src/routes/admin.economics.tsx`).
- Replace with a new economics key `min_purchase_usd_cents` defaulting to **300** ($3.00), so the floor is still tunable from Admin without a code change.

### 2. Custom-amount checkout (Paystack)
- `src/routes/api/billing/initialize.ts`: accept `purpose: "pack"` with `itemCode: "custom"` + `customAmountMinor` (the existing field, already validated). Convert to USD cents via `billing_currencies`, enforce the $3 floor, and store the pending transaction as today.
- Credits granted = `usdAmountCents / credit_retail_usd_cents` (currently 15¢/credit), so $3 → 20 credits, $10 → ~66 credits. Server-side only; the client can never set the credit amount.

### 3. Crediting on payment (database)
- Extend the `apply_paystack_topup` RPC: when `item_code = 'custom'`, grant `usd_amount_cents / credit_retail` credits instead of looking up a pack. Idempotent on reference, as today. Migration includes GRANTs as required.
- Webhook path (`/api/public/paystack/webhook`) uses the same RPC, so it stays in sync automatically.

### 4. Crypto checkout
- `src/routes/api/billing/crypto.ts`: allow `purpose: "pack"` with a custom USD amount, same $3 floor and same credit rate. (It already supports custom amounts for runtime top-ups; this extends the same pattern to credits.)

### 5. Credits sheet UI (`src/components/BillingSheet.tsx`)
- Replace the 3-pack grid with: quick-pick chips (from active packs, purely as amount shortcuts) + a custom amount input showing live credit conversion.
- Buy button disabled with helper text below the $3 equivalent.
- Crypto panel receives the custom amount instead of a pack code.

### 6. Clean-up
- `credit_packs` table and admin pack management stay (they feed the quick-pick chips and price overrides), but packs are no longer the only way to buy.
- No change to build pricing, badge removal, domains, or any other credit spend.

## Safety / invariants kept

- Server re-quotes everything: amount → USD → credits happens only on the server; the client sends a money amount, never a credit amount.
- Verify + webhook remain idempotent on the payment reference; amount/currency mismatch still rejects the payment.
- $3 floor enforced server-side (UI check is cosmetic only).
- No subscriptions, no saved card, no expiry — unchanged.

## Verification

- Unit tests: floor enforcement (below/above $3 in NGN, USD, GHS), credit conversion math, custom top-up RPC idempotency.
- Typecheck + full test suite.
- Publish required afterwards (database function changes).
