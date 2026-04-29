# Builder Hardening — Phased Plan

Goal: close the MEDIUM and WEAK gaps from the audit without destabilizing the pipeline. Each phase is small, independently shippable, and reversible. Nothing in a later phase depends on speculative behavior from an earlier one.

**Guardrails for every phase:**
- One pipeline change per phase. Ship, observe in `ai_outcomes` for ~24h, then move on.
- No phase touches `src/components/ui/*`, `src/integrations/backend/*`, or `scaffold-kit.ts`.
- Every new gate emits a `timeline` SSE event with `outcome: ok | fixed | failed | skipped` so we can see hit-rates immediately.
- Every new gate is **fail-soft**: if the check itself errors (wasm OOM, network blip, npm rate-limit), we log and pass. We never fail a build because our verifier broke.
- No new model calls without a gate. Every model-driven repair must be conditional on a deterministic check failing first.

---

## Phase 1 — Pre-stream prompt hardening (MEDIUM-a)

**Problem:** the 180-line cap is enforced after the fact. The model already gets size guidance (lines 183-188 of `generate.server.ts`), but it's buried among 80+ other rules and lacks a "WHY this matters" hook the model can act on.

**Change:**
- Promote the file-budget rule to the top of the "Hard rules" block, not buried under STYLES.CSS.
- Add a concrete trigger threshold: *"If a single component is heading past ~120 lines, stop and extract the next logical sub-component before continuing."* 120, not 180 — give the model headroom so we hit the gate less.
- Add a `dynamic-prompts` snippet that fires when the user prompt contains landing/dashboard/multi-section keywords, reinforcing the split-into-files pattern with the canonical Hero/Features/CTA example.
- Add one sentence to `SYSTEM_PROMPT_PATCH`: *"If you're about to emit a file > 180 lines, instead emit two ops: one creating the extracted sub-component, one updating the parent to import it."*

**Files:** `src/server/generate.server.ts`, `src/server/dynamic-prompts.server.ts`.
**Risk:** zero — prompt-only.
**Success metric:** `file_budget` timeline event `outcome: failed` rate drops in `ai_outcomes`.

---

## Phase 2 — Cross-file export/import consistency (WEAK-c, partially MEDIUM-b) ✅ SHIPPED

**Problem:** the local verifier checks each file in isolation. If `Page.tsx` imports `{ useFooStore }` from `./store` and `store.ts` only exports `useStore`, we ship green and the user sees a red preview.

**Change:** extend `local-verifier.ts` with a new pass `findDanglingNamedImports`:
1. For every changed `.ts/.tsx` file, parse `import { A, B as C } from "./X"` (named only — default and namespace are already covered by missing-sibling).
2. Resolve `"./X"` against the file map (reuses existing `resolveImportPath`).
3. Read the target file's exports with a regex: `export\s+(?:const|let|function|class|async\s+function|type|interface)\s+(\w+)`, plus `export\s*\{\s*([^}]+)\s*\}`.
4. If a named import has no matching export in the target file, emit a new `LocalIssue` with `kind: "missing-export"` (add to the union).
5. Skip scaffold paths and `examples/` (same skip list as the rest of the verifier).

**Files:** `src/server/local-verifier.ts` only. New `kind` flows automatically into `combinedAutofixIssues` in `generate.ts`.
**Risk:** low. Regex parsing of TS exports has edge cases (re-exports, `export *`), so we **only emit issues when we're confident** — if we can't parse the target file's exports cleanly, we skip silently rather than false-positive.
**Success metric:** new `missing-export` issues appear in `ai_outcomes.local_verifier_errors`; post-stream autofix fixes them.

---

## Phase 3 — Package-name pre-flight (WEAK-b) ✅ SHIPPED

**Problem:** model hallucinates `react-cooler-toast`; we don't know until sandbox install fails.

**Change:** new module `src/server/npm-existence.server.ts` with `verifyNpmPackages(specs: string[])`:
1. Diff against `package.json` to find packages **newly introduced** this turn (skip everything already pinned).
2. For each new bare specifier, `HEAD https://registry.npmjs.org/<pkg>` with a 1.5s timeout, 3 in parallel max.
3. In-memory LRU cache (Map, capped at 500) so the same package isn't re-checked across turns.
4. 200 → exists. 404 → emit `LocalIssue { kind: "missing-dep", detail: "package … not found on npm" }`. Network error / timeout → log and pass (fail-soft).

**Pipeline integration:** insert as Tier 2.45 (between file-budget and stream autofix). Feeds into `combinedAutofixIssues`. Emits `timeline` step `npm_check`.
**Files created:** `src/server/npm-existence.server.ts`.
**Files edited:** `src/routes/api/generate.ts` (add the gate + timeline event).
**Risk:** low. Worst case the npm registry is slow → we skip the check, pipeline continues unchanged.
**Success metric:** `npm_check` outcome counts in telemetry; "package not found" build failures in user previews drop.

---

## Phase 4 — Refactor `generate.ts` (WEAK-f) ✅ SHIPPED (conservative)

**Problem:** 1336 lines of orchestration in one file is now the audit risk it was designed to prevent.

**Change:** **pure refactor, zero behavior change.** Extract each tier into a named helper inside `src/server/pipeline/`:
- `pipeline/run-stream.server.ts` — the model stream + tool-call collection (~lines 400-720 of generate.ts)
- `pipeline/run-tiers.server.ts` — tiers 2.4 → 2.7 + post-stream autofix + image resolve (~lines 720-1130)
- `pipeline/finalize.server.ts` — credit charge + handoff event + result event + telemetry + self-check (~lines 1130-end)

Each helper takes `{ controller, encoder, ...inputs }` and returns the next state. `generate.ts` becomes the route handler that wires them together — should land near 300 lines.

**Process:**
1. Land the refactor in **one PR** with no logic changes. Diff each extracted block character-for-character against the original to confirm.
2. Manual smoke test: one initial generate, one patch, one oversize-rejection turn, one truncation-recovery turn, one petal-image turn. All `timeline` events still fire in the same order.

**Files created:** 3 in `src/server/pipeline/`.
**Files edited:** `src/routes/api/generate.ts` (now ~300 lines).
**Risk:** medium — refactor of the hottest file in the codebase. **Mitigation:** do this *after* Phase 3 so we have ~48h of clean telemetry to compare against post-refactor. Any timeline-event regression is immediately visible.

---

## Phase 5 — Headless render smoke test (MEDIUM-c, WEAK-a)

**Problem:** esbuild parses the file; we never mount it. Components that throw `Cannot read undefined` on first render ship green.

**Change:** new module `src/server/render-smoke.server.ts`:
1. Build an in-memory module map from the changed files using a tiny `vite` SSR transform, OR (simpler & more Worker-safe) use `esbuild.build` with an in-memory plugin that resolves bare specifiers to stubs (`() => null` for any npm import other than `react`, `react-dom/server`, `@/components/ui/*`).
2. Stub `@/components/ui/*` with no-op components.
3. `renderToString(<App />)` for the home route only. Wrap in try/catch.
4. If render throws, emit `LocalIssue { kind: "render", detail: <error.message + first 3 stack frames> }`.

**Why "home route only":** rendering all routes requires routing infra and will explode in scope. Home route catches ~80% of "white screen on load" reports per the audit.

**Pipeline integration:** insert as Tier 2.8 (after esbuild). Gated to **changed files only** — skip if no `src/routes/index.tsx` or `src/App.tsx` change.
**Risk:** medium-high. SSR rendering is the most failure-prone of all the gates (timing, env, missing browser globals). **Mitigations:**
- 3-second hard timeout via `Promise.race`.
- Fail-soft: any throw inside the smoke test itself (not from user code) = skip + log.
- Ship behind a labs flag (`render_smoke_enabled`) so we can A/B against turns without it for a week before defaulting on.

**Files created:** `src/server/render-smoke.server.ts`.
**Files edited:** `src/routes/api/generate.ts` or the new `pipeline/run-tiers.server.ts` (depending on whether Phase 4 has shipped).
**Success metric:** new `render` issues caught pre-ship; reduction in user "blank preview" support reports.

---

## Phase 6 — Pipeline regression harness (WEAK-d)

**Problem:** zero automated tests for the gate stack. Every change to `generate.ts` is shipped on faith.

**Change:** add `src/server/__tests__/pipeline.fixtures.ts` with frozen JSON fixtures of (a) clean turn, (b) truncated stream, (c) oversize file, (d) hallucinated npm package, (e) dangling named import, (f) render-time crash. Then `pipeline.test.ts` runs each fixture through the verifier modules (not the full route — too much mocking) and asserts the expected `LocalIssue[]` shape.

**Files created:** 2 in `src/server/__tests__/`.
**Files edited:** none.
**Risk:** zero — test-only.
**Success metric:** `bunx vitest run` green; future PRs catch regressions before merge.

---

## Deferred (not in this plan, intentionally)

- **MEDIUM-d (semantic patch_files validation):** would require implementing op-application semantics tests. The post-Phase-2 verifier catches most consequences (missing exports, dangling imports). Revisit only if telemetry shows real harm.
- **WEAK-e (RLS / auth correctness for generated apps):** generated apps live in user backends we don't own. Best handled by stronger prompt rules + the existing `integrations/auto-suggest` chip system, not by a server-side gate.
- **MEDIUM-b (full type-checker pass):** running `tsc` on the in-memory file map is the obvious nuclear option. Cost: 3-8s per turn, doubles latency, conflicts with our cost-discipline goal. Ship Phase 5 first; if `render` gate doesn't catch enough, reconsider.

---

## Order of operations

```text
Phase 1 (1-2 hrs)   → ship → observe 24h
Phase 2 (3-4 hrs)   → ship → observe 24h
Phase 3 (3-4 hrs)   → ship → observe 24h
Phase 4 (4-6 hrs)   → ship → observe 48h  ← refactor only after telemetry baseline is clean
Phase 5 (1-2 days)  → ship behind labs flag → A/B 7 days → flip on
Phase 6 (3-4 hrs)   → ship anytime, ideally before Phase 4
```

Recommendation: ship **Phase 1 + Phase 6 together first** — both are zero-risk, and Phase 6 gives us the safety net to do Phase 2-5 confidently.

Approve and I'll start with Phase 1.
