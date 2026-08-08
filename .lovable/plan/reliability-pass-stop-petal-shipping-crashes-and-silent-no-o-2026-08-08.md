# Reliability pass: stop Petal shipping crashes and silent no-ops

Two audits ran across the repair pipeline and the turn lifecycle. Both found the same shape of problem as the `value={undefined}` provider bug just removed: deterministic passes that make a build *compile* while making the app *crash*, and turn paths that end quietly instead of failing loudly.

## Part 1 — Related issues (same class as the provider crash)

Verified in the code, in priority order:

1. **Stub generator emits only default exports** (`src/server/import-resolver.server.ts:118`). When an unresolved import was a *named* import (`import { Hero } from ...`), the generated stub has no matching export. The binding is `undefined` and React throws "Element type is invalid" on first render. esbuild cannot catch it.
   Fix: emit both a default and a named export matching the imported binding; emit `export const X` for every named specifier the importing file used.

2. **Unknown-package imports are stripped by design, leaving live call sites** (`src/server/bare-import-resolver.server.ts:322`). The comment states the runtime crash is intentional. It produces `ReferenceError: X is not defined` in the browser — exactly the class of failure we are trying to eliminate.
   Fix: instead of commenting the import out, replace it with a local safe shim (component → visible placeholder; function/object → inert no-op) so the app renders and the missing dependency is disclosed in the turn summary rather than crashing.

3. **`<Outlet/>` injection splices JSX at a naive `lastIndexOf("</")`** (`src/server/route-graph.server.ts:230-302`). A `</` inside a string prop, comment, or conditional branch puts the Outlet in the wrong node — broken nesting or an Outlet that never mounts.
   Fix: gate the injection on a real parse (reuse the existing esbuild/AST helper); skip the pass when the root element cannot be identified unambiguously.

4. **Regex route surgery on nested routes** (`src/server/route-graph.server.ts:190-228`). The duplicate-`/`-route remover matches to the *first* `</Route>`, so a layout route with children is truncated, leaving unbalanced JSX.
   Fix: same gate — parse first, skip when nesting is detected.

5. **Router wrap/unwrap by text heuristics** (`src/server/router-provider.server.ts:315-447`). The unwrap regex can under-match and remove the dominant `BrowserRouter`, reproducing the `basename` crash this file exists to prevent.
   Fix: make removal apply only when a parse confirms two live router mounts, and always keep the outermost one.

6. **`<Select>` no-op injection** (`src/server/runtime-contract.server.ts:104`) silently locks a control read-only. Same "hide the bug" pattern.
   Fix: drop the injection; report it as a warning instead.

7. **Ownership is enforced in one place only** (`src/server/repair-all.server.ts:346`). Passes have no ownership check of their own, so any pass invoked outside `runAllRepairs` (e.g. the `preemit-gate` `afterRepair` hook) can mutate scaffold files with no restore.
   Fix: move the ownership check into the shared apply helper so every pass is self-protecting regardless of call site.

## Part 2 — Unrelated issues that stop turns completing

1. **A turn that changed nothing is still charged full price.** Settlement runs at `src/routes/api/generate.ts:4617`, before the outcome is computed at `:4770`. An `"answered"` (no-op) turn is charged, and the shortfall is booked as wallet debt.
   Fix: move settlement after the outcome diff; charge nothing (or a reduced answer rate) for `"answered"` turns.

2. **No refund for a generation turn that shipped broken code.** Refunds exist only on the deploy callback path. `localVerdict.ok === false` is telemetry only.
   Fix: reuse the existing `refund_build_charge` RPC when the local verdict fails.

3. **Real bugs are indistinguishable from ambiguous prompts.** The "I didn't change any files" fallback (`:2962`) and the root-cause guard (`:4945`) produce identical UX for a broken pipeline and a vague prompt.
   Fix: keep the friendly message, but tag the turn with a distinct internal failure reason and record it, so these show up in telemetry instead of disappearing.

4. **Staged orchestrator has no timeout of its own** (`src/server/pipeline/staged-orchestrator.server.ts`) and discards partial work with only a `console.warn` on any stage failure.
   Fix: add a wall-clock ceiling around the staged path and record each stage failure as structured telemetry.

5. **Stalled turns sit spinning for 15 minutes** before the SQL reaper closes them, and the deploy watchdog is client-triggered — closing the tab means no retry.
   Fix: shorten the visible stall window with a server-side progress deadline, and let the build reaper mark the build actionable rather than leaving it silently dead.

6. **Persistence failures don't fail the turn** (`:4692`). A failed `replace_project_files` is only logged; the turn still reports success.
   Fix: treat a persistence failure as a terminal turn error.

## Scope and sequencing

Part 1 items 1–3 and Part 2 items 1–3 are the ones that directly cause the crashes and "nothing happened" turns you keep hitting; they land first. Items 4–7 in Part 1 and 4–6 in Part 2 follow in the same pass.

Every change gets regression coverage in the existing `src/server/__tests__` suites, including a named-import stub test, an unknown-package shim test, a nested-route Outlet test, and a no-op-turn billing test. No behavior is suppressed — each fix removes a crash source or surfaces a failure that is currently hidden.
