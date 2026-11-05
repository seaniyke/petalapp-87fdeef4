# Disconnect OpenRouter, activate Lovable AI Gateway

## Goal
Every AI call in Kimble (builds, chat, triage, design, memory, images, transcription) moves from OpenRouter to the Lovable AI Gateway. OpenRouter is removed entirely: code, config, secrets, admin UI, docs.

## Key facts that shape the work
- The gateway serves **no DeepSeek models**. Every model default must be remapped.
- `LOVABLE_API_KEY` is already provisioned (managed). `OPENROUTER_API_KEY` gets deleted at the end.
- The generation engine streams **tool calls over OpenAI-style chat/completions**. On the gateway, `openai/gpt-6-astra` only accepts tool calls via the newer Responses API — a protocol rewrite. Gemini and `gpt-5.6-sol/luna` models accept tool calls on the familiar chat/completions endpoint.
- The gateway bills in workspace credits per token, not USD invoices. Internal cost tracking switches from OpenRouter list prices to the gateway's published credit rates.

## Model mapping (proposed)
| Tier | Today (OpenRouter) | New (Lovable AI Gateway) |
|---|---|---|
| Build / generate (tool calls, streaming) | deepseek-v4-flash | `google/gemini-3.5-flash` (chat/completions + tools, keeps engine protocol) |
| Vision (screenshots, references) | deepseek-v4-flash-vision-exp | `google/gemini-3.5-flash` (native image input) |
| Utility (triage, preflight, memory, coach) | deepseek-v4-flash-0731 | `google/gemini-3.1-flash-lite` |
| Fallback | deepseek-v3.2 | `openai/gpt-5.6-sol` (reasoning off, tool-capable) |
| Image generation | gemini-2.5-flash-image | `openai/gpt-image-2.5-sunburst` |
| Transcription | (OpenRouter) | `openai/gpt-transcribe` |

Rationale: keeping the engine on chat/completions avoids rewriting the streaming tool-loop protocol now. A later, separate step can evaluate `gpt-6-astra` on the Responses API for the build tier.

## Work items
1. **Model config** (`src/lib/ai-model-config.ts`): replace endpoint, key name, all model defaults, env override names; delete the DeepSeek coercion and OpenRouter provider-routing options (ignore list, throughput preference).
2. **Provider layer** (`src/server/ai-provider.server.ts`): point at `https://ai.gateway.lovable.dev/v1`, auth via `LOVABLE_API_KEY`; remove the OpenRouter generation-cost lookup (`/api/v1/generation?id=...`); replace the USD price table with gateway credit rates; keep telemetry, single-fallback retry, and streaming unchanged in shape.
3. **Budget catalog** (`src/lib/openrouter-budget-models.json` → renamed): re-populate with gateway models and their credit rates for economy mode.
4. **Image generation** (`src/server/image-generation.server.ts`): switch to the gateway images endpoint with `gpt-image-2.5-sunburst`.
5. **Transcription** (`src/routes/api/transcribe.ts`): switch to gateway `gpt-transcribe`.
6. **All remaining call sites** (~20 server files): swap key/endpoint references; no behavior changes.
7. **Admin UI** (`src/routes/admin.ai-providers.tsx`): show Lovable AI Gateway as the provider; drop OpenRouter wording.
8. **Cost economics**: `ai_call_log` cost fields record gateway credit rates; margin math (effort pricing, build settlement) is untouched — it reads recorded costs, not the provider.
9. **Vendored bundle**: rebuild `builder/vendor/agent-core.mjs` and bump `AGENT_CORE_VERSION`.
10. **Tests**: rewrite `openrouter-only.test.ts` as a gateway-only guard; update provider/economics tests; run the full suite.
11. **Cutover**: verify one live build end-to-end on the gateway, then delete the `OPENROUTER_API_KEY` secret and remove OpenRouter from docs/env lists.

## Out of scope / unchanged
- Customer pricing, effort curve, credit ledger, cloud tiers — all unchanged; they read recorded costs, not the provider.
- No multi-model routing redesign; single provider, single fallback, as today.
- No switch to the Responses API protocol in this phase.

## Risks
- Gemini tool-calling fidelity for the generation protocol must be proven with a live build before the OpenRouter key is deleted (step 11 gates on this).
- Gateway rate limits are shared workspace-wide; the existing 429 backoff stays.
