# Credit-finished build pause and automatic resume

## Goal
When a user runs out of credits during a build, pause at a safe checkpoint and show a bold, accessible banner with exactly two actions:

- **Finish off** — stop the active work cleanly, keep the unfinished turn saved, and allow it to continue later.
- **Buy credits** — open the existing credit purchase flow; after payment succeeds, Petal automatically continues the same turn from its saved checkpoint.

No generated work should be lost, applied half-finished, charged twice, or restarted from the beginning.

## Experience
1. Keep the normal build progress visible until Petal reaches a safe checkpoint.
2. If the running cost is greater than the available balance, replace the working status with a prominent full-width banner explaining that the project is safe and paused.
3. **Finish off** parks the turn, clears the active spinner, and leaves a persistent “Ready to continue” state in the project conversation.
4. **Buy credits** opens Plans & Credits with the project and paused turn attached to the checkout return.
5. On successful purchase, show “Credits added — continuing your build,” return to the project, and resume automatically. This must also work if the original tab was closed.
6. If the purchased amount is still insufficient, keep the turn paused and show the remaining amount needed rather than starting and stopping again.

## Build changes

### 1. Add a durable credit-pause checkpoint
- Add an `awaiting_credits` completion state and a private, server-owned checkpoint for the validated candidate files, original request, price, project, and logical turn ID.
- Keep the candidate isolated from the live project until the turn completes.
- Add atomic claim/status operations so the browser, payment callback, and background worker cannot resume the same checkpoint twice.
- Preserve the existing project memory and original turn identity.

### 2. Pause safely before delivery and settlement
- After the initial generation and safety checks establish the actual charge, compare it with the latest wallet balance.
- When funds are short, save the checkpoint, emit a structured `credits_paused` event, and end the active stream as paused—not failed or completed.
- Do not apply files, deploy, create credit debt, or charge the user while paused.
- Keep existing pre-flight checks for users who start with no credits.

### 3. Add the bold two-action banner
- Create a dedicated credit-pause banner rather than overloading the generic error card.
- Use the existing Petal design tokens and Button component, strong contrast, clear focus states, mobile-safe layout, and an announced status message.
- Show the saved state, credits needed, and the two requested buttons only.
- Restore the banner from the server after refresh, device change, or project reopen.

### 4. Define “Finish off” as a safe park
- Mark the turn as user-deferred without deleting its checkpoint.
- Stop showing active build progress and release the local turn lock.
- Keep a single persistent conversation item that can reopen the purchase flow later.
- A newer user-requested build supersedes the parked checkpoint to prevent stale work from overwriting newer edits.

### 5. Resume after a successful purchase
- Pass a safe same-origin return path and paused-turn reference through the existing checkout flow.
- After a credit pack or plan payment is verified, atomically wake eligible paused turns for that user.
- Recheck ownership, current project version, and available credits before resuming.
- Continue from the stored candidate through final persistence, deployment, browser checks, and any free Petal repairs.
- Settle the original logical turn once using the existing idempotent turn ID, then clear the checkpoint.
- Trigger the same wake-up from both payment verification and payment webhook handling so closing the tab cannot strand the build.

### 6. Handle failure and race cases
- Payment cancelled or pending: leave the turn safely parked.
- Credits added but not enough: keep it parked and update the shortfall.
- Project changed since pause: do not overwrite it; mark the paused turn superseded and explain that the newer version was kept.
- Duplicate payment callbacks, refreshes, cron runs, and multiple tabs: one atomic claim, one settlement, one deployment.
- Resume failure: preserve the checkpoint and use the existing bounded recovery process without charging for Petal’s repairs.

## Verification
- Unit tests for pause decisions, state transitions, stale-project protection, exact-once claiming, and exact-once settlement.
- Payment tests for successful, pending, cancelled, insufficient, duplicate-callback, and closed-tab cases.
- Stream and builder tests proving paused is distinct from failed, completed, and aborted.
- Browser checks at phone, tablet, and desktop widths for banner visibility, both actions, keyboard focus, refresh restoration, checkout return, and automatic continuation.
- Regression tests confirming normal funded builds, pre-flight empty-wallet behavior, free repairs, project memory, and existing billing flows remain unchanged.

## Technical scope
This changes the generation lifecycle, durable completion state, billing return/webhook wake-up, stream event contract, and builder banner. It does not redesign the general billing screen, change prices, charge failed work, or alter unrelated Petal UI.
