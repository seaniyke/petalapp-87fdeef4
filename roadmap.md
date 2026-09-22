
- [x] Improve the existing Petal homepage using competitor references while preserving Petal identity, functionality, and honest claims.
- [x] Verify the new OpenRouter API key against DeepSeek (live 200 OK, deepseek/deepseek-v4-flash).
- [ ] Builder efficiency audit + optimisation (token telemetry gaps, utility model tier, duplicate calls, change-aware QA) — plan awaiting approval in .lovable/plan.md.
- [x] Builder efficiency: utility model tier + output cap, preflight caching, non-retrying cosmetic helpers, full token/cost telemetry.
- [x] Turn attribution on every AI call (ambient turn context) + per-turn rollup surfaced on Admin -> Economics.
- [x] Change-aware verification: build QA scoped to the routes a turn touched (verify-scope.server.ts); full sweep on first build, publish, global/large changes.
- [x] Safe editing (exact-match replace with loud failure) confirmed already in place in generate.server.ts.
- [ ] Motion personality per project + selective design-memory injection (plan phase 5).
- [ ] Before/after measurement across five real builds (plan phase 6).
