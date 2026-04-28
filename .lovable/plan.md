# Petal AI: Honest Review + Smart OpenRouter Routing + Reliability Upgrades

## Part 1 — Are we doing the right things? Honest answer

**Yes, the foundation is right. But we stopped one step short of where the leaders actually win.**

What we got right (the boring-but-critical stuff):
- Provider abstraction at a single chokepoint (`aiChatCompletions`) — exactly how Vercel AI SDK and Bolt structure it.
- Per-feature routing (generate/discuss/triage/coach/design/memory/recovery/preflight) — this is the *correct* granularity. Most teams route globally and overpay.
- DB-backed admin toggles with a 30s cache — operationally sane, no redeploys.
- Image gen hard-pinned to Lovable AI — correct call (Gemini's `message.images` shape is non-portable).

Where we're behind the frontier (and what they actually do):

| Builder | Their winning move | Where we are |
|---|---|---|
| **Bolt v2** | Two-tier model strategy: Sonnet 4.6 for everyday work, Opus 4.6 only for hard tasks. Auto-escalates. | We have one model per feature, no escalation. |
| **v0** | Three layers around the model: dynamic system prompt (version-pinned framework knowledge), "LLM Suspense" (stream-time find/replace for bad imports), deterministic autofixers (AST-level repairs). Claims double-digit success-rate gains. | We have prompts and self-recovery, but no stream-time correction and no deterministic autofixer. Self-recovery only triggers post-failure. |
| **Replit Agent 4** | Multi-agent: planner → executor → verifier in parallel threads. | Our generate is single-pass. |
| **Cursor / Aider** | Phase-aware routing (implement = cheap model, debug = strong model, plan = reasoning model). | We route by *feature*, not by *phase within a feature*. |

**Bottom line: our plumbing is professional. Our intelligence layer is one generation behind.** The good news — fixing it is incremental, not a rewrite.

## Part 2 — The OpenRouter question, answered properly

You asked which model for easy vs hard. Here is the data-backed answer (synthesized from coderouter.io benchmarks April 2026, OpenRouter pricing, and the Sonnet/DeepSeek/GPT-5 production comparisons):

**The real cost-quality landscape on OpenRouter (per 1M tokens, blended):**

| Tier | Model | Cost | Best for |
|---|---|---|---|
| Cheap | `deepseek/deepseek-chat-v3` | ~$0.32 | Implementation from clear specs, tests, docstrings, simple refactors |
| Cheap | `google/gemini-2.5-flash-lite` | ~$0.20 | Triage, classification, intent detection, summarisation |
| Cheap | `anthropic/claude-haiku-4.5` | ~$1.50 | Memory ops, short rewrites, polish passes |
| Mid | `anthropic/claude-sonnet-4.5` | ~$6.60 | Code generation, complex refactors, debugging, tool-use agents |
| Mid | `openai/gpt-5-mini` | ~$2.00 | Solid all-rounder, good tool-call reliability |
| Heavy | `openai/gpt-5` | ~$5.00 | Architecture, hard reasoning, ambiguous specs |
| Reasoning | `deepseek/deepseek-r1` | ~$1.50 | Deep debugging, planning (no tool calls — pure reasoning) |

**Critical caveats from the research:**
- DeepSeek V3 is ~20× cheaper than Sonnet but produces **3% malformed tool-calls** vs Sonnet's 0.5%. For agentic tool-use features (triage, coach), this gap eats your savings via retries.
- DeepSeek R1 and other "thinking" models **cannot emit tool_calls** — only use them for non-agentic reasoning.
- Sonnet 4.5 / GPT-5 wins on: complex refactors, debugging root cause vs proximate cause, architecture decisions.
- DeepSeek V3 wins on: implementation, tests, docstrings, mechanical refactors.

**Recommended Petal feature → model map (the smart default):**

| Feature | Lovable AI today | Recommended OpenRouter | Why |
|---|---|---|---|
| `generate` (code gen) | Gemini 2.5 Pro | `anthropic/claude-sonnet-4.5` | Industry consensus #1 for code gen + tool reliability |
| `discuss` (chat) | Gemini Flash | `deepseek/deepseek-chat-v3` | 20× cheaper, indistinguishable for chat |
| `triage` (tool-call routing) | Gemini Flash | `openai/gpt-5-mini` | Tool-call reliability matters more than cost here |
| `coach` (idea coaching) | Gemini Flash | `deepseek/deepseek-chat-v3` | Conversational, no high stakes |
| `design` (design director) | Gemini 2.5 Pro | `anthropic/claude-sonnet-4.5` | Design reasoning quality matters |
| `memory` (project memory ops) | Gemini Flash Lite | `google/gemini-2.5-flash-lite` | Pure summarisation |
| `recovery` (self-heal) | Gemini 2.5 Pro | `anthropic/claude-sonnet-4.5` | Debug = needs strong reasoning |
| `preflight` (estimate) | Gemini Flash Lite | `google/gemini-2.5-flash-lite` | Fast classification |

## Part 3 — What I'd actually build, in priority order

### Tier 1: Finish the OpenRouter story (small, high-value, do first)

1. **Per-feature model picker in the admin console.** Right now admin only chooses provider, not model. Add a model dropdown next to each provider toggle, with sensible defaults from the table above. Stored in the existing `ai_provider_settings` table (add a `model` column).
2. **Cost dashboard widget.** Pull OpenRouter's `/api/v1/generation` endpoint after each call (it returns native_token_cost) and roll up a 7-day cost-by-feature view on `/admin/ai-providers`. This is the single most useful thing for deciding what to flip.
3. **Auto-fallback chain.** If primary returns 429/402/5xx, fall back to a configured secondary (e.g., Sonnet → GPT-5-mini → Lovable Gemini Pro). One retry, logged. Prevents OpenRouter outages from breaking Petal.
4. **Tool-call validation guard.** Before sending a parsed tool_call to executors, validate args against the JSON schema. If invalid, retry once with stronger model. This is what makes DeepSeek viable for cheap features without losing reliability.

### Tier 2: Steal v0's reliability tricks (medium effort, big win on success rate)

5. **Dynamic system prompt for code-gen.** Currently we send a static prompt. Inject version-pinned snippets (TanStack Start v1 patterns, Tailwind v4 syntax, Supabase client shape) only when the request mentions them. Detect via embedding match or keyword. Saves tokens AND raises success rate.
6. **Stream-time autofixer ("LLM Suspense" lite).** While generate streams, run a regex/AST pass on each completed code block: fix common bad imports (e.g., `react-router-dom` → `@tanstack/react-router`), strip pages/ folder mentions, repair lucide-react icon names to nearest valid match. Runs in <100ms post-block, no extra model call.
7. **Post-stream autofix model.** When a generation finishes, run a tiny fast model (Haiku 4.5 or Gemini Flash Lite) over it with the prompt "find and fix obvious build-breakers only — no rewrites." Gated to only run when our existing preflight detects risky output.

### Tier 3: Phase-aware routing inside `generate` (advanced)

8. **Phase classifier.** Before generate fires, a tiny <50ms call (or regex heuristic) tags the request: `implement | debug | refactor | plan | docs`. Route to the right model from the matrix. Implement-phase → DeepSeek V3 (cheap). Debug/plan → Sonnet. Saves ~60-70% on the 80% of requests that are mechanical.
9. **Optional Replit-style verifier pass.** After generate, send the diff to a verifier prompt ("does this compile, are imports valid, are there obvious type errors?") on a cheap model. If verifier flags issues, loop back to recovery. We have recovery — we just don't trigger it proactively.

### Tier 4: Long-game (do after Tiers 1-3 prove out)

10. Telemetry-driven router: log every call's success/failure/cost, train a logistic-regression-grade router that picks the model per-request. This is what CodeRouter and Bolt do internally.

## Technical notes

- `OPENROUTER_MODEL_MAP` in `ai-provider.server.ts` currently maps Gemini → Gemini and passes GPT-5 through. We need to expand it (or replace it) so each feature can request a *different* model than its Lovable AI default — which is what step 1 enables via DB.
- Adding a `model` column to `ai_provider_settings` is a single migration: `alter table ai_provider_settings add column model text`.
- The OpenRouter generation cost endpoint is free to call and returns the exact $ — perfect for the dashboard.
- Stream-time autofixer should be implemented as a Transform stream wrapping the existing fetch response in `aiChatCompletions` — single integration point.
- Phase classifier can start as a regex over the user message + last-N tool calls (Cursor does this with ~30 rules). No ML needed for v1.

## What I'd recommend you greenlight first

**Tier 1 only.** That gets you: model-level admin control, real cost visibility, and a safety net — which is the rest of "operating it well." It also unlocks the rest: once you can see per-feature cost, you'll *know* which features deserve the v0-style reliability investment in Tier 2.

Approve and I'll ship Tier 1.
