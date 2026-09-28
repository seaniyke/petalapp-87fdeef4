# Kimble Cloud: measured infrastructure costs, 30% margin and automatic infrastructure choice

## What exists today (audit)
- **Choosing infrastructure:** one place already decides (`resolveCloudTier`): shared by default; dedicated database when the app needs file uploads, SQL, realtime, advanced search or tenant isolation, or grows past 80% of the shared row limit or 50 users; its own server for video, websockets, background jobs, scraping and similar work. It never moves an app down a level. This stays the only decider. No second planner.
- **Charging:** dedicated databases pay a flat 4¢/hour. The note next to it claims 65% margin, but nothing measures that. Railway servers pay a flat rate per awake hour. **Shared Cloud charges nothing.** No provider cost is recorded for any cloud resource. Only the one-off setup is recorded, as UNKNOWN.
- **Credits:** every cloud charge already turns into Kimble Credits through `chargeRuntime`, using the central cost-per-credit rate. That stays the only currency.

## What gets built

### 1. One cloud pricing formula (a pure module, fully tested)
- Customer price = provider cost / (1 − 0.30). So $10 of cost becomes $14.29, a 30% gross margin, not 30% markup.
- Credits = customer price / the existing cost-per-credit rate. Rounding follows the build rules: round up to 0.01, with no customer debt.
- The margin and all rates are stored as settings (`economics_config`), not written into the code.

### 2. Cloud cost ledger (extends `cost_events`, no new money table)
- Each cloud charge writes one row per resource: `cloud_shared`, `supabase_compute`, `supabase_disk`, `supabase_egress`, `railway_cpu`, `railway_ram`, `railway_storage`, `railway_egress`, and `cloud_other`.
- Each row records the project, the measured amount and unit, Kimble's cost, the credits charged, and whether the cost is ACTUAL, ESTIMATED, ALLOCATED or UNKNOWN.
- A read-only admin view answers: "for project X, what did it use and what did that cost Kimble?"

### 3. Railway: charge for measured use, not a flat hourly fee
- Before coding, I read Railway's public API docs for per-service usage (CPU, memory, disk, network) and its published rates.
- The hourly job reads actual usage since the last charge, prices it at Railway's rates (ACTUAL), then charges cost/(1 − 0.30).
- The existing safeguards stay: servers sleep when idle, sleep when credits run out, and are removed after long disuse. If Railway's usage data can't be read, the charge falls back to today's flat rate and is marked ESTIMATED. It is never skipped silently.

### 4. Dedicated database (Supabase Pro): cost from real rates
- Before coding, I read Supabase's docs for the project-size and usage APIs and the Pro pricing.
- Compute cost comes from the project's real instance size times the published hourly rate (ESTIMATED from the provider rate). Disk and data transfer use API data where it exists; where it doesn't, they're marked UNKNOWN.
- The flat 4¢/hour is replaced by cost/(1 − 0.30).

### 5. Shared Cloud: measured and very cheap, but not free
- For each project, measure what we can: stored records and bytes, uploads, sign-ups and active users, and API requests (from the shared request log, if one exists; the audit will confirm).
- Kimble's cost for each project = the shared infrastructure's monthly bill, split by the project's share of storage and requests. This is marked ALLOCATED, never ACTUAL. Anything we can't split fairly is marked UNKNOWN, without made-up precision.
- Customer rate: a small charge per unit of use, set only after checking the credit value and the real shared bill. It will sit well below the price of a dedicated database. A daily job does the charging.

### 6. Moving apps up a level: detect first, never move blindly
- Every time Kimble checks an app, it records what the app needs, with the reason and evidence.
- **Automatic today:** the level chosen at first build: shared, or a Railway server when the app clearly needs one. Setting that up is already safe.
- **Detected only, not automatic:** moving a live app from shared to its own database. Kimble records that the move is needed and runs the pre-move checks: data fits, records are intact, settings and keys are ready, the destination is healthy, and there's a way back. It doesn't move data until a safe migration path exists. No risky migration gets invented.
- An app only moves up for a real requirement or an existing limit. Never "because we can".

### 7. What the customer sees
- The billing screen shows one line: "Cloud usage", in credits. No provider names, no CPU or RAM, and no levels to choose from.

## Live checks (on kimble.cloud)
1. **Delivery app:** needs cloud, runs on shared, sign-up, records saved and still there after reload. Shared usage and its ALLOCATED cost are recorded, credits are charged, and no dedicated database or server is created.
2. **An app with heavy server work** (for example, video processing): a Railway server is chosen, measured use is recorded as ACTUAL, and credits are charged at the 30% margin.
3. **A simple app that only saves a few records:** stays on shared, with nothing expensive set up.

## Kept unchanged
Build credits and AI pricing, the effort curve, one credit balance, how projects are set up, sign-in, publishing, domains, email, the edit rules, and the starter files.

## Change-control (freeze)
- **What is broken:** Shared Cloud earns nothing, dedicated and server charges are flat guesses, and Kimble's real cost is never recorded.
- **Evidence:** the flat 4¢ constant, the flat hourly server rate, and the setup-only cost row marked UNKNOWN.
- **Why it blocks launch:** cloud margin can't be known or guaranteed.
- **Smallest safe fix:** the items above, reusing the existing decider, charge path and ledger.
- **What changes for users:** only how much each cloud charge costs, now tied to measured use.

## Technical details
- New: `src/lib/cloud-pricing.ts` (pure), `src/server/cloud-metering.server.ts` (collects Railway, Supabase and shared usage), a cron route `api/public/cron/cloud-shared-day.ts`, and `cloud_transitions` (detected moves plus check results).
- Changed: `compute-hour.ts` and `runtime-backend-hour.ts` (now measured) and `cloud-tier.server.ts` (records transitions).
- Migration: `cost_events` gains the cloud resource fields if they're missing; `economics_config` gets `cloud_external_margin=0.30`, the shared rates and Pro compute rates; the admin view uses SECURITY DEFINER; every new table gets GRANTs and RLS.
- Tests: the margin math ($10 → $14.29), turning cost into credits, the fallback to ESTIMATED, the shared split, and the tier decisions for delivery, video and a simple list app. Then rebuild the build-server package and update AGENTS.md.

## Needs your input when we get there
- Kimble's current monthly bill for the shared infrastructure. The shared cost split depends on it. Until then, those rows are recorded as UNKNOWN, with the usage still measured.
