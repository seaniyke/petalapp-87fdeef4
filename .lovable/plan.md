# Launch audit: what isn't live that should be

I walked the whole project — routes, cron schedule, secrets, wallets, email queue, UI wiring — and compared it against what the code expects. Most of the system is genuinely live. Three things are not.

## What I confirmed is actually working

- Waitlist is on (`access.waitlist_mode = true`), 5 people already signed up, confirmation emails sending (196 emails logged).
- Email queue is self-arming through the database and is currently drained (0 queued).
- Crypto receiving wallets for USDT (TRC-20 + ERC-20), BTC and ETH are all real addresses, not placeholders.
- Logs viewer is mounted in the Cloud panel; Git sync is mounted in project settings.
- Scheduled jobs running: top-up expiry, period-end changes, domain-slot expiry, stalled-build reaper, monthly runtime grant, hourly backend metering, daily self-learning digest, mobile cert expiry, subscription renewal reminders.
- No stuck builds, no orphaned pending payments.

## Gap 1 — Crypto payments never auto-confirm (highest impact)

The background crypto verifier exists and is complete, but **nothing ever calls it**. The endpoint documents "Schedule: every 2–5 minutes" and there is no such scheduled job. Today a customer who pays in crypto stays "pending" forever unless someone hits the endpoint by hand.

Fix: add a scheduled job that calls the verifier every 3 minutes, authenticated with the same shared secret the endpoint already checks. Then confirm one full cycle runs clean.

## Gap 2 — The referral link is broken at the type level

`/r/{code}` (the whole viral growth loop) and the waitlist status page both navigate to `/auth` without the `redirect` value that route now requires. This is a real mismatch, not cosmetic noise — three type errors, all on the sign-up path we're about to market hardest.

Fix: pass an explicit `redirect` on all three links so referral landings and waitlist "Start building" buttons resolve correctly, then re-run the typecheck to zero.

## Gap 3 — Missing production keys

Referenced in code but absent from the secret store:

- `INTERNAL_HEALTH_TOKEN` — the internal health endpoint returns an error without it, so uptime monitoring can't be pointed at it.
- `PETAL_SIGNING_MASTER_KEY` — mobile signing profiles can't be encrypted, so mobile publish will fail on first real use.
- `RESEND_FROM_ADDRESS` — currently falls back to an empty string rather than a named sender.

Fix: I'll request these three as secrets. The remaining absent keys (`ALCHEMY_API_KEY`, `HELIUS_API_KEY`, `MORALIS_API_KEY`, `STRIPE_SECRET_KEY`) only affect optional generated-app features, not Petal itself — leaving those out is fine for launch.

## Not blocking launch

The database advisor lists 27 items, all INFO/WARN and all inherent to the design (security-definer functions that are intentionally callable, extensions in public, a public bucket). Nothing critical.

## Technical notes

- New cron job `petal-crypto-verify` calling `/api/public/cron/crypto-verify` on the stable production URL with the `x-petal-cron-secret` header, matching the pattern of the existing `net.http_post` jobs.
- Edits: `src/routes/r.$code.tsx` (line 39), `src/routes/waitlist.tsx` (lines 123 and 146).
- Verification: full typecheck to zero errors, then a manual verifier invocation to confirm a clean run.
