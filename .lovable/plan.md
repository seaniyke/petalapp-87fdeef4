# Petal Power Pass — Roadmap

Goal: make Petal produce the most polished, deep, interactive apps of any AI
builder across EVERY build target — web, mobile, backend, chrome extension —
without destabilising the current pipeline.

## Principle
All additions land as **additive dynamic snippets** in
`src/server/dynamic-prompts.server.ts`. No changes to the generation
orchestrator, stage pipeline, verifiers, or file-budget gates. If a snippet
misfires we can remove it in one line.

## Pass 1 — Web depth (shipped)
1. `interactivity` — real client-side search/filter/sort/pagination with URL-synced state.
2. `contentDepth` — ≥ 12 realistic varied items, real names/prices/dates, domain-relevant images.
3. `polishStates` — loading / empty / error contract on every data surface.
4. `dashboardCraft` — full sidebar + topbar + KPI band + activity feed dashboards.
5. `perRouteSEO` — per-route title/description/og on every route.head().

## Pass 2 — Non-web targets (shipped)
6. `mobileCraft` — multi-screen mobile apps with BottomTabBar, MobileHeader,
   native gestures (pull-to-refresh, swipe actions), onboarding, real
   archetype (fintech/social/productivity/health/commerce). Fires on any
   "mobile / native / iOS / Android / Expo / RN / Snack / Capacitor" ask.
7. `backendCraft` — coherent data models (3+ related tables with FKs),
   indexes on every FK, RLS + GRANTs in the same migration, security-definer
   role helpers, zod validation, seed rows in-migration, realtime/storage
   guardrails. Fires on any "backend / schema / API / RLS / migration" ask.
8. `chromeExtensionCraft` — MV3 manifest, real popup UI, background service
   worker with chrome.storage, content scripts, icons, zip packaging, blob
   download button, install instructions, host landing page. Fires on any
   "chrome/browser/edge extension / MV3 / popup / content script" ask.

## Next passes (not in this turn)
- Visual QA: post-generation screenshot diff via Playwright, autofix loop.
- Archetype library: e-commerce, marketplace, LMS, community.
- Live data seeding hooks fed back into the runtime wallet cost model.
