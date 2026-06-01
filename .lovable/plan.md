## Goal

When the user describes a **business** (SaaS, fintech, CRM, marketplace, AI startup, booking, edtech, healthtech, ecommerce platform, social platform), Petal should generate two coordinated surfaces in one plan:

1. **Public marketing site** — `/`, `/features`, `/pricing`, `/about`, `/contact` (Stripe/Linear/Notion-grade, not a dashboard).
2. **Private application** — `/auth`, `/app` (dashboard), `/settings`, `/profile`, plus 1–2 domain surfaces (CRM → contacts/pipeline; fintech → wallet/transactions; AI → workspace/usage).

Today both the staged planner and the orchestrator collapse these categories to a **single** archetype (`marketing` or `dashboard`), and the 10-file cap makes a combined plan impossible. This change keeps existing behavior for everything else and only upgrades business prompts.

Builds on what we already have — does NOT replace:
- `classifyAppShape` (already predicts multi-surface shapes incl. `landing` + `auth` + `dashboard`).
- Staged orchestrator's archetype + design + theme injection.
- `src/App.tsx`-as-root-view contract and renderable-shell guard.
- Recent array-safety, missing-export, and verifying-phase fixes — untouched.

## Changes

### 1. `src/server/pipeline/staged-orchestrator.server.ts`
- Widen the archetype union to add `"business-app"`.
- `archetypeFromShape`: for `saas | fintech | crypto | marketplace | ecommerce | booking | social | ai-tool | consultancy | real-estate` → return `"business-app"`. Keep `internal-tool` → `"dashboard"` (exception). Keep `marketing`-only categories (`local-business`, `restaurant`, `creator`, `directory`, `newsletter`, `content`) as-is.
- Honor explicit user opt-outs detected from the brief (regex sniff): `/admin (only|dashboard)|internal tool|back office|analytics dashboard|chrome extension|mobile app only|api only/i` → force `"dashboard"` / `"tool"` and short-circuit business-app upgrade.

### 2. `src/server/pipeline/stage-plan.server.ts`
- Add `"business-app"` to the `archetypeHint` union and to the system-prompt LAYOUT ARCHETYPE block:
  > `business-app` → BOTH a public marketing site AND an authenticated app shell. Plan ~6 marketing components (`Hero`, `Features`, `Pricing`, `FAQ`, `Testimonials`, `Footer`) + ~4 app components (`AuthCard`, `AppShell` with sidebar, `Dashboard` with domain widgets, `SettingsPanel`). `src/App.tsx` does lightweight routing (react-router or hash/state) between marketing and app sections; uses `<AuthGate>` for app routes.
- Raise file cap from **10 → 16** only when `archetypeHint === "business-app"` (pass a second arg into `PLAN_TOOL` or build the schema dynamically). Keep 10 for every other archetype.
- Update `detectArchetypeMismatch`: for `business-app`, require at least one marketing-shaped component (`Hero|Landing|Pricing|Features`) AND one app-shaped component (`Dashboard|AppShell|AuthCard`); flag plans missing either side.
- Update `injectRootViewIfMissing` purpose string for `business-app` so the auto-injected `App.tsx` mentions "renders marketing site + authenticated app with simple route switch".

### 3. `src/lib/app-shape-classifier.ts`
- For business categories, ensure `surfaces` always includes both `landing` and `dashboard` (already true for `saas`, `fintech`, `marketplace`, `ecommerce`; verify `ai-tool`, `crypto`, `booking`, `social` and add where missing).
- Tighten `rationaleFor` for `saas`, `fintech`, `marketplace`, `ecommerce`, `ai-tool`: explicit "ship marketing site AND authenticated product in the SAME build — not one or the other."

### 4. `src/server/dynamic-prompts.server.ts` (monolithic path)
- Add a `business-app` rule alongside the existing landing/marketing rules: triggers on `\b(saas|crm|fintech|marketplace|platform|startup|edtech|healthtech|booking system|ai (product|startup|tool))\b`. Injects an instruction block listing the same dual decomposition (public routes + private routes + backend) so the monolithic fallback path produces the same shape as the staged path.

### 5. Tests
- Extend `src/server/__tests__` (whichever file covers `app-shape-classifier` / `stage-plan`) with cases: `"Build me a CRM SaaS"`, `"Build a fintech for invoicing"`, `"Build an AI startup"` → assert classifier returns landing+auth+dashboard, archetype maps to `business-app`, planner's mismatch detector accepts a 10–14 file plan with both marketing and app components.
- Exception cases: `"Build me an internal admin dashboard"`, `"Chrome extension for X"` → must NOT upgrade to `business-app`.

## Non-goals (out of scope this turn)

- No changes to backend provisioning logic, auth wiring, or RLS templates — Cloud features are already inferred by the classifier.
- No new design tokens / themes.
- No edit to `client.ts`, `types.ts`, or generated route trees.

## Risk / rollback

- Single-flag rollback: revert `archetypeFromShape`'s business-category branch and the file-cap bump. All other archetypes keep their current behavior.
- The 16-file ceiling for `business-app` only fires when the classifier is confident; low-confidence prompts still take the existing path.
