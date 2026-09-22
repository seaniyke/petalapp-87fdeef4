# Why the request was too big — and the actual fix

## Your question, answered

**Why did the error happen?** The model service refused the request before doing any work. Kimble couldn't tell you that, because its reader only recognises two things in a reply — words and file edits — and silently skips anything else, including a refusal. So it looked like "nothing came back", and Kimble asked the same oversized question twice more.

**Why are we sending a lot?** Because nothing stops us. Three things compound:

1. **There is no ceiling.** Kimble picks the files it thinks are relevant, then any file it considers important is explicitly exempted from the size budget. So the budget is advisory, and a request can grow without limit.
2. **It measures the wrong thing.** The budget counts characters. The model's limit is counted in a different unit entirely, and the two don't convert cleanly. Kimble has never actually checked the request against the limit it has to respect.
3. **It sends whole files to change one line.** "Add logo" pulled in the header, the sidebar, both sign-in pages, and then every file that touches any of those — each one in full. Looplane has 356 files and roughly 790,000 characters of code; a "small" edit can reach for a large fraction of it.

On top of that, the instructions Kimble sends on every single request have been growing every time I taught it something new — type pairings, icon vocabulary, header patterns, imagery rules. Each was a real improvement, and each made every request heavier.

**Should we fix it at the root?** Yes — and the root is "Kimble doesn't know how big its own request is, and sends far more than the job needs." That's what this plan fixes. Everything else was a symptom.

## The fix

### 1. Kimble measures its request before sending it
A real budget in the model's own unit, checked before every send, with a hard ceiling it cannot exceed. No exemptions — the important files get the space first, everything else fits in what's left or doesn't go. A request that can't fit gets split into two focused passes instead of being fired off and refused.

### 2. Send the part, not the whole file
To change a header link, Kimble does not need 400 lines of header. It sends the relevant region plus enough surrounding lines to edit safely, and the full file only for the one or two files it's genuinely rewriting. This is the single biggest reduction, and it makes edits more accurate too: a smaller, sharper request gets a better answer.

### 3. Stop sending instructions the job doesn't need
The design vocabulary Kimble carries — type, icons, headers, imagery, sections — already knows how to hand over only the few entries that fit a brief. That same selection gets applied to the standing instructions, so a one-line change stops carrying the full design manual.

### 4. Read the reply properly
Even with all of the above, a service will occasionally refuse. Kimble learns to recognise a refusal, say what it was, and respond to it — trim and go again for "too big", switch model for "busy" — instead of repeating itself blindly. This is the safety net, not the fix.

### 5. Make "add a logo" a direct capability
When a project has no brand mark, Kimble creates one from the app's name and colours and places it in the header, the sidebar, the sign-in screens and the site icon — one confident change.

### 6. Never end by asking you to repeat yourself
If a turn genuinely can't be completed, one plain line and one button. Not "point me at the specific element" directly after describing the exact change it was about to make.

## Not in scope

Your app's files, credits, pricing, publishing, or the design system's content.

## Technical notes

- **Confirmed refusal path.** `src/routes/api/generate.ts:791-820`: the SSE loop reads `choices[0].delta` and `usage` only. OpenRouter reports upstream failures as a 200 stream carrying `{"error": {...}}` with no `choices`; that frame hits the `continue` at line 800 and is dropped. `aiChatCompletions` branches only on `primary.status`, which is always 200 for a stream — so the fallback model can never engage. Turn `f5707db7`: three calls, 200, null usage, null error_message.
- **Unbounded prompt.** `trimFilesForPrompt` (line 394): `charLimit` is `MULTI_EDIT_CONTEXT_CHAR_LIMIT * 2` = 300k chars when anything is pinned, and line 467 skips the budget check entirely for pinned paths while `fullPaths` are never truncated. `impact-graph` adds up to 18 neighbours as pins. Add a hard token ceiling derived from the model's context window minus `completionBudget`, and make pinning a priority ordering, not an exemption.
- **Wrong unit.** Replace character budgeting with a token estimate (cheap heuristic is enough) and log estimated prompt tokens next to `files_sent` so this is measurable.
- **Region extraction.** For non-`fullPaths` files, send anchored windows from `edit-intent.server.ts` (it already computes anchor line numbers) rather than head-truncated file bodies — head truncation is also why `replace` snippets miss the tail.
- **Static prefix.** `renderDesignTasteBlock` now concatenates taste + locked + sections + headers + icons (+ fonts/illustrations). Gate each block on turn kind: targeted edits get none of it unless the change-set dimension is visual.
- **Then** the classifier: `context_overflow` | `capacity` | `schema_rejected` | `unknown`, each with a distinct next action, feeding the existing `model-kill-switch` counter with real provider errors instead of inferred no-edit turns, and a `pipeline_failures` row per refusal.
- **Logo:** extend `deterministicPatchFallback` with a brand-mark handler over `brand-identity.server.ts`, and make image generation reachable on edit turns (today `resolvePetalImagePlaceholders` runs for initial builds only).
- **Tests:** a fixture stream with an error frame must surface a classified provider error; a budget test asserting a 356-file project never exceeds the ceiling; a regression test that "add logo" on a logo-less project produces ops.
