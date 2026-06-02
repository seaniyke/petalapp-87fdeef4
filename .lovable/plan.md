## Two fixes

### 1. Don't show "Add backend" (or any other CTA chip) while a question is on screen

In `src/routes/builder.tsx`, the inline suggestion chips (`EnableBackendSuggestionChip`, domain, email, payment, SEO, add-page, mobile, AI-feature, analytics, storage, realtime, cron — lines ~3486–3940) render whenever their heuristic fires on the latest assistant message. They don't check whether that same message is a **clarifying question** (the `SuggestionChecklist` poll at line 3379, which already gates the composer).

Result: the screenshot the user attached — Petal asks "Build a demo / I have provider keys / …" and right under it a red "Add backend" chip appears, fighting for the user's attention.

**Fix:** compute a single boolean once per render:

```ts
const lastMsg = messages[messages.length - 1];
const isAskingClarifyingQuestion =
  !!lastMsg &&
  lastMsg.role === "assistant" &&
  (lastMsg.suggestions?.length ?? 0) > 0 &&
  /\?\s*$/.test(sanitizeNarrative(lastMsg.content ?? "").trim().split(/(?<=[.!?])\s+/).pop() ?? "") &&
  answeredQuestionAt !== messages.length &&
  !petalIsWorking;
```

Then add `!isAskingClarifyingQuestion &&` to the render condition of every inline suggestion-chip block (backend, domain, email, payment, SEO, add-page, mobile, AI-feature, analytics, storage, realtime, cron). One line per block; mechanical change.

This preserves the rule "one thing at a time" — when there's a question, only the question (and the composer) are visible. Once the user picks an answer or hits Skip, chips can come back on the next turn.

### 2. Let Petal build crypto / banking / trading apps as polished demos (don't force a clarify stop)

In `src/lib/high-stakes-intent.ts` + `src/routes/api/triage.ts`, when a prompt matches `crypto-wallet | neobank | trading | lending | kyc-identity`, triage currently **forces** `mode = "clarify"` and ships the 4-option poll the user just complained about. But `src/routes/api/generate.ts` already has a `highStakesBlock` that, when it runs, builds a polished demo with a visible "DEMO — simulated data" notice and fake balances. We just never get there because triage stops first.

**Fix:** stop forcing clarify. Let Petal build the demo by default and only state the one-line honest caveat in the reply.

Concretely:

- **`src/lib/high-stakes-intent.ts`** — rename / repurpose `highStakesClarifyInstruction` → `highStakesBuildInstruction(domain)`. New body, per domain:

  > "HIGH-STAKES DOMAIN DETECTED ({domain}). Petal CANNOT custody real {crypto / money / trades / loans / identity} or connect to real {RPC / banking / brokerage / lender / KYC} providers. You CAN — and SHOULD — build a polished, realistic DEMO (fake balances, simulated transactions in the database, full UI). Do NOT stop to ask permission. In your one-line preamble, state the limitation honestly and mention that bringing provider keys later (e.g. Stripe, Plaid, Alchemy) can make it real. Then proceed to build."

  Drop the `Set suggestions to […]` and `Set mode = "clarify"` lines.

- **`src/routes/api/triage.ts`** (around line 348–369) — keep the detection, keep splicing the new build instruction into the system prompt so the warm preamble is honest, but **do not** force the mode. Let the existing triage classifier decide build vs clarify on its own; for clear builds like "Build me a crypto wallet exchange service", it will pick `build`.

- **`src/routes/api/generate.ts`** (line ~1706, the existing `highStakesBlock`) — no change needed. It already forces the DEMO banner, the fake balances, and the "no on-chain / banking SDK" rule. This is the safety net that keeps the demo honest without blocking the build.

Net effect:
- "Build me a crypto wallet exchange service" → Petal says one honest line ("I can't custody real crypto, so I'll ship a realistic demo — bring Alchemy/Stripe keys later to wire it up for real"), then builds it.
- The DEMO notice on the landing page + fake balances + no real on-chain SDK imports keep us honest.
- The clarify poll only fires when triage genuinely can't tell what the user wants — not as a blanket stop on whole domains.

## Technical details

Files touched:
- `src/routes/builder.tsx` — add `isAskingClarifyingQuestion` memo; gate ~12 inline suggestion-chip blocks with it.
- `src/lib/high-stakes-intent.ts` — rewrite `highStakesClarifyInstruction` → `highStakesBuildInstruction` (build-mode wording, no `mode=clarify`, no preset suggestions).
- `src/routes/api/triage.ts` — import renamed helper; keep prompt injection, drop the forced-clarify language. No other behavior changes.
- `src/routes/api/generate.ts` — update the import name; existing `highStakesBlock` semantics stay (demo banner, fake balances, banned SDK imports).

Out of scope (intentionally):
- No change to the other clarify triggers (genuine ambiguity, missing scope).
- No change to capability gating elsewhere (paid-plan, balance, etc.).
- No new tests — these are surgical edits to existing wiring.

## Out of scope / risks

- Users who genuinely want to wire real provider keys on turn 1 will now have to say so ("…with Alchemy keys", "I have Stripe Issuing"). Acceptable trade — the demo path is honest, dismissible, and one prompt away from being upgraded.
- The clarify poll for high-stakes domains disappears as a *default*. If you'd rather keep it as an opt-in (e.g. only when the user's prompt is short / vague), say so and I'll add a length-or-confidence gate before forcing the build path.