# Petal Credit Philosophy (Credit System v2)

Petal is built for emerging markets, where a wasted payment is not an
inconvenience — it is a reason never to come back. Our monetization is
therefore optimized for long-term trust, not short-term credit consumption.

## The promise

**Petal charges only for successful AI work. Every deduction must feel earned.**

Three questions gate every billing change:

1. Would a first-time user feel treated fairly?
2. Would they happily recommend Petal after paying?
3. Could they feel cheated?

If any answer is wrong, the experience gets redesigned — not the price.

## Rules

### 1. Charge after success, never before
Credits are settled **once**, after AI generation completes, from the actual
work done in that turn. No pre-charging, no realtime metering, no per-API-call
billing, no charging while streaming.

- Balance is *checked* before a turn (`checkCreditBalance`, floor of 1 credit)
  — a check writes nothing and takes nothing.
- Settlement happens in `settle_build_charge`, which is idempotent on the turn
  id, so a retried request can never double-charge.

### 2. Failed builds cost zero
If a turn fails for any reason — AI timeout, model failure, provider outage,
OpenRouter error, internal exception, verification failure — the user loses
nothing, because settlement is never reached.

### 3. Repairs are Petal's responsibility
Auto-repair passes, retry loops, import fixes, dependency fixes, runtime fixes
and verification retries run on Petal's tab. Internal cycles are excluded from
the priced usage array; auto-fix turns are skipped at settlement entirely.

### 4. Deployment is separate from generation
If generation succeeded, the user already paid for their application. A later
deployment failure never triggers regeneration and never costs credits.
"Retry deployment", "Repair deployment" and "Retry publish" are free actions.

### 5. Purchased credits never expire
A customer who buys credits owns them permanently. There is no expiry date on
top-up lots, no expiry worker, and no expiry messaging. Subscription credits
may still reset each billing cycle — only purchased credits are permanent.

### 6. Hybrid billing, one drain order
Subscriptions and top-ups coexist. Credits always drain:

```text
Free credits  →  Subscription credits  →  Purchased credits
```

Purchased credits are consumed last, precisely because they never expire.

### 7. Transparency without jargon
Every successful build shows what it cost and why, in plain language:
prompt processing, code generation, backend generation, verification, AI
reasoning. We never expose token counts, model names, or provider pricing.

### 8. Pricing stays simple
Users buy credits. Petal chooses models internally. Premium models may consume
more credits in future, but that complexity stays behind the credit system.

## Where this lives in code

| Guarantee | Implementation |
| --- | --- |
| Post-success settlement | `src/routes/api/generate.ts` (settlement block) |
| Idempotent charge | `public.settle_build_charge` |
| Drain order | `public.spend_credit` |
| Repairs free | `body.isAutoFix` skip + internal cycles excluded from `priceTurn` |
| Deployment free | `src/routes/api/builds/trigger.ts` (no credit path) |
| No expiry | `public.apply_topup_purchase` (NULL expiry), `public.expire_topup_lots` (no-op), cron job unscheduled |
| Cost transparency | `src/lib/build-cost-summary.ts`, `src/components/BuildCostSummary.tsx` |
| Regression cover | `src/server/__tests__/billing-fairness.test.ts` |

Success is measured by user trust, transparency and fairness — not by
maximizing short-term credit consumption.
