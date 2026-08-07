# Petal Project Quality and Chat Reliability Plan

## Objective

Make every Petal turn end in one trustworthy state:

```text
user request
  → scoped file change
  → deterministic validation
  → production build
  → real-browser verification
  → promote only if healthy
  → one clear chat result
```

Petal must keep the last healthy preview visible throughout. Automatic repair may continue in the background, but it must be bounded, free to the user, and unable to create build loops.

## Confirmed current-state problems

- The build callback sets a build to `ready` and moves `projects.latest_build_id` even when browser verification reports defects. In the last 14 days, **69 builds were marked ready with `verification.ok = false`**.
- Stayora currently points at a build marked ready with **40 browser defects**, including blank routes and uncaught runtime errors. It has had **33 ready-but-broken builds** and **9 failed builds**.
- Stayora produced several repair/deploy cycles within minutes. Its recent pipeline history shows **254 deterministic repair records across 13 passes**, including the same broad layout, interaction, scope, and extension repairs firing repeatedly.
- The saved Stayora app currently mounts `BrowserRouter` in both `src/main.tsx` and `src/App.tsx`. Nested routers are invalid and account for the current all-route runtime crash.
- The project contains **341 files**: 73 UI-kit files, 89 examples, and 78 block-library files. Whole-project repair passes repeatedly inspect or mutate this support library even when a user asks for one targeted app edit.
- Runtime telemetry requests are appearing as browser defects because the preview guard’s cross-origin reporting path produces CORS console errors.
- At least one turn older than 15 minutes remains `running`, so stalled-turn cleanup is not yet a reliable terminal-state guarantee.

## Phase 1 — Stop shipping broken previews

1. Split build outcome from preview promotion.
   - Treat compile/deploy success as `deployed`, not automatically healthy.
   - Promote a build to the project’s visible preview only when browser verification is clean.
   - Keep the previous healthy build URL active when verification fails.
   - Store the newest attempt separately from the newest healthy preview so chat can report repair progress without replacing the working iframe.

2. Make verification a hard promotion gate.
   - Blank render, uncaught page error, missing root content, or failed required route blocks promotion.
   - Visual-only findings remain repairable quality findings, with severity thresholds so subjective or duplicate findings cannot block forever.
   - A deployment with no verification report is not promoted unless verification was explicitly unavailable and the previous healthy preview remains visible.

3. Repair Stayora’s current runtime failure.
   - Enforce one canonical router provider at the entry point.
   - Remove nested router providers from generated app components.
   - Rebuild Stayora, verify every declared route, and only then update its healthy preview pointer.

## Phase 2 — Make edits narrow and deterministic

1. Separate immutable scaffold files from user app files.
   - Do not persist the full examples/block catalog into every generated project.
   - Materialize shared kit files only at build time or include only files reachable from the app graph.
   - Never run general layout, interaction, extension, scope, or branding codemods over unused examples and catalog files.

2. Change repair scope from “all project files” to:
   - files changed in the turn;
   - their import dependants and dependencies;
   - the entry/router files when the change affects routing;
   - explicitly selected legacy files during one-time migration.

3. Add idempotency contracts to every codemod.
   - Running the full repair suite twice must produce a byte-identical second result.
   - A pass firing on the same file in consecutive turns becomes a test failure and is quarantined until fixed.
   - Replace size-only progress hashes with content hashes so same-length corruption is detected.

4. Harden the final compiler boundary.
   - Keep the disk-level markdown-fence healer immediately before compilation.
   - Parse every reachable source file after final repairs.
   - Run a production bundle before saving/promoting the version.
   - Add regression fixtures for the exact leaked ` ```typescript ` failure, malformed imports, JSX corruption, duplicate routers, and runtime blank-page cases.

## Phase 3 — Fix the repair loop and credit contract

1. Introduce one server-owned turn state machine.

```text
queued → generating → validating → building → verifying
                                      ↓           ↓
                                  repairing ← failed
                                      ↓
                          succeeded | rolled_back | exhausted
```

2. Make recovery idempotent by logical turn ID.
   - One user request owns all internal generation, build, verification, and repair attempts.
   - Client reconnects and tab reloads reattach to that turn; they never start another.
   - Build callback events use compare-and-swap so an older callback cannot replace a newer result.

3. Bound automatic recovery on the server, not local storage.
   - Deterministic repairs first.
   - At most one targeted AI source repair for compile failure and one for runtime verification failure.
   - Stop immediately when the same normalized defect returns without a meaningful content diff.
   - Exhaustion rolls back to the previous healthy version and ends the turn.

4. Enforce billing invariants.
   - Exactly one charge for one user-initiated successful turn.
   - Internal repair, retry, verification, reconnect, and rollback turns cost the user zero.
   - Failed or rolled-back turns settle to zero/refund automatically.
   - Add database-level idempotency keyed by logical turn ID, not client flags.

5. Make stalled-turn cleanup reliable.
   - Reap expired `running` turns on a server schedule.
   - Release build locks, finish billing settlement, and emit a terminal event in the same transaction.

## Phase 4 — Make chat calm and always actionable

1. Render one status surface per logical turn.
   - Progress updates replace each other rather than stacking.
   - Internal repair prompts and raw logs never become user messages.
   - Success removes obsolete error and verification cards.

2. Make “Ask Petal to fix it” reliable.
   - The button targets the exact failed attempt and defect set.
   - If another operation is active, queue this repair and show “Queued”; never ignore the click.
   - Disable only with an explicit visible reason, never through a silent `busy` return.
   - The repair remains part of the original logical turn and is free.

3. Preserve user control.
   - Composer remains usable while builds run.
   - A user can cancel automatic repair without losing the previous healthy preview.
   - Technical details stay behind a disclosure; the primary message states what Petal is doing and whether the last good version remains live.

4. Remove verifier noise.
   - Send runtime telemetry without a CORS preflight and never classify telemetry transport failures as app defects.
   - Deduplicate route findings by normalized root cause.
   - Cap user-facing defects while retaining full internal diagnostics.

## Phase 5 — Quality release gates

1. Add a fixed golden-project matrix:
   - landing page;
   - multi-page marketing site;
   - dashboard;
   - authenticated app;
   - mobile-width app;
   - targeted edit on an existing large project.

2. For every matrix project, assert:
   - clean parse and production build;
   - no unresolved imports or nested router providers;
   - all declared public routes render meaningful content;
   - no uncaught console/page errors;
   - primary navigation and forms work;
   - mobile has no horizontal overflow, clipped hero, or unreadable overlay;
   - failed candidate builds never replace the healthy preview;
   - one request produces no more than one billable settlement.

3. Release criteria:
   - 0 broken builds promoted as healthy;
   - 0 double charges;
   - 0 zombie turns older than 15 minutes;
   - ≥95% first-attempt production-build success on the golden matrix;
   - ≥98% verified interactive preview success after bounded repair;
   - second repair-suite run is byte-identical for every fixture.

## Rollout order

1. Ship the promotion gate and last-known-good preview protection first.
2. Fix router canonicalization and validate Stayora end to end.
3. Restrict scaffold persistence and repair scope.
4. Move recovery/billing state to the server-owned logical turn.
5. Replace the current chat cards with the single-turn status surface.
6. Run the golden matrix, deploy the builder deliberately, and monitor failure signatures before broad release.

## Technical implementation notes

- Database: add separate candidate/latest-attempt and healthy-preview references, plus a unique billing settlement key for each logical turn. Preserve existing build history.
- Builder callback: classify verification severity before updating project pointers; use conditional updates against the expected attempt ID.
- Repair pipeline: pass an explicit reachable/changed path set through every tier. Scaffold-managed paths are immutable inputs, not model-owned project files.
- Router gate: normalize to one provider in `src/main.tsx`; detect and reject nested `BrowserRouter`, `RouterProvider`, or mixed TanStack/react-router roots.
- Verifier: report root-cause fingerprints, route coverage, and interaction assertions separately from visual suggestions.
- Observability: record terminal outcome, candidate build, promoted build, repair count, normalized defect fingerprint, and settlement ID for every turn.