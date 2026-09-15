# Never lose a build — silent pick-up and finish

## Short answer to your question

No — that message is not about your internet or your browser. Builds already run entirely on Petal's servers:

- Closing the tab, locking the phone, or losing signal does **not** stop a build. The work keeps running and keeps recording every step.
- When you come back, the project silently reattaches and replays everything that happened while you were away.
- If nobody was there when the build finished, Petal writes the reply into the thread itself and even starts the publish step on its own.

What you saw was a **server-side** hiccup — Petal's own call to the AI model dropped mid-request — wearing the wrong words. It reads like your connection, and it stops there instead of just carrying on.

## The one real gap

When a request fails *during* generation (model call drops, worker restart), it's marked stopped and waits for a retry tap. The worker that picks work back up only looks at builds that already finished and failed their checks — it never sees a request that died mid-generation.

## Changes

### 1. Pick it up automatically, say nothing about it
When a request ends before finishing and the cause is transient (model/network/worker), record it as resumable — same record and same attempt budget the existing repair worker already uses — so the two-minute worker re-runs it server-side. No error card, no "connection dropped" line, no retry button. The request simply continues and completes.

While it's queued, the build keeps showing normal working progress ("Still working…"), exactly as it does during any long step.

Guardrails: reuses the existing attempt budget so it can never loop; only transient causes retry — out of credits and user cancellation are untouched and still say what they need to say; the open tab gets first refusal so nothing runs twice.

### 2. Remove the connection wording
Delete the "connection dropped / I lost my connection" phrasing from the paths that now self-recover, including the reply Petal writes when nobody is watching — that reply just reports the finished work. Wording only remains where the user genuinely has to act (no credits, they cancelled).

### 3. Only speak if it truly can't be finished
If the attempt budget is fully spent and the request still can't complete, Petal says plainly which part didn't land — no jargon, no talk of connections. That's the only case the user ever hears about.

## Technical notes

- In the stream's `finally` in `src/routes/api/generate.ts`: when the terminal status is `failed`/`aborted` and the cause classifies as transient, write a `project_turn_completion` row at stage `needs_repair` with a short `resume_after` grace window, and suppress the error event. `src/routes/api/public/cron/turn-resume.ts` plus `claimResumeAttempt` handle it unchanged.
- Wording removal in `src/routes/api/generate.ts`, `src/lib/friendly-errors.ts`, and `src/server/abandoned-turn-reply.server.ts`.
- No change to billing, deployment, the build service, or any UI layout.

## Verification

Type check plus the full suite, then a live test: start a real build, kill the browser mid-stream, confirm it completes and the reply lands; then force a model-call failure and confirm it finishes on its own with nothing shown to the user.
