## Goal

Cut the one layer in Petal's recovery stack that's costing more than it returns (Tier 3 model verifier) and tighten the autofix gate so we don't spend a model call on healthy turns.

## Why

From the audit:
- **`verifier.server.ts` (Tier 3)** runs a `gemini-2.5-flash-lite` call to look for "obvious build-breakers" — but the deterministic `local-verifier.ts` ran 100 lines earlier and already caught them for free. Worse, when it does flag something, the Phase D one-round cap (`autofixModelRan` check) **explicitly skips its recovery pass** because Tier 2 already ran. So it pays full cost (~1.5s + tokens) on every non-trivial turn for near-zero incremental value.
- **`shouldRunPostStreamAutofix` gate is too loose** — fires on any 6+ file turn or any "feature"/"refactor" preflight kind. Telemetry pattern: returns empty fix list most of the time on these turns. The `!localVerdict.ok` clause already guarantees it runs when actually needed.

The other three layers (`local-verifier`, `post-stream-autofix`, `self-recovery`) stay as-is — they're load-bearing.

## Changes

### 1. `src/routes/api/generate.ts`

- Remove the `runVerifier` / `shouldRunVerifier` import (line 43).
- Delete the entire Tier 3 verifier block (~lines 864–919): the `shouldRunVerifier` call, the `runVerifier` call, the `verifier_warning` SSE emission, and the now-dead "verifier-recovery" autofix re-run.
- Remove the `autofixModelRan` tracking variable and the `preflightKind` lookup that only fed the loose gate.
- Replace the autofix gate condition with the tightened version:
  ```ts
  if (!localVerdict.ok || autofixOut.report.fixedCount >= 2) { … }
  ```

### 2. `src/server/verifier.server.ts`

- Delete the file. No other code imports it after the generate.ts edit (verified via ripgrep — only `generate.ts` references `runVerifier`/`shouldRunVerifier`).

### 3. `src/server/post-stream-autofix.server.ts`

- Leave the file alone. `shouldRunPostStreamAutofix` becomes unused but it's a pure function — keep it exported for now (cheap, and useful if we ever want to re-enable a softer gate). Optionally remove if you want zero dead code; I'll leave it unless you say otherwise.

### 4. Verification after edit

- Re-grep for any straggler imports of `verifier.server` or `shouldRunVerifier` and confirm none remain.
- Confirm `generate.ts` still typechecks: the removed block didn't expose any variables used downstream (`autofixModelRan` was only read inside the deleted block; `changedPaths`/`earlyChangedPaths` are still used by other code paths — keep those).

## Recovery pipeline after the change

```text
stream ends
  → regex autofixer (stream-autofixer.ts)
  → local verifier (deterministic, free)        ← source of truth
  → continuation pass (if truncation flagged)   ← same model, finishes the file
  → post-stream autofix model (only if local verifier failed
                               OR regex autofixer caught ≥2)
  → image placeholder resolution
  → build
  → self-check (on success) / humanize-error (on failure)
```

One model recovery call max per turn. No duplicate scanning. Same correctness, lower latency, fewer tokens.

## Risk

Low. The Tier 3 layer's recovery was already neutered by the Phase D cap, so deleting it removes work that wasn't producing fixes. The tightened gate matches what `!localVerdict.ok` already enforces in practice.
