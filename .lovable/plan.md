## Goal

Move from a flat **1 credit per build** model to a **variable, fractional credit** model that reflects the actual size of the work, while keeping discuss at a flat **1 credit**.

## Current state (what's true today)

- All credit columns (`monthly_credits_remaining`, `topup_credits_remaining`, etc.) are **integer**.
- The `spend_credit` Postgres RPC always deducts **exactly 1**.
- `/api/generate` charges 1 credit pre-flight, refunds on failure.
- `/api/generate-image` charges 1 credit pre-flight, refunds on failure.
- `/api/discuss` charges **0 credits** today.
- AI responses come from the Lovable AI gateway but token usage is **never captured**.

## Target model

| Action | Cost |
|---|---|
| Discuss message | exactly **1.00** credit (flat) |
| Build (small CSS tweak) | ~1.00–1.30 |
| Build (new component / landing page section) | ~1.50–2.20 |
| Build (full landing page / multi-file feature) | ~2.20–3.50 |
| Build (large multi-page app, big refactor) | 3.50–6.00+ |
| Image generation | 1.00 (unchanged for now — cost is already roughly fixed per call) |

The variable build cost is computed from **actual AI token usage** returned by the gateway after the model finishes.

## Pricing formula (build only)

```
build_cost = round_to_2dp(
  max(
    1.00,                                                  // floor: never less than 1
    1.00                                                   // base
    + (prompt_tokens     / 1000) * PROMPT_RATE             // input weight
    + (completion_tokens / 1000) * COMPLETION_RATE         // output weight (heavier)
  )
)
```

Initial constants (tunable in one place, `src/server/credit-pricing.server.ts`):

- `PROMPT_RATE = 0.05` credits per 1k input tokens
- `COMPLETION_RATE = 0.30` credits per 1k output tokens
- Hard cap of **8.00 credits** per single build so a runaway response can't drain a wallet — anything above that is clamped and a `clamped: true` flag is written into ledger metadata.

Rationale: completion tokens dominate real LLM cost, so a small CSS tweak (~200 input / ~300 output tokens) lands at ~1.10, while a full landing page (~3k input / ~6k output tokens) lands at ~2.95.

If the gateway response is missing usage data (rare, but possible), fall back to a **fixed 1.50** charge and tag the ledger entry with `usage_missing: true` so we can monitor it.

## Storage: `numeric(10,2)` migration

Per user choice. Migration:

1. Alter the four credit columns on `user_wallets` to `numeric(10,2)`:
   `monthly_credits_remaining`, `topup_credits_remaining`, `daily_free_used`, `monthly_free_used`.
2. Alter `credit_ledger.delta` and `credit_ledger.balance_after` to `numeric(10,2)`.
3. Alter `credit_packs.credits` and `topup_lots.credits_granted` / `topup_lots.credits_remaining` to `numeric(10,2)` for consistency, even though packs sell whole credits today.
4. Defaults stay 0; existing integer values cast cleanly.

No data is lost — Postgres widens int → numeric in place.

## RPC changes

### `spend_credit(_user_id, _amount numeric, _reason, _project_id, _metadata)` — **NEW SIGNATURE**

- Takes a `numeric` amount instead of always deducting 1.
- Order of buckets unchanged: daily-free → monthly grant → topup.
- **Cross-bucket spend allowed**: if a 1.92-credit charge would exhaust the daily-free pool with 0.30 left, it consumes the 0.30, then takes 1.62 from monthly grant. This avoids tiny stranded balances. Each bucket touched is recorded in metadata as a sources array.
- If the total available across all buckets is less than `_amount`, returns `false` (no partial charges).
- Writes a single `credit_ledger` row with the negative numeric delta and the buckets-touched breakdown.

### `refund_credit(_user_id, _ledger_id uuid, _reason, _metadata)` — **CHANGED**

- Now takes the ledger row id of the spend being refunded (instead of "find the most recent -1 spend"). This is necessary because builds can fail far enough after-the-fact (e.g. Cloudflare deploy failure callback) that another spend may have happened in between.
- Reads the buckets-touched metadata, refunds each bucket by its original portion.

### `grant_credits` and the topup/subscription RPCs

- Update parameter types to `numeric` so future product changes (e.g. half-credit promo packs) work without another migration. Existing whole-credit grants are untouched.

## Server route changes

### `/api/discuss` — add charge

- Add the same auth + `spendCredit({ amount: 1.00, reason: 'ai_discuss' })` pre-flight that `/api/generate` uses.
- Refund on failure.
- Return 402 with the standard "out of credits" message when the wallet is empty.

### `/api/generate` — switch to two-phase charge

Today: charge 1 up front, refund on failure.

New flow:

1. **Pre-flight reservation**: charge a **1.00 credit hold** (so users with zero credits are blocked immediately, before any AI tokens are spent). Reason `ai_build_hold`.
2. Run the AI generation as usual. Capture `usage` from the gateway response (`prompt_tokens`, `completion_tokens`).
3. **Post-flight true-up**:
   - Compute `final = priceBuild(usage)`.
   - If `final > 1.00`: charge the difference as a second ledger entry, reason `ai_build_topup`.
   - If `final < 1.00`: refund the difference, reason `ai_build_credit`.
   - If `final == 1.00`: no second entry.
4. On generation failure: refund the original 1.00 hold using the new ledger-id-based refund.

If the post-flight true-up itself fails (e.g. wallet now empty due to concurrent spend), the build still succeeds — we never claw back work the user already received. The shortfall is logged and surfaced in admin metrics, not to the user.

### `/api/generate-image`

Stays at flat 1.00 credit. Image gen pricing is more uniform per call, and changing it isn't part of this ask.

## Client changes

Per user choice — **only show the actual charge after the build**, no estimate before.

1. **Activity card**: add a small line under "🌟 Your app is live" showing `−1.92 credits` (formatted to 2dp, "−1 credit" when exactly 1). Source: a new field on the stream-end response that returns the final ledger debit for this build.
2. **Wallet display** (`useCredits`, settings, header pill): switch all formatting to handle decimals — `formatCredits(n)` that shows `2.5` as `2.5` and `2.50` as `2.50` cleanly, never with trailing junk like `1.9000000001`.
3. **Insufficient-credits check**: the existing 402 handler stays as-is (the pre-flight 1.00 hold is what gates access). No predictive UI.
4. **Discuss UI**: no special change — when the user sends in Discuss mode and is out of credits, they get the same 402 toast as Build today.

## Observability

- The `credit_ledger.metadata` already has room for everything; we'll add `prompt_tokens`, `completion_tokens`, `model`, and `buckets` keys on every build-related entry so admin dashboards can analyze cost-per-build over time.
- A new `v_build_costs` SQL view aggregates `ai_build_hold + ai_build_topup + ai_build_credit` per project so we can see per-project lifetime spend and per-day averages without changing app code.

## Files touched

**Migrations** (1 file)
- `supabase/migrations/<ts>_variable_credits.sql` — column type changes, new RPC signatures, view.

**Server**
- `src/server/credit-pricing.server.ts` — new, exports `priceBuild(usage)` + tunable constants.
- `src/server/credits.server.ts` — `spendCredit({ amount })`, `refundCredit({ ledgerId })`.
- `src/routes/api/discuss.ts` — add pre-flight charge.
- `src/routes/api/generate.ts` — two-phase charge (hold + true-up), capture token usage from gateway.

**Client**
- `src/lib/format-credits.ts` — new tiny helper.
- `src/components/BuildActivityCard.tsx` — show final charge line.
- `src/lib/stream.ts` and `src/server/generate.server.ts` — propagate the final-charge value through the stream end event.
- `src/components/CreditsPill.tsx` and Settings → Plans & Credits — use `formatCredits`.

**No** changes to: payment webhooks, plan upgrade flow, image generation, build pipeline, preview pipeline.

## Backward compatibility

- All existing wallets keep their integer values (now stored as `1.00`, `100.00`, etc.) — no data loss.
- The old `spend_credit(_user_id, _reason, _project_id, _metadata)` signature can be kept as a thin wrapper that calls the new one with `_amount := 1.00`, so anything else in the codebase still using it (or future migrations referencing it) continues to work.

## What the user will see

- Send a discuss message → −1.00 credit.
- Send a small "make the button bigger" build → completes, sees `−1.05 credits` in the activity card.
- Send "build me a landing page with hero, features, pricing" → completes, sees `−2.30 credits`.
- Send "rebuild the whole app with auth, dashboard, settings" → completes, sees `−4.80 credits`.
- Wallet pill shows decimals: `47.20 credits left`.
- If wallet has less than 1.00, all AI actions are blocked at the door with the same friendly upgrade prompt as today.