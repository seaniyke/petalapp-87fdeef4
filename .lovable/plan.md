# Petal Power Pass — Roadmap

Goal: make Petal produce the most polished, deep, interactive apps of any AI
builder — without destabilising the current pipeline.

## Principle
All additions land as **additive dynamic snippets** in
`src/server/dynamic-prompts.server.ts`. No changes to the generation
orchestrator, stage pipeline, verifiers, or file-budget gates. If a snippet
misfires we can remove it in one line.

## This pass (implemented in one go)
1. **`interactivity`** — teach the model to build real client-side
   search / filter / sort / pagination with URL-synced state (not fake
   buttons). Triggers on any "list / dashboard / catalog / directory /
   table" ask.
2. **`contentDepth`** — every generated list ships with ≥ 12 realistic,
   varied items (real names, prices, dates, images from Unsplash Source
   queries — never "Item 1 / Item 2"). Kills the tell-tale AI "3 fake
   cards" default.
3. **`polishStates`** — every list / page must render loading + empty +
   error states. Every route file wraps its main content in an
   `<ErrorBoundary>` fallback. No blank screens on failure.
4. **`dashboardCraft`** — dedicated dashboard pattern: sidebar + topbar +
   real domain widgets (KPI band, activity feed, chart, table) with
   collapsible mobile drawer. Fires on any "dashboard / admin panel /
   console / workspace" ask.
5. **`perRouteSEO`** — every route.head() gets route-specific
   title / description / og:title / og:description / canonical.
   Reinforces existing head-metadata rules right when a new route
   is being scaffolded.

## Next passes (not in this turn)
- Visual QA pass: post-generation screenshot diff via Playwright, feed
  regressions back into an autofix loop.
- Archetype library: e-commerce, marketplace, social feed, LMS, community.
- Mobile parity: the same "content depth + polish states" gates for the
  Snack/RN preview flow.
- Live data seeding: on backend-connected projects, auto-insert seed rows
  after a MIGRATION so the UI has something to render immediately.
