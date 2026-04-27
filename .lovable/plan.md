# Make the AI integration-aware

## Today's behavior

You already have the plumbing for integrations:

- **Marketplace + installer** (`src/server/integrations/`) — Resend and Plausible defined; installer writes files into `project_files`, encrypts secrets, records a manifest.
- **Build-time env injection** (`env-injector.server.ts`) — renders `.env.production` and `.dev.vars` for the deploy.
- **Generated helper files** — e.g. `src/integrations/resend/send.ts` lands in the project so code that imports it works.
- **Backend awareness in prompts** — `/api/generate` already injects a `backendBlock` when a managed backend is attached, telling the AI to use `@/integrations/backend/*`.

What's **missing** is the equivalent for marketplace integrations. Today:

- `/api/generate` and `/api/discuss` have **zero awareness** of which integrations are installed.
- If a user says "send a welcome email when someone signs up," the AI may invent its own `fetch("api.resend.com")` call, hardcode keys, or skip the helper entirely.
- The AI doesn't know `@/integrations/resend/send` exists, that it's server-only, or that `RESEND_FROM_ADDRESS` is already configured.
- The discuss-mode prompt explicitly says "Never invent features that aren't possible in a static React + Vite app" — which actively discourages proposing email/payments even when they're wired up.

So: the foundation works, but the AI can't take advantage of it. Users have to know to mention "use Resend" or paste the import path themselves.

## What to build

A small, reusable **integration context block** that gets injected into both the build prompt and the discuss prompt — same pattern as `backendBlock` today.

### 1. Per-integration AI guidance

Extend `IntegrationDefinition` (`src/server/integrations/types.ts`) with one new optional field:

```ts
aiGuidance?: (ctx: IntegrationContext) => string;
```

Each integration returns a short, prescriptive paragraph the AI can follow:

- **Resend example:** "Email is wired. To send, import `sendEmail` from `@/integrations/resend/send` inside a server route under `src/routes/api/*` (never a React component — `process.env` is undefined in the browser). Default from address is already configured. Sample template at `@/integrations/resend/templates/welcome`."
- **Plausible example:** "Analytics is wired. Pageviews track automatically. To track a custom event, call `trackEvent('event_name', { props })` from `@/integrations/plausible/track`."
- Future Stripe/Paystack: "Checkout is wired. Create a session via `createCheckoutSession()` in `src/routes/api/checkout.ts`. Webhook handler is at `/api/public/payments/webhook`. Never expose the secret key to the client."

### 2. Loader: `loadInstalledIntegrationsContext(projectId)`

New helper in `src/server/integrations/installer.server.ts` (or a new `prompt-context.server.ts`). Returns a single string ready to drop into the system prompt:

```text
### Installed integrations (use these — do NOT reinvent)

**Resend (email)** — <aiGuidance text>
**Plausible (analytics)** — <aiGuidance text>
```

When nothing is installed, returns `""`.

### 3. Wire into `/api/generate`

In `src/routes/api/generate.ts` around line 293–337, add:

```ts
const integrationsBlock = body.projectId
  ? await loadInstalledIntegrationsContext(body.projectId)
  : "";
// then:
content: baseSystem + backendBlock + integrationsBlock + knowledgeBlock + visionAddendum + filesContext
```

### 4. Wire into `/api/discuss`

Same call in `src/routes/api/discuss.ts` around line 138–139, plus soften the "Never invent features" rule so it doesn't override installed capabilities:

> "Never invent features that aren't possible in a Vite + React app **or any installed integration listed below**."

This is the key fix for the "discuss" experience: the user can ask "can we email people on signup?" and Petal will say yes (because Resend is installed) instead of deflecting.

### 5. Generation-mode hard rules

Append to `SYSTEM_PROMPT_INITIAL` and `SYSTEM_PROMPT_PATCH`:

> When an integration block is present below, you **MUST** use those helpers for that capability. Do NOT call third-party APIs directly, do NOT hardcode keys, do NOT recreate helpers that already exist under `src/integrations/*`.

### 6. (Optional, follow-up) Fill in guidance for existing integrations

Add `aiGuidance` to `resendIntegration` and `plausibleIntegration` in this same change so the feature ships useful from day one.

## Files touched

- `src/server/integrations/types.ts` — add `aiGuidance` to the definition type.
- `src/server/integrations/installer.server.ts` — add `loadInstalledIntegrationsContext()`.
- `src/server/integrations/resend.integration.ts` — add `aiGuidance`.
- `src/server/integrations/plausible.integration.ts` — add `aiGuidance`.
- `src/server/generate.server.ts` — append the new hard rule to both system prompts.
- `src/routes/api/generate.ts` — load + inject `integrationsBlock`.
- `src/routes/api/discuss.ts` — load + inject `integrationsBlock`, soften the "never invent" rule.

No DB migrations, no new tables, no UI changes.

## Why this is the right shape

- **Mirrors the backend pattern.** `backendBlock` already proves the approach works.
- **One source of truth.** Each integration ships its own AI guidance next to its files — adding Stripe later is one new field, no changes to `/api/generate`.
- **Cheap.** Adds ~200–600 chars per installed integration to the prompt. No extra round trips.
- **Discuss + Build both improve.** Today only build sees backend context; both should see integrations.

## Out of scope (future ideas)

- Suggesting installs from chat ("It looks like you want email — install Resend?"). Useful but a separate UX problem.
- A `recommend_integration` tool the AI could call mid-turn. Worth doing once the catalog grows past ~5 entries.
- Showing the user, in the chat UI, *which* integrations were factored into a given turn (transparency).
