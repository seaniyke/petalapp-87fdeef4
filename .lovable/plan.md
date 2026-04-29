# Payments-as-Integrations — Paystack + Stripe + Flutterwave (BYOK)

## Why this matters

Today, when a user prompts Petal "add a $20 checkout", the AI hallucinates: it invents env-var names, hardcodes test keys, or calls Stripe/Paystack APIs directly without verification or webhooks. Competing builders (Lovable, Bolt, v0) ship pre-baked payment installers that the AI is *taught* about via system-prompt context, so it writes against a known-good local wrapper instead of guessing.

Our integrations marketplace already has the perfect pipeline for this — `resend.integration.ts` and `plausible.integration.ts` prove the pattern works. We just need three more definition files and to register them.

## Scope

Add three BYOK payment integrations using the existing `IntegrationDefinition` framework. Each one is purely a new file (no installer/registry refactor needed):

- **Paystack** — Africa-focused. Already have a server SDK we can mirror.
- **Stripe** — Global default. Most-requested by users.
- **Flutterwave** — African + global hybrid. Strong in Nigeria, Kenya, Ghana, plus card/USD support.

All three use the same shape: collect API keys → scaffold `src/integrations/<provider>/` with a typed `createCheckout()` + `verifyPayment()` helper and a webhook server route → expose `aiGuidance` so Petal writes against the local wrapper.

## What we'll build

### 1. `src/server/integrations/stripe.integration.ts`

**Fields collected:**
- `secret_key` (secret) — `sk_test_...` / `sk_live_...`
- `publishable_key` (string, public) — `pk_test_...` / `pk_live_...` — emitted as `VITE_STRIPE_PUBLISHABLE_KEY` for client SDK
- `webhook_secret` (secret) — `whsec_...` for signature verification
- `currency` (string, public) — default `usd`

**Files scaffolded into user's project:**
- `src/integrations/stripe/checkout.ts` — `createCheckoutSession({ items, successUrl, cancelUrl, mode })` returning Stripe Checkout URL
- `src/integrations/stripe/verify.ts` — `verifyPayment(sessionId)` that calls Stripe's retrieve API
- `src/integrations/stripe/webhook-verify.ts` — signature verification helper (HMAC-SHA256 over raw body)
- `src/routes/api/payments/stripe/checkout.ts` — server route the frontend POSTs to
- `src/routes/api/public/stripe/webhook.ts` — public webhook receiver (verifies signature, updates DB)
- `src/integrations/stripe/README.md` — usage examples

### 2. `src/server/integrations/paystack.integration.ts`

**Fields collected:**
- `secret_key` (secret) — `sk_test_...` / `sk_live_...` (one key, env auto-detected from prefix — same as our internal Petal Paystack code)
- `public_key` (string, public) — emitted as `VITE_PAYSTACK_PUBLIC_KEY` for inline checkout
- `currency` (string, public) — default `NGN`, validated against `NGN|GHS|ZAR|KES|USD`

**Files scaffolded:**
- `src/integrations/paystack/checkout.ts` — `initializeTransaction({ email, amount, reference, callbackUrl })` (mirror our existing `paystack.server.ts`)
- `src/integrations/paystack/verify.ts` — `verifyTransaction(reference)` with strict amount/currency cross-check (lessons learned from our own audit)
- `src/integrations/paystack/webhook-verify.ts` — HMAC-SHA512 signature check
- `src/routes/api/payments/paystack/initialize.ts`
- `src/routes/api/public/paystack/webhook.ts`
- `src/integrations/paystack/README.md`

### 3. `src/server/integrations/flutterwave.integration.ts`

**Fields collected:**
- `secret_key` (secret) — `FLWSECK_TEST-...` / `FLWSECK-...`
- `public_key` (string, public) — emitted as `VITE_FLUTTERWAVE_PUBLIC_KEY`
- `encryption_key` (secret) — required for direct charge endpoints
- `webhook_secret_hash` (secret) — Flutterwave uses a "verif-hash" header instead of HMAC
- `currency` (string, public) — default `NGN`

**Files scaffolded:**
- `src/integrations/flutterwave/checkout.ts` — `createPaymentLink({ tx_ref, amount, currency, customer, redirect_url })` calling Flutterwave Standard v3 API
- `src/integrations/flutterwave/verify.ts` — `verifyTransaction(transactionId)` with amount/currency cross-check
- `src/integrations/flutterwave/webhook-verify.ts` — `verif-hash` header equality check
- `src/routes/api/payments/flutterwave/initialize.ts`
- `src/routes/api/public/flutterwave/webhook.ts`
- `src/integrations/flutterwave/README.md`

### 4. Register in `src/server/integrations/registry.server.ts`

Add the three imports + push into `INTEGRATIONS`. Remove the `// TODO follow-up: stripe, paystack` comment. One-line change.

### 5. AI guidance per integration

Each definition's `aiGuidance()` will tell Petal:
- The exact helper to import (`@/integrations/<provider>/checkout`)
- That checkout MUST go through a server route, never client-side fetch with raw keys
- That webhook handlers MUST verify signatures (link to the scaffolded `webhook-verify.ts`)
- That amount/currency MUST be cross-checked on verify (our hard-won lesson)
- NOT to hardcode keys, NOT to call provider APIs directly, NOT to recreate the helpers
- Which currency is configured so it picks the right one in checkout flows

This is the lever that makes "add a $20 checkout" actually produce working code.

### 6. Marketplace UI

`IntegrationsSection.tsx` already iterates the catalog automatically — the three new payment integrations will appear with their `category: "Payments"` badge and install dialog with no UI changes needed.

## Out of scope (explicit)

- **No DB migrations bundled** — users get a `payments` table only if they ask Petal "store my orders". Keeps the install lightweight; Petal can add the table on demand because the `aiGuidance` will tell it the expected shape.
- **No subscription/recurring billing scaffolding in v1** — checkout-only. Subscriptions can be a v2 once we see usage patterns.
- **No Apple Pay / Google Pay / wallet-specific UI** — Stripe Checkout / Paystack inline / Flutterwave Standard already render those automatically when the keys support them.
- **Petal's own internal Paystack billing is untouched** — that's a separate code path (`src/server/paystack.server.ts`, `src/routes/api/billing/*`) and stays exactly as it is. The new integration is for *user apps*, not Petal itself.

## Technical notes

**File layout under `src/integrations/<provider>/`** — matches the existing Resend pattern so users can find things consistently. Server-only files import `process.env`; the env injector already maps integration field IDs to env vars (`STRIPE_SECRET_KEY`, `PAYSTACK_SECRET_KEY`, `FLUTTERWAVE_SECRET_KEY`, etc.) and automatically aliases public fields with `VITE_` prefixes.

**Webhook routes under `/api/public/*`** — required so they bypass auth on published sites (per existing convention in `src/routes/api/public/`).

**Idempotency baked in** — each scaffolded webhook handler will include a comment block telling the AI to use a `processed_webhook_events` table keyed on event ID before granting anything, mirroring what we did in our own `paystack/webhook.ts` audit.

**No new dependencies** — all three providers expose REST APIs we hit with `fetch`. No SDK installs needed.

## Files to create

- `src/server/integrations/stripe.integration.ts` (new)
- `src/server/integrations/paystack.integration.ts` (new)
- `src/server/integrations/flutterwave.integration.ts` (new)
- `src/server/integrations/registry.server.ts` (edit — register the three)

## Verification after build

1. Open Integrations marketplace → confirm Stripe, Paystack, Flutterwave appear with "Payments" category
2. Install one (e.g. Paystack) with test keys → confirm files appear under `src/integrations/paystack/` in the user's project tree
3. Confirm `.env.production` and `.dev.vars` get the managed block with `PAYSTACK_SECRET_KEY` + `VITE_PAYSTACK_PUBLIC_KEY`
4. In the project, prompt Petal: "add a button to charge $10" → confirm it imports from `@/integrations/paystack/checkout` instead of inventing fetch calls
5. Uninstall → confirm scaffolded files are removed and env block is stripped

Approve to proceed.
