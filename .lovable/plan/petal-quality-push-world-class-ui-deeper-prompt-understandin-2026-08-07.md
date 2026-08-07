# Petal quality push: world-class UI + deeper prompt understanding

Two tracks, no new user-facing features. Both make what Petal already has work much harder.

## What I found in the current pipeline

- Design taste is strong **for landings only**. `design-taste.server.ts` + `section-library.server.ts` carry a locked palette, locked font pair, refused clichés and 30+ landing section variants. There is **no equivalent design language for app UI** — dashboards, CRUD tables, forms, detail views, settings, empty states. Those screens get the generic mechanics floor (`designFloor`) and nothing else, which is why app screens look plainer than landings.
- The mobile kit (`scaffold-kit-mobile.ts`) is 5 primitives: safe area, header, bottom tabs, pull-to-refresh, screen wrapper. No native-feel list rows, sheets, segmented controls, skeletons, empty states, native type scale, or motion. Mobile output therefore reads like a shrunk website.
- Quality gates today are **static text analysis only** (`frontend-quality`, `layout-hygiene`, `interaction-hygiene`, `product-principles`). Nothing ever *looks* at the built page, even though the builder already runs Playwright in `builder/src/verify.ts`.
- Understanding: `semantic-router` → `system-catalog` (large archetype catalog) → `templates` → `app-composer` produces routes + blocks. But for a CRUD/ERP brief there is **no extracted data model** — no entities, fields, relationships, roles, permissions, or workflow states. The model re-invents them mid-generation, which is where complex apps get shallow ("three fake tables and a chart").
- There is no explicit requirement checklist carried from the brief through to verification, so "you asked for 7 things, we built 4" goes unnoticed.

---

## Track A — Design quality

**A1. App-UI design language (the biggest gap).**
New `app-ui-library.server.ts`: a variant catalog for *product* screens the way `section-library` does for landings — shell variants (sidebar / rail+topbar / command-centre), data-table density and column patterns, filter bars, detail drawer vs. detail page, form layouts (single column, two-pane, stepper), empty / loading / error triads, metric cards, activity feeds, settings pages. Injected whenever the archetype is a dashboard/CRM/ERP/admin shape, alongside the same locked palette and type pair landings get.

**A2. Extend the design director to app shapes.**
`design-director.server.ts` currently commits vibe + fonts + palette. Add: shell choice, data density, radius/elevation scale, chart palette derived from the locked primary, and a "signature product moment" (e.g. inline row editing, a command palette, a sticky summary rail). Persisted to project memory like the existing direction so later turns stay consistent.

**A3. Native-feel mobile kit.**
Grow `scaffold-kit-mobile.ts` with list rows (leading icon / trailing chevron / swipe actions), bottom sheet, segmented control, native form field, skeleton list, empty state, toast, avatar row, and an iOS/Android-aware type + spacing scale. Add a mobile design block to the prompt: thumb-zone actions, 44pt targets, one primary action per screen, no desktop nav patterns, safe-area everywhere. Extend `layout-hygiene` with mobile-specific rules.

**A4. Visual QA pass (see the page, not the source).**
After the build verifies, capture screenshots at 390px and 1440px for the home route plus up to two key routes, and run a cheap vision model against a fixed rubric: overflow, collision, empty bands, contrast, type hierarchy, alignment, cramped touch targets, unstyled overlays. Findings feed the existing repair loop as defects (bounded to one extra repair round, inside the existing `turn-cost-ceiling`), and the worst ones surface in the build card. This closes the loop the text linters cannot.

**A5. Anti-sameness with memory.**
`anti-sameness.server.ts` today is thin. Record each project's chosen palette / type pair / section combination and bias the next project away from recent picks, so consecutive builds by the same user do not rhyme.

---

## Track B — Prompt understanding

**B1. Spec extraction pass (`app-spec.server.ts`).**
On the first turn of any data-shaped brief, one cheap structured call extracts a real spec: entities with fields and types, relationships, roles and permissions, workflow states and transitions, key screens per role, and reporting needs. Seeded from `domain-packs` so an "ERP" brief starts with products/warehouses/purchase orders/invoices instead of a blank page. The spec is injected into generation and persisted to project memory.

**B2. Spec drives schema and routes.**
Feed the spec into `app-composer` so routes are per-entity (list / detail / create / edit) with role-gating, and into the backend path so migrations, RLS policies and GRANTs derive from the same entity list — the existing `backend-quality` linter then has something real to check.

**B3. Requirement checklist + coverage gate.**
Decompose the brief into an explicit numbered requirement list, carry it through the turn, and verify each item at the end (route exists, component exists, CRUD wired). Unmet items become honest post-build notes instead of silent omissions, and feed the existing multi-intent rule rather than replacing it.

**B4. Sharper ambiguity handling.**
Improve `brief-expander` for *complex* briefs (today it mainly rescues vague ones): infer the missing but obvious pieces of a CRUD/ERP ask and state them as assumptions in the reply, keeping the one-question-max rule.

**B5. Edit-intent precision.**
Extend `edit-intent.server.ts` so follow-up turns on large apps resolve to the right entity/screen rather than the whole project, reducing edit creep and cost on iteration turns.

---

## Order of work

1. A1 + A2 (app-UI design language + director extension) — biggest visible jump.
2. B1 + B2 (spec extraction → routes/schema) — biggest depth jump for CRUD/ERP.
3. A3 (mobile kit).
4. A4 (visual QA loop).
5. B3 + B4 + B5, then A5.

Each step ships with tests in `src/server/__tests__/` and a clean typecheck, following the existing pass conventions.

## Technical notes

- All new passes are pure `ProjectFile[] → ProjectFile[]` or prompt-block renderers, matching the existing server module style; nothing changes the streaming contract.
- Every model-backed step (director extension, spec extraction, visual QA) is best-effort: on any failure the build proceeds unchanged, and all of them respect the existing per-turn cost ceiling.
- Visual QA reuses the Playwright runner already in `builder/src/verify.ts`; no new infrastructure.
