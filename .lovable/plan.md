
# Petal Builder — Senior Engineering Audit

I read the whole pipeline: `/api/generate.ts` (3.7K lines), the `pipeline/*` tiers, `ai-provider.server.ts`, `smart-router`, `phase-classifier`, `local-verifier`, `render-risk-linter`, `self-recovery`, `two-phase-gate`, `staged-orchestrator`, `scaffold-kit*` (9.6K lines of pre-baked UI), `dynamic-prompts`, `petal-capabilities`, the integrations registry, the Railway builder service, `/api/discuss`, `/api/triage`, and the golden-app eval harness. Below is the honest scorecard against Lovable / Bolt.new / v0 / Cursor.

---

## What we're genuinely strong at

1. **Deterministic verifier stack is excellent.** The tiered model — `local-verifier` (JSX balance, brace/paren, unterminated strings, undefined components, scope leaks, lazy named exports, unresolved imports, blank-render, RLS sanity, server-fn contract, auth loader) → `tier-render-risk` (optional-prop crash, conditional hooks, undeclared JSX idents, kit list-prop omission) → `tier-esbuild` → `tier-continuation` (true truncation re-ask) → `post-stream-autofix` — is more rigorous than anything Bolt or v0 ship publicly. This is our moat.
2. **`file-budget` hard cap (180 lines / 6 KB, hard-reject at 280/10 KB)** is a smart, production-proven anti-truncation lever competitors don't have.
3. **`scaffold-kit` (~9.6K lines of pre-baked shadcn primitives + composed `blocks-*` sections)** lets the model assemble instead of writing primitives — biggest single quality lever we have, and it's already injected as a closed set.
4. **`smart-router` (Tier 4)** with `ai_call_log` + `ai_call_outcomes` + Thompson-sampling-lite scoring on success/cost/latency, plus `model-kill-switch` cool-offs, is more sophisticated than the static model pickers Lovable and Bolt use.
5. **`two-phase-gate`** (defer backend on turn 1 unless explicitly asked) is a quietly brilliant UX win — first preview ships in seconds, backend lands turn 2 after user opts in.
6. **`petal-capabilities` self-knowledge block** keeps the model honest about Cloud / Mobile / Domains / Email surfaces — competitors regularly hallucinate features they don't have.
7. **Golden-app eval harness** (`src/server/__tests__/golden-apps/`) with live + replay runners + grader is a real eval loop. Most competitors don't have this committed.
8. **`render-risk-linter` R1–R4** (optional-prop crash, conditional hooks, JSX undeclared ident, kit list-prop) catches white-screen bugs that pass syntax — uncommon and high-value.

---

## Where we're behind competitors (ranked by impact)

### P0 — Will move build-success rate the most

**1. No true agentic read/search/edit loop.** Petal emits ONE `write_project` or `patch_files` tool call per turn. Cursor, Claude Code, Lovable's newer pipeline, and Bolt all give the model `read_file` / `list_files` / `grep` / `run_tests` / `edit_file` tools and let it iterate inside a single turn (5–20 tool calls). Petal's `agent_loop` labs flag is opt-in-only and still a bounded autofix loop, not a real agentic edit loop. **This is the single biggest capability gap.**

**2. Monolithic generate path is the default; `staged_pipeline` is labs-only.** The plan→scaffold-in-parallel→wireup orchestrator is exactly the right architecture — but only enabled behind `labs.staged_pipeline` for initial builds. Bolt's parallel-file emission is its main speed/quality story. We have it sitting in the drawer. **Promote staged pipeline to default for `isInitial` after a short rollout window.**

**3. No semantic / embedding index of the project's own code.** Every turn we ship raw file content into the prompt (gated by `trimFilesForPrompt` + `context-budget`). On medium projects (>20 files) that means truncating the oldest files. Cursor, Lovable, and Bolt all maintain a per-project embedding index and retrieve only the K files relevant to the user's turn. We should index `project_files` (pgvector on the Cloud Postgres we already have) keyed by `(project_id, path)`, refresh on write, retrieve top-K on each turn.

**4. Default models are stale & single-vendor.** Every default in the tree is `google/gemini-3-flash-preview` (a preview slug) or `gemini-2.5-flash-lite`. No `gpt-5.4`, no `claude-sonnet-4.5`, no Anthropic at all in the rotation despite the curated-briefs proving the key works. The smart-router can only pick among models that actually log telemetry; right now it has effectively one family to choose between. **Add `openai/gpt-5.4`, `openai/gpt-5.4-mini`, `anthropic/claude-sonnet-4.5` (via OpenRouter) as candidates for `generate.implement` and `generate.debug` phases and let the router pick.**

### P1 — Quality / UX gaps

**5. No in-loop test execution.** We have the verifier but no `vitest run` step. Cursor / Claude Code can write a test, run it, fix the failing assertion, repeat. Adding a "run vitest in the Railway builder" tool would close the loop on logic bugs the verifier can't see.

**6. No screenshot / visual diff feedback.** Lovable and v0 both screenshot the rendered preview and feed it back to the model for "does this look right?" critique. We have a vision-capable model (`gemini-2.5-pro` on attachment turns) but no automated capture loop.

**7. `generate.ts` is a 3,720-line monolith.** This is a maintenance liability and makes the staged pipeline migration painful. The four phases (authorize → assemble prompt → stream+verify → post-stream autofix) should be extracted into named modules.

**8. `discuss` and `generate` re-implement prompt assembly separately.** Capabilities block, dynamic snippets, vision addendum, kit manifest, schema block, memory block — all assembled twice with subtle drift. Extract a single `assemblePromptContext({ mode })` helper.

**9. No streaming-friendly partial-file editing.** `patch_files` exists but the model still resends whole files for "small changes" most of the time. The `ast_patches` labs flag is the right idea but opt-in. Promote it and enforce it for files >100 lines.

**10. `post-stream-autofix` runs once.** Per the comment in `tier-local-verify`, the Tier 3 model verifier was removed because "Phase D one-round autofix cap" made the recovery pass useless. With an agentic loop in place, autofix should iterate up to N times against the verifier until clean.

### P2 — Operational / observability

**11. Image-gen now routes through OpenRouter (recent fix) but the rest of the AI-provider abstraction still hard-codes Lovable URL fallbacks and a static `OPENROUTER_MODEL_MAP` of only 7 entries.** Add Anthropic + GPT-5.4 slugs, and pull the map from `ai_provider_settings` so admins can override without a deploy.

**12. `MAX_AUTOFIX` / loop bounds are scattered.** Centralize all budget knobs (autofix rounds, agent-loop steps, retry counts, token ceilings, file-count caps) in one `pipeline-budgets.ts` so they can be tuned per plan tier.

**13. No per-project context pinning.** When a user says "always use Framer Motion for animations" or "this is a Next.js-style app", we have project-memory but the model doesn't reliably honor it because it's appended late in the prompt. Move project-memory above the kit manifest and add a hard `MUST FOLLOW` framing.

**14. No build-time bundle-size or perf budget.** The builder/Railway service deploys to Cloudflare Pages but doesn't enforce a max-bundle-size, doesn't run `vite build --report`, and doesn't surface unused-imports. Easy to add as a post-build check.

---

## Recommended sequenced roadmap

```text
Week 1 — Default-on the wins we already shipped
  • Flip staged_pipeline ON for all isInitial builds (keep monolith as fallback)
  • Promote ast_patches to default for files >100 lines
  • Add gpt-5.4, gpt-5.4-mini, claude-sonnet-4.5 as smart-router candidates
  • Centralize budgets in pipeline-budgets.ts

Week 2 — Agentic loop (P0 #1)
  • Define read/grep/edit/run_tests tools wired to the in-memory ProjectFile[]
  • Bounded loop: max 12 tool calls / turn, hard token ceiling, billed per cycle
  • Run verifier between each edit; loop exits when verifier clean + brief satisfied

Week 3 — Semantic project index (P0 #3)
  • pgvector table indexed on commit; embed with text-embedding-3-small
  • Replace trimFilesForPrompt with retrieve-top-K(prompt, K=8)
  • Keep "always include" list for App.tsx + router + styles.css

Week 4 — Visual + test feedback (P1 #5–6)
  • Builder: run vitest after build; surface failures as tool result
  • Builder: headless-chromium screenshot of "/" after deploy
  • Generate route: when verifier clean but build_success_rate<0.7 model row, feed screenshot to vision model for critique
```

---

## Technical details (for engineers reading)

**Files that need the heaviest changes:**
- `src/routes/api/generate.ts` — break into `generate/authorize.ts`, `generate/assemble.ts`, `generate/stream.ts`, `generate/post.ts`.
- `src/server/ai-provider.server.ts` — expand `OPENROUTER_MODEL_MAP`, add Anthropic; move model catalog into DB.
- `src/server/pipeline/staged-orchestrator.server.ts` — already orchestrator-shaped; needs an `agentic_loop` stage between scaffold and wireup.
- `src/server/labs-flags.server.ts` — flip `staged_pipeline` default from opt-in to opt-out.
- New: `src/server/pipeline/tools/` — `read_file.ts`, `grep.ts`, `edit_file.ts`, `run_tests.ts` (tool schemas + handlers operating on `ProjectFile[]`).
- New: `src/server/project-index.server.ts` — pgvector index maintenance + retrieval.
- New: `src/server/pipeline-budgets.ts` — single source of truth for all limits.
- `builder/src/build.ts` — add post-build `vitest run` + `playwright screenshot` steps; sign + return results in the existing callback.

**What we should NOT touch:**
- `scaffold-kit*.ts` — it's working; don't churn the closed-set primitives.
- `local-verifier.ts` / `render-risk-linter.ts` — best part of the stack.
- `petal-capabilities.server.ts` — high-signal, low-churn.
- `two-phase-gate.server.ts` — keep the UX behavior exactly as is.

---

## Bottom line

Petal's verifier + scaffold-kit + smart-router stack is already *better* than what Bolt and Lovable advertise publicly. The two gaps that actually matter are **(a) no agentic read/edit loop** and **(b) no semantic project retrieval** — competitors lean on those for "feels like it understands my codebase" and "fixes its own bugs". Closing those, plus flipping the staged pipeline on by default and broadening the model rotation, would put Petal at parity-or-better across the board within ~4 weeks.

Want me to start with **Week 1** (low-risk: flip flags, add model candidates, centralize budgets) so we get measurable wins immediately, or jump straight to the **agentic loop** for the biggest capability leap?
