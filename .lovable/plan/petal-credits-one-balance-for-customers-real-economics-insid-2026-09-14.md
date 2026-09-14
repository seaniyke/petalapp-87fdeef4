# Petal Credits: one balance for customers, real economics inside

Ads are live, so this plan is ordered by what protects the business first and what customers notice first. Nothing here changes your Pro/Business prices or credit-pack sizes — the only pricing rule enforced is the ₦5,000 minimum purchase.

## What I found that shapes the plan

- Petal runs **two money systems**: build credits and a separate runtime cents wallet. Customers see both. That is the main confusion.
- **Image generation charges twice** for one image (1 credit + 5¢ runtime). Real over-billing, fix first.
- **Cost is recorded on 19 of 5,168 AI calls.** Petal cannot currently prove its own margin. Everything else depends on fixing this.
- Build compute, verification, deploy, hosting and failed builds (27.5% of builds) are paid by Petal and measured nowhere.
- Turn pricing is already token-derived and charged once per turn — good foundation, keep it.

## Phase 1 — Stop the leaks (ship first)

1. Image generation charges **once**, in Petal Credits only. The runtime deduction becomes an internal cost record, not a customer charge.
2. Audit and correct `topup_lots.credits_remaining` so purchased credits decrement accurately and cannot be spent twice. Additive migration, no balance is destroyed; any drift found is reported before correcting.
3. Idempotency sweep on every charge path (build callback, image retry, payment webhook, mobile callback, runtime meter) — one event, one charge, always with a ledger row.

## Phase 2 — Measure honestly (the foundation)

4. Every AI call records provider, model, feature, input/output tokens, cached tokens, cost, and a **confidence label: actual / estimated / unknown**. Never a fake $0. OpenRouter's returned usage is treated as actual where available; the internal price table is only a fallback.
5. A **turn economics record** per user turn: credits charged, AI calls, tokens, models, agent rounds, build/verify/deploy durations, image count, result, refund, retries, and total internal variable cost with its confidence label.
6. The builder reports its own timings (install, typecheck, build, Playwright, deploy) so build cost is derived from real minutes at a configurable rate — never presented as an invoice.

## Phase 3 — One balance for the customer

7. **Petal Credits** becomes the single balance customers see, buy and spend. Runtime/cloud usage converts into credits at centrally configured rates.
8. Internally the existing ledgers stay, each usage event tagged with a category: ai, build, runtime, image, mobile_build, deployment, storage, bandwidth, app_ai. Customers never see these.
9. `app_ai` is wired for accounting only — measurable, not billable, until you switch it on.
10. Customer UI shows balance, how to top up, what uses credits, and history. No costs, tokens, providers or margins anywhere near it.

## Phase 4 — Pricing plumbing (no price changes)

11. All rates move into config/database: credit packs, subscription credits, internal cost-per-credit target, AI/build/runtime/image/mobile internal rates. Nothing hard-coded across files.
12. **₦5,000 minimum purchase**, enforced server-side at checkout, with currency-aware equivalents from a configurable rate and sensible rounding per currency. Note: today's smallest packs sit below that floor, so they are deactivated rather than deleted — history and existing balances stay.

## Phase 5 — Admin economics and guardrails

13. Admin-only economics dashboard: revenue, credits consumed, variable cost, contribution, margin; build stats with failure rate and p75/p90/p95 cost; AI cost by provider/model/feature; runtime usage; user and project rankings; and a **data-coverage line** (% actual / estimated / unknown) so no decision is made on thin data.
14. Configurable internal alerts: failure rate, rising build cost, expensive projects, free users over cost ceiling, margin below target.
15. Free-tier cost ceiling: when a free user's variable cost gets excessive, Petal **degrades gracefully** — cheaper model routing, fewer repair rounds, tighter context — never a scary message. Existing per-turn, per-project and per-workspace caps stay.

## Phase 6 — Prove it

16. Test matrix from your brief: purchases (minimum, larger, failed, duplicate callback, refund, insufficient), builds (success, failure, retry, duplicate callback), AI cost capture in all three confidence states, image charged exactly once, runtime metering with duplicate events, top-up lots across partial spend/multiple lots/expiry, and the admin dashboard's numbers.
17. Then, and only then, a separate written pricing recommendation based on real measured margin. No price move without your approval.

## Technical notes

- New tables (additive): `turn_economics` (one row per turn, owner-scoped RLS, explicit grants) and cost-confidence columns on `ai_call_log`. No existing billing column is renamed or dropped.
- New config table for internal rates + pricing constants; `credit-pricing.server.ts`, `runtime-wallet.server.ts` and `billing-pricing.server.ts` read from it with today's values as defaults, so behaviour is unchanged on day one.
- Credit conversion for runtime usage happens in one place so the two ledgers stay intact underneath.
- Every phase ships behind a flag defaulting to current behaviour, matching the existing flag convention.
- Constraints respected: Paystack stays, Supabase Cloud stays, no DigitalOcean, no new payment provider, no rebuild.

## Suggested sequence

Phases 1 and 2 together as the first change — they stop the over-billing and start the measurement clock while the ads run. Phase 3 next, since that is the visible simplification.
