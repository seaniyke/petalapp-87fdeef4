## What we're building

A **second option** for connecting a backend to a Petal project. Today users only have "BYO Supabase" (paste URL + keys). We'll add **"Auto-provision (Managed by Petal)"** — Petal creates a real Supabase project for them under our paid Supabase org, wires it in, and bills the user a recurring monthly fee.

BYO stays as the free option. Auto-provision is the paid one.

---

## How the money works (so this isn't a loss-leader)

- Supabase charges **us** ~$10/month per Micro project on our Pro org, plus base fees and overages.
- We charge the user **$15/month per provisioned backend** (configurable via `billing_addons`). Margin covers Supabase cost + Paystack fees + a little headroom.
- Paystack doesn't have great recurring-card support across all our currencies, so we model "monthly" as a **renewable 30-day slot** — exactly like the existing `domain_slots` pattern. User pays again every 30 days; if they don't pay, we auto-pause their Supabase project (stops the meter on our side).

---

## User flow

1. In ProjectSettings → Backend, user sees two cards: **"Connect existing"** (today's flow) and **"Auto-provision (Petal-managed)"** (new, with "$15 / month" badge).
2. Clicks Auto-provision → opens new `BuyBackendSlotDialog` (same shape as `BuyDomainSlotDialog`) → picks currency → goes to Paystack → returns to `/billing/return`.
3. On successful payment, the verify endpoint:
   - Creates a `backend_slot` row (30-day expiry).
   - Kicks off Supabase project creation via the Management API.
   - Updates `project_backends` row with `provider = 'managed_petal'`, `status = 'provisioning'` then `'ready'` once Supabase reports the project is ACTIVE_HEALTHY.
4. UI polls status. Once `ready`, the next AI generation includes the existing `backendKit` files — same code path as BYO, the generated app doesn't know the difference.
5. ~3 days before slot expiry, we email the user a renewal link. If they don't renew within 30 days, the Supabase project gets paused (we keep the data, stop the bill).

---

## Architecture

```text
                 ┌─────────────────────────┐
   user ──pay──▶ │ /api/billing/initialize │ ──▶ Paystack
                 └─────────────────────────┘
                              │
                       webhook + verify
                              ▼
                 ┌─────────────────────────┐
                 │  apply_paystack_         │
                 │  backend_slot RPC        │  (new)
                 │  - inserts backend_slots │
                 │  - kicks provisioner     │
                 └─────────────────────────┘
                              │
                              ▼
                 ┌─────────────────────────┐
                 │ supabase-mgmt.server.ts │  (new)
                 │  POST /v1/projects      │
                 │  poll status            │
                 │  fetch anon key         │
                 └─────────────────────────┘
                              │
                              ▼
                 ┌─────────────────────────┐
                 │   project_backends      │  (existing table)
                 │   provider='managed_petal' │
                 │   status='ready'        │
                 └─────────────────────────┘
```

---

## Database changes (one migration)

1. **New table `backend_slots`** — mirrors `domain_slots`:
   - `user_id`, `project_id`, `paystack_reference`, `amount_minor`, `currency_code`, `purchased_at`, `expires_at` (purchased_at + 30 days), `consumed_by_backend_id`, `status` ('active' | 'expired' | 'cancelled').
   - RLS: user can SELECT their own.

2. **Add `backend_slot` to `billing_addons` catalog** (data insert) with `code = 'managed_backend_monthly'`, `price_cents = 1500`, `duration_days = 30`.

3. **Extend `project_backends`**:
   - `provider` already exists (`byo_supabase` today). Allow new value `managed_petal`.
   - Add nullable `supabase_project_ref` (text), `provisioning_started_at`, `paused_at`.
   - Add new status values: `'provisioning'`, `'paused'`, `'failed'`. Existing `'ready'` is reused.

4. **New RPC `apply_paystack_backend_slot`** — copy of `apply_paystack_domain_slot` but inserts into `backend_slots`, idempotent on `paystack_reference`.

5. **New RPC `expire_backend_slots`** — daily job: for each `backend_slots` row with `expires_at < now()` and no successor row, mark the linked `project_backends.status = 'paused'`. We don't delete; user can renew and we resume.

---

## New files

- `src/server/supabase-mgmt.server.ts` — wrapper around the Supabase Management API (`https://api.supabase.com/v1/projects`). Methods: `createProject`, `getProjectStatus`, `pauseProject`, `restoreProject`, `getApiKeys`. Uses a new `SUPABASE_MGMT_PAT` secret (Personal Access Token from our Supabase org).
- `src/server/managed-backend.server.ts` — orchestration: `provisionForProject(projectId, slotId)` does create → poll until ACTIVE_HEALTHY (with 5-min timeout) → fetch anon key → upsert `project_backends`. On failure, marks backend `failed` and logs the error so user can request a refund.
- `src/routes/api/backend.ts` — add new actions:
  - `?action=provision-status` (poll progress for the UI).
  - `?action=cancel-managed` (user cancels future renewals).
- `src/components/BuyBackendSlotDialog.tsx` — clone of `BuyDomainSlotDialog`, points at the new addon code.
- `src/components/ManagedBackendCard.tsx` — shown inside the existing backend section of `ProjectSettingsSheet`. States: not-purchased / provisioning / ready / paused / failed. "Renew" button when within 7 days of expiry.

---

## Files to modify

- `src/routes/api/billing/initialize.ts` — already supports `purpose: 'addon'` with a `projectId`. The new addon code drops in with no code change. (Just verify project ownership, which it already does.)
- `src/routes/api/billing/verify.ts` and `src/routes/api/public/paystack/webhook.ts` — branch on `tx.item_code` to call the new `apply_paystack_backend_slot` RPC (or a generic `tx.purpose === 'addon' && itemCode.startsWith('managed_backend_')` check), then enqueue provisioning.
- `src/server/backend-connector.server.ts` — no change needed; `lookupBackendForGenerate` already returns `{url, anonKey}` from `project_backends` regardless of provider. The generator and `backendKit` work as-is.
- `src/components/ProjectSettingsSheet.tsx` — add the new "Auto-provision" card alongside the existing BYO connector.
- `supabase/config.toml` — no change.

---

## Secrets needed

We need to add **one** new secret:
- `SUPABASE_MGMT_PAT` — a Personal Access Token from our Supabase organization, with project create/read/delete scopes. I'll request this via `add_secret` after you approve the plan. You generate it at https://supabase.com/dashboard/account/tokens.

We also need to confirm: **which Supabase organization** (org slug) should new projects be created under? I'll ask during implementation — you'll either tell me the slug or we'll look it up from your account.

---

## What we will NOT do in this iteration

- **No Supabase OAuth.** Projects are created in *our* org, not the user's. (They never see Supabase, that's the point.)
- **No live database admin UI.** User cannot run SQL or create tables from Petal yet — they get the connection wired in, and the AI writes migrations into `MIGRATION:` blocks the same way it does today for BYO.
- **No auto-cancellation refunds.** If provisioning fails, we surface an error and a "contact support" button — no automatic Paystack refund yet.
- **No proration.** A renewal is just a new 30-day slot starting from today.

---

## Risk callouts

1. **Supabase Management API rate limits** — creating projects is rate-limited (~60/hour per org). For launch volume that's fine; if we ever hit it we'll need a queue.
2. **Provisioning latency** — a fresh Supabase project takes 60–180 seconds to become ACTIVE_HEALTHY. The UI will show a progress card and poll every 5 seconds.
3. **Org-level cap** — Supabase Pro org has a soft cap (~10 projects free, then $10 each). At ~70 paying users we'll hit that and start paying per-project. The $15/mo price already accounts for this.
4. **What happens if Petal goes away?** Data lock-in. We should document and ship a "download my Supabase project credentials" button so users always have an exit path. (Included in this plan as a small UI addition on the ManagedBackendCard.)
