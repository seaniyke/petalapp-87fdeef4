
## Yes — and here's how we do it without making things worse

You asked two things: (a) make Petal genuinely capable of building real apps with very few errors, on par with the top AI builders, *without* the back-and-forth code thrash that introduces new bugs; and (b) refresh the Builder UI with premium fonts at ~14px and an iOS-style polish that feels bold, confident, and elegant.

Both are doable. The honest constraint is this: build quality is not a single switch — it's a system. The Builder UI is a focused, contained change. So I'm proposing them as two tracks that ship independently.

---

## Track A — Build quality (the real business)

**Principle: do less, but verify more.** Most regressions in AI builders come from *post-generation patching* (auto-fixers stepping on each other, retries that silently rewrite working files, "smart" routers picking the wrong tier). The fix is not more cleverness — it's a stricter contract at each step and *one* source of truth per concern.

### What I'd change, in priority order

1. **Single autofix pass, not three.** Today we have `stream-autofixer.ts`, `post-stream-autofix.server.ts`, and per-tier fixers in `pipeline/tier-*`. They overlap. I'd consolidate to: stream → one verifier → at most one targeted repair attempt → stop. No silent retries that mutate user files.

2. **Make the verifier the gatekeeper, not a suggestion.** `local-verifier.ts` already does esbuild + render-risk + RLS sanity. Today some paths bypass it. Rule: *no file write reaches the user's project unless it passed verification or is explicitly marked "user override".*

3. **Type-check parity with Lovable.** Add a tsc-noEmit pass on changed files only (incremental, ~1–2s) before commit. Catches the class of errors users hit most: bad imports, wrong props, missing exports.

4. **Stop the "smart router" from second-guessing itself.** `smart-router.server.ts` (495 lines) is where tier-mis-selection causes thrash. I'd add a *decision log* per turn (which tier, why, what evidence) so we can see — and the model can see in the next turn — why a choice was made. Reduces oscillation.

5. **Render-risk and RLS linters become hard fails on Cloud writes.** Right now they warn. For anything touching `user_roles`, RLS policies, or auth flows, a lint fail blocks the write. This is the #1 source of "it built but nothing works" complaints.

6. **A small golden-app test suite.** 8–10 reference apps (todo, blog, chat, dashboard, marketplace, auth+roles, file upload, realtime, payments stub, email send). Run nightly. Any regression in build success rate is a release blocker. This is what separates the top-5 builders from everyone else — they have these and we don't.

7. **Lovable-parity audit.** One pass through our generate prompt, scaffold kit, and examples pack to make sure naming, file layout, and conventions match what a Lovable user expects (route file conventions, `@/` imports, shadcn patterns, Cloud client usage). No surprises.

### What I'd explicitly *not* do
- No new "cleverness" layers. No new auto-fix tier. No new model router. The point is fewer moving parts, not more.
- No big-bang rewrite of the pipeline. Each item above is independently shippable and reversible.

### How we ship Track A without breaking anything
Each item lands behind a flag (`labs.strict_verifier`, `labs.single_autofix`, etc.), runs in shadow mode for ~48h emitting telemetry, then flips on. The golden-app suite is the proof.

**This is multi-week work.** I'd suggest we pick the top 2–3 items to start (I recommend #1, #2, #6) and treat the rest as a roadmap. Trying to do all seven in one pass would be the exact thrash you're warning against.

---

## Track B — Builder UI refresh (iOS-styled, premium, confident)

This one is concrete and contained. Today's Builder uses **Inter** (sans), **Fraunces** (display), **JetBrains Mono** at a `text-sm` (14px) / `text-xs` (12px) heavy mix. Headline brand is good; body in chrome and chat is too small and reads as utilitarian.

### Typography — premium, iOS-feeling
- **Body / UI:** swap **Inter** → **Inter Tight** as the primary, with **SF Pro Text** stack as the system fallback (`-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter Tight", system-ui`). On Apple devices users get real SF Pro for free — most "iOS premium" feel comes from this single decision.
- **Display / headlines:** keep **Fraunces** — it's already our brand voice. Tighten tracking at large sizes.
- **Mono:** keep **JetBrains Mono**.
- **Base size:** raise from 14px (`text-sm`) to **15px** as the *new* `text-sm`, with `text-base` at **16px**. Most Builder chrome currently uses `text-xs` (12px) — those bump to **13px**. This is the "everything got slightly bigger and more readable" feel without breaking layouts.
- **Letter-spacing:** add `-0.01em` to body, `-0.02em` to headlines (≥ text-xl). This is the single biggest "feels like iOS" tweak.
- **Line-height:** body `1.5`, UI chrome `1.4`, headlines `1.1`.
- **Weights:** standardize on 400 / 500 / 600 / 700 only. Drop ad-hoc 800/900.

### iOS-style surface polish
- **Corner radii:** raise `--radius` from `0.875rem` → `1rem` (16px). Sheets and cards go to `rounded-2xl` (20px). This alone reads as "iOS 17+".
- **Blurs:** sheet/popover backdrops gain `backdrop-blur-xl` + `bg-card/85` for the frosted-glass look.
- **Shadows:** softer, taller — `0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 32px -12px rgba(20,20,40,0.18)`.
- **Buttons:** primary CTA gets a 1px inset highlight on top + a faint gradient (subtle, not glossy). `active:scale-[0.98]` already exists in places — apply consistently.
- **Density:** chat composer, header, and sidebar get a 1–2px breathing-room bump. No new components.

### Scope of Track B
Only these files change:
- `src/styles.css` — font variables, base size, radius, shadow tokens.
- `src/routes/__root.tsx` — Google Fonts URL (add Inter Tight, drop unused weights).
- `src/routes/builder.tsx` — replace `text-xs` → `text-[13px]` and `text-sm` → `text-[15px]` in chrome only (header, composer, sidebar, file tree, command palette). Chat message body stays at 15px for readability.
- `src/components/CommandPalette.tsx`, `BuildActivityCard.tsx`, `HistoryPanel.tsx`, `BuilderActionsSheet.tsx` — same size bump.
- No component logic changes. No prop changes. Pure visual.

### Risk
Low. All changes are CSS / class swaps. Reversible per-file. I'll spot-check the mobile viewport (you're on 430px right now) since slightly larger fonts can cause wrap on dense rows — I'll tighten padding where needed.

---

## What I need from you

Two questions before I start:

1. **Track A scope for *this* session:** start with items #1 + #2 (consolidate autofix + make verifier the gatekeeper), or start with #6 (golden-app test suite) so we have a measurable baseline first? My recommendation is **#6 first** — without it we can't prove anything got better.

2. **Track B:** ship the typography + radius + blur changes now in one pass, or stage it (typography first, then surfaces)?

Once you answer, I'll switch to build mode and execute. I won't touch anything outside the agreed scope.
