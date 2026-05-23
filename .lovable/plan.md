# Plan: 4 Production-Grade Gaps

Sequenced lowest-risk → highest-risk. Each item is independently shippable; we can stop after any step.

## 1. Hard two-phase gate (frontend → backend)

**Goal:** Backend-touching intents (auth, DB, payments, storage, email, realtime, cron, AI) cannot run on the same turn as the initial frontend build. Petal must build the frontend first, then ask the user to confirm before the backend turn.

**Where:**
- `src/routes/api/generate.ts` — pre-flight check: if `messages.length` shows this is turn 1 AND the prompt triggers any backend intent (reuse `backend-intent.ts`, `payment-intent.ts`, etc. detectors), force `hasBackend: false` for the generation, append a `suggestions` block to the closing assistant message ("Add auth?", "Add database?", etc.), and skip the backend phase.
- `src/server/pipeline/staged-orchestrator.server.ts` — pass `phase: "frontend" | "backend"` through; in frontend phase strip backend files from plan.
- System prompt addition: "On turn 1, never write supabase client code, RLS, or server functions. Propose them as suggestions."

**Risk:** Low. Reuses existing intent detectors + SuggestionChecklist (already hard-blocking).

## 2. Per-file validate-then-continue loop

**Goal:** Instead of running `post-stream-autofix` after the whole stream, validate each file as it lands and auto-repair before moving on. Catches broken imports / syntax mid-stream so later files can depend on earlier ones.

**Where:**
- `src/server/pipeline/stage-scaffold.server.ts` — wrap the per-file write in a `validateFile(file)` → `repairFile(file, errors)` → re-validate loop (max 2 repair passes per file).
- New `src/server/pipeline/validate-file.server.ts` — runs the cheap subset of checks already in `validate-styles.server.ts`, `npm-existence.server.ts`, `tool-call-guard.server.ts`, plus a TS parse via `@babel/parser` (already a dep).
- Emit `file_validated` SSE event so BuildActivityCard can show a green tick per file.

**Risk:** Medium. Adds latency per file (~200-500ms). Mitigation: only run on `.ts/.tsx`, skip assets; cap repair at 2 attempts then continue and let post-stream autofix catch the rest (current behavior as fallback).

## 3. Preview crash → static fallback

**Goal:** When WebContainer throws at runtime (white screen, module error, infinite loop), show the last known-good preview snapshot + a "Petal is fixing this" banner instead of a blank iframe.

**Where:**
- `src/components/WebContainerPreview.tsx` — already has error boundary; extend to:
  - On successful boot, snapshot a screenshot via `iframe.contentWindow` → IndexedDB keyed by `projectId@versionId`.
  - On crash (caught error OR readiness probe fails after 8s), render `<PreviewCrashFallback>` showing the last snapshot + the crash reason from `friendly-errors.ts` + a "Try repair" button that re-triggers generation with the error context appended.
- New `src/components/PreviewCrashFallback.tsx`.
- `MobilePreviewFallback.tsx` already exists; refactor to share the snapshot UI.

**Risk:** Medium. IndexedDB snapshot is best-effort (cross-origin iframe screenshots are limited — fallback to a cached DOM clone or just the friendly-error card if snapshot unavailable).

## 4. AST-level diff edits

**Goal:** Replace the "keep existing code" comment convention with true AST patches for `.ts/.tsx` edits. The model emits a small JSON patch (`{file, op: "replace-export", name: "Foo", body: "..."}` etc.) and the server applies it via `@babel/traverse`. Fewer regressions, smaller token usage, no accidental deletions.

**Where:**
- New `src/server/pipeline/ast-patch.server.ts` — exports `applyPatch(source, patch)` supporting ops: `replace-export`, `replace-function`, `add-import`, `remove-import`, `replace-jsx-block` (anchored by `data-petal-block="id"`).
- New tool spec in the system prompt: `<petal:patch file="..." op="...">...</petal:patch>` alongside the existing full-file write format. Model chooses per-edit; full-file for new files, patches for edits.
- `keep-existing-expander.ts` stays as fallback.
- Add `src/server/pipeline/__tests__/ast-patch.test.ts`.

**Risk:** High. Touches the core generation contract. Recommend shipping behind a labs flag (`use-labs-flags.ts` already exists) and A/B testing on internal projects first.

## Suggested order

1. **#1 (gate)** — 1 PR, low risk, biggest UX win for non-technical users.
2. **#2 (per-file validate)** — 1 PR, medium risk, measurable build-quality improvement.
3. **#3 (preview fallback)** — 1 PR, medium risk, eliminates the worst failure mode (blank screen).
4. **#4 (AST patches)** — Labs-flagged rollout. Defer until #1–#3 stable.

## Out of scope

- Rewriting `examples-pack.ts` / system prompt structure (already strong).
- Touching billing, mobile pipeline, Cloud activation, or the $5 grant logic.
- Changing the SuggestionChecklist contract (already final per recent memory).

## Open questions

- For #4: should we ship the patch format at all, or is "keep existing code" + #2's per-file validation enough? AST patches are the highest-effort/highest-risk item — happy to drop it if you'd rather invest the time elsewhere.
- For #1: do you want the gate to be **absolute** (turn 1 = frontend only, always) or **smart** (skip gate if user explicitly says "build me a full SaaS with auth and DB")?
