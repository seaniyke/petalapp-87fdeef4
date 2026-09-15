# Never lose a build to a dropped connection

## Short answer to your question

No — that message is not about your internet or your browser. Builds already run entirely on Petal's servers:

- Closing the tab, locking the phone, or losing signal does **not** stop a build. The work keeps running and keeps recording every step.
- When you come back, the open project silently reattaches and replays everything that happened while you were away.
- If nobody was there when the build finished, Petal writes the reply into the thread itself and even starts the publish step on its own.

What you actually saw is a **server-side** failure — Petal's own call to the AI provider dropped mid-request — wearing the wrong words. It says "I lost my connection" so it reads like your connection, and it's used as the catch-all wording for several unrelated internal failures.

## The one real gap

When a build fails *during* generation (provider drop, worker restart), the request is marked stopped and just waits for you to press retry. The automatic worker that picks work back up only looks at builds that already finished and failed their checks — it never sees a request that died mid-generation. So this single case does depend on the user noticing and retrying.

## Changes

### 1. Honest wording
Replace the blanket "The connection dropped while Petal was building" with wording that matches what actually happened, and never implies the user's connection is at fault. Same for the stopped-build reply written when nobody is watching.

### 2. Auto-resume a request that died mid-generation
When a request ends stopped before any files were written, record it as resumable (same record the repair worker already uses, same attempt budget) so the existing two-minute worker picks it up and re-runs it server-side. The user sees it continue on its own instead of a retry button.

Guardrails: reuses the existing attempt budget so it can never loop; only retries failures that are genuinely transient (provider/network/worker), never out-of-credits, never a user cancellation; the open tab still gets first refusal, so no double run.

### 3. Tell the user what's happening
While an interrupted request is queued for automatic retry, the chat says so plainly ("Petal's connection to the model dropped — picking it back up automatically") rather than showing a dead-end error card.

## Technical notes

- Wording lives in `src/routes/api/generate.ts` (the stream catch block), `src/lib/friendly-errors.ts`, and `src/server/abandoned-turn-reply.server.ts`.
- Resumability: in the stream's `finally`, when the terminal status is `failed`/`aborted` and the cause is classified transient, write a `project_turn_completion` row at stage `needs_repair` with a short `resume_after` grace window. `src/routes/api/public/cron/turn-resume.ts` and `claimResumeAttempt` then handle it unchanged.
- No change to billing, deployment, the build service, or any UI layout.

## Verification

Type check plus the full suite, then a live test: start a real build, kill the browser mid-stream, confirm it completes and the reply lands; then force a provider failure and confirm the automatic retry finishes it without a user tap.
