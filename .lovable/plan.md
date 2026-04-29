
## Goal

Stop treating "Petal builds bad code" as something to *repair*. Make the first pass correct.

## What the data says

I pulled the last 30 days of generation outcomes from `ai_call_outcomes`. Of failed verifications:

| Failure kind | Count |
|---|---|
| jsx (unbalanced tags) | 32 |
| undefined identifier | 20 |
| braces (unbalanced) | 10 |
| truncation (mid-stream cut-off) | 6 |

All four are symptoms of **one root cause**: the model is asked to emit too much code at once, with too much instruction overhead, in a single tool call — so it loses track of structure, drifts, hallucinates names, or simply runs out of completion tokens mid-file.

Layered autofixers (regex pass → flash-lite model → verifier → flash-lite model again → continuation) can recover *some* of these, but they are a band-aid. They add latency, double-charge attention, and fail when the underlying file is structurally lost.

## The real fixes (3 changes)

### 1. Shrink the prompt the model has to read every turn

Current `SYSTEM_PROMPT_INITIAL` is ~195 lines of rules + a 50-component kit catalog. Then we append: backendBlock + integrationsBlock + suggestionsBlock + knowledgeBlock + memoryBlock + designBlock + dynamic snippets + visionAddendum + the entire current project. On a 15-file patch, the system message can hit 25–40k tokens before the user prompt.

Models lose adherence to instructions buried that deep. We will:

- Split the kit catalog out of the always-on prompt. Keep only a one-line "components live in `@/components/ui/*`; here are the categories" pointer.
- Inject the **specific** kit components relevant to the user's turn via the existing `pickDynamicSnippets` mechanism (it already does keyword matching for charts/forms/router/etc.). Expand it to also pick the matching component signatures rather than re-stating them in the base prompt.
- For patch turns, switch from "dump every file's full contents" to a **manifest + on-demand** pattern: send a compact list of `path → first 200 chars` for every file, and only the FULL contents of files the user's request likely touches (heuristic match on filenames mentioned + the last-edited files). This is what Cursor/Aider do.

Expected effect: prompt size drops 60–80% on patch turns, model focus rises sharply, "undefined" errors drop because the model can actually see what it imports.

### 2. Enforce file-size caps the model consistently violates

`SYSTEM_PROMPT_PATCH` already says "no file > 6 KB / 180 LOC". The model ignores it because nothing punishes the violation. Add a deterministic split step:

- After `relayAndCollect`, before the autofixers, scan each emitted file's size. If any file exceeds 6 KB or 180 lines, run a **mandatory targeted continuation**: ask the same model to split *that specific file* into smaller modules and re-emit. This is not a "fix bugs" pass — it's a "stay under the budget" pass and it's bounded (one shot per oversized file).
- Reject the response and re-prompt once if the model emits the literal string `// ... keep existing code` or `{/* ... rest unchanged */}` (currently the prompt forbids these but they still slip through).

Expected effect: truncation errors → 0. Half of jsx/braces errors come from giant files; those drop too.

### 3. Replace the JSON-tool-call streaming with structured per-file emission

Today the model emits one giant JSON tool call where all files are nested string values. The model has to JSON-escape every quote, backslash, and newline in every file. A single mis-escape mid-stream causes the parse to fail and we throw "AI returned invalid project data."

Switch to OpenAI's parallel tool calls: define `write_file` (path, content) and `finish_project` (plan, summary, recap) as separate tools. Each file becomes its own tool invocation with its own `arguments` object — much smaller scope per call, no nested escaping, and we can validate/repair each file independently the moment it lands instead of waiting for the whole blob.

This is the single biggest win. It directly attacks truncation (each call is small enough to never get cut) and JSON-escape bugs (each file's content is an isolated string).

## What we are NOT doing

- More autofixer rounds. The current pipeline already runs up to 4 model calls on a single user turn (continuation + post-stream autofix + verifier-recovery + self-check). Adding a 5th would worsen latency without addressing the cause.
- Retrying with a stronger model on failure. The smart router already escalates; that's table stakes.

## Files to change

- `src/server/generate.server.ts` — split the kit catalog out of `SYSTEM_PROMPT_INITIAL`/`PATCH`; redefine `WRITE_PROJECT_TOOL` / `PATCH_FILES_TOOL` to use parallel per-file tools.
- `src/server/dynamic-prompts.server.ts` — expand snippets to include component signatures, not just usage rules.
- `src/routes/api/generate.ts` — change `relayAndCollect` to handle multiple parallel tool calls; add the manifest-based file context for patch turns; add the size-cap split step before existing autofixers.

## Validation

- Re-check `ai_call_outcomes` after 24 h of traffic. Targets: pass-rate >70 % (currently 0 % over the last 4 calls), avg autofix invocations <1, zero truncation kind errors.
- Smoke test: build a marketing site, a dashboard with charts, and an auth flow. Each should land first-pass with no `[verifier-recovery]` log entries.

If you approve, I'll implement these in order (1 → 2 → 3, each independently shippable).
