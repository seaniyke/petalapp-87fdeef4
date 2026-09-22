# Survive long offline gaps mid-build

## Goal

A build turn keeps going on the server no matter what the phone does — and when the phone comes back (seconds or many minutes later), the conversation picks up exactly where it left off, with no error card and no lost work.

## What already works (verified in code)

- The server runs the build independently of the connection and records every step (`turns` + `turn_events` tables).
- The server announces the turn ID as the very first stream event; the phone saves it per project (`turn-persistence.ts`).
- A resume endpoint (`/api/turns/$id/events`) replays missed events and live-tails until the turn ends, with a 25-minute ceiling and stale-turn cleanup.
- An auto-reconnect watcher re-attaches on page load and when the tab becomes visible again.
- Short blips (seconds) are already retried quietly (`retry-transient`, `resumeAcceptedTurn`).

## The three remaining gaps

1. **Drop lasts longer than ~4 seconds while the stream is open.** The reconnect gives up after three quick tries and the turn ends in a "could not reconnect" timeout card — even though the build is still running fine on the server.
2. **Nothing retries while the phone is away.** The watcher only fires on page load and tab-visible. On mobile Safari, switching from Wi-Fi to LTE (or waking the phone) often fires neither reliably, so a saved turn can sit unresumed until the user happens to reload.
3. **Drop before the first byte.** If the request itself dies before the turn ID arrives, the phone has nothing saved — the server keeps building into the void and the user sees a failure.

## Changes

### 1. Dropped stream becomes "reconnecting", never an error (when a turn ID exists)

- `src/lib/stream.ts`: when the reconnect attempts are exhausted but a turn ID is known and the failure is a network drop (reuse `isTransientNetworkError`), call a new `onReconnectDeferred(turnId)` handler and return cleanly instead of throwing.
- `src/routes/builder.tsx`: on `onReconnectDeferred`, keep the turn ID saved, keep the activity card visible in a calm waiting state ("Connection hiccup — Kimble keeps working and will pick back up automatically."), and let the watcher (below) finish the turn. No error card, no retry button, no double charge.
- A genuine server-side failure (turn row ends as failed/aborted) still surfaces normally via the resumed `done` event.

### 2. Watcher retries on its own schedule

- In the auto-reconnect effect in `builder.tsx`: also listen for the browser `online` event, and add a light interval (every ~20s while the tab is visible and a saved turn exists) that re-runs `attemptResume()`. Existing guards (skip when a send is already running in this tab) stay.
- When the resumed turn reaches its end, the existing "refresh files + messages" path already shows the finished result — unchanged.

### 3. Phone-minted turn ID (covers drops before the first byte)

- The client mints a UUID per send, saves it before the request goes out, and sends it with the request.
- `src/routes/api/generate.ts`: accept an optional client-supplied turn ID (validated UUID), use it for the turn recorder instead of generating one, and dedupe: if a turn row with that ID already exists for this user+project, attach to it instead of starting a second build. This also makes the send itself safely retryable — a retried POST can never double-charge or double-build.
- If the server never received the request (no turn row on resume), the saved ID resumes to nothing and the UI falls back to today's behaviour.

### Tests

- `stream.ts`: deferred-reconnect path calls the handler instead of throwing; non-network errors still throw; no turn ID still throws.
- `turn-persistence` / watcher logic: interval re-attempts while a saved turn exists; stops after terminal `done`.
- Server: client-supplied turn ID is used; duplicate send with the same ID attaches rather than re-runs; invalid IDs are rejected.
- Live Playwright check: start a turn, kill the network mid-stream (offline), restore after ~1 minute, confirm the conversation completes with no error card.

## Out of scope

- No changes to billing, the build pipeline itself, or the plan-approval flow.
- The existing 40-minute stale-turn ceiling stays as is.
