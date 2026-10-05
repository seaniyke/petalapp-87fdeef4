# Execution-engine replacement roadmap
## Current frontend request
- [x] Refine the existing iOS chat and fix oval action buttons without changing generation, billing, or Cloud.
- [x] Check chat appearance and controls on phone and desktop (public/loading state; authenticated conversation not available).

- [x] Stage 1–2: ExecutionState + execution loop replaces batch page writer and router harvest (deleted `writePlannedPages`, `pagesReferencedByRouter`, `[...planned, ...fromRouter]`)
- [x] Stage 3: missing shared modules resolved inside the loop (re-run on newly written files); write-gate and late passes deleted
- [x] Stage 4: inspector AI call + module deleted; critic model review deleted (deterministic rules kept)
- [x] Stage 5: product-usefulness check merged into prd-acceptance (one acceptance authority); backend table check and feature flags stay — different jobs, not duplicates
- [x] Stage 6: reviewed — context already has one entry point (context/index); design-intel (what the project is) and design-knowledge (craft rules) are intentionally separate inputs, no merge
- [x] Stage 7: build-server syntax fixer is report-only (never rewrites verified source); callback shim and chunk-recovery rewrite already gone
- [ ] Stage 8: live benchmarks (small edit, 4-page site, medium app, hospital) — blocked on user publishing

## Webby-style engine (approved)
- [x] Stage A: tool-calling loop (read/list/search/create/edit/plan/finish), per-write validation, periodic typecheck, state-based finish, circuit breaker, tests
- [x] Stage B (first builds; edits still on patch path): wire first builds + edits to the loop; delete planFirstBuild shell scheduling, rawPageCompletion, runChunkedGeneration, swallowed catch
- [x] Readiness consolidation: finish + commit read one readiness verdict; stable-foundation model from the import graph; old step engine (agent-loop.ts) deleted
- [ ] Edits: move existing-app edits onto the tool loop (still on patch path)
- [ ] Stage C: compaction at 70%, per-call tracing (TTFT, tokens, tool/validation time) into turn_events/turn_economics
- [ ] Stage D: live benchmarks A-D, then hospital (E) only after A-D pass

## Design quality (Webby comparison)
- [x] apply.ts installs fonts into index.html for Vite SPAs (was __root.tsx-only → design system never applied to any generated app)
- [x] Substrate (house style, Geist + Newsreader, 6 accents) and Obsidian (dark editorial, Instrument Serif + Plus Jakarta Sans, 3 accents) packages installed
- [x] tokens.css ships Tailwind v4 `@theme inline` so bg-background/text-muted-foreground/font-serif actually resolve in generated apps
- [x] resolvePackageForIntent: deterministic package + accent from the brief (no AI call)
- [x] first-build brief carries DESIGN.md + COMPOSITION_RULES (section shapes, anti-monotony, rhythm) + COPY_RULES (banned AI vocabulary)
- [x] systemTextOf: every system message (incl. cache_control part arrays) reaches runToolLoop — first builds ran on "[object Object]" so no manual, skills or design contract was in live context
- [x] managedSurfaceRefusal in tool-loop: config stems (vite/tailwind/postcss/.postcssrc, any extension), package.json/tsconfig/components.json/index.html, and a second stylesheet are refused deterministically
- [x] write validation covers .css (v3 @tailwind directive, unbalanced braces), not just tsx/jsx
- [ ] Live bakery re-run vs 2m08s / 11 calls / $0.0098 / 15 files baseline — blocked on user publishing

## Billing MVP (approved 2026-09-27; spec = .lovable/plan.md)
- [x] 1 Cost capture: every AI call ACTUAL or ESTIMATED cost basis
- [x] 2 One pricer + one billing-eligibility authority
- [x] 3 SIMPLE complexity class
- [x] 4 Configurable economics (revenue/credit, margin, min charge, rounding)
- [x] 5 Reservation / release (DB)
- [x] 6 Reservation feeds runaway-cost ceiling
- [x] 7 Actual-cost settlement, no build debt, idempotent
- [x] 8 Customer credit meter (estimate / using / used)
- [x] 9 Minimal admin economics
- [x] 10 Billing regression tests, suite, typecheck, build
- [ ] 11 Live bakery benchmark billing report — needs user publish

- [x] Economic ceiling tied to reservation
- [x] Billing DB warnings fixed (5 functions server-only)
- [ ] Publish billing build + live bakery reconciliation (waiting on publish)
- [x] Pause mobile / API-backend / Chrome-extension pipelines for launch (flags off, hidden from site, never reach the engine)
- [x] Effort pricing engine (price from work, cost for margin; admin breakdown; tests)
- [ ] Six-build live benchmark suite on effort pricing — waiting on publish
- [ ] Commercial decision + Kimble Cloud Readiness Report — after the benchmark suite

## Closing the gaps (approved 2026-10-05)
- [x] P1.1 One connector model + catalog mapped over existing integrations
- [x] P1.4 Connector Hub screen grouped by category with status
- [x] P1.2 One-click sign-in flow built (signed state, encrypted tokens, popup connect)
- [ ] P1.2b Switch on Stripe Connect, Google, GitHub — blocked: needs user developer-app credentials
- [ ] P1.2c Create the saved-connections table — blocked: database unreachable right now, retry next turn
- [ ] P1.3/5/6 First one-click connectors, in-chat connect card, health monitor — after P1.2
- [ ] Phase 2 Speed, Phase 3 Coverage, Phase 4 Launch Kit
