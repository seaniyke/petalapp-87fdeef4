## Goal

Make Petal produce the same caliber of first build that Lovable does on prompts like *"Build a community app where users can create posts anonymously"* — a real feed UI with a committed design, not a sidebar-and-dashboard placeholder that then leaks build errors into chat.

## What's actually broken (confirmed in code, not hypothesized)

1. **Two unequal pipelines.** `src/routes/api/generate.ts:1599` runs `runStagedPipelineStream` when the `staged_pipeline` labs flag is on. The staged path uses ONLY `runStagePlan → runStageScaffold → runStageWireup`. It bypasses every quality layer the monolithic path runs afterward (lines 1607–1714): `pickDesignDirection`, `buildBlueprintFor` (app-composer), `classifyAppShape`, `pickDynamicSnippets`, `renderLearningBlock`, `renderPetalCapabilitiesBlock`. That's why the screenshot's plan is generic "sidebar + dashboard" — the staged plan model never saw any of it.
2. **No design commitment before code.** Neither pipeline pre-writes semantic tokens into `src/styles.css` from the design brief. The model gets *told* a palette in the prompt but the tokens it has to use are still the defaults. Result: undesigned shadcn-on-white.
3. **Stage-plan uses `google/gemini-3-flash-preview` with a thin prompt.** `src/server/pipeline/stage-plan.server.ts:140` — fast/cheap, and the system prompt doesn't mention app *archetype*, *audience*, or *aesthetic*. The classifier output never reaches it.
4. **No parser-level retry on scaffold files.** `stage-scaffold` retries on token-cap, but not on "the file you emitted has a syntax error." The screenshot shows exactly this failure mode: a `DashboardPage.tsx` with `Unexpected ')'` that survived to runtime.
5. **Autofix leaks 3 messages and then punts to the user.** Sequence visible in screenshots:
   - User turn → "🔧 Petal noticed a build error and is fixing it automatically" (`builder.tsx:1731`)
   - A second visible Petal turn narrating the fix in prose ("I'll fix the syntax error in DashboardPage.tsx…")
   - Fallback "I couldn't safely apply that edit on this pass. Tell me the exact bit you want changed…" (`generate.ts:2326`) — asking the user to describe a fix to code the user never wrote.

The autofix UX is wrong on two axes: it's loud (3 messages where Lovable shows 0), and its failure mode treats Petal-generated code as if it were user-edited code.

## The plan

### Phase 1 — One quality path
Backfill the staged pipeline with the briefs the monolithic path already builds. Refactor `generate.ts` so the **context bundle** (design direction, app-shape block, composer blueprint, dynamic snippets, learning block, capabilities block, high-stakes block) is built BEFORE the `if (labsFlags.staged_pipeline)` branch and passed into `runStagedPipelineStream`. Today these are built *after* the branch (lines 1607+), so the staged path can never see them.

Surface area: extract a `buildInitialContextBundle({...})` helper from `generate.ts`. Both branches call it. Staged-orchestrator gains a `context: InitialContextBundle` parameter and threads it into every stage's system prompt.

### Phase 2 — Design brief that actually lands in code
After `pickDesignDirection` returns, but BEFORE Stage 1 (plan):
- Translate the chosen direction into a `styles.css` patch (palette tokens in `oklch`, font-family vars, radius, shadow-elegant, gradient-primary). Pre-write that file as op #1 of the result so every subsequent file uses real tokens.
- Install the chosen Google Fonts via `@fontsource/*` (the questions_post_answer_guidance pattern). Stage-plan must list the `import '@fontsource/xxx'` lines as belonging to `src/main.tsx` even though main.tsx isn't user-planned — pass them through `injectRootViewIfMissing`'s sibling.
- Add the brief summary into the plan stage's user prompt so the planner knows the *vibe*, not just the feature list.

### Phase 3 — App shape drives layout, not file count
Run `classifyAppShape(brief)` *before* planning and pass `shape` into `runStagePlan`. Extend stage-plan's system prompt with archetype-specific layout rules:
- `feed` → single-column, composer at top, post cards below, optional tag filter chip rail. NO sidebar. NO dashboard.
- `marketing` → hero + sections, no auth shells.
- `dashboard` → sidebar + main, only when the user explicitly asked for a dashboard/admin tool.
- `tool` / `game` → centered canvas.

Add a hard rule: "If shape is `feed`, planning a `Sidebar` or `DashboardPage` component is a planning error — reject and replan."

### Phase 4 — Parser-validated per-file generation
In `stage-scaffold`, after each file's content arrives, run a cheap parser pass (`@babel/parser` parse, errors only — already in deps via Vite). If it fails:
1. Re-emit the WHOLE file with `previous_attempt + parser_error` in the user prompt (one retry, full token budget — do NOT shrink the cap, which the recent App.tsx fix already established for the root view; generalize that rule to any file whose retry reason is `syntax_error`).
2. If retry still fails, mark that file as `needs_repair` and short-circuit wire-up to `ok: false, reason: "scaffold_syntax_unrecoverable"` so the orchestrator falls back to the monolithic path silently (same pattern as `missing_root_view`).

This is the single biggest reliability lift — most "Unexpected ')'" failures come from one truncated component.

### Phase 5 — Silent, honest autofix UX
- **Remove the visible "🔧 Petal noticed a build error" system note** (`builder.tsx:1731`). Replace with the same subtle activity-card status that normal turns use ("Fixing build…"). The user already sees the activity card spinner; the chat message is redundant noise.
- **Suppress the second Petal turn for autofix runs.** Autofix should write files and emit a `result` event without a narrative assistant message. Today it streams a fresh prose turn ("I'll fix the syntax error in DashboardPage.tsx…") — kill that for `isAutoFix === true` by setting the system prompt to "Edit files only. Do not write a chat message."
- **Replace the "Tell me the exact bit you want changed" fallback for autofix turns.** When `isAutoFix` and the patch retry exhausts (`generate.ts:2322`), revert files to pre-turn snapshot, refund credits (already on us), and emit ONE quiet card: "Petal couldn't auto-repair this build — reverted to the last working version." Never ask the user to describe a syntax fix.

### Phase 6 — Telemetry to prove it
Add three counters to the existing pipeline-telemetry surface so we can verify the fix from `/admin/pipeline`:
- `staged_pipeline.shape_mismatch` (planner emitted a layout that contradicts the classified shape)
- `scaffold.syntax_retry_count` and `scaffold.syntax_unrecoverable_count`
- `autofix.user_visible_messages` (target: 0)

## Out of scope

- The agent loop / golden eval harness (separate, larger effort).
- pgvector retrieval for past successful builds.
- Killing the staged pipeline entirely. Phase 1 makes it equal to monolithic; we keep it because parallel scaffold IS faster when it works.
- KeshPay-style "ask first" — explicitly overridden by project memory.

## Technical notes

Files touched:
- `src/routes/api/generate.ts` — extract `buildInitialContextBundle`, pass it to both branches; tighten autofix system prompt + fallback.
- `src/server/pipeline/staged-orchestrator.server.ts` — accept and thread the context bundle; new `scaffold_syntax_unrecoverable` fallback reason.
- `src/server/pipeline/stage-plan.server.ts` — accept `shape`, `designBrief`, `appShape` in args; bigger system prompt with archetype rules; consider bumping model to `google/gemini-3.5-flash` for planning.
- `src/server/pipeline/stage-scaffold.server.ts` — per-file `@babel/parser` validate; full-budget re-emit on syntax_error; report `needs_repair`.
- `src/server/design-director.server.ts` — return a `tokensCss` field (the `styles.css` patch) alongside the existing prompt block.
- New `src/server/pipeline/stage-design.server.ts` — runs after design-director, emits the `styles.css` op + `@fontsource` install ops as a deterministic pre-stage.
- `src/routes/builder.tsx` — remove the visible "🔧 Petal noticed" system note for autofix.

No DB migrations. No new secrets. No new packages (`@babel/parser` is already pulled in by Vite's chain).

## Acceptance check

Re-run the exact prompt from the screenshots — *"Build a community app where users can create posts anonymously"* — and the result must be:
1. A single-column feed UI with a composer and post cards (no sidebar, no "DashboardPage").
2. A non-default palette/typography visible on first paint.
3. Zero "noticed a build error" or "couldn't safely apply" messages in chat.
4. If the staged pipeline fails, the user sees a normal Petal turn with the monolithic result — no telemetry of the fallback in the UI.
