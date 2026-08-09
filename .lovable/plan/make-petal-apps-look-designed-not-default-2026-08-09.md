# Make Petal apps look designed, not default

Note: the reference image didn't come through on this message — the plan below is based on what I found in the last real Petal build (Fernly, built 17:58 UTC today). If you re-attach the screenshot I'll fold the specific sections you flagged into it.

## What I found (verified against the shipped app)

The design guidance is already extensive — a design director picks a vibe, a locked palette, a locked font pair, a section library, and motion level. The problem is that almost none of it survives into the shipped app, because nothing enforces it after the model writes code.

Concrete evidence from the Fernly build:

- `src/styles.css` declares `--font-display: "Syne"` and `--font-body: "Plus Jakarta Sans"` — but **no file anywhere loads those fonts**. No Google Fonts link in `index.html`, `src/App.tsx`, or `src/main.tsx`. The browser silently falls back to system sans. This single bug is the biggest reason every Petal app reads as "plain".
- Root cause of that: the design-taste prompt tells the model to add the font `<link>` to `src/routes/__root.tsx` — a file that **does not exist in the generated app scaffold** (generated apps are Vite SPA: `index.html` + `src/App.tsx` + `src/pages/*`). The instruction is unfollowable, so the model skips it.
- `framer-motion` appears in **zero** generated files and is not in the app's `package.json`, so the "animate the hero on mount, reveal sections on scroll, one signature moment" rules shipped as nothing.
- Interior pages (`MyPlants.tsx`) use **no kit blocks at all** — raw divs — while landing pages do. So the app degrades to unstyled boxes as soon as you leave the home page.
- The anti-sameness scan that would catch some of this is explicitly advisory: it "NEVER blocks generation", so a build with no fonts, no motion, and missing sections still ships as a success.

Multi-page: the last build **did** ship 3 pages (Home, MyPlants, CareTips), so "only landing page" is fixed for initial builds. But the route-coverage continuation only runs when `isInitial` is true — a multi-page **edit** turn has no equivalent safety net.

## What to build

### 1. Deterministic design finisher (the big one)

A new server post-processor that runs on every build after the model writes files and before verification. It doesn't ask the model to be tasteful — it makes the taste real:

- **Font loader**: read the font pair from the locked design pick (falling back to whatever `styles.css` declares), then inject `preconnect` + a Google Fonts `css2` link into the generated app's `index.html` head, and confirm `@theme` maps `--font-display`/`--font-body` so `font-display`/`font-body` utilities exist. Also apply the body font on `html, body` and the display font on `h1–h3` as a floor, so headings look designed even if the model forgot the utility classes.
- **Motion floor**: when the chosen motion level is `subtle` or higher, ensure `framer-motion` is in the app's `package.json` and the kit motion primitives are present, then apply a mount fade/rise on the hero and a scroll reveal wrapper on subsequent sections if the model shipped none.
- **Elevation/depth floor**: if the landing has zero shadows, zero gradients, and zero rounded surfaces, apply the locked-palette hero gradient + soft radial glow from the theme tokens.

### 2. Fix the instructions that can't be followed

Rewrite the design-taste and app-UI prompt blocks so file paths match the **generated app's** scaffold (`index.html`, `src/App.tsx`, `src/pages/*`), not Petal's own TanStack layout. Any instruction that names a file the scaffold doesn't have gets corrected.

### 3. Promote design from advisory to gated

Turn the anti-sameness scan into a real **design contract check** with a small set of hard failures:
- font pair declared but not loaded
- fewer than the required sections on a landing
- interior pages using no kit components / no semantic tokens
- banned clichés (purple→pink gradient, raw indigo, Lorem ipsum, hardcoded 2024)

Hard failures feed the existing bounded repair loop (one round, then ship with a visible warning) rather than silently passing. Soft findings stay advisory so we don't add build friction.

### 4. Beauty floor for interior/app screens

Extend the app-screen checklist so non-landing pages must use kit blocks, section headers, empty states, and elevated cards — and add a check that flags a page built entirely from raw `div`s with no design tokens.

### 5. Multi-page confidence

- Extend route-coverage continuation to **edit** turns, not just initial builds, using planned steps plus nav/footer link targets as the expected route set.
- Surface a "pages shipped vs pages planned" line in the build timeline so a partial build is visible rather than silent.

### 6. Verify by building

Run two real builds end to end and watch them:
1. A fresh multi-section app — confirm fonts actually load in the preview, motion runs, and every planned page exists.
2. A multi-page **edit** on that app (touching nav + 3 pages at once) — confirm all pages change in one turn.

Fix whatever surfaces during those runs.

## Technical notes

- New module `src/server/design-finisher.server.ts`, invoked from the post-generation pipeline alongside the existing hygiene passes (`layout-hygiene`, `interaction-hygiene`, `kit-dep-closure`), so it inherits their ordering and failure isolation.
- Font injection reuses the `DesignPick` from `palette-presets.server.ts` / `themes.server.ts` — no new source of truth for typography.
- Dependency additions go through `kit-dep-closure.server.ts` so `framer-motion` lands in `package.json` with the peer set already handled.
- Design contract checks emit `LocalIssue`s in the existing shape so `generation-quality-gate` and the defect judge classify them without new plumbing.
- Route coverage change is a scope widening in `src/routes/api/generate.ts` (drop the `isInitial` condition) plus expected-route derivation from the edit plan.
