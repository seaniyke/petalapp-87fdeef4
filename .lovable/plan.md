# Runtime Wallet — Cloud + AI usage, like Lovable

## What changes for the user

Two clearly separated pockets:

1. **Build credits** (today) — pay subscription (Free/Pro/Business) for the AI that *writes your code*. No change.
2. **Runtime wallet** (new) — pays for the things that cost money *after* code is written:
   - Managed backend hours
   - Image generation
   - AI features inside the user's app (calls to Lovable AI gateway from generated code)
   - Custom domain provisioning

Every workspace gets a **free $10 monthly allowance** that resets on the 1st. When it runs out, the wallet falls back to a **top-up balance**. Free-plan users can use the allowance but can't top up. Pro/Business can top up.

Per-project and workspace **spend caps** prevent runaway bills — once hit, runtime services pause until the user raises the cap or the next month rolls over.

## UI

A new **"Cloud & AI balance"** sheet (mirrors the screenshot you uploaded), opened from the account dropdown and from a new banner inside `/builder` when balance is low.

```text
┌──────────────────────────────────────────┐
│ Cloud + AI                               │
│ Monthly free resets 1 May 2026           │
│                                          │
│ [ Top up ]              $9.40            │
│                         Top-up balance   │
├──────────────────────────────────────────┤
│ Cloud   ⓘ   $25 / $25  Free used         │
│             $24.32     Top-ups used      │
│                                          │
│ AI      ⓘ   $1 / $1    Free used         │
│             $8.64      Top-ups used      │
├──────────────────────────────────────────┤
│ Project breakdown                    ⌄  │
│ • KeshPay      $4.20 this month          │
│ • Petal        $1.10 this month          │
│ Spend cap: ₦5,000/mo  [edit]             │
└──────────────────────────────────────────┘
```

Top-up modal offers fixed packs (₦1,500 / ₦5,000 / ₦20,000) with a **"Custom amount"** option, paid through the existing Paystack flow.

## Pricing internals (admin-tunable)

Stored in `system_settings` so you can adjust without redeploying:

| Meter | Default unit price | Charged when |
|---|---|---|
| Managed backend | $0.02 / hour | Hourly cron, only while project active |
| Image generation | $0.02 / image | On `generate-image.ts` success |
| App AI (gemini-flash) | $0.001 / 1K tokens in, $0.002 / 1K tokens out | On generated-app AI call |
| App AI (gpt-5-mini) | $0.005 / 1K tokens in, $0.015 / 1K tokens out | On generated-app AI call |
| Custom domain | $1.50 / month | On primary domain set |

Free monthly allowance: **$10 USD** per workspace, applied first before top-ups drain.

## How it slots into existing code

- Petal already has `user_wallets`, `topup_lots`, `credit_ledger`, `paystack_transactions`, and a working Paystack webhook. The wallet is **additive**, not a rewrite — credits stay for build, USD cents are a new currency for runtime.
- Existing `apply_paystack_topup` RPC stays for build-credit packs. New `apply_paystack_runtime_topup` RPC for runtime wallet.

---

## Technical implementation

### 1. Schema (one migration)

```sql
-- Per-workspace runtime wallet (separate from credit balance on user_wallets)
ALTER TABLE public.user_wallets
  ADD COLUMN runtime_free_balance_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN runtime_topup_balance_cents BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN runtime_free_reset_at DATE NOT NULL DEFAULT (date_trunc('month', now())::date + INTERVAL '1 month')::date,
  ADD COLUMN workspace_cap_cents BIGINT;  -- nullable = no cap

-- Per-project caps (nullable = no cap)
ALTER TABLE public.projects
  ADD COLUMN spend_cap_cents BIGINT,
  ADD COLUMN runtime_paused BOOLEAN NOT NULL DEFAULT false;

-- Append-only ledger of every runtime debit/credit
CREATE TABLE public.runtime_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  project_id UUID,
  meter TEXT NOT NULL,        -- 'backend_hour' | 'image_gen' | 'app_ai' | 'domain' | 'topup' | 'free_grant'
  delta_cents BIGINT NOT NULL,  -- negative = debit
  free_after_cents BIGINT NOT NULL,
  topup_after_cents BIGINT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.runtime_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owners view ledger" ON public.runtime_ledger
  FOR SELECT USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'));

-- Atomic charge function: free first, then top-up, respecting caps
CREATE FUNCTION public.charge_runtime(
  _user_id UUID, _project_id UUID, _meter TEXT,
  _amount_cents BIGINT, _metadata JSONB DEFAULT '{}'
) RETURNS TABLE(ok BOOLEAN, reason TEXT, free_after BIGINT, topup_after BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$ ... $$;

-- Atomic credit (top-up / monthly grant)
CREATE FUNCTION public.credit_runtime(
  _user_id UUID, _meter TEXT, _amount_cents BIGINT, _metadata JSONB
) RETURNS VOID ...;

-- Monthly reset trigger via pg_cron
SELECT cron.schedule('runtime-monthly-reset', '0 0 1 * *', $$
  SELECT public.runtime_apply_monthly_grant();
$$);
```

### 2. Server-side metering layer

New file `src/server/runtime-wallet.server.ts` exporting:

- `chargeRuntime({ userId, projectId, meter, cents, metadata })` — calls `charge_runtime` RPC, returns `{ ok, reason }`. Returns `{ ok: false, reason: 'cap_exceeded' | 'insufficient_balance' }` when caller should pause.
- `getRuntimeBalance(userId)` — returns `{ free, topup, freeResetAt, breakdown }`.

Wire it into:

- `src/server/managed-backend.server.ts` — new hourly cron at `/api/public/cron/runtime-meter` charges `$0.02 × active_projects` per workspace; pauses backend when `chargeRuntime` returns `cap_exceeded`.
- `src/routes/api/generate-image.ts` — charge `$0.02` per successful image; refuse if balance can't cover.
- `src/server/generate.server.ts` — for **user-app** AI calls (not the builder AI itself), meter token usage. Builder AI continues to draw from the existing credit system.
- `src/server/petal-subdomain.server.ts` / `domains.ts` — charge `$1.50` when a custom domain is set primary.

### 3. Top-ups via Paystack

- Extend `src/routes/api/billing/initialize.ts` `purpose` enum with `"runtime_topup"` (custom amount) and reuse the existing Paystack init/verify code paths.
- New row kind in `paystack_transactions` (already has `purpose` text col — no schema change).
- Webhook handler in `src/routes/api/public/paystack/webhook.ts` calls new `apply_paystack_runtime_topup` RPC that calls `credit_runtime` and inserts a ledger entry.
- Fixed packs stored in a small new table `runtime_topup_packs (code, label, amount_cents, currency_code)` so admin can edit without redeploys.

### 4. Spend caps

- Project-level cap UI in `ProjectSettingsSheet.tsx` (new "Spend cap" field).
- Workspace-level cap UI in the new Cloud & AI balance sheet.
- `charge_runtime` RPC enforces caps atomically — checks `SUM(month-to-date debits)` per project and per workspace before allowing the debit.
- When a cap is hit: `runtime_paused` is flipped on the project; managed backend is paused; user gets an in-app banner + email (reuses existing email infra).
- Warning email at **80%** of free allowance and at **80%** of cap (uses existing `email_send_log` system).

### 5. UI (new + edits)

**New files:**

- `src/components/CloudBalanceSheet.tsx` — the screenshot-style sheet, with "Top up" button and project breakdown.
- `src/components/RuntimeTopupModal.tsx` — pack picker + custom amount, Paystack flow.
- `src/components/SpendCapEditor.tsx` — reusable cap input (Naira, with USD equiv).
- `src/lib/runtime-wallet.ts` — client helpers (`getRuntimeBalance`, `initiateTopup`).

**Edited files:**

- `src/components/SiteHeader.tsx` — add "Cloud & AI balance" item to the user dropdown.
- `src/components/CreditBadge.tsx` — keep as-is, but tooltip notes it's *build credits*.
- `src/components/BillingSheet.tsx` — add a "Runtime usage" link/section pointing to the new sheet.
- `src/routes/builder.tsx` — low-balance banner; cap-paused banner with "Raise cap" button.
- `src/components/ProjectSettingsSheet.tsx` — spend cap field.
- `src/routes/admin.billing.tsx` — admin view of runtime meter prices + per-workspace usage.

### 6. Order of work

1. Migration (schema + RPCs + cron).
2. `runtime-wallet.server.ts` + RPC tests via `read_query`.
3. Paystack `runtime_topup` purpose + webhook handler + RPC.
4. Cloud & AI balance sheet + top-up modal.
5. Wire metering into managed backend cron.
6. Wire metering into `generate-image.ts` and user-app AI calls.
7. Spend caps UI + enforcement + warning emails.
8. Admin view + price knobs.

Estimate: ~2–3 implementation passes, mostly because the metering integration touches several existing server modules.

---

## Out of scope for v1 (call out so we don't scope-creep)

- Per-seat or per-collaborator wallets (workspace-level only for now).
- Auto-recharge ("top up another ₦5,000 when balance drops below ₦500"). Easy v2.
- Refunds for failed image gens / failed backend hours — v1 just doesn't charge on failure.
- Naira-native pricing (we store in USD cents internally, display in user's preferred currency using existing `billing_currencies.usd_rate`).
