# First-build cleanup reliability fix

## Scope

- Restrict first-build deterministic cleanup to files actually created or modified by the current generation unit, plus generated dependencies that were explicitly changed.
- Keep read scope separate from write and cleanup scope; skip cleanup when no files changed and prevent any fallback to the full starter project.
- Add proof-oriented cleanup telemetry for turn, attempt, unit, exact paths/counts, duration, result, and skipped state.
- Inspect the existing continuation watchdog and make only the isolated change needed so a silent continuation receives one bounded fallback attempt without replaying completed units.
- Preserve current batching, output budgets, thinking defaults, provider routing, recovery, caching, billing, design, memory, and scope protections.

## Validation

- Add focused tests covering changed-only cleanup, untouched-file exclusion, zero-change skip, legitimate router changes, non-expanding scope, exact telemetry, bounded continuation fallback, completed-unit protection, and thinking off.
- Run the full automated test suite and typecheck.
- Run the same Rise & Crumb Home/Menu/About/Contact smoke test once, capture raw generation, provider, token, cleanup, timing, billing, publish, and browser evidence, then stop at the first genuine failure.

## Exclusions

- No generation redesign, broad AI cleanup/review loop, speculative features, or work on existing security warnings.
- Do not claim readiness unless every smoke-test acceptance condition in the uploaded brief is demonstrated.