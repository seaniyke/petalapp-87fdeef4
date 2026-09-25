# Continuous project lifecycle: exact identity for first builds and iterations

## What the audit found

What already works (we keep it):
- One request classifier already separates a first build from 10 kinds of edit and spots cross-cutting changes.
- The design package is put back on every saved version, whatever the AI wrote.
- Revision checks, refund guards, the circuit breaker, the recovery budget and the blocking/warning split in readiness are all in place.

Gaps to close:
1. **A new build has no request attached.** It only gets linked later, and only if the build service reports it back or by guessing "the most recent request on the project" (three places).
2. **Refunds can hit the wrong charge.** When nothing exact is found, the refund takes the most recent unrefunded build charge on the project from the last 6 hours.
3. **No operation identity.** Estimate, reservation, charge, build and refund are joined by timing, not by one ID. There is no record of whether something was a first build, an iteration, a fix, a design change, etc.
4. **Read-before-edit is not enforced.** The work log stops duplicate reads and no-op writes, but an existing file can be overwritten without being read first.
5. **Browser checks are not tied to the request.** The AI writes test flows from what "the app is for," so a missing "Book Now" can count against an edit that never touched booking.
6. **Every message sounds like a first build** ("Your app is ready") and never names the revision.
7. **Simple edits run the full flow:** the duplicate "understand the request" call and a full build/browser run happen even for a text change.

## What changes

### 1. One operation ID for every request
- When a request starts, it creates one operation record. That record stores the operation type (FIRST_BUILD, ITERATION, DESIGN_SYSTEM_CHANGE, DEBUG_FIX, RETRY, RECOVERY, RESTORE, UNDO, OTHER), the starting revision, the turn, and the cohort label.
- Operation type comes from the existing classifier result. No new classifier.
- The estimate, reservation, every credit charge and refund, every AI, picture, build and browser cost, and every build all carry this ID.

### 2. Exact build identity
- Each build stores the turn, operation, starting revision, build revision and attempt number from the moment it is created.
- The build service gets these values and sends them back in its callback. If they don't match the stored ones, the callback is rejected.
- Remove all three "most recent request" guesses. When the identity is missing, the build is marked "attribution unknown" instead of guessed.

### 3. Exact refunds
- The refund function takes an operation ID and refunds only charges with that ID. Remove the 6-hour "most recent charge" fallback.
- It stays idempotent: one refund per charge, enforced by the database. The existing rules stay in place: no refund after READY, for a stale revision, or once the revision has shipped.

### 4. Iteration behaves like iteration
- **Read-before-edit:** the work log refuses a write to an existing file that wasn't read this turn. New files are exempt.
- **Execution depth from the classifier:** NO_BUILD, SOURCE_VALIDATION_ONLY, BUILD, BUILD_PLUS_BROWSER or FULL_VERIFICATION. A micro edit skips the duplicate "understand" call and the full planning step. Correctness checks are not removed. Whenever the current system needs a build, it still runs.
- **Browser checks target the change:** the test planner gets the user's request, the changed files and the affected routes. A check unrelated to the request can only produce a WARNING or OBSERVATION, never a BLOCKING failure.
- **Design-system changes** go through the existing deterministic re-theme only, never through a normal AI generation.
- **Messages:** for iterations, "Updated … in revision N. Building now." and then "Revision N is ready." First builds keep their current wording.

### 5. Economics by operation and by project
- The admin economics page gets:
  - averages per operation type: cost, AI calls, cache rate, redundant, repair and refunded work
  - a project lifecycle view: iterations per project, and cumulative credits, cost, profit and margin
  - P50, P75, P90 and P95 costs
- The 10-build cohort counts build operations, not projects. It stays switched off until this work is verified.
- Free credits stay build-only (10 per day, 50 per month, enforced atomically). Iteration, fix and visual-edit operations count as builds. Anything else is rejected.

## Amendments (hardening)

1. **Operation ID is the authority, not just a label.**
   - The server creates the ID at the start of each operation. It can never be changed, and it can never move to another project, user or turn.
   - Every customer-owned money record must point to a valid operation: charge, refund, reservation, AI call, picture, build, browser check, repair, retry, deployment and settlement.
   - Background costs not tied to a customer are labelled SYSTEM or SHARED instead of being left blank.
   - A missing ID makes the write fail; it is never guessed.
   - Enforced by database foreign keys and checks, plus server checks at each write point.
2. **Four separate revisions:**
   - base: where the operation started
   - committed: the version it produced
   - build: the version that was built
   - published: the version that went live
   - The database checks they fit together, e.g. a build must equal the committed revision.
   - Settlement states: CREATED, RESERVED, EXECUTING, COMMITTED, BUILDING, VERIFYING, READY, FAILED, SETTLED, REFUNDED, CANCELLED.
   - The database only allows valid moves between states. Final states cannot be reopened, and READY can never become REFUNDED. Build and readiness progress is read from the existing build and readiness records, not copied.
3. **Execution depth can only go up.** The classifier gives the starting depth. A fixed impact check then raises it when the change touches:
   - routes, shared or imported components, packages or config
   - backend or integrations, generated code
   - code where types or runtime behaviour matter
   - an explicit request to "test it"
   - It never lowers a depth the current system requires.
4. **Credit purpose is separate from operation type.**
   - Every charge has a purpose set by the server. Free credits pay only when the purpose is BUILD.
   - A fixed allow-list maps each operation to BUILD only when it creates or builds a project revision.
   - Restore and undo count as BUILD only if they produce a new buildable revision. Unknown or future operations default to non-build.
   - The client can never choose the purpose or which credit balance pays.
5. **Outcome economics** are added to Admin → Economics next to the existing numbers:
   - cost per successful customer outcome, per operation type and per successful revision
   - failed-work cost and refunded cost
   - rates for success, customer failures, verification-only failures, infrastructure failures and stale callbacks
   - retained revenue and gross profit per successful outcome
   - per project: lifetime revenue, credits, cost, failed work, refunds, profit, margin, operation counts and average cost per successful operation
   - P50, P75, P90 and P95 for operation, successful-operation, first-build and iteration cost
   - ACTUAL, ESTIMATED, ALLOCATED and UNKNOWN costs always stay in separate columns.
6. **The AI knows which phase it is in.** The existing context builder adds a FIRST_BUILD_CONTEXT or ITERATION_CONTEXT block.
   - ITERATION_CONTEXT lists: current, build and published revision; readiness; design package and accent; requirements and memory; relevant routes, components, integrations and files; recent changes; known verification issues; operation type; execution depth.
   - It also states the rules: existing code is authoritative, preserve what works, scope the change, read before editing, and the result becomes the next revision.
   - The existing memory precedence is kept.
7. **Read-before-edit is a hard write rule.** Overwriting an existing file that wasn't read in this operation is rejected.
   - A read from an earlier operation does not count.
   - Exceptions, documented in code: new files, design-package files written by the deterministic installer, and other named system writers.
8. **Final audit traces both paths end to end:** the first build (path A) and an iteration (path B), each through every step and proof point listed in the amendments brief.
   - Anything that cannot be executed here, including database concurrency tests the environment doesn't allow, is listed as NOT RUN with the reason.

## Technical details
- Migration:
  - add an `economic_operations` table (id, user_id, project_id, turn_id, operation_type, credit_purpose, base_revision, committed_revision, build_revision, published_revision, estimated/reserved/charged/refunded credits, settlement_state with a transition-guard trigger, cohort, attribution SYSTEM/SHARED/CUSTOMER), with the required grants and RLS; `operation_id` foreign keys plus triggers that make customer-owned rows need one and forbid changing it later
  - add `operation_id` to `credit_ledger`, `cost_events`, `project_builds`, `turn_economics` and `ai_call_log`
  - add `build_attempt` and `attribution` (exact or unknown) to `project_builds`
  - rewrite `refund_build_charge(_operation_id, _build_id, _reason)`
  - add a unique index on refunds by `refund_of_ledger`
  - `spend_credit` accepts `operation_id`
- Code to change:
  - `generate.ts`: create the operation, pass the ID through
  - `trigger.ts` and the builder payload: insert the build with its identity
  - `callback.ts`: verify the identity; remove the `listEdits(…,1)` guess
  - `turn-economics.server.ts`: remove `attachBuildEconomicsByProject` and the 30-minute ledger match
  - `ledger.ts`: read-before-edit
  - `classify.ts`: return execution depth
  - `verify-plan.server.ts`: request-scoped flows with severity
  - `readinessHeadline`: iteration wording with the revision
  - `admin.economics.tsx`
- Tests: the Part 29 matrix, in a new `lifecycle-attribution.test.ts`. Database behaviour (concurrency, refund uniqueness) is tested against the real functions where possible. Anything that can't be run is reported as not run.
- The build service needs a redeploy to send the identity back. Until then, builds are shown as "attribution unknown", never guessed.
- At the end: the Part 30 forensic trace of a first build and an iteration, and the 23-point report.

## Not changing
$0.13 price, OpenRouter, cost labels, revision checks, transactions, the circuit breaker, the recovery budget, the free-credit limits. No second classifier, billing, readiness or design authority. No real customer build is run.
