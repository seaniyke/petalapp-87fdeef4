
## What's actually happening

I traced the affected user (`ikemadu32@gmail.com`, sub `SUB_07cz5x57yw5aqbs`, plan Starter Pro NGN ₦1,600) end‑to‑end against `paystack_events`, `paystack_invoices`, `subscriptions` and `email_send_log`. The story is:

- **2026‑04‑30** `subscription.create` received → `next_payment_date = 2026‑05‑28`.
- **2026‑05‑28** Paystack fired `invoice.update` + `invoice.payment_failed`. The charge attempt against authorization `AUTH_ipkyt2xeaw` (Verve, last4 9598, PAYCOM) came back `status: failed`. Paystack rescheduled `next_payment_date` to `2026‑06‑28`.
- Our webhook ran `handleInvoiceFailed` → flipped the subscription to `status='attention'` and called `sendBillingEmail("payment-failed", …)`.
- **No row in `email_send_log`** for this user. The email was never even enqueued.
- **No "your plan is about to renew/expire" email** was ever sent either — because no such job exists in the project.

So this is really **two separate bugs**, both real, both my fault as the senior on this codebase:

### Bug 1 — Renewal/expiry reminder never existed for plan subscriptions
`src/lib/email-templates/backend-renewal-reminder.tsx` exists but is wired only to the *managed‑backend slot* cron (`runtime-backend-hour.ts`). Nothing scans `public.subscriptions` looking at `current_period_end` / `next_payment_date`, so users get zero warning before Paystack tries the renewal charge.

### Bug 2 — Renewal charge "fails silently" from the user's perspective
Two sub‑causes:

a. **The payment‑failed email is dropped by the Worker runtime.** In `src/routes/api/public/paystack/webhook.ts`, `handleInvoiceFailed` calls `sendBillingEmail(...)` with bare `void` (fire‑and‑forget). We're on Cloudflare workerd; when the webhook returns `200`, any in‑flight `fetch` from a non‑awaited promise is cancelled. That's why `email_send_log` has zero rows for this user even though Paystack delivered the event correctly (verified in `paystack_events`).

b. **We never actually re‑attempt or escalate the failed renewal.** Paystack only retries on its own monthly cadence (`cron_expression: "37 19 28 * *"` for this sub → next attempt 2026‑06‑28, a full month later). We don't tell the user "your card was declined, update it now" beyond a single best‑effort email, and we don't expose the Paystack manage link in the UI in this state.

Paystack docs confirm: for subscriptions, `charge.success` / `invoice.payment_failed` / `subscription.not_renew` / `subscription.disable` are the source of truth, and the standard recovery flow is "email the user the subscription **manage link** so they re‑authorize a card" — Paystack does *not* auto‑retry within the same billing period.

---

## Fix plan

### 1. Make webhook‑triggered emails actually leave the box
In `src/routes/api/public/paystack/webhook.ts`:
- Replace every `void sendBillingEmail(...)` in `handleChargeSuccess`, `handleInvoiceFailed`, `handleExpiringCards`, `markChargeFailed` with `await sendBillingEmail(...)` inside the existing `try`. The handler already returns 200 on success — awaiting only adds the time for one `fetch` to our own `/lovable/email/transactional/send`, which enqueues into pgmq and returns immediately. This is the actual root cause of "no email sent".
- Keep `sendBillingEmail` non‑throwing (it already swallows internally) so a flaky email still doesn't 500 the webhook back to Paystack.
- Add a single defensive `console.info("[paystack webhook] email enqueued", { template, userId, idempotencyKey })` so future "did we send it?" questions are answerable from worker logs.

### 2. Add a real "subscription renewing / failed / expiring" cron
New file `src/routes/api/public/cron/subscription-renewal-reminder.ts` (public route, `apikey` header pattern like the other crons). It does three passes against `public.subscriptions WHERE provider='paystack'`:

a. **Pre‑renewal reminders** (T‑7 / T‑3 / T‑1 days before `next_payment_date`, status `active`, `cancel_at_period_end=false`) → send a *new* template `subscription-renewal-reminder` ("Your *Starter Pro* plan renews on 28 May for ₦1,600").

b. **Payment‑failed nudges** (status `attention`, last reminder >72h ago, no successful invoice since) → send `subscription-payment-failed-followup` with the Paystack **manage link** (`getSubscriptionManageLink(subCode)`), so the user can swap card. Cap at 3 nudges over 14 days.

c. **Expired/canceled** (`current_period_end < now()` AND no successful charge since, OR `cancel_at_period_end=true` AND `current_period_end < now()`) → send `subscription-expired` once, flip wallet `plan_code` back to `free` via existing `cancel_paystack_plan` RPC.

Idempotency: use `idempotencyKey` shaped `sub-renewal-{subCode}-{YYYY-MM-DD}-{phase}` so re‑runs in the same day don't double‑send (the existing email queue already dedupes by `message_id`).

Schedule via `pg_cron` once a day at 09:00 UTC, calling
`https://project--fe869ce3-50d8-49d0-b2fe-829b0f7b4b1c.lovable.app/api/public/cron/subscription-renewal-reminder` with the project's anon key in the `apikey` header (canonical pattern from `schedule-jobs-options`).

### 3. Three new React Email templates
Under `src/lib/email-templates/`, registered in `registry.ts`:
- `subscription-renewal-reminder.tsx` — "Your {planName} renews on {date} for {amount}. Update card."
- `subscription-payment-failed-followup.tsx` — "We couldn't charge your card. Update payment method to keep {planName} active." CTA → Paystack manage link.
- `subscription-expired.tsx` — "Your {planName} plan ended. You're back on Free. Renew anytime."

All three reuse `PetalEmailLayout` like `backend-renewal-reminder.tsx` does.

### 4. UI surfacing of `status='attention'` (small, contained)
In `src/components/BillingSheet.tsx`, when the user's row has `status='attention'`, show a red inline banner above the plan grid: *"Your last renewal charge failed on {date}. Update your card to keep {plan}."* with a button that POSTs to the existing `/api/billing/subscription/manage-link` and opens the returned Paystack URL. This is the same data path that already powers cancel/manage — just shown when relevant.

### 5. One‑time backfill for the affected user
After deploy, manually fire the cron once. The 28‑May failure on `SUB_07cz5x57yw5aqbs` will hit pass (b) and the user gets the "update your card" email with the manage link today. No DB write needed beyond what the cron does itself.

---

## Files touched

| File | Change |
|---|---|
| `src/routes/api/public/paystack/webhook.ts` | `await` the 4 `sendBillingEmail` calls; add log line |
| `src/routes/api/public/cron/subscription-renewal-reminder.ts` | **new** — 3‑pass cron over `subscriptions` |
| `src/lib/email-templates/subscription-renewal-reminder.tsx` | **new** |
| `src/lib/email-templates/subscription-payment-failed-followup.tsx` | **new** |
| `src/lib/email-templates/subscription-expired.tsx` | **new** |
| `src/lib/email-templates/registry.ts` | register the 3 templates |
| `src/components/BillingSheet.tsx` | `attention`‑state banner + manage‑link CTA |
| migration | `pg_cron` schedule for the new endpoint, daily 09:00 UTC |

## What I'm explicitly NOT changing

- The Paystack webhook contract, signature verification, or idempotency on `paystack_events` — all of that is correct.
- The `subscriptions` schema — `status='attention'`, `next_payment_date`, `current_period_end` are all already populated correctly by the existing handlers.
- Paystack's own retry cadence (we can't override it). We compensate by emailing the user a manage link so they can self‑heal between Paystack's monthly attempts.
- The first‑charge success path (`handleChargeSuccess` for one‑shots) — that one already works; we're only `await`ing what was previously `void`.

## Verification after build

1. Re‑POST the stored `invoice.payment_failed` event from `paystack_events` against `/api/public/paystack/webhook` with a valid signature and confirm a `payment-failed` row appears in `email_send_log` with `status='sent'`.
2. Hit the new cron endpoint manually and confirm the affected user gets exactly one `subscription-payment-failed-followup` row.
3. Open the BillingSheet as that user and confirm the red "card declined — update" banner is visible.

Want me to proceed with this in build mode?
