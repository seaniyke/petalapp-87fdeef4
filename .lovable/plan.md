Plan: Expand OpenRouter budget-tier model coverage and cost-aware routing

Background

Petal already has a sophisticated AI routing layer:
- OpenRouter is wired in as an optional provider (`src/server/ai-provider.server.ts`).
- A telemetry-driven smart router (`src/server/smart-router.server.ts`) scores models by success rate, cost, and latency per (feature, phase).
- A phase classifier (`src/server/phase-classifier.server.ts`) tags every turn as implement / debug / refactor / plan / docs.
- Outcomes are tracked in `ai_call_log` and `ai_model_quality`, so we can measure whether a cheap model actually produces working apps.
- The admin UI at `/admin/ai-providers` lets operators pick per-feature models and fallbacks.

Today the recommended OpenRouter models are mostly mid-range or strong: `deepseek/deepseek-chat-v3`, `anthropic/claude-sonnet-4.5`, `openai/gpt-5-mini`, `claude-haiku-4.5`. We do not yet expose a curated "budget tier" of ultra-cheap models for the high-volume, low-risk tasks.

Objective

Add a curated budget-tier model catalog from OpenRouter, route low-risk turns to it automatically, and prove with shadow data that cost savings do not degrade build quality.

Phases

1. Research OpenRouter cheapest viable models
   - Fetch current pricing from OpenRouter for models under roughly $0.20 input / $1M tokens and $1.00 output / $1M tokens.
   - Shortlist candidates for code generation: e.g. Qwen 2.5 / 3 coder variants, Llama 3.1/3.2 instruct, Mistral Small / Codestral, DeepSeek V3 when discounted, etc.
   - Note context-window sizes, tool-calling support, and vision support for each candidate.
   - Deliverable: a JSON catalog file (`src/lib/openrouter-budget-models.json`) with model slug, input/output price, context, and capability flags.

2. Add budget-tier model catalog to the cost engine
   - Extend `MODEL_PRICE_PER_M_TOKENS` in `src/server/ai-provider.server.ts` with the new budget entries.
   - Add a `BUDGET_MODELS` constant keyed by feature, so the router knows which candidates are allowed in the cheap tier.
   - Ensure the OpenRouter model remap (`OPENROUTER_MODEL_MAP`) covers any slugs that differ from Lovable AI slugs.

3. Make the phase classifier drive cheaper routing
   - Update `modelTierForPhase` in `src/server/phase-classifier.server.ts` so that `implement` and `docs` can optionally use the budget tier when the turn is small / low-risk.
   - Add a prompt-size heuristic: short implement prompts (e.g. <150 chars, no attachments, <4 files) are routed to the budget tier first.
   - Keep `debug`, `refactor`, and `plan` on the smart/strong tier by default.

4. Introduce an Economy mode
   - Add a per-user or per-workspace flag (`economy_mode` on `profiles` or `workspace_settings`) that increases the share of budget-tier routing.
   - Surface a toggle in the builder UI (e.g. near the model/cost chip) so users can opt in to "Faster & cheaper" vs "Best quality".
   - When enabled, the router expands the candidate list to include budget models; when disabled, the existing behavior is preserved.

5. Shadow-test budget models before default rollout
   - Add a shadow-mode flag to the smart router: for a configurable percentage of traffic, call the budget model in parallel with the primary model but only record the result, do not return it to the user.
   - Compare verifier pass rate, build success rate, and follow-up fix rate between the primary and shadow models using `ai_call_outcomes` and `ai_model_quality`.
   - Only promote a budget model to the live candidate list after it meets a quality floor (e.g. verifier pass rate within 5% of the primary model for the same feature/phase).

6. Update the admin AI providers console
   - Add a "Budget tier" section to `/admin/ai-providers` showing recommended cheap models per feature and their live cost/quality scores.
   - Let operators enable/disable individual budget models and set the shadow-test percentage.
   - Show a projected cost savings line based on the last 7 days of telemetry if the budget tier had been used.

7. Roll out and monitor
   - Start with 10% of eligible implement/docs turns routed to the budget tier.
   - Increase gradually as quality data proves the models.
   - Add alerts in the admin dashboard when a budget model's success rate drops below the configured floor.

Technical details

Files likely to change:
- `src/server/ai-provider.server.ts` — price list, budget model constant, OpenRouter slug map.
- `src/server/phase-classifier.server.ts` — small/low-risk heuristic for budget routing.
- `src/server/smart-router.server.ts` — shadow-test path and budget-candidate expansion.
- `src/routes/api/generate.ts` — pass the economy-mode flag into model selection.
- `src/routes/admin.ai-providers.tsx` — new budget tier UI and shadow-test controls.
- `src/server/ai-provider-admin.server.ts` — server helpers for budget model settings and cost projections.
- `src/lib/openrouter-budget-models.json` (new) — static catalog of cheap OpenRouter models.

Database changes:
- Add `economy_mode` boolean to `profiles` or `workspace_settings` (re-use existing workspace settings table if present).
- Add `shadow_pct` and `budget_enabled` flags to `ai_provider_settings` per feature, or create a new `ai_budget_model_settings` table.

Risks and mitigations

- Quality regression: mitigated by the shadow-test gate and the smart router's quality multiplier.
- Tool-calling failures on cheap models: mitigated by capability flags in the catalog; only models with verified tool support are eligible.
- Latency spikes: monitored via the existing `latency_ms` telemetry and kill-switch.

Success criteria

- At least 2 budget models are live in the router with a measured cost reduction of 30%+ on eligible turns.
- Verifier pass rate and build success rate for budget-routed turns stay within 5% of the strong-model baseline.
- Admin UI can enable/disable budget models and adjust the shadow-test percentage without a deploy.
