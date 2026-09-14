# One balance: everything becomes Petal Credits

You're not behind — we're half way. Today there are still **two pots**: Petal Credits
(builds, plan features) and a separate dollar wallet for Cloud + AI ($20 top-up, $10
free). The "unified" switch I turned on only makes credits a *fallback* when the dollar
wallet runs dry. That's why the second page still exists.

This plan finishes the job: **one balance, one top-up, one screen.**

## What changes for you

- The "Cloud & AI balance" menu item goes away.
- Your $20 top-up and $10 free credit convert into Petal Credits at the standard rate,
  with a line in your history showing the conversion. Nothing is lost.
- Cloud and AI usage is charged straight from your credit balance — same as builds. A
  one-off top-up and a subscription behave identically.
- "Plans & credits" becomes the only money screen: your balance, top up, your plan, and
  a short breakdown of where credits went (builds, Cloud, AI, per project) plus your
  spend cap.

## The new Plans & credits screen

```text
Balance            128 credits          [ Top up ]
                   Daily 5 · Monthly 0 · Extra 100

Plan               Free                 [ See plans ]

Where credits go   Builds 22 · Cloud 4 · AI 2   this month
                   By project  >
                   Spend cap   none      [ Set cap ]

Top up             pick a pack  →  pay (card or crypto)
Subscribe          Starter Pro / Starter Business
```

Copy gets cut roughly in half: one sentence per section, no repeated "pay as you go"
explanations, and the plan feature list trimmed to short phrases ("Backend, database,
auth & storage" / "AI models, no API key" / "Custom domains & email").

## How it works underneath

1. **Migration (one-off, reversible record).** For every user with a runtime balance:
   convert `runtime_topup_balance_cents` and remaining free-grant cents into credits at
   the central rate from `economics_config` (`target_variable_cost_per_credit_usd`),
   insert `credit_ledger` rows with reason `runtime_migration` (metadata keeps the
   original cents and source bucket), then zero the runtime balance columns. Idempotent:
   a user already carrying a `runtime_migration` row is skipped.
2. **Charging.** `chargeRuntime()` stops draining a dollar wallet and becomes a thin
   wrapper that converts meter cents to credits and calls `spendCredit` with the meter
   in metadata. `runtime_ledger` keeps recording every meter tick in cents, so per-meter
   and per-project economics, caps and the admin dashboard keep working unchanged.
3. **Spend caps** stay in dollars internally and keep blocking before the credit charge —
   a cap is a deliberate ceiling, not a balance problem. Project pause on cap hit is
   unchanged.
4. **Free grant.** The existing $5/$10 grant rule becomes a credit grant on the same
   trigger (first upgrade or first top-up, one time ever), granted as non-expiring
   credits instead of dollars.
5. `PETAL_UNIFIED_BALANCE` and the fallback module are no longer needed once charging is
   direct; the module stays in place for one release as a no-op safety net, then is
   removed.

### Files

- `src/components/BillingSheet.tsx` — restructure + copy rewrite; absorbs usage
  breakdown, project breakdown and spend cap from the Cloud sheet.
- `src/components/CloudBalanceSheet.tsx`, `RuntimeTopupModal` — removed; entry points in
  `SiteHeader.tsx`, `MobileNavSheet.tsx`, `AccountHubGrid.tsx`, `routes/profile.tsx`
  drop the item.
- `src/server/runtime-wallet.server.ts` — charge path switches to credits.
- `src/lib/runtime-wallet.ts` — reads usage/caps only, no balance.
- New migration for the conversion; `credit_ledger` gains the `runtime_migration` reason.
- Low-balance prompts in `/builder` point at credits, not a dollar top-up.

### Verification

Type check and the full suite after each step; migration dry-run against real rows
first (report totals converted before applying); then a live check that a Cloud/AI action
draws down credits and shows in the breakdown.

## Worth knowing

No prices change — packs, Pro/Business, the ₦5,000 minimum and Paystack all stay as they
are. The internal ledgers stay intact for accounting; this is a customer-facing
unification, not a rewrite of billing.
