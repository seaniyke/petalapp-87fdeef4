## Goal

Collapse the three independent "should Petal ask a question?" layers into **one decision point: triage**. Today the question logic is duplicated across triage, discuss, and generate — each with its own prompt rules, its own regex detectors, and its own chip synthesizer. That's why Petal feels chatty: three systems all biased toward asking, layered on top of each other.

After this change, **only triage** decides whether the turn is a question. Discuss and generate trust that decision and just execute.

---

## Target architecture

```text
user message
     │
     ▼
┌──────────────────────────────────────────┐
│  /api/triage  ← THE ONLY QUESTION GATE   │
│  Returns: mode + (if clarify) question   │
│           + suggestions (chips)          │
└──────────────────────────────────────────┘
     │
     ├── mode = "clarify"  → render question card. STOP. No discuss, no build.
     │
     ├── mode = "chat"/"explain" → /api/discuss (answer only, never asks back)
     │
     └── mode = "build"/"edit"/"fix"/"redesign" → /api/generate (just builds, never asks)
```

Triage already returns `mode`, `suggestions`, and a `reply`. We extend it to be the authoritative question source, and we strip the question-asking machinery out of discuss and generate.

---

## Changes

### 1. `src/routes/api/triage.ts` — the single gate (keep + strengthen)

- Keep the existing triage tool-call shape (`mode`, `suggestions`, `reply`, etc.).
- Rewrite `TRIAGE_SYSTEM_PROMPT` so `clarify` is a **last resort**: only when two reasonable interpretations would produce visibly different products AND no sensible default exists. Otherwise pick build/edit/fix and proceed with a stated assumption. Drop the "low confidence → clarify" guidance.
- Tighten `looksLikeBareQuestion`: a bare question now biases to `explain` (Petal answers it) instead of `clarify` (Petal asks back). Only escalate to `clarify` when the message is so short/ambiguous that no answer is possible.
- This is now the only file in the codebase that decides "is this turn a question?".

### 2. `src/routes/api/discuss.ts` — strip its question logic

- Rewrite `DISCUSS_SYSTEM_PROMPT` to forbid asking questions in this mode. Discuss runs only when triage already classified the turn as `chat`/`explain` — its job is to **answer**, not to interrogate. Hard rule: "Never end a reply with `?`. State assumptions, propose a plan, and stop. If you genuinely cannot answer without more information, say so in one sentence and stop — do not ask."
- **Delete** the `SUGGESTED-ANSWER CHIPS (MANDATORY…)` block in the prompt.
- **Delete** the server-side safety net that synthesizes chips when the reply contains `?` (lines ~273–288). With discuss no longer asking, this is dead code.
- Stop parsing the trailing ```suggestions``` fenced block — discuss won't emit one anymore. Simplify the response to `{ reply }`.
- Update `src/lib/discuss.ts` client helper to drop `suggestions` from its return type.

### 3. `src/routes/api/generate.ts` — strip its question logic

- **Delete** `detectClarifyingQuestion` (lines ~845–893) and its call site at ~2073–2109. Generate no longer second-guesses whether the model "really meant to ask" — by the time generate runs, triage has already routed clarifying turns elsewhere, so generate's job is unambiguously to ship files.
- **Delete** the `emitConversationalFallback` `suggestions` branch usage tied to that detector. Keep the helper itself if other call sites use it; remove only the question-detection caller.
- Add one short line to the build system prompt (in `src/server/generate.server.ts`): "Do NOT ask the user questions in this turn. If something is unclear, make the most reasonable assumption, state it in `summary`, and proceed. Asking is handled upstream — by the time you run, the user has committed to a build."

### 4. `src/server/answer-options.server.ts` — keep, used only by triage

- File stays. Triage may call it as a server-side safety net when the model returns `mode=clarify` with empty `suggestions` (rare, but worth keeping the guardrail). Remove its imports from `discuss.ts` and `generate.ts`.

### 5. Client routing in `src/routes/builder.tsx` — trust triage

- When triage returns `intent="clarify"`, render the question card (`SuggestionChecklist`) using `meta.suggestions` and `meta.reply` directly — do NOT call `/api/discuss` or `/api/generate` for that turn.
- When `intent="chat"`, call `/api/discuss` (will never return suggestions now).
- When `intent="build"`, call `/api/generate` (will never abort on a question now).
- Remove any client-side fallback that synthesizes chips from a generate response — generate no longer emits clarifying questions.

---

## Files

**Edit:**
- `src/routes/api/triage.ts` — prompt rewrite + downgrade tightening (single source of truth).
- `src/routes/api/discuss.ts` — strip prompt rules, strip chip parser, strip safety net, simplify response.
- `src/routes/api/generate.ts` — delete `detectClarifyingQuestion` + its call site.
- `src/server/generate.server.ts` — add one-line "do not ask" rule to the build prompt.
- `src/lib/discuss.ts` — drop `suggestions` from `DiscussResult`.
- `src/routes/builder.tsx` — route `clarify` intent to question card without hitting discuss/generate.

**Keep, unchanged:**
- `src/server/answer-options.server.ts` (now only called from triage as a safety net).
- `src/components/SuggestionChecklist.tsx` (UI is fine; it just renders whatever triage produced).

**No new files. No DB changes. No UI changes.**

---

## Out of scope

- Redesigning the question card UI.
- Touching credits, build pipeline, or the integration-suggestion chips (those are a separate system for "enable backend / payments / etc." and not user-facing questions).
- Changing the Idea Coach (separate flow, separate endpoint).

## Why this is a permanent fix

- **One decision, one place.** "Should Petal ask?" is answered exactly once per turn, by triage. Discuss and generate become pure executors.
- **No drift.** Today the three layers' prompts can disagree and each has its own regex; tightening one doesn't fix the others. After this change, tuning Petal's askiness means editing one prompt.
- **Fewer false-positive questions.** Generate's regex that aborts builds on any `?` is gone — no more "Want to see it live?" killing a deploy.
- **Cheaper.** One fewer LLM safety-net call in discuss; no second classifier pass in generate.
