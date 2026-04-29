
# Make Petal feel like Lovable — and stop confusing users

I went into the database and read the last ~40 build failures + the screenshot the user sent. The "Petal got a bit confused" card they hit is the **generic** error — it fires when nothing else matched. The real failures right now are not the ones we already fixed in Phase A–D. They're new ones. I'll fix the actual root causes AND the chat UX that made it feel hostile.

## What's actually breaking (last 7 days, real data)

1. **Truncated AI output** — 5 of the last 10 build failures are `Unterminated string literal` / `Unterminated regular expression` / `Unexpected end of file` in `App.tsx`, `main.tsx`, `AuthPage.tsx`. The model stops streaming mid-file. Our truncation recovery only fires when the local verifier flags it, and it's not catching these.
2. **Imports that don't resolve** — `date-fns` (not in package.json), `./ThemeToggle` (file never created). The Phase C "import integrity" prompt nudge isn't enough on its own.
3. **Generic "got confused" card** — when ANY of the above happen, the user sees "Something didn't go right. Want to try that again?" with no useful info and a button that just retries the same broken prompt.
4. **The screenshot itself**: top-up banner is truncated, the warning eclipses the chat, and the assistant's clarifying question got an answer ("Both combined") that should have moved the build forward but instead errored.

## Plan

### Part 1 — Stop the bleeding (build-failure causes)

1. **Truncation defense at the parser, not just the verifier.**
   In `src/routes/api/generate.ts`, after the stream finishes, run a deterministic "is this file syntactically closed?" check on every emitted file (`{`, `(`, `[`, JSX `<Tag>`, string quotes, template literals). If any file fails, force `runContinuation` for THAT file specifically — even if the verifier didn't flag a `truncation` issue. Today continuation only runs when the verifier says "truncation"; broaden it to "syntax-incomplete OR truncation".

2. **Whitelist-based npm import guard.**
   In `src/server/local-verifier.ts`, add a check: for every bare `import "x"` (not `@/...`, not `./...`), confirm `x` (or its scope root) is in scaffold `package.json`. If not, mark it as a `missing-dep` issue. Then in the post-stream autofix prompt, list the missing deps explicitly so the model either (a) removes the import, or (b) swaps for an in-tree alternative. We do NOT auto-add to package.json — that's a build-pipeline change.

3. **Sibling-file integrity check.**
   Same verifier: for every `import X from "./Foo"` or `from "@/components/Foo"`, confirm Foo exists either in the scaffold OR in the same emitted file set. If not, queue a fix instruction. This catches the `./ThemeToggle` class of failures.

4. **Lower truncation odds at the source.**
   In `SYSTEM_PROMPT_PATCH` (`src/server/generate.server.ts`), add a "FILE-LENGTH BUDGET" rule: any single file over ~6KB MUST be split into smaller modules. Big monolithic `App.tsx` files are the ones that consistently truncate.

### Part 2 — Make the chat feel like Lovable

5. **Warmer top-of-screen banner.**
   The Cloud-AI banner in the screenshot is loud, truncated, and dominates the chat. Replace the full-width yellow alert with a one-line, dismissible chip that lives ABOVE the composer (not above the chat), with copy: "Add credits to keep building — first top-up unlocks $5/mo free." The "Top up" CTA stays.

6. **Friendly clarifier handling.**
   When triage asks a clarifying question and the next user message is short ("Both combined", "Yes", "the first one"), the builder currently treats it as a fresh build prompt with no context. Patch `src/routes/builder.tsx` so when the previous assistant turn was a triage clarifier, the next short reply is folded into the original ask before being sent to `/api/generate`. This is the single biggest "Petal feels stupid" moment.

7. **Replace the generic error card with a smart one.**
   In `src/lib/friendly-errors.ts`, add specific patterns for the failure modes we now SEE in telemetry:
   - `Unterminated string|regex|Unexpected end of file` → "Petal's reply got cut off — let me try again with a smaller scope." Auto-retries with a "be concise, split files" prompt nudge (no extra credit).
   - `Could not resolve "(.+)" from` → "Petal forgot to create `<file>`. One more tap and I'll add it." Single-button targeted fix.
   - `Rollup failed to resolve import "(.+)"` (npm package) → "That feature needs a package Petal didn't include. Tap to use the built-in alternative."
   The generic fallback gets a "Show details" that's open by default with a one-line plain-English summary, not a stack trace.

8. **Lovable-style streaming chat shell.**
   The current chat bubbles are dense and dark. Tighten to match Lovable's pattern: assistant bubble has a soft surface with a thin left accent in `--primary`, user bubble is a pill on `--muted`, sender label and avatar are smaller, and the message content uses `prose-sm` markdown rendering (already in place via `MarkdownMessage` — verify `react-markdown` is wired everywhere, not just on streaming deltas).

9. **Status line under the composer.**
   Lovable shows "Ready" / "Thinking…" / "Writing 4 files…" right under the input. We have the data (`phase`, `filesWritten`, `latestPath`) but only show it inside `BuildActivityCard`. Mirror it into a small caption under the composer so the user always knows Petal's state without scrolling.

### Part 3 — Recovery, not retry

10. **One-click "fix this" on every error card.**
    Today the "Try again" button replays the EXACT user prompt verbatim. For build / parse / truncation errors that's not what the user wants — they want the LAST broken state fixed. Wire the retry button on parse/build errors to an `askPetalToFix(errorLog)` flow (we already have the function) instead of a verbatim replay.

11. **Auto-fix budget bump from 2 → 3 attempts** for syntax/truncation errors only (these have very high success on the third try in our telemetry — Phase D capped autofix to 1 round at the model level, but the build-callback retry loop is separate).

## Out of scope (call out, don't do)

- Switching default model — Phase B telemetry isn't ripe yet.
- Deploy worker timeouts (separate audit).
- Custom-domain / publishing flow polish.

## Order of operations

A → 1, 2, 3 (one PR, removes ~80% of the failures we see today)
B → 4, 6, 7, 10 (the parts the user actually feels)
C → 5, 8, 9, 11 (visual polish + safety net)

Each phase is independently shippable and individually verifiable against the telemetry views we built in Phase B.

After approval I'll start with Part 1 (build reliability), then Part 2 (chat feel), then Part 3 (recovery). Want me to proceed in that order, or front-load the visual changes (Part 2) so the user feels the difference immediately?
