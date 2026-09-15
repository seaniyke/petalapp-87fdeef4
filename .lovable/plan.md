# Frontend engine: audit it with real builds, then fix what's broken

This is about the engine that designs and builds **apps for Petal users** — not Petal's own interface.

## What I already confirmed by reading the code

Good news first — the foundations are real, not marketing:

- Every new app gets **one design direction decided before any code is written** (a named look, a font pairing, a palette mood, layout density, motion level, plus a few distinctive moves). It's chosen on the first build and remembered, so later changes don't drift into a different style.
- Each app also gets a **committed design system** (tokens, type scale, spacing, radii) assembled up front and re-fed into every later turn.
- After deploying, a real browser opens the app, records console/network errors, catches horizontal scrolling, and takes screenshots that a vision model reviews for overlap, clipping, unreadable text, blank heroes, cramped phone layouts and broken images. Anything it finds goes into the repair loop.

Three real problems I can already prove:

1. **The design rules are written but never enforced.** There's a finished, tested checker that compares the emitted code against the app's own design system (raw colours, stray hex values, off-system fonts, inline colour styles). It is called only from unit tests — never during a build. So the contract is decided, handed to the model, and then nobody checks the model obeyed it. This is the single biggest quality leak.
2. **Visual review is too narrow.** Only 2 pages at 2 widths (phone 390 and desktop 1440), 6 screenshots maximum. No tablet. Interior pages, signed-in screens, forms, dialogs and dashboards usually never get looked at.
3. **Nothing judges whether the result is actually good.** The reviewer is deliberately told to ignore anything subjective — it only reports things that are visibly broken. So an app that is ugly, generic or badly organised passes as "verified".

## What I'll do

### Step 1 — Prove it with real apps (no code changes)

Build four apps end to end on your account, each chosen to stress a different weakness:

- a fintech dashboard (data density, tables, hierarchy)
- a premium restaurant site (does "premium" actually change type, spacing, imagery — or just colours)
- a booking app with sign-in (interior and signed-in screens, forms, empty/loading/error states)
- a marketplace (many pages — do page 1 and page 5 share one button, one radius, one type scale)

For each: open every page at phone, tablet and desktop, capture screenshots, inspect the DOM, and record concrete defects with evidence. Deliverable: an audit document with the real pipeline map, per-stage failure analysis, and a scored list of what's broken.

### Step 2 — Fix the confirmed bugs

- **Turn the design-system checker on** for real builds and structural changes: violations feed back to the model as repair instructions before the app is called done, exactly like a console error does. Small cosmetic edits only log, so nothing gets slower or pricier for a one-line tweak.
- **Widen visual review**: add tablet, review the pages a build actually created rather than the first two, and include signed-in screens when the app has sign-in. Keep the screenshot budget under control by compressing harder rather than looking at less.
- **Add a craft judgement pass** alongside the defect pass: does this look like the design direction that was chosen, is there a clear hierarchy, does the phone layout look designed rather than shrunk, are empty/loading/error states present. It runs once per build, on screenshots already taken, and only turns into repair work when it is confident.

### Step 3 — Fix whatever the four builds expose

Root-cause fixes in the engine, not prompt patches. Re-run the same four builds afterwards and compare before/after screenshots to prove each fix landed.

## Technical notes

- Enforcement point: `lintDesignSystem` / `renderDesignLintFeedback` (`src/server/design/design-system-lint.server.ts`) wired into the post-apply repair path in `src/routes/api/generate.ts`, scoped by turn type, skipping scaffold-owned paths.
- Visual coverage: `VISUAL_DEFAULT_WIDTHS` and route selection in `builder/src/verify.ts` (currently `plan.routes.slice(0, 2)`), with the plan built from the routes the turn touched; caps stay (`VISUAL_MAX_SHOTS`, `VISUAL_MAX_BYTES`).
- Craft pass: extends `visual-qa.server.ts` / `craft-qa.server.ts` rather than adding a new service; reuses the shots already captured, so the only added cost is one vision call per build.
- No change to the build service, deployment, billing, or Petal's own UI. No pricing change.

## Cost and risk

The checker is free (no model call). The wider screenshots cost browser time, not credits. The craft pass is one extra cheap vision call per initial build — not per edit. Every new gate fails open: if it errors, the build proceeds exactly as today.

## What I need from you

Nothing blocking — I'll build the four test apps on your account and delete them afterwards. Tell me if you'd rather keep them.
