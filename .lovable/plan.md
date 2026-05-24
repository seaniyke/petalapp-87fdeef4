## What's already in place (do NOT rebuild)

- 5 build targets with strong system-prompt addenda — `web`, `mobile`, `web-mobile`, `backend`, `extension` (`src/lib/build-targets.ts`).
- Target inferred from the prompt and ridden as `x-petal-target` into `/api/generate`. Chip rail intentionally removed.
- Per-target preview chrome (`DevicePreviewFrame`, phone frame, extension popup sim).
- Mobile scaffold kit (`scaffold-kit-mobile.ts`) + Snack preview path.
- Build pipeline now self-heals hallucinated UI primitives (shim added last turn) so the preview cannot go blank from a missing `ui/<x>` import.

## The actual gap

The "blank `Your app is ready` card" in your screenshot is the **scaffold's placeholder index** rendering before the model's first edit lands — that's a preview/UX bug, not a wrong-target bug. Separately, within the `web` target there is **no sub-type routing**: a "landing page" and a "CRM dashboard" both get the same generic web prompt, so the model defaults to whatever it feels like, which often reads as app-shell-y on mobile viewports.

We fix this in three sequenced phases. Phase 1 alone resolves the screenshot.

## Phase 1 — Web sub-type router (Marketing / App / Fullstack)

1. New module `src/lib/web-subtype.ts`:
   - Type `WebSubtype = "marketing" | "app" | "fullstack"`.
   - `inferWebSubtype(prompt)` — keyword + phrase heuristics ("landing page", "portfolio", "waitlist", "homepage" → marketing; "dashboard", "CRM", "admin", "SaaS tool", "analytics" → app; "marketplace", "platform", "with auth + payments" → fullstack).
   - Per-subtype system-prompt addendum block. Marketing block forbids sidebars/auth shells and mandates hero + features + testimonials + pricing + FAQ + footer with marketing typography. App block mandates app shell + sidebar + tables/forms, forbids giant hero. Fullstack inherits app + adds auth/db/payments guidance.

2. Wire into `src/routes/api/generate.ts` right after `buildTarget` resolution: when target is `web`, compute subtype, append the subtype block to `buildTargetBlock`. Log the detection so we can tune heuristics.

3. Stretch (same phase): when the subtype is `marketing`, swap the initial index placeholder copy from "Your app is ready" to "Generating your landing page…" with a skeleton hero. Pure UX fix in `DevicePreviewFrame` blank-state, no pipeline change.

## Phase 2 — Pre-generation "Build Blueprint" surface

Add a lightweight blueprint that the model echoes back BEFORE files:

1. New helper in `generate.server.ts` that prefixes the model output with a one-screen blueprint block: `{ projectType, sections, navigation, designLanguage, backend, files }`. Server parses + persists to a new `project_blueprints` table (or column on `projects`) so subsequent turns stay consistent.
2. Reuse this blueprint to seed the design tokens (fonts, palette presets from memory) deterministically instead of letting the model re-pick each turn.

## Phase 3 — Generation quality gate (auto-repair)

Tier-2 verifier check after the model returns:

1. If subtype = `marketing` and the file tree contains `Sidebar`, `DashboardLayout`, or auth route files → flag, regenerate just the index+layout with a corrective prompt.
2. If subtype = `app` and the index file is a single hero section with no nav → flag, regenerate shell.
3. Runs inside the existing `runLocalVerifyTier` + `postStreamAutofix` loop so the user never sees a mismatched first render.

## Out of scope for this batch (handle in follow-ups)

- Chrome-extension scaffold kit (target exists, scaffold doesn't — separate ticket).
- Multi-platform "Build Uber" decomposition into `mobile/` + `src/` + `packages/shared/` (the `web-mobile` target already declares this shape; needs its own scaffold kit).
- Snack/Expo preview mode toggle on the existing mobile preview.

## Why this order

Phase 1 ships the visible win (landing prompts → marketing layout) in one focused change set against files I already know. Phase 2/3 require schema work and verifier changes that are safer once Phase 1 is proven in production. Trying to land all 11 sections of the prompt at once would touch every server-side file in the generate pipeline simultaneously — high regression risk on a live system.

## Technical surface (Phase 1 only)

- New: `src/lib/web-subtype.ts` (~80 lines, pure functions + addenda).
- Edit: `src/routes/api/generate.ts` — ~15 lines around the `buildTargetBlock` assembly.
- Edit: `src/components/DevicePreviewFrame.tsx` (or scaffold's blank index) — copy + skeleton swap.
- Test: extend `src/server/__tests__/pipeline.test.ts` with subtype inference fixtures.
- Zero schema changes, zero migrations, fully reversible.

Approve and I'll implement Phase 1 immediately. Say "all phases" and I'll sequence 1 → 2 → 3 across the next turns.
