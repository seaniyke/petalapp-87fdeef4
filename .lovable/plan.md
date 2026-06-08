## The problem

"Make the site mobile responsive" (and any other cross-cutting ask — "improve design across pages", "fix all forms", "tighten the spacing everywhere") consistently dies with:

> I wasn't able to apply that change on this pass. Could you rephrase…

or worse, the model claims success and nothing changed. The previous turn already closed the "lying about edits" loophole (no-op gate + empty-ops gate), but it only made Petal honest about failing — it didn't make Petal succeed. That's what we have to fix now.

## Why edits fail for broad requests

Looking at `src/routes/api/generate.ts` and `src/server/generate.server.ts`, the apply pipeline has four real gaps:

1. **All-or-nothing apply.** `applyOps(currentFiles, safeOps)` is one call over the whole batch. One bad `replace` op (stale `search` snippet, ambiguous match, oversized) throws and kills the entire turn — even if 4 other ops would have applied cleanly. The "I wasn't able to apply that change" message is the all-or-nothing failure mode.

2. **Retries don't narrow scope.** `structuredRetryCompletion` re-runs the SAME big request 3 times with the SAME oversize prompt. Same model, same context, same drift → same failure. There is no fallback that says "OK, just edit ONE file at a time, give me the full file content."

3. **Target files get trimmed out of context.** `trimFilesForPrompt` drops "lower-priority" files for the prompt budget. For a cross-cutting ask, the model can't see the files it needs to edit, so its `replace.search` snippets are hallucinated and never match. We never pin the files implied by the user's intent (e.g. anything matching `*.tsx` under `src/pages` / `src/routes` when the ask is site-wide).

4. **No intent-driven decomposition.** Broad asks are sent as one giant patch. There's no "this is cross-cutting → enumerate target files first, then loop file-by-file" step. The kit handles narrow asks ("change the hero headline to X") fine; it has no plan for "make the whole site responsive."

The combination is what the user is seeing: the model writes "I updated the main app component and global styles" (the cheerful summary you saw in the screenshot), no real ops apply, the no-op gate kicks in, and Petal apologizes instead of doing the work.

## The fix (4 changes, surgical)

### 1. Per-op apply with partial success
File: `src/server/generate.server.ts` (`applyOps`)
- Wrap each op in its own try/catch.
- Collect `{appliedOps, failedOps[]}` instead of throwing on first failure.
- Caller in `generate.ts` (~line 2370) decides what to do with the failures.
- Net effect: if 4 of 5 ops worked, those 4 land and we only retry the 1 that didn't.

### 2. Per-file rewrite fallback when a `replace` fails
File: `src/routes/api/generate.ts` (replace the current retry-the-whole-batch loop around line 2377–2434)
- For each failed op, run a tightly-scoped follow-up to the model with:
  - the FULL current contents of just that one file,
  - the user's original intent,
  - instruction: "return a single `update` op with the COMPLETE new file content for `<path>`."
- This is the single most reliable recovery path — full-file rewrite of one file is the easiest thing for the model to get right.
- Cap at N=8 files per turn (covers "make the site mobile responsive" without runaway cost).

### 3. Intent-driven file pinning
File: `src/routes/api/generate.ts` (`trimFilesForPrompt` call ~line 1688) + new helper `src/server/intent-targets.server.ts`
- Detect cross-cutting intents from the user prompt (regex/keyword: "mobile", "responsive", "across", "every page", "all forms", "site-wide", "redesign", "all pages", etc.).
- When detected, force-include all `src/pages/**`, `src/routes/**`, `src/components/*.tsx` (app components, not the kit) in `filesContext`, ignoring the trim budget — raise the budget ceiling for this turn only.
- Effect: the model actually sees the bytes it needs to edit, so its `search` snippets are exact, not hallucinated.

### 4. Cross-cutting plan-then-loop
File: `src/routes/api/generate.ts` (new branch before the main patch call)
- When a cross-cutting intent is detected (same classifier as #3), do a cheap planning pass first:
  - Ask the model: "List the files you'd touch and a one-line change description for each. JSON only."
- Then run patch_files file-by-file, each with that single file's full content + the planned change. Each iteration produces ONE `update` op for one file.
- Stream per-file progress so the user sees `pages/Home.tsx → done`, `pages/About.tsx → done`, etc. (the streaming trace from the previous turn already supports this shape).
- This converts an unstable one-shot 8-file diff into 8 stable single-file rewrites.

### What we do NOT change
- Truth gates from the last turn stay. Empty-ops fallback stays. No-op detection stays. Those are correct.
- Plan Mode allow-list, protected paths, and PETAL.md globs are still enforced.
- Scaffold/kit healing and post-stream autofix are unchanged.

## Files touched

- `src/server/generate.server.ts` — `applyOps` returns `{files, applied, failed}` instead of throwing.
- `src/routes/api/generate.ts` — new failed-op rewrite loop replaces the current 3x same-prompt retry; new cross-cutting branch; intent-aware file pinning.
- `src/server/intent-targets.server.ts` — new: `detectCrossCuttingIntent(text)` + `pinFilesForIntent(intent, files)`.
- `src/server/file-budget.server.ts` — accept a `pinned: string[]` set that bypasses trimming.

## Verification

1. Reproduce: send "make the site mobile responsive" on a multi-page project. Today → "I wasn't able to apply…". After → per-file stream events, actual file diffs, no no-op fallback.
2. Send a narrow ask ("change the hero headline to X") — must still take the existing fast path, not the cross-cutting loop.
3. Force a single bad op in a 5-op batch (manual test) — confirm the other 4 land and only the bad one is retried via full-file rewrite.
4. Confirm the screen in the user's screenshot ("I wasn't able to apply that change on this pass") only appears when EVERY recovery path has failed, not as the default outcome for broad asks.

## Out of scope (call out, don't do here)
- AST-level edits behind `ast_patches` labs flag — already exist, leave them as-is.
- Visual design quality (the earlier hero-contract / design-director work) — separate concern.
- Streaming UI — handled in the prior turn.
