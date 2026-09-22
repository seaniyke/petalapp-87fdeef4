# One balance, and a Cloud that knows what a project needs

Three pieces, in order. Each one ships on its own.

---

## 1. One balance (Kimble Credits everywhere)

Today there are still two pots: Kimble Credits (builds) and a separate cents
wallet for Cloud + AI. The single-balance switch exists but is **off** —
`PETAL_UNIFIED_BALANCE` is set nowhere, so Cloud/AI still drains the cents
wallet first and only falls back to credits. That is why customers still see
two numbers.

**What changes for you and your users**

- One number: Kimble Credits. Builds, Cloud, AI and Compute all draw from it.
- Any leftover cents balance converts to credits at the central rate, with a
  line in history showing the conversion. Nothing is lost.
- Top up once, use it for anything. Subscriptions keep granting monthly credits.
- "Plans & credits" becomes the only money screen: balance, top up, plan, and a
  short breakdown of where credits went (builds / Cloud / AI / Compute).

**How**

- One-off migration: for every user with `runtime_topup_balance_cents` or free
  grant cents, convert at `economics_config.target_variable_cost_per_credit_usd`,
  insert `credit_ledger` rows with reason `runtime_migration`, zero the cents
  columns. Idempotent — a user already carrying that row is skipped. Dry-run
  totals reported before applying.
- `chargeRuntime()` stops draining cents and becomes: caps check → convert cents
  to credits → `spendCredit` with the meter in metadata. `runtime_ledger` still
  records every tick in cents so internal economics, caps and the admin
  dashboard are untouched.
- `runtime-credit-fallback.server.ts` and the env flag are no longer needed;
  the module stays one release as a no-op, then goes.
- Spend caps stay in dollars internally and still block before the charge.
- Free grant becomes a credit grant on the same one-time trigger.
- Credit engine itself (`spend_credit`, three-bucket drain, charge-after-success)
  is **not touched**.

---

## 2. Kimble Compute — a real backend runtime tier

Railway is currently only Kimble's own build engine. This adds a second, separate
use: per-project containers for apps that need a server we can't fake.

- New `project_compute` record per project: Railway service id, environment id,
  region, status, internal URL, custom subdomain.
- Provisioning through the existing Railway GraphQL client
  (`src/lib/admin-builder-deploy.functions.ts` pattern, moved into a reusable
  `src/server/railway.server.ts`): create service in a dedicated Kimble team
  project, deploy the app's server image, set env vars from the project's
  secrets, return the URL.
- Generated apps reach it through the same injected client — a `compute` section
  alongside `auth` and `db`, so frontend code never changes when a project moves
  tier.
- Metering: an hourly cron (same shape as `runtime-backend-hour`) charges a
  `compute_hour` meter to credits. Idle containers sleep after a quiet period;
  abandoned ones are reaped. Never bills a sleeping container.
- Gated: paid plan or purchased credits (`hasFullAccess`), plus a platform
  capacity ceiling in `economics_config` so we can't be flooded.
- Compute failures degrade, never break: if provisioning fails the app keeps
  running on its current tier and the owner is told plainly.

---

## 3. Cloud decides the tier — the user never picks

One decision function, `resolveCloudTier(projectId)`, owns the answer. Three tiers
under one name, Kimble Cloud:

| Tier | What it is | Chosen when |
| --- | --- | --- |
| Kimble | Shared database, auth, REST | Default for every new app |
| Kimble + | The app's own Postgres, storage, raw SQL | Rows/users cross the shared ceiling, or the app needs SQL, storage buckets, or realtime |
| Kimble Compute | Isolated container | The app needs long-running work, background jobs, websockets, a custom server runtime, heavy file/media processing, or a non-JS dependency |

- **Intent at generation time**: the app spec already describes what the app does.
  A deterministic capability read (no extra AI call) maps requirements —
  "upload and process video", "run a scraper every hour", "socket chat",
  "ffmpeg / python / long job" — to a required tier, recorded on the project.
- **Growth at runtime**: the existing autoscale cron keeps watching rows and
  users for Kimble → Kimble +, and adds a compute signal (repeated timeouts,
  long-running requests) for → Kimble Compute.
- **Self-knowledge**: the capabilities prompt block gains the three tiers so
  Kimble answers tier questions correctly in chat and never invents a panel.
- Upgrades stay as they are today: never silent, never break a running app,
  cost shown, owner can opt out, data copied and verified before switchover.

---

## Technical notes

- New: migration for the cents→credits conversion; `project_compute` table with
  grants + RLS (owner read, service_role all); `compute_hour` added to
  `RuntimeMeter`; `compute_hour_usd` and `max_active_compute` in
  `economics_config`; `src/server/railway.server.ts`;
  `src/server/cloud-tier.server.ts` (the single tier decision).
- Changed: `runtime-wallet.server.ts` (charge path), `BillingSheet.tsx` (one
  balance + breakdown), `backend-autoscale.server.ts` (third tier),
  `petal-capabilities.server.ts` (tier self-knowledge), `credit-usage.ts`
  (compute bucket).
- Unchanged: Paystack, prices, packs, credit drain order, charge-after-success,
  visual QA, mobile builds, the builder itself.
- Each piece ships with tests and a typecheck; nothing here changes what
  anything costs the customer today.

## Verification

Dry-run the conversion and report totals first. Then: a Cloud action draws down
credits and appears in the breakdown; a compute project provisions, serves,
sleeps and bills exactly one hour per hour awake; and three sample prompts
(simple CRUD, storage-heavy, video-processing) resolve to Kimble, Kimble + and
Kimble Compute respectively.
