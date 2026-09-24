
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
- [x] Sign-in crash in generated apps: starter backend now exposes the same auth helpers as the dedicated one, plus a deterministic pass that rewrites calls to helpers a project's backend does not expose
- [x] Generated app tab icon now uses the app's own logo shape and primary colour instead of a fixed pink tile
- [ ] Rebuild Looplane once Kimble is published, then sign in on the live site to confirm end to end

- [x] One balance: Cloud + AI meters charge Kimble Credits directly (no cents wallet left to convert — all wallets at zero)
- [x] Kimble Compute: per-project Railway containers (project_compute, railway.server.ts, compute.server.ts, hourly meter cron, sleep/reap)
- [x] Kimble Cloud tier intelligence: resolveCloudTier picks Kimble / Kimble + / Kimble Compute from app intent + growth; recorded per project, never downgraded
- [ ] Kimble Compute needs RAILWAY_COMPUTE_PROJECT_ID, RAILWAY_COMPUTE_ENVIRONMENT_ID and a default container image before it can provision
- [x] Kimble opens its own areas from chat: kimble-surfaces.ts (surface map + deterministic detector), surface-events.ts, open_surface stream event, discuss openSurface field, owner-voice prompt block, builder openers for domains/credits/mobile/Cloud sub-views (verified live: credits, app users, domains all open)

- [x] Custom domains: certificate permission restored (Cloudflare for SaaS create/status/delete verified), routing target moved to fallback.kimble.cloud, Kimble hosts reserved, host lookup accepts kimble.cloud subdomains, edge router rebranded
- [ ] Redeploy the subdomain/custom-domain edge router from source (needs Workers permission on the account that hosts it)
- [ ] End-to-end confirm a real customer domain (needs a domain outside our Cloudflare account)

- [x] Builder truthfulness: keep targeted edits scoped to the requested files, resolve only newly-added picture placeholders, de-duplicate resumed activity, and show only real live events.
- [x] Right page, right size: small edits locked to the resolved target files (edit-boundary.server.ts), a `micro` verification tier that checks one page for real breakage only, and design lint scoped to what the turn changed.
- [x] Focused expertise: a small skill catalog (src/server/skills) chosen deterministically per request instead of loading the whole craft manual every turn.
- [x] Fast project open: the builder no longer waits on the full project source before painting — project row, conversation and draft load together, source streams in behind them, and a turn settles it before running.
- [ ] Six-scenario benchmark run: classify each result (product / infrastructure / benchmark / inconclusive)
- [ ] Explain why builds use more OpenRouter tokens (per-call breakdown from ai_call_log)

## Hardening pass (pre-benchmark, Sept 24)
- [x] Template scope: templates never add pages/routes/forms the user didn't ask for
- [x] Section scope: dynamic prompts stop mandating Stats/Testimonials/CTA
- [x] Recovery: every code repair on build model, reasoning off, ~6K budget, one attempt
- [x] First build: bounded generation units sized to requested scope
- [x] Visual QA off the critical path
- [x] Telemetry: attempt id + abandon reason on every AI call
- [x] Investigate 3-min repair gap
- [x] Tests + final path review
- [ ] Hardening items still open: whole-project tidy/typecheck of starter kit, verify-plan AI call before build start, live test of the new scope + parts rules

## Build engine replacement (approved plan, Sept 24 2026)
- [x] Gemini removed from all text/design/repair/QA paths + regression test (pictures still use Gemini image model — plan option a)
- [x] Design step reads reply once, fails cleanly
- [ ] engine/provider-policy.ts as sole provider picker; remove avoidUpstreams/stalledUpstream plumbing
- [ ] engine stages (scope/plan/generate/validate/repair/completeness/run) + thin generate.ts route
- [ ] bounded recovery table; missing-page generation once; honest incomplete messages
- [ ] delete dead recovery/retry/pipeline tier/agent loop code
- [ ] fresh Rise & Crumb smoke run through build, publish, browser check
