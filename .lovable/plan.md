# Petal Growth Engine: viral waitlist + referral

## What the best do (research)

- **Robinhood (~1M pre-launch signups):** the confirmation page *is* the product. After joining you immediately see **your position in line** and "move up the list — invite friends". Each referral bumps you up. Position + scarcity + a share link, nothing else.
- **Superhuman (180k waiting, $30/mo):** the wait was deliberate. Position emails, personal onboarding on approval, and hand-picked batch invites. Lesson: **approval must feel personal and earned**, not automated spam.
- **Dropbox / Perplexity Comet:** referrers get **product value** (storage, Pro months, credits), not swag. Two-sided rewards convert far better than one-sided.
- **Academic finding (Tuck/Chicago Booth):** line-jumping by referral is only accepted when the rule is **transparent and applies to everyone** — hidden queue-jumping breeds resentment.
- **Common failure mode:** treating waitlist emails as a list you own. Signup ≠ user. Most lists go cold in 2–3 weeks without touchpoints.

**Direct answer to your question:** no — a waitlist signup is *not* a user. It's an intent signal with a short shelf life. The whole design below is about (a) making each signup recruit more signups, and (b) shrinking the gap between "joined" and "built their first app".

## Proposed system for Petal

### 1. Referral loop (the core)
- Every signup gets a code (`petal.../r/ab12cd`) and a shareable link.
- Post-signup screen becomes a **status page**, not a dead-end "thanks": position in line, people behind you, referral link with one-tap copy + WhatsApp/X/IG share, and a live counter.
- **Referral math (transparent, shown on the page):** each verified referral moves you up 15 spots; 3 referrals = instant approval + auto-invite email. Milestones at 1 / 3 / 10.
- Anti-abuse: referrals only count on a distinct verified email; self-referral, same-IP and disposable-domain referrals silently don't count toward jumps.

### 2. Two-sided reward, paid in Petal credits
- Referrer: bonus build credits granted at first sign-in for each friend who signs in (not merely joins).
- Friend: a welcome credit bump, so the invite is worth *receiving*. This is the single biggest conversion lever and reuses the existing wallet/credit ledger.
- Credits only unlock on sign-in, so the incentive is to bring real builders, not email addresses.

### 3. Approval → activation, not just access
- Approve & invite already exists; add **auto-approve rules** (3+ referrals, or admin-set daily drip of N people) so growth doesn't depend on you clicking.
- Invite email gets a **24-hour urgency window** and lands the user directly in the composer with a starter idea prefilled.
- If an approved person never signs in: nudge at day 2 and day 7, then release the spot.

### 4. Keeping the list warm
- A short "while you wait" sequence reusing the existing template system: day 0 confirmation (exists), day 3 "here's what people are shipping with Petal", day 7 "you moved up / here's your link again".
- Leaderboard email to top referrers monthly.

### 5. Public proof surfaces
- Live signup counter + recent-builds strip on the landing page (social proof drives the share).
- Approved builders' public projects (gallery) linked from the waitlist status page — this is Petal's unfair advantage: the waitlist can *see* what they're waiting for.

### 6. Post-launch: the loop doesn't stop
The same referral primitives keep running after waitlist mode is off — invite a friend, both get credits — so the growth engine survives the launch instead of being thrown away.

### 7. Admin instrumentation
Waitlist tab gains: referral leaderboard, K-factor (invites sent → signups → sign-ins), source breakdown, conversion funnel (joined → approved → signed in → first build), and auto-approve controls.

## Technical outline

- **DB:** add `referral_code`, `referred_by`, `position`, `referral_count`, `invited_at`, `first_signin_at` to `waitlist_signups`; new `waitlist_referrals` (referrer, referred, status, counted_at) with unique constraint on referred email. Grants + RLS as usual; all reads via admin/service paths.
- **Public routes:** `/api/public/waitlist` extended to return status (position, count, code); new `/r/$code` route that sets the referral attribution then redirects to the waitlist form.
- **Status page:** new `/waitlist/status?token=…` (opaque token emailed + stored locally) so people can return to their position without an account.
- **Credits:** grant through the existing `grant_credits` / runtime-ledger RPCs at first sign-in, keyed idempotently on the referral row so retries can't double-pay.
- **Emails:** three new templates in the existing registry (`waitlist-position`, `waitlist-referral-milestone`, `waitlist-nudge`), sent through the existing queue with per-recipient idempotency keys.
- **Anti-abuse:** email normalization (gmail dots/plus), IP + user-agent heuristics already captured on signup, disposable-domain blocklist.

## Rollout order

1. Referral codes + attribution + status page with position & share link (the loop).
2. Two-sided credit rewards on first sign-in.
3. Auto-approve rules + activation-focused invite email + nudges.
4. Admin leaderboard, funnel metrics, drip controls.
5. Warm-up email sequence and public proof surfaces.
6. Flip referrals on permanently for post-launch growth.

## Open choices

- Reward size: I'd suggest a modest credit grant per referral with a cap (e.g. first 10 referrals) so it stays affordable — exact numbers are yours to set.
- Whether referrals should *instantly* approve at 3, or just accelerate position. Instant approval grows fastest; position-only keeps quality control with you.
