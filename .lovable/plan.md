## Goal

When Petal asks a question (assistant message has `suggestions`), the chat must show an answer card with tick-box options, the composer is hard-blocked until the user answers, and the answer is auto-sent as the user's reply. Works before AND after a build. A small "Skip question" link lets the user bypass.

## Changes

### 1. `src/components/SuggestionChecklist.tsx` — turn into a real answer form
- Add props: `freeText?: string`, `onChangeFreeText?(v)`, `onSend(text)`, `onSkip()`, `pending?: boolean`, `answered?: boolean`.
- Layout:
  - Header: "Petal needs an answer to continue".
  - Tick list (existing) — multi-select.
  - Free-text textarea below ("Add your own answer (optional)").
  - Footer: `Send answer` button (primary), `Skip question` link (subtle).
- `Send answer` is enabled when at least one tick OR free-text is non-empty.
- On send: assembles `chosen.join(", ")` + (if free-text) a newline + free-text, calls `onSend(text)`. Becomes disabled + shows "Answer sent" once `answered` is true.
- On skip: calls `onSkip()` which marks the question answered without sending.

### 2. `src/routes/builder.tsx` — wire blocking + always-on rendering

State (per-message, keyed by message id):
- `answeredQuestionIds: Set<string>` — tracks which assistant questions have been answered or skipped.
- `questionFreeText: Record<msgId, string>` — local draft per question card.

Render rule (replace current `files.length === 0` gate at line ~3275):
```
const isLastAssistant = i === messages.length - 1;
const hasQuestion = (m.suggestions?.length ?? 0) > 0;
const isAnswered = answeredQuestionIds.has(m.id);
const showChecklist = hasQuestion && isLastAssistant && !petalIsWorking && !isAnswered;
```
- Always render `<SuggestionChecklist>` when `showChecklist`, regardless of `files.length`.
- Remove the duplicate `suggestions` prop on `NextStepsCard` so post-build clarifying questions render in the checklist (not folded into NextStepsCard). Keep NextStepsCard for non-question post-build state.

Composer hard block:
- Compute `pendingQuestion = lastAssistant has suggestions && !answeredQuestionIds.has(lastAssistant.id)`.
- When `pendingQuestion`:
  - Disable composer textarea (`disabled`, lower opacity, placeholder "Answer Petal's question above to continue…").
  - Disable Send button + attachments + voice + build-target chips that submit.
  - Disable Cmd/Ctrl+Enter shortcut.
- Skip link (in the checklist footer) calls `setAnsweredQuestionIds(prev => new Set(prev).add(m.id))` to release the block without sending.

Send handler:
- `onSend(text)` from the checklist: marks the question answered, then calls the existing `handleSend(text)` path (same path the composer uses) so the answer flows through discuss/generate normally.

### 3. Update memory rule

`mem://index.md` Core line currently says the checklist "drops chosen lines into composer for editing — never auto-sends." Replace with the new contract:
> Discuss mode: when Petal asks a question, chat renders SuggestionChecklist as a required answer card (multi-select + optional free text). Composer is hard-blocked until user sends or taps Skip. On send, the answer is submitted automatically.

Also rewrite `src/components/SuggestionChecklist.tsx` header comment to match.

## Out of scope
- No changes to `/api/discuss` or `/api/generate` — they already emit `suggestions`.
- No change to the `suggestions` JSON contract in the system prompt.
- No change to NextStepsCard's preview/publish/keep-building actions (only the `suggestions` prop is removed).
