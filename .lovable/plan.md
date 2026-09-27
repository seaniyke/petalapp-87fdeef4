# Kimble Effort Pricing: charge for work done, protect the margin

## What changes for the customer
Nothing new appears on screen. They still see "About X credits estimated", then "X credits so far", then "X credits used". The difference is what X measures: how much work Kimble did, not how little the AI cost us. A 4-page website will cost several credits, not 0.82. A one-line text fix stays near the 0.30 minimum.

## What stays exactly as it is
One credit ledger. Held credits before work, returned exactly once. No debt, no double charge, never above the hold. Settlement from the saved per-step records (setup steps billed, the after-save memory step not billed). Cost log, refund guards, cancellation, no-progress stop, daily 10 / monthly 50 free limits, Paystack packs and their prices. Same build loop, OpenRouter only, no new orchestrator.

## How it works

```text
request -> size class + scope  -> estimated effort -> estimated credits -> hold (estimate x headroom)
build   -> every step recorded (cost, files, pages, checks, retries, waste)
end     -> measured effort -> credits from the curve -> floor 0.30 -> cap at hold
        -> separately: internal cost, revenue, contribution, margin, flags
```

Two numbers, never mixed:
- **Customer price** = the effort curve. AI cost does not feed it.
- **Internal cost** = the saved per-step costs. Used for margin checks and the spending limit only.

### 1. Effort score (one pure function, all weights configurable)
Counts productive work only, from the build's own records:
- Scope: pages created/changed, routes, components, backend/database/auth/integration/payment work.
- Output: files created, files changed (weighted by lines changed, capped per file so one huge file cannot dominate), files deleted.
- Verification: validation cycles that passed, runtime checks.
- Class (SIMPLE to ESCALATED) as a small multiplier, not a price.
- Time: a small, capped term; slow providers cannot raise the price.

Excluded as waste (never billed): failed provider calls and their retries, writes rolled back or discarded, repeated identical reads, idle/no-progress steps, repair of Kimble's own bugs. The model never reports its own effort.

Each weight is documented with why it exists and lives in the economics settings so it can be tuned without a code change.

### 2. Price curve (progressive, configurable)
credits = max(0.30, a x effort^p), rounded up to 0.01, capped at the hold.
Starting values chosen so the calibration ranges from the brief hold: tiny edit ~0.3 to 0.8, small ~0.5 to 1.5, medium ~1 to 3, substantial ~2 to 5, major build ~4 to 8, very complex ~7 to 15, escalated 15+. No per-type fixed prices anywhere.

### 3. Estimate and hold
Before the build: estimated effort from the request scope, class and (once 20+ similar builds exist) history, turned into estimated credits by the same curve. Hold = estimate x headroom (3). The internal spending limit is decoupled from the hold: it becomes the class cost estimate x headroom, because a credit is now worth more than its cost and the old "hold x $0.026" limit would be far too loose.

### 4. Profitability per build (stored)
Revenue = credits x $0.13; internal cost; productive cost; wasted cost; contribution; margin; cost/revenue; markup. Three separate flags, never merged:
- **Underpriced**: margin below the configured floor (default 70%) while waste is low.
- **Expensive execution**: margin low because waste is high; the customer is not charged for it.
- **Bad estimate**: actual effort differs from estimated effort by more than 50%.
No automatic repricing; flags only.

### 5. Learning
Per class and per model: count, P50/P75/P90, average cost, average price, average margin, estimate error. History influences estimates only after a configurable sample minimum (20). The curve itself is only ever changed by an admin.

### 6. Admin economics
Extend the existing billing panel: customer (credits, revenue, average/median price), internal (cost, productive, wasted), profitability (contribution, margin, markup, cost/revenue), effort (score, class, steps, files, pages, checks), estimate quality, all broken down by class and by model/provider. Internal only.

### 7. Tests
Floor (0.10/0.22/0.29/0.30 -> 0.30), pass-through (0.37 ... 10.00), effort scenarios (tiny edit through complex app), profitability scenarios (profitable, borderline, underpriced, expensive execution, waste, provider retry, failed, refunded), billing integrity (hold, settle, late cost, last step, cost log, repeat settle, concurrent settle, cancel, no debt, spending limit).

### 8. Live benchmark suite (published site)
Six real builds: tiny UI change, small component change, medium feature, sign-in + database feature, bakery website, larger multi-page app. For each: all 19 numbers the brief lists. Prices are not adjusted to make the table look good; the curve is recalibrated only from what the suite shows, and any change is reported.

### 9. Then
Commercial decision (curve, profitability, outliers, recommended launch values, what stays configurable, what to collect after launch), then the Kimble Cloud Readiness Report (sections A to J).

## One thing to be aware of
With work-based prices, the 50 free monthly credits buy fewer builds (roughly ten small websites instead of about sixty). That is the intended effect, but it is a business choice; I will show the exact number after the benchmark.

## Technical details
- `src/lib/effort-pricing.ts` (new, pure): `effortScore(signals, weights)`, `creditsForEffort(score, curve)`, `estimateEffort(scope, cls, history)`, `profitability(...)`, `flags(...)`. `build-pricing.ts` keeps cost math for the spending limit and margin; `creditsForCost` stops deciding the customer charge.
- Signals come from existing sources: `turnStrategy.executionSummary`, `tool_loop_calls`, the committed diff, readiness verdicts, `ai_call_log` (status, retries). Waste derived from failed/retried calls, rolled-back writes and idle steps already recorded by the loop.
- Migration: `economics_config` keys for weights, curve `a`/`p`, margin floor 0.70, estimate-error threshold 0.5; new `turn_economics` columns (effort_estimated, effort_actual, effort_signals jsonb, credits_estimated, revenue_usd, productive_cost_usd, wasted_cost_usd, contribution_usd, margin_pct, flags text[]); `build_billing_summary` extended by class and model. `reserve_build_credits`, `settle_build_charge`, `release_build_reservation` unchanged.
- `generate.ts`: settlement passes the effort price to `settle_build_charge`; `economicCeilingUsd` switches to class cost x headroom.
- Rebuild the agent bundle and bump `AGENT_CORE_VERSION`; record the rule in AGENTS.md (customer price = effort curve; internal cost = records; never mixed).
