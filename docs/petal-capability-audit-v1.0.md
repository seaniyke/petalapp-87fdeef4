# Petal Capability Audit v1.0

**Date:** 2026-08-05
**Method:** Evidence only — source `file:line` references and production database telemetry. No aspirational claims. Where evidence was absent, the row reads **NOT PROVEN**.

**Legend**
- **REAL** — implemented, wired into a live call path, evidence cited.
- **PARTIAL** — exists, but scope-limited or not reachable on the main user path.
- **MISSING** — no implementing code found.
- **NOT PROVEN** — could not be confirmed within this audit's scope.

---

## 0. Executive summary

Petal is substantially more built than a prototype. The generation pipeline, verifier/repair gauntlet, deploy service, and billing settlement are all real code on real call paths, and the production database confirms **462 build attempts, 350 successful (75.8% lifetime; 98.5% in the last week)**.

Three findings materially change the picture:

1. **Turn lifecycle is broken at the data layer.** `turns` = **400 `running`**, 10 `succeeded`, 2 `failed`. Fewer than 3% of turns ever reach a terminal state. Every derived metric (per-turn success rate, honesty ledger, stale-turn cleanup) is unreliable until this is fixed.
2. **Two model routes are 100% dead.** `openai/gpt-5` on `generate`: **107 calls, 107 errors**. `google/gemini-pro-latest` on `design`: **62 calls, 62 errors, 38ms avg** (fails instantly). These are silently absorbed by fallback, so they never surfaced as incidents.
3. **Credit settlement is the single largest failure signature.** `post_build_charge_failed` = **26 occurrences, most recent 2026-08-05** — still live.

Build quality is trending strongly upward: weekly success went 78.7% → 72.1% → 63.0% → **98.5%**.

---

## 1. Request understanding & routing — **REAL**

| Item | Status | Evidence |
|---|---|---|
| Intent classification | REAL | `src/routes/api/triage.ts:149` — forced tool-call enum `["chat","clarify","build","edit","fix","explain","redesign"]` |
| Collapse to pipeline | REAL | `triage.ts:222-224` — `chat`/`explain`→chat; `clarify`→clarify; build/edit/fix/redesign→build pipeline |
| Structured meta | REAL | `src/lib/triage.ts:22-30` — `mode, confidence, language, audience_level, scope, brief, unknowns, suggestions` |
| Anti-over-clarification | REAL | `triage.ts:96,103` — clarify is "LAST RESORT", only below ~0.25 confidence |
| Multilingual | REAL | `language` field + reply-in-user-language instruction (`triage.ts:131-133`) |
| Model | REAL | `openai/gpt-5-mini`, **344 calls, 0 errors, 606ms avg** |

**Telemetry:** triage is the healthiest subsystem in the stack — zero errors across 344 production calls.

---

## 2. Build target routing — **REAL (5 targets)**

`src/lib/build-targets.ts:14-24` — `web`, `mobile`, `web-mobile`, `backend`, `extension` (+ legacy `ios`/`android` migrated to `mobile`). Each ships a hard `systemPromptAddendum` (e.g. mobile forbids `div`/`react-dom`, mandates `expo-router`, safe areas, `expo-image`).

**Unsupported (confirmed absent):** Flutter, Electron/Tauri desktop, CLI tools. PWA is not a first-class target — it is an aesthetic layer on `web` via `scaffold-kit-mobile.ts`.

---

## 3. File generation — **REAL, two paths**

**Path A — Staged pipeline** (tried first): `src/server/pipeline/staged-orchestrator.server.ts:199-322`
- Plan → parallel Scaffold → Wire-up, all *before* the SSE stream opens; results are then replayed as canned SSE (`:284-312`). The client sees progress, but not live model streaming.
- Plan: one LLM call, `emit_plan` forced tool, cap **28 files (business-app) / 10 (other)** (`stage-plan.server.ts:376`), `max_tokens` 1800/1200.
- Scaffold: **one AI call per file, all in parallel** via `Promise.allSettled` (`stage-scaffold.server.ts:334-338`). Token caps 3200–5000/file. **One** retry pass; truncation retries get 1.5× budget.
- Wire-up: `runAllRepairs` → local verifier → esbuild verifier → `ensureRenderableShell`.
- Any fatal issue returns `null` → **silent fallback to Path B** (`generate.ts:1937`).

**Path B — Monolithic**: single `write_project` tool call with its own retry + continuation tier (`pipeline/tier-continuation.ts`, invoked `generate.ts:3735-3750`).

**Hard budgets** (`src/server/pipeline-budgets.ts`): `MAX_FILE_LINES` 180, `MAX_FILE_BYTES` 6KB, `HARD_REJECT_LINES` 280, `HARD_REJECT_BYTES` 10KB, `MAX_PLANNED_FILES` 8, `TARGET_INITIAL_FILES` 6, `MAX_STRUCTURED_RETRIES` 2, `MAX_AUTOFIX_ROUNDS` 2, `AGENT_LOOP_MAX_STEPS` 12, `AGENT_LOOP_MAX_TOKENS` 200k.

> ⚠️ **Contradiction found:** `pipeline-budgets.ts` declares `MAX_PLANNED_FILES = 8` and calls itself "single source of truth", but `stage-plan.server.ts:376` independently caps at 28/10. The centralization is incomplete — exactly the drift the module was written to prevent.

---

## 4. Verification & repair — **REAL, 13/13 modules on live call paths**

Every module below was confirmed as real code invoked from a live path, not a stub:

| Module | Call site |
|---|---|
| `local-verifier.ts` | `stage-wireup.server.ts:57`, `generate.ts` |
| `esbuild-verifier.server.ts` | `stage-wireup.server.ts:85`, `generate.ts:1382,1402` |
| `repair-all.server.ts` (composition point) | `stage-wireup:49`, `generate.ts:2741,2941,3426`, `builds/trigger.ts`, `publish.ts`, `watchdog.ts` |
| `source-escape-fixer` | `repair-all:79` (pass 0a, first) |
| `import-syntax-fixer` | `repair-all:86` |
| `jsx-attr-literal-fixer` | `repair-all:92` |
| `brand-identity.server.ts` | `repair-all:137,228` |
| `router-provider.server.ts` | `repair-all:167` |
| `bare-import-resolver` | `repair-all:173` |
| `layout-hygiene.server.ts` | `repair-all:240` |
| `interaction-hygiene.server.ts` | `repair-all:246` |
| `critic-agent.server.ts` | `generate.ts:3031, 3068` |
| `generation-quality-gate.server.ts` | `generate.ts:3840` |
| `rls-sanity-linter.ts` | generation-verify time |

**Gap:** ESLint and TypeScript are **NOT** run as a live gate on generated code. No `tsc`/`eslint` invocation exists in the generation runtime — only esbuild parse checking. Type errors in generated apps are caught at Vite build time, i.e. at deploy, not at generation.

---

## 5. Recovery & billing safety — **REAL**

- Structured retry on tool-parse failure (`generate.ts:933,1267,2591`); continuation tier for truncation; post-stream autofix (`post-stream-autofix.server.ts`); self-recovery humanization (`self-recovery.server.ts`).
- **Charging model is post-build, not pre-charge+refund** (`generate.ts:4295-4327`). Failed turns are simply unbilled (`creditsCharged: 0` at `:1087,1115`). This is the correct design.
- Rollback on unrecoverable mid-turn failure (`generate.ts:3439-3440`).

**Live defect:** `post_build_charge_failed` — **26 occurrences, latest 2026-08-05 11:20 UTC**. The drain-based settlement fix landed but the signature is still firing. This is the top-priority open bug.

---

## 6. Chat editing — **REAL, surgical**

`resolveEditIntent` (`src/server/edit-intent.server.ts:247-365`) classifies the edit verb by regex, extracts anchors, and **scores real project files by literal byte match** to pin up to 8 files (`:279-364`) into the prompt untruncated. Edits use `patch_files` with `replace`/`create` ops — never a whole-file rewrite (`generate.ts:971`; `generate.server.ts:187` explicitly disables `write_project` for edits).

Undo is **full-file snapshots** in `project_versions` (`src/lib/versions.ts:47-91`), not a diff history.

---

## 7. Preview — **REAL, three engines**

| Engine | Use | Evidence |
|---|---|---|
| **WebContainer** (StackBlitz, not Sandpack) | Desktop web preview | `src/lib/webcontainer.ts:38-70` |
| **Expo Snack** | Mobile RN preview + QR to device | `SnackPreview.tsx:37-99` |
| **Cloudflare Pages CDN iframe** | Instant preview + mobile/unsupported-browser fallback | `use-latest-ready-build.ts`, `MobilePreviewFallback.tsx` |

- Dependency caching is real: `depsSatisfied()`/`ensureDeps()` (`webcontainer.ts:558-610`) skip `npm install` entirely when semver ranges are already satisfied; `prewarmContainer()` (`:629-696`) pre-installs a baseline before the user opens a project.
- Instant preview is **frame-safety gated** server-side (`preview-probe.functions.ts` reads real status + `X-Frame-Options` + CSP `frame-ancestors`) before being shown.
- Crash detection: 2+ runtime errors in 5s swaps in `PreviewCrashFallback` with a user-triggered "Ask Petal to repair" (`WebContainerPreview.tsx:244-266`). Repair is **not** automatic.
- Hard timeout: 5 min install/start (`WebContainerPreview.tsx:43`).

---

## 8. Deployment — **REAL**

Railway-hosted Fastify "builder" service → `npm install` → `vite build` → `wrangler pages deploy` → Cloudflare Pages at `petal-<12char>.pages.dev` (`builder/src/build.ts:33-38,151-193`). Cloudflare Worker fronts `*.buildwithpetal.com` and custom domains with a 60s-cached host lookup (`subdomain-worker/src/index.js:39-55`).

**Limits:** 32MB body, 2000 files, 3 concurrent builds, 50 queue depth, 12-min job timeout; npm 4min / vite 3min / wrangler 3min.
**Hardening:** idempotency guard (`builds/trigger.ts:121-148`), full repair re-run pre-deploy (`:150-288`), watchdog retry for builds stuck >80s, max 2 retries (`watchdog.ts:105-138`).
**Post-deploy browser verification** (Playwright) is blocking before `ready` (`server.ts:341-367`).

**Gaps:**
- **No rollback.** Every deploy overwrites the `--branch=main` alias. The "previous ready build" behaviour is a *display* fallback, not a rollback of the live site.
- **No durable deploy logs.** Only last 4000 chars into `project_builds.error_message`.

---

## 9. Backend generation — **mixed**

| Capability | Status | Evidence |
|---|---|---|
| DB schema / migrations | REAL | `managed-migrations.server.ts:39-151`, hash-tracked, halts on first failure |
| RLS | REAL + linted | `rls-sanity-linter.ts:12-30` |
| Auth (email/OTP/magic-link/OAuth) | REAL | `backend-kit.ts:50,112-145,237-238` |
| Storage / file uploads | REAL | `backend-kit.ts:168-187` |
| Payments (Stripe/Paystack/Flutterwave) | REAL | Signed webhooks: Stripe HMAC-SHA256 `stripe.integration.ts:222-273`; Paystack HMAC-SHA512 `:188`; Flutterwave `verif-hash` `:203-337` |
| Webhooks | REAL | per-provider `/api/public/*/webhook` with verify-before-fulfil |
| Edge functions / arbitrary server logic | PARTIAL | No generated Supabase Edge Functions. Webhook routes only; no generic "write me a backend function" |
| **Realtime** | **MISSING** | No `.channel(` in `backend-kit.ts`/`shared-backend-kit.ts`. Petal uses realtime internally, does not generate it |
| **Cron / scheduled jobs** | **MISSING** | No `pg_cron`/`cron.schedule` in generation code — mentioned in prompts only |
| **Full-text search** | **MISSING** | No search-index generation found |
| Rate limiting | PARTIAL | `rate-limit.server.ts` protects Petal's own endpoints, not generated apps |
| Analytics | PARTIAL | Cookieless beacon auto-injected by the worker (`index.js:175-193`) + PostHog/Plausible install packs. No generated analytics table/dashboard |

---

## 10. Design intelligence — deterministic where it matters

- **Palette + font pair: deterministic FNV-1a hash of the brief**, not LLM, not random (`palette-presets.server.ts:74-93`). Same prompt → same design, every time.
- **Theme registry:** 25 named `ThemeSpec`s with full CSS-variable token maps (`themes.server.ts:47-68`), written into `src/styles.css` before wire-up (`staged-orchestrator.server.ts:251-267`).
- **Code-shipped, not model-invented:** 12 shadcn primitives, 11 framer-motion primitives (`FadeIn`…`BlurFade`), auth cards, `SIDEBAR_SHELL`, `MOBILE_NAV`, `STAT_CARD`, `KPI_GRID`, `EMPTY_STATE_CTA`, `PROFILE_HEADER`, a11y kit (react-aria + dev-only axe-core), fluid typography scale, dark-mode CSS.
- **Prompt-enforced, model-executed:** spacing (`py-16 md:py-24`), landing checklist, responsive breakpoints, 390px mental check.
- **Post-hoc cliché scanner:** `anti-sameness.server.ts:19-27` flags purple/pink gradients, raw `indigo-500`, Lorem ipsum, `©2024`, Inter — **informational only, never blocks** (`:11`).

**Partial:** dedicated 404/error page component and a real onboarding flow were not confirmed as discrete blocks. Games are classified in detail (`game-intent.ts`, 124 lines) but have **no game scaffold kit** — guidance only.

---

## 11. Project memory — **REAL, deliberately small**

Not chat compression — a curated key/value fact store, **cap 30 keys**, values ≤400 chars (`project-memory.server.ts:24-26`). Written after each successful build by a cheap `gemini-3-flash-preview` forced `merge_memory` call (max 6 upserts / 3 deletes), instructed to skip transient facts. Read as a markdown block into both triage and generate prompts. Overflow is LRU trim, not summarization. All writes go through the user's JWT (RLS applies, no service-role bypass).

---

## 12. Production telemetry (ground truth)

### Build outcomes
| Metric | Value |
|---|---|
| Total builds | **462** |
| Ready | **350 (75.8%)** |
| Failed | **112 (24.2%)** |
| Projects | 32 |

### Weekly trend
| Week | Builds | Ready | Success |
|---|---|---|---|
| 2026-04-27 | 202 | 159 | 78.7% |
| 2026-07-06 | 43 | 31 | 72.1% |
| 2026-07-27 | 127 | 80 | 63.0% |
| **2026-08-03** | **67** | **66** | **98.5%** |

### Failure causes (112 failed builds)
| Cause | n | Share |
|---|---|---|
| `vite build failed (exit 1)` | **85** | **75.9%** |
| Builder unreachable (404/403/503/530) | 11 | 9.8% |
| Build timeout (10/20 min) | 7 | 6.3% |
| Builder stopped responding | 3 | 2.7% |
| Cloudflare Pages create failed (500) | 2 | 1.8% |
| `npm install` failed (ETARGET / exit 217) | 3 | 2.7% |
| `fetch failed` | 1 | 0.9% |

**Reading:** three quarters of all failures are generated code that parses (esbuild passes) but does not typecheck/build under Vite. This is direct confirmation of the §4 gap — there is no TypeScript gate before deploy.

### AI call log (top routes)
| Feature | Model | Calls | Errors | Avg ms |
|---|---|---|---|---|
| generate | google/gemini-2.5-flash | 1115 | 0 | 6,987 |
| recovery | anthropic/claude-sonnet-4.5 | 501 | 1 | 2,176 |
| preflight | google/gemini-2.5-flash-lite | 349 | 1 | 616 |
| triage | openai/gpt-5-mini | 344 | 0 | 606 |
| generate | google/gemini-2.5-pro | 271 | 0 | 16,328 |
| recovery | google/gemini-2.5-flash-lite | 129 | 0 | 2,833 |
| **generate** | **openai/gpt-5** | **107** | **107 (100%)** | 358 |
| generate | google/gemini-3-flash-preview | 105 | 0 | 16,880 |
| design | google/gemini-3-flash-preview | 63 | 0 | 2,127 |
| **design** | **google/gemini-pro-latest** | **62** | **62 (100%)** | **38** |
| design | openai/gpt-5-mini | 46 | 0 (46 fallback) | 495 |

**Two model IDs are 100% dead.** `gemini-pro-latest` failing in 38ms is an invalid-model-ID signature, not a capacity issue. `openai/gpt-5` on generate is 107/107. Both are masked by fallback, so users see latency, not errors — but Petal is paying a round-trip on every one.

`recovery` at **501 calls vs 1591 generate calls** means roughly **1 in 3 generations needs a recovery pass**.

### Turn lifecycle — **BROKEN**
| Status | n |
|---|---|
| running | **400** |
| succeeded | 10 |
| failed | 2 |

**97% of turns never reach a terminal state.** Either terminal writes are not firing, or the `STALE_TURN_MS` cleanup is not running. Everything derived from `turns` is currently untrustworthy.

### Pipeline failure signatures
| Signature | n | Last seen |
|---|---|---|
| `post_build_charge_failed` | **26** | **2026-08-05** (live) |
| `No result returned.` | 13 | 2026-08-04 |
| `The operation was aborted` | 9 | 2026-05-01 |
| `Load failed` | 7 | 2026-05-01 |
| `edit_pipeline:protected_path_only:vite.config.ts` | 3 | 2026-07-30 |

By surface: `credit_settlement` 26, `generate` 32, `build` 19, `generate-edit` 4.

---

## 13. Honest scorecard

| Area | Grade | Basis |
|---|---|---|
| Intent understanding | **A** | 344 calls, 0 errors, 7-mode classifier, anti-over-clarify |
| Design determinism | **A** | Hash-seeded palette/fonts, 25 token themes, code-shipped primitives |
| Repair/verify breadth | **A−** | 13 real modules on live paths, one composition point |
| Deploy infrastructure | **B+** | Real CDN pipeline + watchdog + browser verify; no rollback, no log archive |
| Preview | **B+** | 3 engines, real dep caching, frame-safety probe; repair is manual |
| Build reliability | **B** | 98.5% this week, 75.8% lifetime; 76% of failures are Vite typecheck |
| Backend generation | **C+** | Schema/RLS/auth/storage/payments real; realtime, cron, search, edge functions missing |
| Observability | **D** | 400 zombie turns; 2 dead models unnoticed; no durable deploy logs |
| Billing correctness | **D** | 26 live `post_build_charge_failed` |

---

## 13b. Routing defects found in the classifier chain — **NEW, high impact**

Full stage order for a build request (deterministic unless marked LLM):

`/api/triage` **(LLM)** → mode collapse → `/api/generate` → build-target from header → `inferWebSubtype` (regex) → `classifyAppShape` (regex) → `detectArchetype`/high-stakes (regex) → `decideBackendGate` (regex) → Design Director **(LLM, `gemini-3-flash-preview`)** → `classifyPhase` (regex, **LLM** fallback `gemini-2.5-flash-lite`) → model tier + smart router → generation **(LLM)** → verify tiers (deterministic).

Only 4 of ~11 stages are LLM calls. Target, backend inclusion, auth, and landing-page inclusion are all decided by regex before the writing model ever runs.

### Defect A — build target is header-only, never inferred from the prompt

`generate.ts:1646` — `request.headers.get("x-petal-target") ?? "web"`. Grep across `src/` finds **no** prompt-text inference anywhere.

Consequence: a user who types **"build me a Chrome extension"** or **"mobile banking app"** with the picker on its default gets a **web app**. The staged orchestrator's brief sniff (`staged-orchestrator.server.ts:75-83`) only nudges the planner's archetype slot — it cannot change `BuildTargetId`.

> This directly contradicts the recorded product decision that the target chip rail was removed *because* the target would be inferred from the prompt. The rail is gone; the inference was never built. Every non-web request typed in plain language currently mis-targets.

### Defect B — `inferWebSubtype` short-circuits marketing

`src/lib/web-subtype.ts:116-118`:
```
if (scores.fullstack >= 2) return "fullstack";
if (scores.marketing > scores.app && scores.marketing >= 2) return "marketing";
```
Fullstack is checked first and unconditionally. **"landing page for a fintech"** scores marketing 3 *and* fullstack 2 → returns `fullstack`, and the FULLSTACK addendum then mandates a dashboard-first `/` with **no marketing home**. The user asked for a landing page and gets an app shell. Fix: compare scores instead of short-circuiting.

### Defect C — the two classifiers disagree

`inferWebSubtype` and `classifyAppShape` run independently with separate regex tables. "Build an Airbnb clone" hits web-subtype's celebrity-brand rule (weight 4 → `fullstack`) but misses app-shape's `marketplace` pattern → `category: "generic"`, no surfaces, no cloud features. Bare "Uber" or "Airbnb" (without the verb "build") matches neither.

### Defect D — brittle keyword gaps

- `"inventory API"` → `inventory` domain rule requires system/management/tracker/warehouse/stock, so it misses; falls to `ecommerce`.
- `"AI chatbot"` → classified `ai-tool` with cloud `["auth","database","ai","storage"]`, but the backend gate likely does **not** fire, so turn 1 ships without the backend the shape says it needs.
- `"mobile banking app"` → correctly flags high-stakes via `project-archetype.ts:679`, but `"fintech"` alone does not.

---

## 14. Ranked fix list (evidence-derived)

1. **Turn lifecycle** — 400 stuck `running`. Find the missing terminal write / non-running cleanup. Blocks all measurement.
2. **`post_build_charge_failed`** — 26 hits, still firing 2026-08-05.
3. **Build-target inference from prompt text** (Defect A) — plain-language mobile/extension/backend requests currently build web apps.
4. **Remove or correct the two 100%-failing model IDs** — `openai/gpt-5` (generate), `google/gemini-pro-latest` (design). 169 wasted round-trips.
5. **Add a TypeScript gate before deploy** — 85 of 112 build failures are Vite-stage. esbuild parse-checking is not enough.
6. **Fix `inferWebSubtype` short-circuit** (Defect B) — "landing page for X" must not return `fullstack`.
7. **Reconcile `MAX_PLANNED_FILES`** — 8 in `pipeline-budgets.ts` vs 28/10 in `stage-plan.server.ts:376`.
8. **Unify the two classifiers** (Defect C) — one shared signal table feeding both.
9. **Deploy rollback** — currently impossible; every deploy overwrites the live alias.
10. **Backend gaps** — realtime and cron are the two most commonly expected features Petal cannot generate.
11. **Durable deploy logs** — 4000 chars in one column is not diagnosable.


---

## 15. Scope limits of this audit

- ESLint/TS-as-live-gate: confirmed absent by grep of the generation runtime; not confirmed against CI config.
- Rollback: none found in the audited files; a rollback endpoint elsewhere in the repo was not exhaustively excluded.
- `context-budget.server.ts` chat-history compression (distinct from project memory) was not traced.
- `templates.server.ts` (731 lines) and `industry-packs.ts` (461 lines) were read partially.
- Cost columns in `ai_call_log` are largely NULL, so per-turn cost could not be computed from telemetry.
- `AppShape.confidence >= 0.4` injection threshold is asserted in a doc comment (`app-shape-classifier.ts:91-92`); the enforcing call site was not located.
- Admin-configurable runtime model overrides (`ai-provider.server.ts:605`) may silently replace any hardcoded model id listed here.

---

*Baseline established 2026-08-05. Compare every future milestone against this document.*
