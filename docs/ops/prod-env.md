# Petal — Production Environment Variables

Reference for the secrets that MUST be set in the production worker
before launch. Verify with `GET /api/internal/health` (bearer-token
gated by `INTERNAL_HEALTH_TOKEN`).

> Never commit values to git. All secrets live in the Lovable Cloud
> secrets store and are injected into the worker at runtime.

## Critical — launch blockers

| Secret | Purpose | Source |
|---|---|---|
| `SUPABASE_URL` | Backend URL | Auto-injected by Lovable Cloud |
| `SUPABASE_PUBLISHABLE_KEY` | Browser/RLS client | Auto-injected |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin client (`client.server.ts`) | Auto-injected |
| `LOVABLE_API_KEY` | Petal AI Gateway | Auto-managed; rotate via `lovable_api_key--rotate_lovable_api_key` |
| `INTERNAL_HEALTH_TOKEN` | Gates `/api/internal/health` | Generate with `openssl rand -hex 32` |

## Mobile pipeline (Codemagic + Expo)

| Secret | Purpose |
|---|---|
| `BUILDER_URL` | Railway builder service base URL |
| `BUILDER_SHARED_SECRET` | HMAC for builder ↔ worker callbacks |
| `CODEMAGIC_API_TOKEN` | Trigger EAS builds under Petal's Codemagic workspace |
| `CODEMAGIC_APP_ID` | Codemagic app ID for the mobile builder template |
| `EXPO_ACCESS_TOKEN` | Petal's Expo org token (`builds:write` scope) |
| `MOBILE_SIGNING_KEY` | AES key for at-rest signing-profile secrets in `mobile_signing_profiles` |

## Billing & payments

| Secret | Purpose |
|---|---|
| `PAYSTACK_SECRET_KEY` | Primary card rail (NGN/GHS/KES/ZAR/USD) |
| `PAYSTACK_WEBHOOK_SECRET` | Verify Paystack webhook signatures |
| `FLUTTERWAVE_SECRET_KEY` | Secondary rail (optional but recommended for fallback) |
| `STRIPE_SECRET_KEY` | International cards (optional) |
| `STRIPE_WEBHOOK_SECRET` | Verify Stripe webhooks |

## Email (Petal Email)

| Secret | Purpose |
|---|---|
| `RESEND_API_KEY` | Outbound transactional + auth email |
| `RESEND_WEBHOOK_SECRET` | Bounce/complaint webhook verification |

## Domains & hosting

| Secret | Purpose |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare for SaaS zone management + registrar |
| `CLOUDFLARE_ACCOUNT_ID` | Account scope for above |
| `CLOUDFLARE_ZONE_ID` | `buildwithpetal.com` zone for subdomain worker |
| `SUBDOMAIN_WORKER_SECRET` | Worker ↔ origin auth for `*.buildwithpetal.com` |

## Optional

| Secret | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | Fallback AI provider if Lovable gateway is down |
| `SEMRUSH_API_KEY` | SEO Insights tab |

---

## Pre-launch checklist

```bash
# 1. Confirm all critical secrets are present
curl -H "Authorization: Bearer $INTERNAL_HEALTH_TOKEN" \
  https://buildwithpetal.com/api/internal/health

# 2. Expected response shape:
# { "ok": true, "missing": [], "checked": 24, ... }

# 3. If `missing` is non-empty, add each via Lovable Cloud → Settings → Secrets
```

If `/api/internal/health` returns `{ ok: false, missing: [...] }`, **do not
flip the publish CTA live** — fix the missing secrets first.
