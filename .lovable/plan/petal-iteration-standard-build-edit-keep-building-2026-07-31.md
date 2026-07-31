# Petal Iteration Standard — build, edit, keep building

Goal: a user can start an app and then edit it ten, twenty, fifty times in a row without hitting a dead end, a silent no-op, or a repair loop. Today the first build is strong; the *continuation* path is where Petal loses to Lovable. This plan defines the standard, then fixes the specific gaps that break it.

## The standard (what every edit turn must guarantee)

1. **One turn = one terminal state.** Every turn ends as exactly one of: `applied` (files changed), `answered` (chat only, no files claimed), `blocked` (explicit, with a next action), `failed` (error card with a retry). No turn may end claiming work it did not do.
2. **No silent no-ops.** If Petal says it changed a file, the bytes changed. Anything dropped is named in the reply.
3. **Blocked never means stuck.** A dropped op must be retried once with the reason fed back to the model before the user is told anything.
4. **Bounded self-healing.** At most 3 automatic repair units per user turn, persisted per project, never refilled by a reload.
5. **Continuity.** After every applied turn the project is buildable, previewable, and the next turn sees the exact bytes that shipped.
6. **Honest, plain-language reporting.** No raw stack traces as the primary message; the technical log is opt-in.

## What's actually broken (verified in the code)

- **Blocked ops surface to the user instead of being retried.** In `src/routes/api/generate.ts` the critic gate and the protected-path filter drop ops and then either self-heal or emit a conversational fallback. When *some* ops survive, the rejected ones are only disclosed in prose ("11 proposed changes were blocked") — the model never gets a chance to redo them correctly. That is the single biggest source of "it said it did it but it didn't".
- **Protected-path refusal is a dead end for app code.** The fallback text asks the user to rephrase. Standard 3 says: retry once with the constraint stated, then refuse.
- **Repair passes are all-or-nothing per turn.** `runAllRepairs` runs the full deterministic chain; there is no record of which pass fired for which turn, so repeated identical repairs across turns are invisible.
- **No iteration regression suite.** There are unit tests for individual repair passes, but nothing that runs a realistic *sequence* of edits against one project and asserts the standard holds.

## Changes

### 1. Op-repair round (`src/routes/api/generate.ts`)
When the critic rejects ops or the protected-path filter drops ops, and the turn is not already a retry, send one extra model round containing: the rejected ops, the exact rejection reasons, and the constraint ("do not touch these paths", "search string did not match once"). Apply the corrected ops through the same critic gate. Only after that round may rejections be disclosed to the user. Cap: one repair round per turn, reusing the existing turn budget so it cannot loop.

### 2. Honest terminal state (`src/routes/api/generate.ts`, `src/routes/builder.tsx`)
Emit an explicit `turn_outcome` SSE event (`applied | answered | blocked | failed`) with the list of paths actually mutated, computed by byte comparison — not by what the model claimed. The builder renders the reply from that event, so the "I've fixed…" sentence can never contradict a zero-diff turn.

### 3. Blocked card with a real next action (`src/components/PetalErrorCard.tsx`)
When the outcome is `blocked`, show what was blocked, why, and one button that re-sends the request with the constraint pre-applied ("do it in app code instead"). No prose dead ends.

### 4. Per-turn repair ledger (`src/server/repair-all.server.ts`)
Return which passes fired, persist them on the turn record, and suppress a pass that fired identically on the two previous turns for the same project (a sign the model keeps re-emitting the same broken shape rather than the repair being useful). Surface that to the admin pipeline view only.

### 5. Iteration regression suite (`src/server/__tests__/iteration-standard.test.ts`)
A scripted sequence against a fixture project, asserting the standard end to end:
copy edit → add a section → add a route → rename a component → delete a section → restyle → add a form with validation → re-edit the same file twice.
For each step assert: ops apply, the claimed paths equal the mutated paths, the project still parses, and no repair pass fires twice for the same reason.

## Testing mode

You drive it: build an app, then iterate normally and report anything that feels wrong. Every failure you hit gets classified against the four terminal states above, so we fix a category rather than an instance.

## Technical notes

- The op-repair round reuses the existing agent-loop budget accounting in `src/server/agent-loop.server.ts`; no new credit charge.
- `turn_outcome` is additive to the SSE stream; older clients ignore unknown event types.
- Recovery budget (`src/lib/recovery-budget.ts`, 3 units, 6h TTL, per project) stays as the ceiling for automatic repairs and is unchanged.
