## Goal

Match Lovable's behavior end-to-end: whenever Petal asks a clarifying question, it **also** ships 2–4 concrete tap-to-pick answer options, rendered as a Lovable-style radio card (with inline "Write your own…", arrow carousel, and Skip all / Next-Review footer).

Two parts:
1. **Backend** — guarantee every clarifying question comes with answer options.
2. **Frontend** — rebuild the SuggestionChecklist card to look/behave like the screenshots.

---

## Part 1 — Backend: always emit answer options with a question

Today suggestions only appear when:
- `triage` returns `clarify` (already works), OR
- `discuss` model voluntarily emits a `` ```suggestions `` JSON block (often skipped), OR
- `generate`'s `detectClarifyingQuestion` regex finds an "A, B, or C" or yes/no pattern (most free-form questions miss this).

That's why Petal often asks "What color scheme would you like?" with zero clickable answers.

### 1a. `src/routes/api/discuss.ts` — make answer chips mandatory when asking

- Tighten `DISCUSS_SYSTEM_PROMPT`: **"If your reply contains a question mark, you MUST end with a `` ```suggestions `` JSON array of 2–4 short, distinct answer options (each ≤6 words, written as the user would say them, e.g. `"Use a dark theme"`, `"Keep it light and minimal"`). Never ask a question without options."**
- Add a server-side safety net after the model returns: if `cleanReply` contains `?` but `chipSuggestions.length === 0`, run a lightweight LLM follow-up (or a deterministic fallback that extracts noun-phrase alternatives) to fill 2–3 options. Cheapest path: a second tiny call to the same model with a 1-shot prompt — `"Given this assistant question, return 2–4 short answer options as a JSON array."` Use the existing gateway client; no new deps.
- Keep `suggestions` flowing through the existing `Response.json({ reply, suggestions })` contract — the client already renders them.

### 1b. `src/routes/api/generate.ts` — same guarantee on the build-path question detector

- In `detectClarifyingQuestion`, when a question is detected but the regex extracts 0 chips, call the same "answer-options" helper (shared util, see 1c) to synthesize 2–4 options from the question text. This runs only on the rare "question slipped through to build" path that's already discarded — but when it does, the user gets clickable answers instead of a dead card.

### 1c. New helper `src/server/answer-options.server.ts`

- Exported `synthesizeAnswerOptions(question: string, context?: { lastUserMessage?: string }) : Promise<string[]>`.
- Strategy: deterministic-first, LLM-fallback.
  - Deterministic: pull "A, B, or C" lists, "yes/no" auxiliary verbs, and "either … or …" patterns out of the question (lift the existing logic from `detectClarifyingQuestion`).
  - LLM fallback: tiny one-shot call to the cheapest model in the gateway. Cap to 4 options, ≤6 words each, dedupe, strip leading bullets/numbers.
- Used by both 1a and 1b.

### 1d. (Optional safety) `src/routes/api/triage.ts`

Already returns suggestions in `clarify` mode. No code change — just add a sentence in the prompt: **"Answer options must be tap-ready replies the user can send as-is, not topics."** Existing schema/limits stay.

---

## Part 2 — Frontend: Lovable-style question card

### 2a. Rewrite `src/components/SuggestionChecklist.tsx` (keep export name)

Render shape (matches IMG_8136 / 8137 / 8138):

```text
┌────────────────────────────────────────┐
│ {question title}                       │
├────────────────────────────────────────┤
│ ● Option one                           │  ← selected, soft tinted row
│ ○ Option two                           │
│ ○ Option three                         │
│ ○ [ Write your own…              ]    │  ← radio + inline input
├────────────────────────────────────────┤
│ ‹  ›                  Skip all  [Next] │
└────────────────────────────────────────┘
```

- State: `selectedIndex: number | null`, `customText: string`.
- **Single-select radios.** Clicking a row selects it; clicking "Write your own…" focuses the input. Typing in the input auto-selects the custom row.
- Footer:
  - `‹ ›` ghost circular buttons (disabled in single-question mode — kept for visual parity).
  - **Skip all** muted link → calls existing `onSkip`.
  - Primary pill **Next** (or **Review** when `isLast`) → calls `onSend(selectedOption ?? customText)`. Disabled until something is picked.
- Tokens only — `bg-card`, `bg-muted/50` for selected row, `bg-primary text-primary-foreground` for the pill, `text-muted-foreground` for Skip all. No raw hex.
- Keep `pending` / `answered` lock states and the Cmd/Ctrl+Enter shortcut.
- Drop the "Quick replies — tap one or keep typing" chip header. The question text becomes the card title.

### 2b. Call site `src/routes/builder.tsx` (around line 3327)

- Pass `question` derived from `m.content`: take the last sentence ending in `?`; fallback to `"Pick an option"`.
- Everything else (`options`, `onSend`, `onSkip`, `answered`) stays as-is.

---

## Out of scope

- Multi-question carousel as a real multi-step flow (still one question per assistant turn). Arrows render disabled for now so the visuals match Lovable; we can wire real multi-question later by extending the assistant-message shape to `questions: Array<{ question, options }>`.
- Composer blocking. Questions remain non-blocking per existing memory rule.
- Triage / discuss / generate orchestration logic — only the prompts and the new options-synthesizer change.

## Files touched

- `src/components/SuggestionChecklist.tsx` — full rewrite (same export).
- `src/routes/builder.tsx` — derive + pass `question` title.
- `src/routes/api/discuss.ts` — stricter prompt + post-reply safety net.
- `src/routes/api/generate.ts` — wire safety net into `detectClarifyingQuestion`.
- `src/routes/api/triage.ts` — one-line prompt tightening (optional).
- `src/server/answer-options.server.ts` — **new** shared synthesizer.
