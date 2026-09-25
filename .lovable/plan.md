# Hardening pass: semantic verification + repair lifecycle

Scope: harden the changes just made. No new orchestrator, state machine, verification framework, repair engine, or billing logic. No real customer build.

## 1. Three explicit outcomes for the identifier checker
- `checkUndefinedIdentifiers` returns `{ status: "verified" | "failed" | "unavailable", issues, reason? }` instead of a bare issue list. It no longer silently returns `[]` when the compiler fails.
- `unavailable` covers: compiler throws, time budget exceeded, config can't load, or checker returns non-deterministic output.
- `verifyProposedSource` maps these onto the **existing** status vocabulary (`passed` / `failed` / `unavailable` already used by the esbuild verifier):
  - failed → existing FAIL (blocks commit, as today)
  - unavailable → recorded as `unavailable` with reason; follows the existing rule for this pre-commit path (esbuild still authoritative for parse → save proceeds, but the result is logged on the turn and never reported as verified)
- Add a small time budget so a slow compile becomes `unavailable`, not a hang.

## 2. Check exactly the proposed tree
- Confirm and test that the in-memory host is fed `args.tree` = current untouched files + transaction's proposed files (the same tree `commitTurn` would persist), never the persisted snapshot.
- Resolve relative and `@/` imports across that tree so a changed file sees other changed files' exports.
- Read `tsconfig.json` paths/jsx from the proposed tree where present; fall back to current defaults.

## 3. Keep it cheap
- Diagnostics still only on changed files; the program includes only changed files plus what they transitively import from the tree (bounded). No full-project check per edit.

## 4. False positives
- Where the bundled `typescript` package exposes `lib.dom`/`lib.es*` text, load the real libs instead of the homemade list; keep the ambient list only as a fallback (and don't grow it).
- Tests: window, document, console, fetch, JSX, React imports, imported/local names, params, destructuring, browser APIs (IntersectionObserver, ResizeObserver, structuredClone) pass; genuinely undeclared `mode` fails.

## 5. Repair lifecycle (the `mode` incident)
Test the chain end to end with the existing pieces (mocked AI, no real build):
generation → proposed Auth.tsx → checker finds `mode` → transaction rejected → revision unchanged, no files written, 0 credits → repair context built (classified `repair`, not FIRST_BUILD) → Auth.tsx read before edit → fixed file passes → commit → revision +1 → build requested for that exact revision → readiness only via existing gates. Assert no design selection or page mapping stage runs.

## 6. App.tsx partial completion
- When the critic gate blocks a path (`blockedPaths`), the related PRD requirement must stay `IN_PROGRESS`/partial, never COMPLETED; the unresolved part (nav link to /auth) is recorded so the next turn continues without the user restating it.
- Audit the existing `prd-progress.server.ts` path for this; fix only if it can mark the requirement done despite a blocked file. Tests cover it.

## 7. Classifier regressions
Keep the "broken" regression and add: localized bug → targeted repair; broad product request → plan kept; broad request with "broken/fix/problem" → still plans; repair never becomes FIRST_BUILD; cross-cutting repair still escalates to staged planning.

## 8. Verify and report
Run targeted tests, repair-incident tests, full suite, typecheck, production build. Report the 7 items requested, then stop.

## Technical details
Files expected to change: `src/server/verification/identifiers.server.ts`, `src/server/verification/source.server.ts`, possibly `src/server/prd/prd-progress.server.ts` (only if the audit shows a false-complete), tests in `src/server/__tests__/repair-incident.test.ts` and a new `identifiers.test.ts`, `vitest.config.ts` include list.
