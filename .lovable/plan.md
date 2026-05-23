# Question-first: never deploy when Petal is asking

## Problem

Today a single turn can both **ask a clarifying question** and **build + deploy**. The screenshot shows Petal asking "is this the in-app preview, your browser, or a deployed URL?" while also wrapping the App in a Router and shipping "Your app is live · built in 13s". That's wrong on two counts:

1. It burns credits on a guess.
2. It makes the question feel rhetorical — the user already sees a "live" stamp, so why answer?

Rule we want: **if Petal asks, Petal doesn't build. The user answers, then Petal builds and deploys.**

## Plan

### 1. Triage — bias question-shaped prompts to `clarify`

`src/routes/api/triage.ts`

- Tighten the prompt: when the user's latest message is a **question about existing state** ("why is X blank?", "is this working?", "what does Y mean?") with no explicit fix instruction ("fix it", "make it work"), pick `mode = "explain"` or `"clarify"` — never `"fix"`/`"build"`.
- Add a deterministic pre-classifier helper `looksLikeBareQuestion(text)` (regex: ends with `?`, starts with `why|what|how|is|are|can|does|do|should`, no imperative verbs). If it matches and the model still returned `fix`/`build` with `confidence < 0.7`, downgrade to `clarify` server-side before emitting `intent`.

### 2. New build-time escape hatch: `ask_question` op

`src/server/generate.server.ts`, `src/routes/api/generate.ts`

- Extend `FileOp` with a new variant `{ kind: "ask"; question: string; chips?: string[] }`. Only one allowed per turn; if present, **all sibling file ops are discarded**.
- Add a small `askQuestionBlock` to the system prompt:

  > If you genuinely need one piece of information before you can build safely, emit a single `ask` op with a one-sentence question and up to 3 short answer chips. Do NOT also emit file edits in the same turn. Use this sparingly — default is to state an assumption and proceed.

- In `applyOps`, when an `ask` op is seen:
  - skip the validator/autofix/preview steps,
  - skip the credit settlement for file work (charge only the small triage/model-input cost already taken),
  - emit a new SSE event `type: "question"` with `{ question, chips }`,
  - close the stream cleanly with `type: "result_question"` instead of `type: "result"` (no `files`, no `summary`, no `recap`).

### 3. Post-generation guard

`src/routes/api/generate.ts`

After the model returns, before we commit `nextFiles`:

- Run a tiny heuristic on `summary` + last assistant chunk: contains `?` AND a question word AND no past-tense edit verb ("added", "wrapped", "created"). If true AND no `ask` op was emitted, treat the turn as a malformed question — convert to a `result_question` with the detected question, discard the file ops, refund the build settlement.
- Log this as `recordAiOutcome({ buildStatus: "aborted_question" })` so we can see how often models violate the contract.

### 4. Client — render questions as a hard pause, not a footnote

`src/routes/builder.tsx`, `src/lib/stream.ts`

- Add handlers for `question` / `result_question` SSE events. On receipt:
  - append an assistant message with `content = question`, `suggestions = chips`,
  - set `pendingQuestion = true` for that message (already used elsewhere),
  - **do not** show `BuildActivityCard`, "Your app is live", `NextStepsCard`, or the diff summary for this turn,
  - keep the composer fully enabled (non-blocking, per existing rule) but tag the next user message with `forceBuild: true` so the answer doesn't get re-triaged into another `clarify`.
- When `result_question` arrives, ensure `setActivityVisible(false)`, `setPhases(defaultPhases())`, and no `creditsCharged` chip renders.

### 5. Wallet / credits

`src/routes/api/generate.ts`

- A `result_question` turn settles **only** the triage + question-emission cost (a few cents at most), never the build floor.
- The follow-up turn (user's answer, `forceBuild: true`) runs the full build and is charged normally.

### 6. Memory rule

`mem://index.md` Core:

> If Petal asks a clarifying question, the turn must NOT also edit files or deploy. Answer first, build second.

## Technical details

- New SSE event types: `question`, `result_question`. Backwards-compatible — older clients just ignore them and see no result, which is fine since no files were written.
- `FileOp` discriminator gains `"ask"`. AST-patch labs flag is untouched.
- The triage downgrade is deterministic and runs **before** the SSE `intent` event, so the client never flips to build mode for a bare question.
- No DB schema change. Questions ride existing `messages.suggestions` column.

## Files touched

- `src/routes/api/triage.ts` — prompt tightening + `looksLikeBareQuestion` downgrade
- `src/routes/api/generate.ts` — `ask` op handling, post-gen guard, new SSE events, credit settlement branch
- `src/server/generate.server.ts` — extend `FileOp`, prompt block, `applyOps` early-return
- `src/lib/stream.ts` — parse `question` / `result_question` events
- `src/routes/builder.tsx` — render question turns without build chrome, set `forceBuild` on the next send
- `mem://index.md` — add the rule
