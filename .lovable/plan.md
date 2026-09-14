# Phase 6 — a real "your app is ready"

Today "ready" means: the build compiled, the deployed URL answered, and the browser check found no blocking defect. That is a good bar, but it is not the promise. It says nothing about whether signing in works, whether the main thing the app exists to do actually completes, or whether the checks were even able to run.

Phase 6 makes readiness an explicit, evidence-backed verdict built from the test results phases 3–5 already produce — and makes "we could not test it" a distinct answer from "it works".

## The gate

An app is only called ready when every one of these is true:

- The build finished and the live address serves the real app.
- No blocking runtime fault in the browser check (unchanged from today).
- Every must-work check passed: the app opens, the key pages load, sign-in works where the app has sign-in, the main journey completes end to end.
- No must-work check was left untested. Untested is never a pass.
- Nothing that was working before this change is broken now.

If any must-work check failed and the repair budget is spent, the verdict is "not ready — here is what is wrong". If checks could not run at all (the app would not start, a key was missing, an outside service was down), the verdict is "could not verify", with the reason, never "ready".

## What the person sees

One honest line at the end of a build, in plain words:

- Ready — with a short list of what was checked and proven.
- Not ready — what failed, on which page, and what Petal tried.
- Could not check — what stood in the way and what Petal needs from them.

No change to how the build card looks; only the wording and the badge state it can show.

## Technical notes

- New `src/server/readiness.server.ts`: a pure `evaluateReadiness({ shipped, blockingDefects, results, budgetSpent, intervention })` returning `{ verdict: "ready" | "not_ready" | "unverified", reasons, checked, failed, unverified }`. Pure so it is fully unit-testable, no IO.
- `recordBuildOutcome` in `turn-completion.server.ts` takes an optional readiness verdict and uses it for the accept decision instead of `shipped && !blockingDefects.length`. Absent verdict keeps today's behaviour exactly, so nothing regresses for builds that ran before Test Lab wiring.
- `project_turn_completion` gains `readiness` (jsonb) and `verdict` (text) so the decision and its evidence are durable and visible to the resume worker and the admin view.
- `project_test_runs.status` already carries the run-level tally; readiness reads from the tallied `CaseResult[]`, not from a second source of truth.
- Callback path in `api/public/builds/callback.ts` passes the test-run results through when a run exists for the build; otherwise nothing changes.
- Unit tests in `src/server/__tests__/readiness.test.ts` cover: all-pass ready, a failing must-work check, an untested must-work check, intervention leading to unverified, and the no-results fallback matching today's decision.

Verification: type check, full suite, then a real end-to-end build through the live pipeline confirming the verdict lands on the record.
