# Make Kimble feel calm, short and obvious

Right now a single build can put five separate cards in the chat (status, cost, "what changed", "what's next", suggestions), the project menu holds seventeen entries, and the home page repeats the same promise in four sections. Everything is well meant, but the user has to read a lot to learn very little.

This plan cuts what's on screen, merges things that belong together, and puts the moments that earn money where they feel like help rather than a sales pitch.

Guiding rules for every screen touched:
- One idea per card. One card per moment.
- Short lines. Say the outcome, never the machinery behind it.
- Detail is available, not displayed — tucked behind one "Details" tap.
- Never show cost breakdowns, internal step names, or how anything works under the hood.

---

## 1. One result card per build (biggest win)

Replace the stack of post-build cards with a single card:

```text
 Your app is ready                      2 credits
 Reservations page added, live now.

 [ See it live ]  [ Publish ]  [ Keep building ]
 Details ›
```

- Headline changes only with the real state: ready / needs you / stopped.
- The one-line summary replaces the current recap paragraph; the full write-up moves behind "Details".
- "Why you were charged" bullet lists go away. Just the number.
- Follow-up ideas appear as up to three short chips under "Keep building" — not their own card.
- Questions Kimble asks stay as they are (one question, chips, build waits).

## 2. One live line while it works

While building, the card shows a title, one live line and elapsed time. The multi-step rail and its internal labels come out of the main view; the step list stays under "Details" for people who want it.

## 3. A project menu you can scan

Seventeen actions become four groups with the same contents on phone and desktop:

- **Share** — share preview, publish, custom domain
- **Your app** — settings, code & files, history, visitor feedback
- **Connect** — payments, data & services, integrations
- **Grow** — search visibility, analytics, credits & plan

Rename anything a normal person wouldn't recognise (for example "SEO & AI search" becomes "Get found", "Kimble Shield" becomes "Safety check").

## 4. One place for money

The billing panel becomes three blocks instead of six: your balance, your plan, get more. Remaining credits appear in one bar with one number. Payment method, receipts and per-project usage move behind "Details".

## 5. A shorter home page

Keep the hero, the proof, how it works, pricing and one closing call to action. Fold the two "complete product" sections into one, cut repeated headlines, halve the body copy. One call to action repeated, not five different ones.

## 6. Earning moments that feel like help

- The credit count sits in one place and only speaks up when it's actually low — a single line with a one-tap top-up, never a banner stack.
- When someone publishes successfully, that's the moment the result card offers a plan upgrade (custom domain, hidden badge) in one sentence.
- Top-up amounts presented as three simple choices, most popular pre-selected.
- The "Built with Kimble" badge on free apps stays; the plan panel explains removing it in one line.
- No pricing, cost or margin explanation anywhere in the product.

## 7. One voice pass

Sweep every button, toast and empty state: sentence case, under eight words where possible, no internal vocabulary. Error text says what happened and the one thing to do next.

---

## Technical notes

- New `BuildResultCard` component replaces `CompletionStatusCard`, `BuildCostSummary` and `NextStepsCard` in the chat thread; the recap `CollapsibleSegment` folds into its Details area. The three old components are deleted once nothing renders them.
- `BuildActivityCard`: keep phase state, render only headline + `latestActivityLine` + timer; phase rail moves inside the existing details/trace area.
- `src/lib/builder-actions.ts` gains a `group` field; `BuilderActionsSheet` and the desktop menu render groups from it, so phone and desktop stay identical by construction.
- `BillingSheet` reorganised into three sections; no change to wallet, plan or checkout logic.
- Copy changes are presentation-only — no pipeline, billing or build behaviour is modified.
- Existing tests for activity language and credits stay green; add a snapshot test asserting the chat renders at most one card per completed turn.

## Not in scope

Build pipeline behaviour, credit maths, plan prices, admin screens.
