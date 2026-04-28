
# Buy + auto-configure domains via Cloudflare Registrar

Goal: A non-technical user types `acme`, sees `acme.com` is available for $9.15/yr, pays in their local currency via Paystack, and 30 seconds later `https://acme.com` serves their published Petal app — with zero DNS touched by hand.

Cloudflare Registrar is the right pick: we already use Cloudflare for SaaS for SSL/hosting, the same `CLOUDFLARE_API_TOKEN` works (just needs Registrar:Edit added), and registered domains land directly inside our Cloudflare account where we can auto-create the CNAME for them.

## What changes for the user

Today: Buy a $12 *slot* → type a domain you already own → copy A + TXT records into your registrar → wait → maybe it works.

After this plan, two paths in **Project Settings → Domains**:

1. **"Buy a new domain"** (new, primary CTA) — search → pick → pay → done. SSL active in seconds. No DNS UI ever shown.
2. **"Connect a domain I own"** (existing flow, kept as-is) — for users who already own a domain elsewhere.

```text
┌─────────────────────────────────────────────┐
│  Domains                                    │
│  ─────────────────────────────              │
│  [ Search: acme              ] 🔍           │
│  ✓ acme.com         $9.15/yr   [Buy]        │
│  ✓ acme.app        $14.00/yr   [Buy]        │
│  ✗ acme.io         taken                    │
│  ─────────────────────────────              │
│  Already own a domain? Connect it →         │
└─────────────────────────────────────────────┘
```

## Architecture

```text
User types "acme"
     │
     ▼
POST /api/registrar?action=search   ─► CF GET /registrar/domain-search
     │  (debounced, returns suggestions)
     ▼
User clicks "Buy acme.com"
     │
     ▼
POST /api/registrar?action=quote    ─► CF POST /registrar/domain-check
     │  (real-time price + availability, locks for ~60s)
     ▼
Create Paystack transaction         (price = CF cost × markup, in user's currency)
     │
     ▼
Paystack webhook → /api/public/paystack/webhook
     │
     ▼
register_domain() server fn:
  1. CF POST /registrar/registrations          (charges our CF billing profile)
  2. Poll status until "active" or "pending"
  3. CF POST /zones (add zone for acme.com)    [auto on registration in same account]
  4. CF POST /zones/{id}/dns_records           (CNAME @ → buildwithpetal.com)
  5. createCustomHostname(acme.com, "http")    (HTTP-01 SSL — works instantly
                                                because DNS already points to us)
  6. Insert project_domains row, mark active
     │
     ▼
Realtime push → DomainsSection flips to "Active ✓"
```

The slot system stays as-is for "connect a domain I own". Buy-a-domain is a separate purchase line item — user pays the registration fee + our markup once per year, and renewal is a separate flow (Phase 2).

## Files to create / change

**New — server**
- `src/server/cloudflare-registrar.server.ts` — typed wrappers for `domain-search`, `domain-check`, `registrations`, `domains` list, `zones` create, and `dns_records` create. Same `cfFetch` pattern as `cloudflare-saas.server.ts`.
- `src/server/registrar-orchestrator.server.ts` — the post-payment pipeline (register → wait → add zone → add CNAME → create custom hostname → mark active). Idempotent and safe to retry.
- `src/routes/api/registrar.ts` — `?action=search | quote | list-purchases`. All Bearer-auth + project-ownership checks like `/api/domains`.

**New — client**
- `src/components/BuyNewDomainDialog.tsx` — search box (debounced 400ms), result list with price + Buy button, currency picker (reuses `fetchCurrencies` / `convertPrice`), final confirm with WHOIS-required checkbox.
- `src/lib/registrar.ts` — thin client wrapping `/api/registrar`.

**Edited**
- `src/routes/api/billing/initialize.ts` — new `purchaseKind: "domain_registration"` branch that takes `{ domainName, currency, returnUrl }` and stores the locked CF quote in transaction metadata.
- `src/routes/api/public/paystack/webhook.ts` — on successful `domain_registration`, call `registerDomainPostPayment(metadata)`.
- `src/components/DomainsSection.tsx` — add "Buy a new domain" button alongside "Connect existing", show a "Registered domains" subsection (renewal date, auto-renew toggle).
- `supabase` migration — new `domain_registrations` table:
  ```text
  id, project_id, hostname, cloudflare_zone_id, cloudflare_registration_id,
  registered_at, expires_at, auto_renew, last_paystack_ref,
  cost_usd_cents, charged_amount_minor, charged_currency, status
  ```
  RLS: owners read their own; service role writes via webhook.

## Pricing & margin

- CF charges at-cost (e.g. `.com` ≈ $9.15/yr). We add a flat markup (configurable in `app_config`, default **+$3 USD**) so $9.15 → $12.15 to the user.
- Quote is locked at search time (CF's `domain-check` returns the exact price); we charge that exact USD amount through the same Paystack rails as slots, so multi-currency "just works".
- Failed registrations after payment → automatic Paystack refund via the existing refund helper.

## Required setup (one-time, by you)

1. **Cloudflare dashboard** → Registrar → accept Domain Registration Agreement, add billing profile, set default registrant contact (name/address/email shown on WHOIS for new domains unless we override per-purchase).
2. **API token** → edit `CLOUDFLARE_API_TOKEN` to add `Account → Registrar → Edit` and `Zone → Zone → Edit` + `Zone → DNS → Edit` permissions.
3. No new secrets needed — same token, same account ID.

## Beta limitations we handle

- **Limited TLDs**: search response only returns supported TLDs. We surface "More extensions coming soon" under results so users aren't confused if `.dev` is missing.
- **Cached search**: we always call `domain-check` on click before charging the user — never trust search cache for the buy step.
- **Async registration**: orchestrator polls `GET /registrar/domains/{name}` every 3s up to 60s; if still pending, marks row `status=pending_registration` and a cron in `/api/public/cron/` finishes the DNS+SSL wiring once CF reports `active`.

## Out of scope for Phase 1 (call out as Phase 2)

- Auto-renewal billing (manual renewal works; auto-renew toggle stored but not yet enforced).
- Transferring an existing domain *into* Cloudflare (different API surface).
- Email-on-domain provisioning (separate plan — would tie into Lovable Email by auto-adding MX + SPF + DKIM to the new zone the moment user clicks "Add email").

## Open questions to confirm before I build

1. **Markup**: flat +$3 USD per year, or percentage (e.g. +25%)?
2. **WHOIS privacy**: enable by default for all purchases? (CF includes it free.)
3. **Default registrant contact**: use a generic Petal contact, or require each user to fill their own at checkout? (Generic is faster UX; per-user is more correct legally.)
