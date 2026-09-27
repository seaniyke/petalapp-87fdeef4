# Billing audit and launch plan

This covers what exists today, based on the code and the live database, and the smallest set of changes that makes billing ready for launch. I will not change any code until you approve.

## 1. Current architecture (what exists)

There is **one balance** (Kimble Credits) and **one ledger** (`credit_ledger`). Every charge goes through the same database functions. That part is already right.

```text
USER
 -> user_wallets (buckets: daily free, monthly free cap, monthly grant, top-up lots, credit_debt)
 -> GRANT: grant_credits / monthly_grant / topup (Paystack apply_paystack_topup, topup_lots)
 -> CHECK: check_credit_balance(BUILD_FLOOR = 1.0)   <- no reservation exists
 -> BUILD runs (tool loop) and records per-call usage and cost
 -> PRICE: priceTurnByCost(real OpenRouter cost / target_variable_cost_per_credit_usd), min 1.0, max 20
 -> SETTLE: settle_build_charge (one per turn, drains free -> grant -> top-up, books any shortfall as debt)
 -> REFUND: refund_build_charge (guarded: never refunds a delivered, stale or same-revision build)
 -> INTERNAL COST: turn_economics (ai_cost_usd_micro, tokens, calls, retries, class, cost_basis)
 -> PURCHASE: credit_packs + billing_price_overrides -> Paystack -> topup lots
```

## 2. Tables and services involved

- Ledger and balance: `credit_ledger`, `user_wallets`, `topup_lots`, `credit_paused_turns`
- Catalogue: `billing_plans`, `credit_packs`, `billing_price_overrides`, `billing_currencies`
- Operations and economics: `economic_operations` (one per turn), `turn_economics`, `tool_loop_calls`, `cost_events`, `economics_config`
- Runtime meters: `runtime_ledger` and `charge_runtime`. These charge credits through the same `spend_credit`.
- Code: `credits.server.ts`, `credit-pricing.server.ts`, `turn-cost-ceiling.server.ts`, `execution/complexity.ts`, `execution/charge-decision.ts` (shadow only), `build-outcome.ts`, `api/generate.ts` (settle step), `builds/callback.ts` (refund step)

## 3–5. Charging, refund and cost telemetry paths

- **Charge:** after commit, `generate.ts` calls `priceTurnByCost`, then `settle_build_charge`, which is idempotent on the turn. Turns that change nothing, auto-fix runs and turns whose save failed are not billed.
- **Refund:** the build callback calls `refund_build_charge` when a build fails verification. It refuses anything that was delivered.
- **Flat charges:** discuss, coach and image each take 1 credit up front and refund it if they fail. Transcribe, badge removal, domain and mobile are charged separately. They all share the same ledger.
- **Cost telemetry:** each AI call reports its real OpenRouter cost when the provider returns it. `turn_economics.ai_cost_usd_micro` stores it with a basis of actual or unknown.

## 6. Already available in real time

Each loop call records its provider, model, input, cached, output and reasoning tokens, its cost when reported, its duration and its retry, recovery or failed status. The per-turn class (LIGHT, STANDARD, HEAVY, COMPLEX or ESCALATED) and its expected cost are already computed. The free buckets already enforce **10 per day and a 50 per month cap**, which matches the target model.

## 7. What is missing (confirmed from data, last 30 days)

- **Price is far above cost.** Builds with a known cost average **$0.016 (median $0.010, 90th percentile $0.034)** but are charged about **3.1 credits**, because of the 1.0 floor and the old token formula. At $0.026 per credit the right charge is about **0.4–1.3 credits**.
- **Many builds have no recorded cost.** 105 of 174 recent turns have cost_basis "unknown", so they fall back to the token formula. Also, `cost_events` has 0 rows.
- **No reservation.** Kimble only checks that the user has 1 credit, then charges after the build. Anything over the balance becomes debt, so a user with a low balance can run a large build.
- **The ceiling is not tied to the balance.** The per-turn cost ceiling exists but is not linked to what the user can afford.
- **Settings drift.** `target_variable_cost_per_credit_usd` = 0.03 (target 0.026). Pack prices range from about $0.15 to $0.30 per credit, not $0.13. There is no revenue-per-credit setting.
- **No customer meter.** There is no "Estimated / Using / Used" credit display during a build.
- **No SIMPLE class.** The classifier has 5 classes, not 6.
- **Admin cannot yet answer** gross contribution, cost of failed or refunded builds, or cost by class or model, in one view.

## 8. Duplicate or conflicting paths

- Two pricing formulas: `priceBuild`/`priceTurn` (tokens) and `priceTurnByCost` (real cost). The token formula also runs as a silent fallback.
- `charge-decision.ts` (shadow) and the live `isUnbillableTurn` both decide whether a turn is billable.
- There are legacy ledger reasons (`ai_build_hold`, `ai_build_topup`) and a separate `spend_credit` overload.
- There is no second ledger. All charges go through `spend_credit`/`settle_build_charge`.

## 9. Proposed authoritative flow

```text
request -> classify (existing) -> estimate = class p90 cost / cost_per_credit
 -> reserve min(estimate x headroom, available)   [reserve_build_credits, new]
 -> build; running cost accumulator per turn (sum of call costs, streamed)
 -> hard stop when accumulator >= reservation ceiling (existing ceiling, fed the reserve)
 -> verification -> settle_build_charge(actual) releases the rest of the reservation
 -> refund_build_charge on failure (existing rules)
```

## 10. Classes

Add **SIMPLE** below LIGHT, for copy or style edits to a single file. The class sets **only** the estimate and the reservation. It never sets the final charge. Each class's estimate comes from its measured 90th-percentile cost in `turn_economics`, with a configured default until 20 or more samples exist.

## 11. Formula

```text
internal_cost_usd = sum(AI call cost) + build_minutes x build_minute_usd + images + browser
billable_cost     = internal_cost_usd - wasted cost caused by Kimble (dead streams, discarded resends)
credits           = round_up_to(billable_cost / cost_per_credit, rounding_step)
credits           = clamp(credits, min_charge, reservation_ceiling)
```

`cost_per_credit` = revenue_per_credit x (1 - target_margin), which is 0.13 x 0.20 = $0.026. `rounding_step` (0.01) and `min_charge` (0.05) are settings. If any call's cost is unknown, estimate it from tokens times the model's price and mark it ESTIMATED. The 1.0 floor is removed.

## 12. Reservation and settlement

- Reserve an amount without spending it. It is held in a new `credits_reserved` field on the wallet, tied to the turn.
- If the available balance is below `min(estimate, SIMPLE estimate)`, return 402 before the build starts.
- The running cost is compared with the reservation. When it would exceed the reservation, the build stops cleanly (the existing no-progress/ceiling stop), keeps what is already verified, and asks for more credits (the existing credit pause).
- Settlement charges `min(actual, reservation)` and releases the remainder. No debt is created for builds any more.
- Refund rules, applied exactly:

| Outcome | Charge |
|---|---|
| Success (including fix-up work inside the loop) | actual measured cost, minus waste caused by Kimble |
| Partial success (committed and verified) | actual measured cost |
| Fails before any meaningful work, provider failure, timeout, cancellation, no-progress stop, circuit breaker | 0. Reservation released. |
| Verification failure after commit | full refund via `refund_build_charge` |
| Auto-fix or internal repair | 0 |

## 13. MVP changes (launch-ready)

1. Settings: add `revenue_per_credit_usd` (0.13), `min_charge_credits`, `rounding_step`, `reservation_headroom`, and the class defaults. Derive cost_per_credit from these. The admin page edits them.
2. One pricer: replace `priceBuild`/`priceTurn`/`priceTurnByCost` with a single `priceFromMeasuredCost`. Remove the 1.0 floor. Estimate unknown costs from tokens times the model's price and mark them ESTIMATED.
3. Fix cost capture so every call records a cost. Fill `cost_events` (actual or estimated) for every loop call.
4. Reservation: new `reserve_build_credits` and `release_reservation` database functions. `settle_build_charge` settles against the reservation and never creates debt for builds.
5. Tie the reservation to the existing cost ceiling (runaway protection).
6. Add the SIMPLE class. Base estimates on historical 90th-percentile cost per class.
7. Merge the shadow `charge-decision` into `build-outcome` as the one billing-eligibility authority.
8. Customer meter: estimate before the build, running credits during it (from the accumulator, streamed), final amount at the end. Credits only, never tokens or dollars.
9. Admin economics view over `turn_economics` and the ledger: builds, credits charged or refunded, AI or variable cost, revenue represented, contribution, and cost by class, model or outcome, including failed builds.
10. Tests: pricing, reservation and settlement, every refund row, idempotency, and daily or monthly limits.

## 14. Can wait until after launch

- Automatic recalibration jobs (start with a manual "recompute class estimates" admin button)
- Repricing packs to $0.13 per credit (a commercial decision, made in the admin settings)
- Browser or runtime cost for builds beyond build minutes
- Removing legacy ledger reasons and the old `spend_credit` overload

## Technical notes

- Free allowance: `spend_credit` already caps at 10 per day and 50 per month for BUILD purposes only. No change is needed.
- Each change under `src/server/` requires rebuilding the agent core bundle and bumping `AGENT_CORE_VERSION`.
- Record the one-pricer and reservation rules in `AGENTS.md`.
