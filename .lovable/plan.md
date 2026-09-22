# Make custom domains work

I checked the live setup. Custom domains are built end to end — adding a domain, DNS instructions, status checks, automatic HTTPS, and serving the right app at the domain. Three things are blocking it, and all three are fixable.

## What's blocking it

**1. Our domain provider key is missing one permission (the real blocker).**
Every domain action we make — registering a domain, requesting its certificate, checking status — is refused with an authentication error. The same key works fine for everything else (reading the zone, DNS records), so it is only the certificate/custom-hostname permission that is missing. Until this is fixed, no customer domain can ever go live, no matter what they do at their registrar.

**2. We tell customers to point at the wrong address.**
The instructions say to point their domain at `fallback.buildwithpetal.com`, but domains are actually registered under `kimble.cloud`. These need to match, or verification and certificates stall.

**3. Kimble's own addresses aren't in the "never treat as a customer domain" list.**
The list still names the old buildwithpetal addresses and doesn't include `kimble.cloud` / `www.kimble.cloud`.

## What happens next

Step 1 needs you (a minute in the Cloudflare dashboard):

- Create an API token with **Zone → SSL and Certificates → Edit** and **Zone → Zone → Read**, scoped to the `kimble.cloud` zone. (The current token is missing the first one; it must be a token created under **My Profile → API Tokens**, not an account-scoped one.)
- Paste it to me and I'll store it securely and re-run the check.

Then I'll do the rest:

- Turn on the setup that lets customer domains reach Kimble, and confirm it answers.
- Change the address customers point at to one on `kimble.cloud`, in the instructions, the copy buttons, and the automatic DNS check.
- Add Kimble's own addresses to the reserved list.
- Run a full end-to-end test with a real test domain: add it, point the DNS, watch it verify, get its certificate, and load a published app over HTTPS — plus the "not published yet" and "private" pages.
- Clean up the one stale test domain still sitting in our records.

## Technical detail

- `src/server/cloudflare-saas.server.ts` calls `/zones/$CLOUDFLARE_SAAS_ZONE_ID/custom_hostnames`; that zone is `kimble.cloud` (confirmed, active). `GET custom_hostnames` and `GET custom_hostnames/fallback_origin` both return `403 code 10000 Authentication error`, while `GET /zones/{id}` returns 200 — permission scope, not a bad token.
- `PETAL_DOMAIN_CNAME_TARGET` / `PETAL_DOMAIN_APEX_ALIAS_TARGET` in `src/lib/domains.ts` are `fallback.buildwithpetal.com`; change to a proxied record in the SaaS zone (`fallback.kimble.cloud`, which already resolves to Cloudflare). `src/routes/api/domains/dns-check.ts` and `DomainsSection.tsx` both read these constants, so one change updates instructions, copy buttons and verification.
- Set the zone's fallback origin to the host running `proxyToPages` (`src/server/host-routing.server.ts`) once the token allows it.
- `RESERVED_EXACT` in `host-routing.server.ts`: add `kimble.cloud`, `www.kimble.cloud`; keep the existing entries.
- `project_domains` holds one row: `petalapp.dev`, active — a leftover from earlier testing.

## Not in scope

Domain purchasing, email domains, plan gating, and the billing side of domains.
