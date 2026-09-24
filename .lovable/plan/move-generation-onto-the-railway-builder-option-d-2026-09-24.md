# Move generation onto the Railway builder (Option D)

## Goal
Refresh, closing the tab or losing the connection never kills a build. Stop still stops it. One copy of the generation code, and no AI work is ever done twice.

## What changes for the user
- Refresh during a build: the page reconnects and picks up where it was ("Reconnecting — picking the build back up…"). The build never restarts.
- Stop: works as it does now. It's confirmed by the server, and nothing is charged, saved or built after it.
- Speed, cost, models, providers and output don't change.

## Approach
Run the **existing** generation code on the builder instead of copying it there. The builder bundles the same source files, so there's never a second version to keep in sync.

```text
Browser ──POST /api/generate──> Worker (thin ingress)
   │                              auth, rate limit, credit floor,
   │                              mint turnId, insert turns row,
   │                              signed POST /agent/generate ──> Railway builder
   │                                                                runs generation core
   │                                                                writes turn_events
   │                                                                saves files, charges,
   │                                                                triggers build
   └──── SSE replay of /api/turns/:id/events <──── turn_events (already exists)
```

## Phases
1. **Contract.** Add a typed `AgentJobPayload` (turnId, projectId, userId, the request body, and the headers the core reads, such as the eval header and target). The payload is HMAC-signed with the existing `BUILDER_SHARED_SECRET`.
2. **Builder runner.** Add `POST /agent/generate` (verifies the signature, replies 202, runs the job) and `POST /agent/cancel` (aborts the local controller). A new esbuild step bundles `src/server/agent-runner.ts`, which calls the existing generation core with a service-role Supabase client and a writer that records to `turn_events` only. The job shares the builder's slot limit. It sends a heartbeat to the turn row every 14s, the same timer that exists today.
3. **Thin ingress.** `/api/generate` checks the new flag, `USE_DURABLE_AGENT=1`. With the flag on, it dispatches to the builder and streams the event replay of that turn. With the flag off, it keeps today's inline path as the fallback. If the dispatch fails, the turn is marked failed and the user is told plainly.
4. **Cancel.** `requestTurnCancel` keeps the row flip it does today and also sends a signed `/agent/cancel`. The existing `assertTurnActive` and `claimTurnCommit` checks stay the authority.
5. **Crash recovery.** If the builder restarts, the turn's heartbeat stops and the existing resume job picks it up. There's no new mechanism.
6. **Remove the inline path** once live runs pass. This is a separate step after your review.

## Tests (the 10 from the brief)
- Refresh keeps the same turnId, runs one job and makes no duplicate AI calls.
- Disconnect has no effect on the job.
- Stop before commit leaves the turn aborted, with no charge, no save and no build.
- Stop after commit reports "completing".
- Events arriving after Stop are ignored.
- A failed dispatch ends the turn as failed with an honest message.
- A bad signature on either builder endpoint is rejected.
- Builder slots full: the job is queued, not dropped.
- A builder crash hands the turn to the resume job.
- With the flag off, the old path behaves exactly as today.

## Needs from you
- Railway builder env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and the AI provider keys (OpenRouter and the Lovable AI key). I'll list them exactly. You'll have to set them on Railway, because I can't reach it.
- A builder redeploy after the code lands.

## Technical notes
- The core already records every event through `turn-recorder`, so the SSE writer on the builder becomes a no-op sink.
- Worker-only APIs used by the core are audited and replaced with Node equivalents behind a small runtime shim. There are no logic changes.
- No schema changes. `committed_at`, `turns` and `turn_events` are reused.
- No live build until you ask for one.
