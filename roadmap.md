
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
- [x] engine/provider-policy.ts as sole provider picker; avoidUpstreams/stalledUpstream plumbing + dispatch NextBit override removed
- [ ] engine stages (scope/plan/generate/validate/repair/completeness/run) + thin generate.ts route
- [x] bounded recovery table connected (retry 1, truncation 1, repair files 3, missing pages 1); second retry + 3-round page loop deleted
- [ ] delete dead recovery/retry/pipeline tier/agent loop code
- [ ] fresh Rise & Crumb smoke run through build, publish, browser check

- [x] Completeness safety gate: incomplete/failed first builds never report success or get built
- [ ] Phase 2: stage-by-stage engine replacement (scope, plan, generate, validate, repair, completeness, run) with old code deleted per stage
- [ ] Remove stale deepseek-chat-v3 setting
- [x] Completeness stage (engine/completeness.ts): one call naming all missing pages; "Contact only" page-name bug fixed
- [ ] Completeness call wrote only App.tsx in live run — find why pages weren't included
- [ ] Fold late "fill empty screens" page writer (page-completion.server) into the completeness stage and delete it
- [ ] Planning / generation / repair stage extraction with old code deleted per stage
- [ ] Rerun fresh 4-page test; then build → browser check → publish

## Phase 2 — single-owner stages
- [x] WRITE is the only page writer (plan → shell → one call per page); tidy-up and shell guard never invent pages or routers
- [x] REPAIR is one stage: write-time single-file repair (engine/repair.ts); continuation, post-write autofix, extra repair round and safety-gate repair deleted; safety gate is check-only
- [ ] Fresh 4-page smoke test (after user go-ahead) → build → browser check → publish

## Webby constraint audit (Sept 2026)
- [x] Audit of 16 capabilities against the live code; report delivered in chat
- [x] Guard fix: first-turn backend deferral removed (user intent outranks the two-phase gate)
- [x] Guard fix: file-length caps removed from the model prompts (contradicted the one-page-per-call WRITE contract and caused near-empty pages); deterministic revert still applies only to unfinished files
- [ ] Model evaluation inside the constrained architecture (next step)

## Truthful failure + OpenRouter routing (Sept 24)
- [x] Code generation uses OpenRouter native routing/failover (no `only` allow-list); known-bad providers via `ignore`
- [x] No eligible provider → typed `providers_exhausted`, never sent/re-sent; turn reports the real cause
- [x] Failed turns end the active phase (no lingering "Checking my work"); plan steps tick only when written
- [x] Check wording states what was actually checked (no "all good"/"end to end")
- [ ] Next: move the generation core onto the Railway builder (`/agent/generate`), Cloudflare as thin control layer

## Railway move (plan approved 2026-09-24)
- [x] Phase 1: signed data gateway (/api/public/agent/ops) + tests
- [~] Phase 2: AgentIO seam added; commit point (Stop checks, balance, charge, save files) routed through it. Progress events + turn close + AI call log also routed. Saved plan (blueprint) read+save routed; memory already uses the user's own sign-in. Scoped table access (db.query op + stand-in client) done. Phase 3 code done (in-process runtime, AGENT_IN_PROCESS flag). Blocked on user: OPENROUTER_API_KEY + AGENT_IN_PROCESS=1 on Railway, redeploy; then live check
- [ ] Phase 3: run core on Railway — blocked on OPENROUTER_API_KEY on Railway + redeploy
- [ ] Phase 4: switch over (AGENT_RUNTIME=railway) and live-prove

## Builder streaming UX (Sept 2026)
- [x] Stage 1–4: turn reducer (live + replay), activity story, full replay on refresh, truthful Stop
- [x] Stage 5–6: files, steps, narration, timeline moved to the reducer; duplicate builder state removed
- [ ] Later: move phases + cycle caption (entangled with publish flow) into the reducer
- [ ] Refresh after a turn finished while away: result comes from saved card, not replay
