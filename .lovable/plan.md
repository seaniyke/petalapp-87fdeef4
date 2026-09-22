# Why "Add logo" failed — and how to make simple asks stop failing

## What actually happened

I traced your exact turn (21:41, Looplane). Kimble understood the request perfectly — it even said which places the logo should go. Then it tried to produce the edit three times in nine seconds, and all three attempts came back empty. Nothing was wrong with your request, and nothing was wrong with the app.

Three separate weaknesses turned that into a dead end:

1. **All three attempts were the same attempt.** The retry and the "recovery" pass use the same model, the same instructions and the same output format as the first try. When the first one comes back empty, the next two come back empty too. Kimble looks like it's working hard; it's repeating itself.
2. **There is no last-resort path for ordinary asks.** Kimble only knows how to hand-finish two specific requests when the model fails (a hero background, and "add more sections"). Everything else — logo, colour, spacing, copy, a link — falls straight to the apology.
3. **The apology blames you.** "Point me at the specific element" is the wrong sentence when Kimble just finished describing the exact change it was going to make. It also throws away the plan it had already written.

On top of that, these empty turns aren't recorded anywhere, so this failure was invisible until you screenshotted it.

## What I'll change

### 1. Each attempt must be a different attempt
First try stays as it is. If it comes back empty:
- second attempt switches to the backup model,
- third attempt drops the strict output format entirely and asks for a plain list of changes, which Kimble then converts itself.

Three different shots instead of the same shot three times.

### 2. Use the plan Kimble already wrote
When Kimble has described the change in words but produced no edit, that description is the instruction for the next attempt — it gets handed back in, so the second try starts from a finished plan rather than from nothing.

### 3. Make "add a logo" actually work
Logo is one of the most common first asks and Kimble has no direct route for it today. It gets one: when a project has no brand mark, Kimble creates one from the app's name and palette, then places it in the header, the sidebar and the sign-in screens, with the site icon updated to match. Same treatment for the other everyday asks that currently have no safety net: colour changes, button and text edits, adding a link or a section.

### 4. Never end a turn by asking the user to repeat themselves
If all attempts genuinely fail, Kimble says so plainly, keeps its own plan visible, and offers one button to try again. It only asks a question when it truly never understood the ask — not when it did.

### 5. Count these
Empty turns get recorded internally with enough detail to see which requests and which model produced them, so this stops being a thing you discover by screenshot.

## What this does not touch

Your app's files, credits, publishing, the design system, or anything the user sees outside the builder conversation. No change to pricing or plans.

## Technical notes

- Root cause confirmed from `ai_call_log` turn `f5707db7`: `phase_router`, `structured_retry` and `tool_recovery` all returned HTTP 200 with no recorded completion tokens in 3.1s / 2.7s / 5.9s, all on `deepseek/deepseek-v4-flash`. The turn ended in `emitConversationalFallback(... reason: "no_safe_edit")` at `src/routes/api/generate.ts:3419`.
- `recoverMissingToolOutput` re-issues the same tool schema on the same model, so it cannot clear a tool-emission failure. Add model rotation on attempt 2 and a tools-free JSON pass on attempt 3, parsed through the existing `tool-args-salvage.server.ts` shape.
- Empty-body detection: treat a 200 with no tool call and no assistant text as a hard failure at the provider layer, log the raw body head and finish reason (both currently unrecorded — `ai_call_log.completion_tokens` is null for streamed generate calls).
- `deterministicPatchFallback` grows from two handlers to a small intent table (logo/brand mark, colour token change, copy edit, link, section) keyed off the change-set target, reusing `brand-identity.server.ts` for the mark and the existing image pipeline for the asset.
- Write a `pipeline_failures` row for `no_safe_edit` / `no_edit_emitted` turns; today these degrade silently and never reach the table.
- Tests: one per new recovery stage, plus a regression test that an "add logo" edit turn on a logo-less project produces ops.
