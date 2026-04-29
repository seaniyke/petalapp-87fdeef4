# Close the AI Capability Gaps

Build all three improvements so Petal AI can write backend code, collect secrets mid-conversation, test what it ships, and recommend the right marketplace integration before hand-rolling.

---

## 1. `add_secret` Mid-Conversation Capability

Goal: AI can request any secret at any point and a secure form pops up in chat.

### Backend
- New table `pending_secret_requests` (id, project_id, conversation_id, secret_name, instructions, status, created_at, fulfilled_at). RLS: only project members can read/write their own.
- Server function `requestSecret({ name, instructions, link? })` — inserts a pending request and returns its id.
- Server function `fulfillSecret({ requestId, value })` — encrypts with AES-256-GCM (reuse `project_integration_secrets` crypto helper) and stores into `project_secrets`. Marks request fulfilled.
- Server function `listProjectSecrets()` — names only, never values.

### AI Streaming Action
- Register a new streamed action tag the assistant can emit:
  `<lov-add-secret name="OPENAI_API_KEY" instructions="Get from platform.openai.com" link="https://platform.openai.com/api-keys" />`
- Stream parser (in `src/server/ai/stream-actions.ts`) intercepts the tag and calls `requestSecret`, then renders an inline `SecretRequestCard` in the chat transcript.

### Chat UI
- `SecretRequestCard.tsx`: input (masked), "Save securely" button, status pill (Pending → Saved). On save, calls `fulfillSecret`, shows checkmark, and emits a synthetic user message `[Secret OPENAI_API_KEY saved]` so the AI continues.
- Resend / cancel buttons.

### System prompt update
- Document the action tag, when to use it (only after confirming intent + scaffolding any infra that needs the URL), and that values are never echoed back.

---

## 2. Self-Testing Loop

Goal: AI can invoke its own server functions, read logs, and query the DB before declaring "done."

### Three new tools (server-side, gated to AI runtime)

**`invoke_server_function`**
- Accepts `{ path, method, headers?, body? }`
- Resolves to the latest preview deployment URL for the project (`project--{id}-dev.lovable.app`).
- Returns `{ status, headers, body }` truncated to 8KB.

**`read_server_logs`**
- Reads worker + sandbox logs (last 1h, max 100 entries).
- Optional `search` filter and `deployment` (`preview` | `published`).
- Returns newest-first.

**`read_database`**
- Wraps `supabaseAdmin` with a SELECT-only guard (parses SQL, rejects anything but `SELECT` / `WITH … SELECT`).
- Limits 1000 rows, 5s timeout.

### Loop integration
- After any code edit that touches `src/server/**` or `src/routes/api/**`, the agent runner auto-suggests a smoke check step.
- Errors found in logs are fed back into the next AI turn as a `<tool-result>` block so the model can self-correct.

### Safety
- All three tools are read-only or invoke existing user code — no arbitrary SQL writes, no shell.
- Rate-limited per conversation (20 invocations / 50 log reads / 30 db reads per turn).

---

## 3. Integration Auto-Suggest

Goal: When the user asks for a feature that overlaps a marketplace integration, the AI proposes installing it instead of hand-rolling.

### Registry metadata
- Extend each `IntegrationDefinition` with:
  - `triggers: string[]` — example user phrases ("send email", "accept payment", "add auth", "send SMS").
  - `replaces: string[]` — npm packages or patterns the integration supersedes (e.g. `nodemailer`, `stripe`).

### Pre-prompt classifier
- New step in the agent pipeline: a lightweight classifier (gpt-5-nano) runs over the user message, scores against `triggers`, and surfaces matches into the system prompt as:
  ```
  Suggested integrations for this request:
  - Stripe (payments) — install via marketplace before writing checkout code
  - Resend (email) — install instead of hand-rolling SMTP
  ```

### Behavior change in system prompt
- "If a suggested integration matches the request, recommend installing it first. Only hand-roll if the user declines."
- AI emits `<lov-suggest-integration id="stripe">` which renders an "Install Stripe" button in chat.

### Marketplace UI
- Add a "Suggested for this prompt" row at the top of the integrations panel that mirrors the AI's suggestions.

---

## Rollout Order

1. **Self-testing loop** first — unblocks debugging for everything else.
2. **`add_secret`** second — needed before integration auto-suggest can complete user flows that require keys.
3. **Integration auto-suggest** last — depends on the registry metadata being stable.

## Files to Create / Edit

**New**
- `supabase/migrations/<ts>_pending_secret_requests.sql`
- `src/server/secrets/requests.functions.ts`
- `src/server/secrets/requests.server.ts`
- `src/server/ai/stream-actions.ts` (or extend existing)
- `src/components/chat/SecretRequestCard.tsx`
- `src/server/ai/tools/invoke-server-function.ts`
- `src/server/ai/tools/read-server-logs.ts`
- `src/server/ai/tools/read-database.ts`
- `src/server/ai/classifier/integration-suggester.ts`
- `src/components/integrations/SuggestedIntegrationCard.tsx`

**Edit**
- `src/server/integrations/registry.server.ts` — add `triggers` / `replaces` to all entries
- `src/server/integrations/{stripe,paystack,flutterwave,resend,...}.integration.ts` — add metadata
- `src/server/ai/system-prompt.ts` — document new actions and self-test expectations
- `src/server/ai/agent-runner.ts` — wire the three new tools + classifier step
- `src/components/chat/MessageRenderer.tsx` — render `SecretRequestCard` and `SuggestedIntegrationCard`

## Notes / Open Decisions

- Classifier model: `google/gemini-2.5-flash-lite` is cheaper than `gpt-5-nano` and fast enough — pick one before implementation.
- For `read_database`, decide whether to expose to the AI by default or require user opt-in per project (matches Cloud "Read database" toggle). Recommend: opt-in, default off, with a one-click enable in chat when the AI requests it.
