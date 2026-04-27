# Plan: Idea Coach — help users go from "I don't know what to build" to a sharp prompt

## What we're solving

Petal's landing today asks new visitors to do the hardest thing first: type a precise app description into an empty box. Research on AI-product onboarding (NN/g, ChartMogul, a16z) shows this "blank prompt problem" is the single biggest cause of first-session churn — AI-native consumer tools retain only ~23% of revenue at this tier, and 70-80% of trial users churn within three months largely because they "don't know how to make it useful."

Petal already has two seeds of a fix: the typewriter placeholder and the `StartIdeasPanel` of 8 starter cards. But both are static — they suggest *finished* ideas. The user who arrives thinking *"I want to make something for my small business but I don't know what"* still bounces.

We're going to add a third path into the composer — **Idea Coach** — that turns ideation into a guided, two-to-four-turn conversation that ends with a populated, ready-to-send build prompt. Critically, the user never leaves the landing page, never sees a modal, and never has to re-type their answers. The output of the coach **is** the prompt that lands in the composer.

## Design principles (from the research)

1. **No new surface.** The coach lives inside the existing composer card. No modal, no separate page, no wizard. Mode selection moves into a single dropdown so the composer stays clean.
2. **Constrain the first decision.** Bora's "Gate 2: Constraint" — instead of an empty box, the first turn presents 4-6 tappable seed chips ("For my work", "For fun / hobby", "For a small business", "Surprise me") so the user picks rather than writes.
3. **Each turn produces something visible.** Not a chat log to read — a growing **prompt preview card** the user watches assemble in real time. This is the "Proof" gate.
4. **Always a one-tap escape to Build.** At any point the user sees "Looks good — build it now ↑" so they're never trapped in the conversation.
5. **Coach is paid, but cheap.** Each coach turn costs **0.5 credit**, billed *after* the AI replies (same "charge after success" pattern we just unified across `/api/discuss` and `/api/generate`). At 3-4 turns per session this is ~1.5-2 credits to go from "no idea" to "ready to build" — meaningfully cheaper than a single Build message and clearly priced as ideation.

## The mode picker — a single dropdown, not a row of pills

Today's composer has a `[Build] [Discuss]` segmented pill. Adding a third pill ("Help me think") would push the toolbar to 3 segments + camera + send and crowd the 430px viewport. Instead we replace the segmented control with a small **mode dropdown** — a single button that shows the current mode and opens a tidy popover.

```text
   ┌─────────────── composer card ───────────────┐
   │  Describe an app you want to build…         │
   │                                             │
   │                                             │
   │ [📷] [⊞ Build ▾]                      [↑]  │   ← single mode button + popover
   └─────────────────────────────────────────────┘

   tap "Build ▾" →

   ┌──── popover ────┐
   │ ⊞  Build        │  ← Generate or modify code     ✓
   │ 💬 Discuss      │  ← Chat — no file changes
   │ ✨ Help me think│  ← Brainstorm an idea (½ credit/turn)
   └─────────────────┘
```

Specifics so it feels sweet, not utilitarian:

- The trigger button keeps the active mode's icon + label and adds a small chevron. Same height/radius as today's pills so the rest of the card doesn't shift.
- The popover uses our existing `Popover` primitive (already in `src/components/ui/popover.tsx`), `bg-card`, `border-border`, `shadow-soft`, `rounded-2xl`. Items are 3 rows of `[icon] [label] [one-line hint]` with the active row marked by a small primary-coloured dot on the right.
- "Help me think" item has a tiny muted suffix `· ½ credit/turn` so pricing is honest at the moment of choice.
- Keyboard: `↑/↓` to move, `Enter` to pick, `Esc` to close. Trigger has `aria-haspopup="menu"` and `aria-expanded`.
- Selecting a mode closes the popover and immediately reshapes the composer body (textarea for Build/Discuss; coach UI for Help me think) — no second click needed.

## The user journey (mobile-first, 430px viewport)

```text
   ┌────────────────── composer card ──────────────────┐
   │  Describe an app you want to build…               │
   │                                                   │
   │ [📷] [⊞ Build ▾]                          [↑]   │
   └───────────────────────────────────────────────────┘
                         │
              user opens mode dropdown,
              picks "✨ Help me think"
                         ▼
   ┌────────────── composer card (coach) ──────────────┐
   │  What kind of thing are you in the mood to make?  │
   │                                                   │
   │  [ For my work ]  [ For a hobby ]                 │   ← chip choices
   │  [ For a side  ]  [ Surprise me ]                 │     (taps, not typing)
   │  [   biz       ]                                  │
   │                                                   │
   │  …or just tell me in your own words               │   ← still typeable
   │  [ ___________________________________ ]          │
   │ [📷] [✨ Help me think ▾]                  [↑]   │
   └───────────────────────────────────────────────────┘
                         │
                user taps "For a hobby"
                         ▼
   ┌────────────── composer card (coach) ──────────────┐
   │  ✦ Building your idea          ½ credit · turn 1   │   ← cost stays visible
   │  ┌──────────────────────────────────────────┐    │
   │  │ A hobby app — let's narrow it down       │    │   ← live preview card
   │  └──────────────────────────────────────────┘    │
   │                                                   │
   │  Pick a vibe — or describe your own:              │
   │  [ Track something ]  [ Make something ]          │
   │  [ Find something  ]  [ Share something ]         │
   │ [📷] [✨ Help me think ▾]                  [↑]   │
   └───────────────────────────────────────────────────┘
                         │
                  …2-3 more turns…
                         ▼
   ┌────────────── composer card (coach) ──────────────┐
   │  ✦ Here's your prompt                             │
   │  ┌──────────────────────────────────────────┐    │
   │  │ A minimalist running log where I tap to  │    │
   │  │ start a run, see pace + distance, and    │    │
   │  │ get a weekly streak summary. Pastel      │    │
   │  │ tones, large numerals, mobile-first.     │    │
   │  │                              [✎ tweak]   │    │
   │  └──────────────────────────────────────────┘    │
   │                                                   │
   │  [ ↻ Try a different idea ]   [ Build this ↑ ]   │   ← clear next step
   └───────────────────────────────────────────────────┘
```

When the user taps **Build this**, we drop the prompt into the existing composer textarea, switch the dropdown back to **Build**, and submit through the normal `/builder` flow. From the AI's perspective there's no difference between this and a hand-typed prompt — same credit charging, same generation pipeline.

## How it stays "part of the journey"

- **Same card, same border, same shadow.** Coach UI replaces the textarea content area in place — no slide-in panel, no overlay.
- **The starter ideas rail stays** (we just rebuilt it as the swipeable carousel) for users who already know what they want. We add a single tiny link under it: *"Not seeing what you want? Help me think →"* which simply opens the mode dropdown pre-selected on coach.
- **No "Done!" celebration screen.** The final preview prompt smoothly transitions out of the preview card and into the textarea (200ms fade + slide), then the coach UI collapses back to the normal Build composer with the prompt already populated. Same `↑` send button.
- **Coach state survives reload.** Same `sessionStorage` draft pattern that already protects the textarea — extended to include `{ coachStep, coachAnswers }` so a refresh or auth detour doesn't wipe a half-built idea.

## Builder-side touch (small but important)

Once the user lands in `/builder` with a coach-generated prompt, we pass `?source=coach` on the URL. On the first build only, the system prompt sent to `generate.ts` gets a tiny suffix: *"This prompt was assembled with the user's coach. Lean toward a clean, focused MVP rather than a kitchen-sink app — the user is more interested in seeing their idea come to life than in feature breadth."* No UI change in the builder.

## Pricing & charging

- **Cost:** 0.5 credit per coach turn. Charged *after* the AI reply succeeds (mirrors the new `/api/discuss` and `/api/generate` flow — never charge on submit, only on success).
- **Server cap:** the route hard-stops at 4 turns even if the model wants to continue, so worst-case spend per coach session is 2 credits.
- **Visibility:** the coach panel always shows `½ credit · turn N` next to the heading so cost is never a surprise. The credit badge in the header continues to live-update via the existing `useWallet` hook.
- **Insufficient credits:** server returns 402 with a friendly message ("Coach needs ½ credit to continue. Top up to keep brainstorming."), the client shows it inline in the coach panel with a "Top up" link to `/billing`. The user's progress so far is preserved.

## What we are NOT doing (intentionally)

- No separate `/ideas` route or onboarding wizard. (Bora's research: tutorials shown before users understand the tool are dismissed as ads.)
- No coach access for signed-out users — the credit charge requires a wallet, so coach mode triggers the existing auth redirect on first turn (same UX as Build).
- No persistence of coach conversations to the database. Session-only. (We're not building a chat product.)
- No replacement of the existing `StartIdeasPanel` rail or `SampleAppShowcase`. They stay and complement the coach.

---

## Technical implementation

**New files**
- `src/server/idea-coach.server.ts` — server helper `coachTurn({ history, userInput })` that calls Lovable AI Gateway (`google/gemini-3-flash-preview`) using **tool-calling for structured output** (per AI Gateway docs — never ask the model for raw JSON). Tool schema: `{ question: string, chips: string[] (2-5), assembledPrompt: string | null, isFinal: boolean }`. System prompt: "You are an idea coach for an app builder. Keep questions to one sentence. Stop after 3-4 turns by setting `isFinal: true` and producing `assembledPrompt`."
- `src/routes/api/coach.ts` — TanStack server route exposing `POST /api/coach`. Auth-required (verifies Bearer token like `/api/discuss`). Charges **0.5 credit** via the existing `chargeCredits()` helper in `src/server/credits.server.ts` *after* the AI reply succeeds, with `reason: "ai_coach_charge"` and `metadata: { route: "/api/coach", turn: N }`. Surfaces 402/429 the same way `/api/discuss` does.
- `src/components/IdeaCoach.tsx` — the in-card UI. Manages `{ step, history, preview, busy, error }` locally. Calls `/api/coach` per turn. Emits `onComplete(prompt)` upward when the user clicks **Build this**. Renders chip buttons + small text input fallback + the live preview card with `aria-live="polite"`.
- `src/components/ComposerModePicker.tsx` — the dropdown trigger + popover (built on existing `Popover` primitive). Props: `value: "build" | "discuss" | "coach"`, `onChange`, `disabled`. Items include label, icon, one-line hint, and (for coach) the `½ credit/turn` suffix.

**Edits**
- `src/server/credits.server.ts` — add `"ai_coach_charge"` to the allowed `reason` enum. Confirm fractional amounts (0.5) are supported by the existing wallet ledger (`numeric` column) — if the column is `integer`, we'll add a migration to switch to `numeric(10,2)`. Will verify against the actual schema during implementation.
- `src/routes/index.tsx` — extend `mode` union to `"build" | "discuss" | "coach"`. Replace the inline segmented `[Build][Discuss]` pills with `<ComposerModePicker />`. When `mode === "coach"`, render `<IdeaCoach />` in place of the textarea (the toolbar, attachment chips, and submit button stay). Wire `onComplete` to populate the textarea, switch mode back to `"build"`, and focus the textarea (reuses the existing logic from `StartIdeasPanel.onPick`). Extend the sessionStorage draft schema (backward-compatible reads).
- `src/components/StartIdeasPanel.tsx` — append a single small text link under the rail: *"Not seeing what you want? Help me think →"* via a new optional `onSwitchToCoach` prop.
- `src/routes/api/generate.ts` — read `source` from the request payload; if `source === "coach"` **and** it's the project's first generation, append the one-line MVP-bias hint to the system prompt. No behavioural change for non-coach prompts.
- `src/routes/builder.tsx` — read `?source=coach` from search params and pass it through to the first `/api/generate` call.

**Reused primitives** — `Popover`, `Button`, design tokens (`bg-card/90`, `border-border`, `shadow-soft`, `text-primary`, `pink/mint/lilac/sky/butter` accents, `bg-aurora`). No new colors, no new dependencies.

**Accessibility** — chips are real `<button>`s with `aria-pressed`. Mode dropdown trigger has `aria-haspopup="menu"`/`aria-expanded`. Live preview card uses `aria-live="polite"`. Reduced-motion users get instant transitions.

**Cost / safety** — `gemini-3-flash-preview` at ~3-4 turns × ~200 output tokens ≈ 800 tokens per coach session. We hard-cap at 4 turns server-side regardless of what the model returns, so the absolute worst case for a single user session is 2 credits and ~3,200 tokens.

## Rollout

Single shippable change. The only DB consideration is confirming the wallet ledger supports fractional amounts (will verify and migrate to `numeric(10,2)` if needed during implementation). No new env vars, no new secrets, no flag. We can A/B by measuring whether `?source=coach` builds have higher first-day return rate than non-coach builds, using analytics we already have.