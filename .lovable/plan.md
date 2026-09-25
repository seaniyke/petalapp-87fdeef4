# Custom credit amounts — buy any amount, $3 minimum

Keep the existing credit packs, show them in a dropdown instead of the current 3-card grid, and add a new "Custom amount" option. The old fixed ₦5,000 minimum is removed and replaced with a $3.00 USD-equivalent floor.

## What the user sees

- In the Credits sheet, "Top up credits" shows one dropdown listing every pack (e.g. "20 credits — $5"), plus a last option "Custom amount".
- Picking a pack works exactly as today (pack checkout).
- Picking "Custom amount" reveals an amount field: type an amount in their currency, see instantly how many credits it buys, tap Buy.
- Custom amounts below the $3 equivalent show: "The smallest purchase is $3.00" (in their currency).
- Crypto checkout supports both the selected pack and the custom amount, same $3 floor.

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
- Replace the 3-card pack grid with a dropdown (shadcn Select) listing all active packs with local-currency price, plus "Custom amount".
- Pack selected: existing summary card + Buy (unchanged checkout).
- Custom selected: amount input with currency symbol, live credit conversion, Buy disabled with helper text below the $3 equivalent.
- Crypto panel receives either the pack code or the custom amount.

### 6. Unchanged
- Packs, admin pack management and local price overrides all stay as-is.
- Packs priced below $3 would now be allowed (the ₦5,000 floor no longer blocks them); the $3 floor applies to all credit purchases, packs included.
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
