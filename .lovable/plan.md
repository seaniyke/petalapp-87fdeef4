## Cloud + AI billing audit

I traced the system end-to-end: DB migrations, the `charge_runtime` / `apply_paystack_runtime_topup` RPCs, the server helpers, the UI surfaces (CloudBalanceSheet, RuntimeTopupModal, EnableBackendFromCloudDialog, RuntimeLowBalanceBanner), and the actual charge call sites (hourly cron, image generation).

### How it actually works (confirmed)
- Two balances per user: `runtime_topup_balance_cents` (paid, never expires) + `runtime_free_balance_cents` (the $5/mo grant).
- Grant is **locked until first paid top-up**. First top-up sets `runtime_topup_qualified_at` and grants $5 immediately. Subsequent months auto-rollover to $5 on next charge.
- Spend order: free → top-up. Insufficient funds opens a 48h grace window on the project, cron pauses after grace expires.
- $10 (1000¢) is the floor to enable a managed backend (enforced in `/api/backend.ts` and SQL `can_enable_managed_backend`).
- Meters: `backend_hour` 2¢/hr (cron), `image_gen` per image, plus `app_ai`, `domain` defined.

### Issues found

**1. UI still shows the $10 grant (wrong amount).** `src/lib/runtime-wallet.ts` exports `MONTHLY_FREE_GRANT_CENTS = 1000` and the type comment says "currently 1000 ($10)". `src/server/runtime-wallet.server.ts` returns `monthlyFreeGrantCents: 1000` and a comment "currently $10 = 1000". DB grant is $5 — UI shows $10. → cap on `UsageRow` in CloudBalanceSheet shows "$X / $10" instead of "$X / $5".

**2. Top-up packs don't match the $10 floor.** Active packs in DB:
   - `runtime_starter` ₦1,500 = $1
   - `runtime_standard` ₦5,000 = $3.50
   - `runtime_pro` ₦20,000 = $15
   When EnableBackendFromCloud opens the modal with `minUsdCents=1000`, only the $15 pack qualifies, so smaller packs are dimmed and users have to either jump to ₦20,000 or use Custom amount. There is no $10 pack. The starter pack at $1 is also useless — it can never enable a backend and doesn't even cover one month of free grant. **Fix:** add a $10 pack (~₦15,000) and either drop or repurpose the $1 starter.

**3. Image generation charges silently fail open.** In `src/routes/api/generate-image.ts` (line ~195), when `chargeRuntime` returns `!ok` (insufficient balance / cap exceeded), we `console.warn` and **still return the generated image**. The image is delivered without a successful debit — free usage leak. **Fix:** if `!charge.ok`, return 402 with the same shape used for `runtime_paused` above, before responding with the image URL. (Charge BEFORE doing the work, or accept the leak only if the work is already done — currently the image is generated then we try to charge, which is the worst order.)

**4. RuntimeTopupModal copy is stale.** Description still reads "...only spent after your free monthly allowance." Fine in spirit but the wider modal has no other free-grant context now. Tighten to "Top-ups never expire. After your first top-up you also get $5/mo free Cloud credit." — accurate and motivating.

**5. CloudBalanceSheet hardcoded AI cap.** `freeCapCents={100}` for the AI usage row is a placeholder that doesn't correspond to any real cap. The free grant is one $5 bucket shared across Cloud + AI, not a separate AI cap. Either remove the AI free-cap row entirely or show "Top-ups used" only for AI until we actually attribute free-grant usage by meter.

**6. RuntimeLowBalanceBanner threshold.** Triggers at `< $1` total (free + topup). With the $5 grant, that means "low" only fires after the user has spent $4+ of free + all top-up. Reasonable, but the message says "Cloud + AI balance is low ($X.XX)" — when the user is "low" because they've never topped up (totalCents = 0, not yet qualified), we should say "no balance — top up to enable Cloud + AI features", not "low".

**7. No automated coverage of the cron + RPC interaction.** Out of scope for a copy/UX audit, but worth flagging: the only way to know `apply_paystack_runtime_topup` actually grants $5 on first top-up is to top up. No users have done so yet (ledger is empty). I'll verify by reading the migration logic — looks correct — but recommend a manual end-to-end test with a small Paystack test charge once these fixes ship.

### Proposed fixes (code changes)

1. `src/lib/runtime-wallet.ts` — change `MONTHLY_FREE_GRANT_CENTS` from `1000` to `500`. Update the field comment.
2. `src/server/runtime-wallet.server.ts` — change returned `monthlyFreeGrantCents: 1000` to `500`. Update the type comment.
3. `src/routes/api/generate-image.ts` — when `!charge.ok`, return 402 with `error: "Cloud + AI balance exhausted — top up to keep generating images."` instead of warning and returning the image. Move/keep the charge so we don't deliver work we couldn't bill for.
4. `src/components/RuntimeTopupModal.tsx` — refresh description copy to mention the $5/mo grant unlocked after first top-up.
5. `src/components/CloudBalanceSheet.tsx` — split the $5 free grant correctly: show the grant as a single bucket above the per-meter usage breakdown, and remove the fake $1 AI cap. Cloud and AI rows show "Top-ups used: $X" only.
6. `src/components/RuntimeLowBalanceBanner.tsx` — special-case `totalCents === 0 && !qualifiedForFreeGrant` with a "Top up to start using Cloud + AI" message instead of "balance is low ($0.00)".
7. **Add a $10 top-up pack via migration** so the EnableBackend flow has a quick-pack option that exactly meets the floor. Suggested: `runtime_backend_floor` label "₦15,000" amount_cents 1000 sort_order 2 (between standard and pro). Optionally retire the $1 starter (it's confusing — too small to do anything meaningful).

### What I'm NOT changing
- The DB logic itself (`charge_runtime`, `apply_paystack_runtime_topup`, grace window, qualified-at) — verified correct.
- The $10 floor for managed backends — that's intentional.
- BillingSheet / build-credit system — separate concern, not part of Cloud + AI.

### Verification after the fix
- New user, no top-up: CloudBalanceSheet shows $0/$0, Cloud and AI rows show only "Top-ups used $0", banner says "Top up to start using Cloud + AI".
- After first $10 top-up: top-up balance shows $10, free balance shows $5, qualified flag set, all UI surfaces say $5/mo (not $10).
- Image gen attempt with empty wallet: returns 402, not 200.
- EnableBackend dialog: clicking "Top up" opens modal with the new $10 pack pre-selected as Recommended.