# Make Kimble truly stop and wait when it asks

## What you reported

When Kimble asks something (your screenshot: the "Kimble's Plan" approval card), the build does not actually stop — the activity card keeps spinning ("Reading your brief", "Building…") while the question is on screen.

## What I found (verified in code)

- **Clarifying questions (chat) already stop correctly.** A "clarify" turn never reaches the build pipeline, and your next message is automatically treated as the answer. No change needed there.
- **Plan approval is broken.** The server correctly stops after proposing a plan — it emits `plan_proposed` and ends the stream. But it never sends the normal "done" signal, so the client thinks the build was *interrupted*:
  - `src/lib/stream.ts` (line ~400): a stream that ends with no result/done is treated as a dropped connection — it tries to reconnect to a server turn that doesn't exist, then throws "The build is still running, but Kimble could not reconnect…".
  - `src/routes/builder.tsx` (line ~2814): after the stream, "no result" throws a fake timeout error. So a perfectly good plan proposal can surface an error card, and the spinner/busy state never ends cleanly.
  - The plan card also renders *while* Kimble is still marked busy (`builder.tsx` line 5098 has no idle check), which is exactly the overlap in your screenshot.

## The fix

1. **Server: end plan proposals cleanly.** In the plan-first short-circuit (`src/routes/api/generate.ts` ~line 1890), emit a terminal `done` event with a new status `plan_proposed` right after the proposal, before closing the stream.
2. **Client stream layer: treat `plan_proposed` as a successful end-of-turn.** In `src/lib/stream.ts`, track that a plan was proposed; skip the reconnect attempt and the "could not reconnect" throw for that case.
3. **Builder: stop the turn, keep the card.** In `src/routes/builder.tsx`:
   - When a plan was proposed, return early after the stream — no fake "model stopped responding" error, no error card, busy/activity state cleared, persisted turn id cleared.
   - Gate the plan card so it only renders once Kimble is idle (no spinner behind it).
   - Refresh-safe: the pending plan already survives reloads via localStorage; keep that, and make sure the restored card also renders with Kimble idle.
4. **Clarifying questions: small hardening.** Fix the stale comments that claim the composer is "hard-blocked" (it isn't — typing counts as answering, which we keep), and make the pending-question gate also survive a refresh by keying off the persisted last assistant message.

## Result

Whenever Kimble asks — a quick question with answer chips, or a plan to approve — all building activity visibly stops, nothing continues in the background, and nothing resumes until you answer, approve, or skip. Works across page refreshes.

## Technical details

- Files: `src/routes/api/generate.ts`, `src/lib/stream.ts`, `src/routes/builder.tsx`, `src/lib/pending-plan.ts` (read path only).
- New SSE status `plan_proposed` on the existing `done` event; no billing impact (planning already charges nothing extra; settlement path untouched).
- Tests: extend `src/server/__tests__` with a stream-level test (plan_proposed + done ends cleanly, no resume attempted) and a builder-state test for "proposed plan ⇒ not busy, no error".
- Verify with a real turn in the preview: send an edit with Plan first, confirm the card appears, spinner stops, no error card, approve resumes the build; reload mid-proposal and confirm the card returns without any building.
