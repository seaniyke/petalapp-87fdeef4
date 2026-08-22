# Petal Marketplace + Creator Economy — audit and phased plan

No code changes yet. This is the audit and the build order I recommend as your CTO.

## Short answer on "what's next"

Next step is **not** the marketplace. It's finishing the trust layer under it: builder reliability (in progress) and credit/billing correctness. The marketplace is only valuable if a bought project reliably opens, customizes and deploys. So: Phase 0 hardening → Phase 1 listing foundation → Phase 2 paid transfer → later, creator economy.

## A. What already exists we can reuse

- **Project cloning** — `remixProjectBySlug()` in `src/lib/projects.ts` already copies `project_files` into a fresh project owned by the buyer, with `remixed_from_id` provenance. This *is* the "Open in Petal" engine; it just needs to move server-side and behind an entitlement check.
- **Public discovery** — `/gallery`, `public_projects_list` / `public_project_get` security-definer functions, `is_featured`, `remix_count`, project slugs, `ProjectThumbnail`.
- **Curated content surfaces** — `/packs`, `/templates`, `/themes` and the industry-pack data model are the visual/IA precedent for a marketplace listing page.
- **Payments** — Paystack init (`src/routes/api/billing/initialize.ts`) with a `purpose` enum, the webhook dispatcher (`api/public/paystack/webhook.ts`) that fans out to `apply_paystack_*` RPCs, crypto checkout (`api/billing/crypto.ts` + `crypto_payments` + cron verifier), `paystack_transactions`, price overrides per currency.
- **Entitlements** — `src/server/entitlements.server.ts` (`has_full_access`: subscription OR purchased credits). A purchase-entitlement check is the same shape.
- **Ledgers** — `credit_ledger`, `topup_lots`, `runtime_ledger` give a proven double-entry pattern to copy for marketplace earnings.

## B. Marketplace primitives that already exist

Provenance (`remixed_from_id`, `bump_remix_count`), public/private visibility, slugs, featured flag, per-currency pricing, transaction records, webhook idempotency (`paystack_events`, `stripe_events`), project versions and file snapshots.

Missing: listings, licenses, purchases, creator profiles, payouts, commission accounting.

## C. Database changes eventually required (not now)

- `marketplace_listings` — project_id, creator_id, slug, title, pitch, category, screenshots, demo_url, price_minor/currency, license_code, status (draft/in_review/live/delisted), source_version_id (frozen snapshot), stats.
- `marketplace_licenses` — code, name, buyer rights (personal/commercial/extended), resale allowed, white-label allowed, display text.
- `marketplace_purchases` — buyer_id, listing_id, license_code, price paid, payment ref (paystack tx or crypto payment), delivered_project_id, status.
- `marketplace_earnings` — creator_id, purchase_id, gross, commission, net, payout_state. Ledger-style, append-only.
- `marketplace_reviews` (later), `creator_profiles` (later), `payout_accounts` (later, gated on KYC).

All with GRANTs + RLS: listings readable by anon only when `status='live'`; purchases readable by buyer and creator only; earnings never client-writable.

## D. Payment architecture reuse

Add `purpose: 'marketplace'` to the existing Paystack init enum and crypto enum, with `itemCode = listing id`. The webhook gains one branch that calls a new `apply_marketplace_purchase(...)` RPC — same idempotency, same events table, same currency logic. No new payment rail, no Stripe, no change to charge-after-success builds.

## E. How a creator product is represented

A listing points at a **frozen version snapshot** of a project, not the live project. The creator keeps building on the original; buyers get what was reviewed and priced. Delivery = copy that snapshot's files into a new buyer-owned project.

## F. How a purchase becomes a project

Server-side `deliverPurchase(purchaseId)`: verify paid → create project owned by buyer → insert files from the frozen snapshot → set `origin_listing_id` provenance → return project id → builder opens it. Client-side remix path is never used for paid delivery.

## G. Licensing

Start with three fixed codes stored in a table (not free text): `personal`, `commercial`, `extended`. Each row carries plain-English rights plus booleans (`resale_allowed`, `white_label_allowed`, `redistribute_allowed`), all false for personal. Purchase records snapshot the license code and text at purchase time so later edits can't retroactively change buyer rights.

## H. Creator ownership

Original project stays owned by the creator; buyers get a copy, never write access. Listing status/pricing is creator-controlled; delisting stops new sales but never revokes delivered copies. Resale of a purchased listing is blocked at publish time by checking `origin_listing_id` against the license's `resale_allowed`.

## I. Revenue

`gross = price paid`; `commission = gross * rate` (config row, not hardcoded); `net = gross - commission - payment fees`. Recorded per purchase in `marketplace_earnings`. Balance shown to creators; payouts remain a manual, admin-approved step until KYC/refund/dispute policy is settled.

## J. What NOT to build yet

Payouts, KYC/KYB, refunds/disputes, subscriptions-to-creators, reviews/ratings, affiliate, escrow, code download/export of purchased source, marketplace promos inside the builder, any mock/static marketplace data.

## K. Risks to the core builder

- Listings must not add joins or latency to the builder's project load path — keep marketplace tables out of `projects` reads.
- The `purpose` enum change touches live payment code — additive only, with webhook tests.
- File-copy delivery must reuse the existing verified path; a second divergent copier would drift.
- No new nav item or banner inside `/builder`. Marketplace lives on its own routes and in the projects/dashboard area only.

## L. Phases

- **Phase 0 (now, no marketplace code)** — finish builder reliability work; tighten credit transparency: clear purchased-vs-subscription balances, purchase history, per-build cost visibility.
- **Phase 1 — Listing foundation** — `marketplace_listings` + `marketplace_licenses` tables, creator "Publish to marketplace" flow from an existing project, admin review queue, real `/marketplace` browse + detail pages reading live DB rows. Free listings only (price 0, "Open in Petal" uses the existing clone path).
- **Phase 2 — Paid transfer** — `marketplace_purchases`, Paystack + crypto `purpose: 'marketplace'`, server-side delivery, buyer library, license snapshot on purchase.
- **Phase 3 — Creator surface** — creator profile, product management, sales list, earnings ledger (balance only, no payouts), product analytics from existing page-view infra.
- **Phase 4 — Economy** — commission config, payout requests behind admin approval + KYC, refunds/disputes policy, reviews.

## Verification stance

Every phase ships wired to the database with real rows and tests; nothing is called done on mock data.
