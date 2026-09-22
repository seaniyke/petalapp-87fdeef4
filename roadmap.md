
- [x] Improve the existing Petal homepage using competitor references while preserving Petal identity, functionality, and honest claims.
- [x] Verify the new OpenRouter API key against DeepSeek (live 200 OK, deepseek/deepseek-v4-flash).
- [ ] Builder efficiency audit + optimisation (token telemetry gaps, utility model tier, duplicate calls, change-aware QA) — plan awaiting approval in .lovable/plan.md.
- [x] Builder efficiency: utility model tier + output cap, preflight caching, non-retrying cosmetic helpers, full token/cost telemetry.
- [x] Turn attribution on every AI call (ambient turn context) + per-turn rollup surfaced on Admin -> Economics.
- [x] Change-aware verification: build QA scoped to the routes a turn touched (verify-scope.server.ts); full sweep on first build, publish, global/large changes.
- [x] Safe editing (exact-match replace with loud failure) confirmed already in place in generate.server.ts.
- [x] Motion personality per project + selective design-memory injection (design direction persisted per project; full block on structural turns, compact identity-only block on small edits).
- [ ] Before/after measurement across five real builds (plan phase 6).
- [x] Token-as-billing-unit idea: dropped by user; credits stay.
- [x] System health test: 576 tests green, typecheck clean, OpenRouter/DeepSeek live 200, 6 key pages load with no console errors, build service healthy (0 queued).

- [x] Build recovery: watchdog asks the build service what it is running, refreshes progress, and recovers finished-but-unreported builds from the live deployment (verified on Looplane build 8d48201d)
- [ ] Looplane sign-in page renders nearly empty (/auth) — investigate
