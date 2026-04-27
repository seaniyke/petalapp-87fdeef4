# Integrations Marketplace + Labs Toggle

## Goal
Give Petal users a one-click way to add Stripe, Paystack, Resend, and analytics to a generated app. Petal injects keys + scaffold code + DB tables on demand. Ships behind a "Labs" toggle so existing flows stay untouched.

## What you'll see as a user
1. **Settings → Labs** — a new section with toggles for each experimental feature. Off by default for everyone.
2. **Project Settings → Integrations** (visible only when Labs is on) — a marketplace grid of connector cards: Stripe, Paystack, Resend, PostHog, Plausible, OpenAI passthrough.
3. **Per-card flow** — click "Add Stripe" → guided sheet asks for the keys (or starts OAuth where supported) → Petal writes the integration files into the project, runs any required DB migration on the project's managed backend, and posts a chat message recapping what changed.
4. **Removal** — each installed integration shows "Installed" with a "Remove" button that deletes only the integration files (not user-modified ones).

## Scope of first slice
Six integrations, in this order of priority. If we run long, we ship the first three and the framework; the rest reuse the same pipeline.

| Integration | Type | What gets scaffolded |
|---|---|---|
| Stripe | API key | server checkout fn, `stripe-webhook` route, `subscriptions`/`payments` table |
| Paystack | API key | server initialize fn, `paystack-webhook` route, `transactions` table |
| Resend | API key | `sendEmail()` helper, sample template, `email_log` table |
| PostHog | Public key | `posthog-provider.tsx`, autocapture wired in root |
| Plausible | Domain only | `<Plausible />` script tag, no key needed |
| OpenAI passthrough | API key | server `chat()` helper that proxies to OpenAI |

PWA + push notifications ships as a **prompt-triggered template** in this same framework (not as a default). When a user prompts "make this installable" or "add push notifications", the AI calls into the same scaffold pipeline.

## Architecture

```text
src/
  server/
    integrations/
      registry.server.ts      ← catalog: id, name, fields, files, migration
      installer.server.ts     ← apply/remove + idempotency
      stripe.integration.ts   ← per-integration definitions
      paystack.integration.ts
      resend.integration.ts
      posthog.integration.ts
      plausible.integration.ts
      openai.integration.ts
      pwa.integration.ts      ← scaffold-only (no UI card, prompt-triggered)
  components/
    IntegrationsSection.tsx   ← grid + install dialog
    LabsSection.tsx           ← toggles
  routes/
    api/
      integrations/
        list.ts
        install.ts            ← POST { projectId, integrationId, fields }
        remove.ts
```

DB additions:
- `labs_flags` — per-user feature flags (one row per user, jsonb of enabled flags). RLS: user reads/writes own row.
- `project_integrations` — installed integrations per project. RLS: only owner. Records integrationId, installed_at, version, encrypted credential refs.
- Credentials stored in a new `project_integration_secrets` table (server-side only — never returned to client). Encryption uses pgcrypto with a server-side master key from `PETAL_INTEGRATION_SECRET_KEY`.

## How the scaffold pipeline works
Each integration is a static object:
```ts
{
  id: "stripe",
  name: "Stripe",
  fields: [{ id: "secret_key", label: "Secret key", secret: true }, ...],
  files: (creds, opts) => ProjectFile[],
  migration?: (creds, opts) => string, // SQL for project's managed backend
  envInjection: (creds) => Record<string, string>, // server-side only
}
```
Installer flow:
1. Validate fields (Zod).
2. Encrypt + store creds in `project_integration_secrets`.
3. Render files, merge into `project_files` (skip files the user has modified — diff against last install).
4. If `migration` is present and project has a managed backend, apply it via the existing `supabase-mgmt.server.ts`.
5. Inject env vars into the project's runtime config.
6. Append a chat message: "Stripe installed. Added 3 files, 1 webhook, and a `subscriptions` table."

Removal is the inverse — delete files matching the registered manifest only.

## PWA template (prompt-triggered, not default)
- Lives in `pwa.integration.ts` but no UI card. The chat AI calls `installIntegration("pwa", ...)` when the user says "make this installable" / "add offline support" / "add push notifications".
- Three depth levels passed as opts: `manifest`, `offline`, `push`.
- Adds:
  - `public/manifest.webmanifest` + icon set
  - `<link rel="manifest">` injected into `index.html`
  - Service worker (only at `offline` and above) registered behind the iframe/preview-host guard from the `pwa` knowledge file
  - Install prompt component
  - For push: VAPID key generation script in chat output, `push-subscribe.ts` server route, `web_push_subscriptions` table
- Generated apps get a clear warning in chat that PWA features only activate on the published deployment, not in the in-app preview.

## Labs toggle
- Per-user setting stored in `labs_flags`. Read on app load, written from a new `LabsSection.tsx` in the settings sheet.
- Initial flags: `integrations_marketplace`, `pwa_template`. Both default off.
- A small `useLabsFlag("integrations_marketplace")` hook gates the new UI surfaces.
- Admins (existing `useIsAdmin`) see all flags forced on.

## Out of scope for this slice
- Connecting Petal's own Lovable connector gateway for these (they're customer-owned keys, not workspace OAuth).
- Per-end-user OAuth in generated apps (e.g. a generated app letting *its* users connect Google) — that's a future template.
- Analytics dashboards inside Petal showing PostHog data — we only scaffold the SDK.

## Risks and mitigations
- **Credential leakage** — secrets never round-trip to the client; `install.ts` accepts them, encrypts, and discards. The integration card UI only ever sees `installed: true`.
- **Stomping user edits** — installer keeps a manifest of last-installed file hashes. If a hash differs, prompt before overwriting.
- **Migration failures** — managed-backend migrations run inside a transaction; failure rolls back and the install is marked failed (no orphaned files).
- **PWA cache poisoning preview** — service worker registration is gated by the existing iframe/preview-host detection from the pwa knowledge file. Hard rule, no exceptions.

## Order of work
1. `labs_flags` table + `LabsSection.tsx` + `useLabsFlag` hook (smallest, unblocks everything else).
2. `project_integrations` + `project_integration_secrets` tables + `registry.server.ts` skeleton.
3. `installer.server.ts` + `/api/integrations/*` routes.
4. `IntegrationsSection.tsx` UI behind the labs flag.
5. Stripe, Paystack, Resend integration definitions (the "real" first three).
6. PostHog, Plausible, OpenAI definitions.
7. PWA template definition + AI prompt rules so the chat agent knows when to trigger it.
8. End-to-end test on a sample project: install Stripe → trigger checkout → receive webhook.

Steps 1–4 unblock everything; we can ship a "Labs preview" with just Stripe + Resend if we need to cut scope.
