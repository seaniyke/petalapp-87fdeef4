# Why "Add logo" came back empty — and how to make it just work

## The answer to your question

It didn't come back empty. It came back with an **error message that Kimble throws in the bin**.

When Kimble asks the model to do work, the reply arrives as a live stream. Sometimes the first thing in that stream isn't work — it's a refusal from the model service ("too much text at once", "busy right now", "that request shape isn't supported"). Kimble's reader only knows how to recognise two things in that stream: words and file edits. Anything else — including an explicit error — it skips over and keeps reading, reaches the end, and concludes: nothing came back.

So the turn looks like a mystery on our side: the connection succeeded, no error was recorded, and Kimble genuinely doesn't know why it got nothing. It then repeats the identical request twice more, gets the identical refusal twice more, and apologises to you.

Your turn is textbook: three requests, 3.1s / 2.7s / 5.9s, all "fine", all zero work produced.

So no — retries aren't the fix. **Reading the reply is the fix.** Once Kimble can see what the service actually said, almost every one of these turns can be completed instead of retried.

## What I'll change

### 1. Read the whole reply, not just the parts we like
Kimble's stream reader learns to recognise a refusal and capture the reason. This single change turns an invisible failure into a known one and is the precondition for everything below.

### 2. Answer the refusal instead of repeating the question
Each reason gets the right response, immediately, inside the same turn:
- **Too much at once** — Kimble sends fewer files and asks again straight away. This is the most likely cause of your turn: Looplane is a big app and "add logo" touches several files.
- **Service busy or briefly down** — wait a moment and go again, or switch to the backup model. This is the only case where trying again is the right answer.
- **Request shape rejected** — ask for a plain list of changes instead of the strict format, and Kimble converts it.

### 3. Don't let it get too big in the first place
Today Kimble decides how much to send by rough size, not by what the model can actually accept. It will measure properly before sending and keep the request inside the limit, so the "too much at once" refusal mostly stops happening rather than being recovered from.

### 4. Make "add a logo" a thing Kimble can just do
Even with all of the above, logo deserves a direct route: when a project has no brand mark, Kimble creates one from the app's name and colours and places it in the header, the sidebar, the sign-in screens and the site icon — one confident change, no guessing.

### 5. Never end by asking you to repeat yourself
If a turn truly can't be completed, Kimble says what happened in one plain line and offers one button. It will not say "point me at the specific element" right after describing exactly what it was about to do.

### 6. Make these visible to me
Refusals get recorded with their reason so this class of failure shows up on its own instead of via your screenshots.

## Not in scope

Your app's files, credits, pricing, publishing, or the design system.

## Technical notes

- Root cause confirmed at `src/routes/api/generate.ts:791-820`: the SSE loop reads `choices[0].delta` and `usage` only. OpenRouter emits upstream failures as a 200 stream carrying `{"error": {...}}` with no `choices`; that payload hits the `continue` at line 800 and is discarded. `tool.name` stays null, `tool.usage` stays null → `parseCollectedProject` finds nothing → `recoverMissingToolOutput` → `emitConversationalFallback("no_safe_edit")`.
- Telemetry corroborates (turn `f5707db7`): `phase_router`, `structured_retry`, `tool_recovery` all `status: 200`, `completion_tokens` null, `error_message` null, `fallback_used` false. `aiChatCompletions` only branches on `primary.status`, so a streamed provider error can never trigger the fallback model — that's why all three attempts were identical.
- Change 1: capture `json.error` (and a `choices: []` + no-usage terminal frame) in `relayAndCollect`; add `providerError: {code, message}` to `ParsedTool`; write it to `ai_call_log.error_message` via `updateLastCallUsage`, and record a `pipeline_failures` row.
- Change 2: classify into `context_overflow` | `capacity` | `schema_rejected` | `unknown` and branch — re-issue with a reduced `trimFilesForPrompt` budget, rotate to `fallbackModel`, or a tools-free JSON pass parsed through `tool-args-salvage.server.ts`. The existing `model-kill-switch` counter should be fed by real provider errors rather than inferred no-edit turns.
- Change 3: `trimFilesForPrompt` currently budgets on characters. Budget on estimated tokens against the configured model's context window (minus reserved output), and log the estimate alongside `files_sent`.
- Change 4: extend `deterministicPatchFallback` with a brand-mark handler reusing `brand-identity.server.ts` plus the existing image pipeline, and make image generation reachable on edit turns, not initial builds only.
- Tests: a fixture SSE stream carrying an OpenRouter error frame must surface a classified provider error rather than an empty tool; one per branch; a regression test that an "add logo" edit turn on a logo-less project produces ops.
