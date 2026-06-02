# Petal Launch Punch-List

Ordered by **launch-blocking severity**. P0 = ship-stoppers, P1 = ship within 72h, P2 = week-1 fast-follows. Each item has a concrete file target + acceptance criteria so it's verifiable, not vibes.

---

## P0 — Ship-stoppers (must clear before "Publish" CTA goes live)

### 1. Delete the `/api/mobile/eas-build` 501 stub
- **File:** `src/routes/api/mobile/eas-build.ts` → delete.
- **Why:** Returns HTTP 501 today. Any external prober (or curious user hitting devtools) sees a broken endpoint on a production domain. Codemagic is the real path (`src/server/mobile-service.server.ts`); EAS-direct was abandoned.
- **Also:** grep for any client call to `/api/mobile/eas-build` and remove.
- **Done when:** route file gone, build green, `rg eas-build src/` returns 0 hits outside `routeTree.gen.ts`.

### 2. Verify & document prod env vars on Railway/Worker
- **Vars to confirm present and non-empty in prod:**
  - `BUILDER_URL`, `BUILDER_SHARED_SECRET` (snapshot → builder handoff)
  - `CODEMAGIC_API_TOKEN`, `CODEMAGIC_APP_TEMPLATE_ID`
  - `EXPO_ACCESS_TOKEN` (Petal's org token, server-side only)
  - `MOBILE_SIGNING_KEY` (Android keystore passphrase)
  - `PETAL_EMAIL_*`, `PADDLE_*` / `STRIPE_*`, `PAYSTACK_SECRET_KEY`, `FLUTTERWAVE_SECRET_KEY`
- **Deliverable:** a `docs/ops/prod-env.md` checklist + a `/api/internal/health` route that reports `{present: [...], missing: [...]}` (no values) gated by `INTERNAL_HEALTH_TOKEN`.
- **Done when:** health endpoint returns `missing: []` in prod and preview.

### 3. Codemagic build watchdog
- **File:** new `src/routes/api/public/mobile/cron-watchdog.ts` + DB function.
- **What:** every 5 min, find `mobile_builds` rows in `queued` or `running` for >25 min, mark `stuck`, notify the user + admin Slack webhook, and offer retry.
- **Why:** Codemagic builds occasionally hang (signing race, simulator boot). Without this, users sit watching a spinner forever.
- **Done when:** synthetic stuck row gets flipped to `stuck` within 5 min in staging.

### 4. App-level rate limit on `/api/generate`
- **File:** `src/routes/api/generate.ts` (add middleware) + new `src/server/rate-limit.server.ts` (KV-backed, sliding window).
- **Limits:** authed user → 30 req/min, 500 req/hr; per-IP fallback for anon → 10/min. 429 with `Retry-After`.
- **Why:** today a single malicious tab can drain the wallet meter and torch our AI gateway budget.
- **Done when:** unit test simulates 35 calls in 60s, 5 return 429.

---

## P1 — Within 72 hours (operational gaps; not user-visible breakage, but high-blast-radius)

### 5. Per-project AI spend attribution
- **Files:** `src/server/ai-usage.server.ts`, `src/lib/cloud-ai-usage.functions.ts`, `CloudAiUsageView.tsx`.
- **What:** add `project_id` to `ai_usage_events` insert path; group "AI usage" panel by project. Backfill existing rows with `project_id = NULL` → label "Workspace-wide".
- **Why:** today owners can't see which project burned the meter. Blocks accurate cost-per-project for our own pricing model.

### 6. Confirm runtime-hour cron scheduler
- **What:** the 4¢/hr backend meter relies on a 5-min cron hitting `/api/public/billing/tick-backend-hours`. Verify the external scheduler (Cloudflare Cron Trigger or upstash-cron) is actually configured for prod, not just preview.
- **Add:** a `last_tick_at` row in `billing_meta`; admin dashboard widget that goes red if >10 min stale.
- **Done when:** widget reads `< 6 min` in prod for 24h continuous.

### 7. Registrar end-to-end load test
- **Files:** `src/routes/api/registrar/{search,purchase,poll}.ts`.
- **What:** scripted test that races Cloudflare webhook arriving before the purchase response returns (real bug we've hit twice). Idempotency key on `domain_purchases` + UPSERT.
- **Done when:** 50 concurrent purchases of distinct domains all land in exactly one row each.

### 8. Mobile signing key rotation runbook
- **File:** `docs/ops/mobile-signing-rotation.md`.
- **Cover:** how to rotate `MOBILE_SIGNING_KEY` without invalidating already-published Play Store apps (Google Play App Signing v2 upload key swap procedure), and the DR steps if the keystore is lost.
- **Why:** if we lose this key with even one published app, that app is dead forever. Policy gap, not a code gap.

---

## P2 — Week-1 fast-follows

### 9. Hide `/lovable/email/*` discovery on `buildwithpetal.com`
- Add `Disallow: /lovable/` to `public/robots.txt` + 404 the path on the apex domain (keep working on `*--{id}.lovable.app`).

### 10. GitHub export (read-only ZIP first, real sync later)
- Phase 1: `Download as ZIP` button on Publish sheet (week 1).
- Phase 2: real `git push` to user-owned repo (post-launch, separate epic).

---

## Cross-cutting: African language support

This is the moat — let's make it real, not just a triage trick.

### 11. Expand language detection beyond Pidgin
- **File:** `src/routes/api/triage.ts` (language register detector).
- **Add detection for:**
  - **Swahili** (KE/TZ/UG) — already partial, promote to first-class
  - **Yoruba**, **Igbo**, **Hausa** (NG — together cover ~140M speakers)
  - **Amharic** (ET — 50M, unique script ጥሩ ነው → strong signal)
  - **Zulu** + **Xhosa** (ZA)
  - **French (West African register)** — already covered by `fr`, but tune for Ivorian/Senegalese idioms
  - **Arabic (Maghrebi)** — Egypt/Morocco/Tunisia
- **Implementation:** keep it cheap — n-gram + stopword list per language in `src/server/lang-detect.server.ts`, not an LLM call. Falls back to LLM classify only when confidence <0.6.

### 12. Localized system prompts per detected language
- **File:** `src/server/prompts/locale/{sw,yo,ig,ha,am,zu,xh,ar-MA}.md`.
- The model still *generates code in English* (variable names, comments), but **explains, asks clarifying questions, and writes UI copy** in the user's language when the project is for that market.
- **Acceptance:** a Yoruba prompt "Ṣe app fún titaja aṣọ" → triage returns clarifying question in Yoruba, scaffolds e-commerce app with Yoruba placeholder copy.

### 13. African market template pack
- **File:** `src/server/templates.server.ts` — add: `okada-dispatch`, `chama-savings` (KE rotating-savings), `agritech-marketplace`, `mobile-money-wallet`, `church-tithing`, `street-food-pos`.
- These show up in `StartIdeasPanel` only when geo or language signals an African user — invisible to others, so global UX stays clean.

---

## Sequencing (recommended 5-day sprint)

```
Day 1: P0-1 (delete stub) + P0-2 (env audit)        → 1 dev
Day 2: P0-3 (watchdog) + P0-4 (rate limit)          → 2 devs parallel
Day 3: P1-5 (per-project AI) + P1-6 (cron check)    → 2 devs parallel
Day 4: P1-7 (registrar test) + P1-8 (signing docs)  → 1 dev + you
Day 5: P2-9, P2-10, P3-11..13 lang pack             → all hands
```

Ship `Publish` CTA after Day 2. Days 3–5 ride behind a flag if needed.

---

## Out of scope (intentionally deferred)

- Multiplayer / real-time co-editing — post-launch Q2.
- Self-serve GitHub two-way sync — phase 2 of item 10.
- Full Codemagic → in-house builder migration — only if Codemagic cost exceeds $X/mo.
- iOS Test Flight automation — needs user's Apple Developer cert; deferred to user-onboarded flow.

---

## Open questions for you

1. **Lang priority:** do we ship all 8 African languages in item 11, or start with the 3 highest-volume (Swahili, Yoruba, Pidgin) and add the rest as a v1.1?
2. **Rate limit numbers (item 4):** 30/min/user feels right for builders — too tight or too loose given your expected load?
3. **Watchdog notifications (item 3):** Slack webhook for admin, but for the *user* — in-app toast only, or also email via Petal Email?
