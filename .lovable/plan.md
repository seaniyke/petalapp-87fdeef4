# Shared vs dedicated database — which users get what

## The recommendation (plain language)

**Every new app starts on the shared database. Dedicated is an upgrade the user chooses, never the default.**

Why:

- **Money flows one way.** A dedicated database costs Petal real money every hour it's alive (billed to the user at 4¢/hr). A shared app costs Petal almost nothing — it lives inside one database we already run. Provisioning dedicated for every casual "to-do list" app means Petal bankrolls thousands of idle databases for users who may never pay.
- **Casual apps don't need it.** The shared tier already gives a generated app sign-up/sign-in, per-user data, and full create/read/update/delete — we proved this live. Its limits (5,000 rows, 25 collections, 32KB per record) comfortably cover every "not very serious" app.
- **The free organisation can't take it anyway.** The new "Petal Cloud" organisation is on Supabase's free plan: only 2 databases can exist at once. Auto-provisioning per user would exhaust that instantly. Dedicated-at-scale requires the organisation on a paid plan (~$25/mo), which makes the economics above even more important.
- **Serious apps tell us they're serious.** A user who hits the row limit, needs file storage, or wants their own database is a user with a real project — and is on a paid plan with credits. That's exactly when dedicated makes sense, and the upgrade path already exists.

So "not serious → shared, serious → dedicated" is correct, but the signal shouldn't be us guessing seriousness. The signals are: the user explicitly enables it, their data outgrows the shared limits, or they need a capability the shared tier doesn't have.

## What already works (no changes needed)

- Every generated app defaults to the shared tier — zero provisioning cost.
- Row-limit hits already return "upgrade to a dedicated backend for unlimited rows".
- Enabling dedicated is paid-plan gated, checks the user's credit balance, respects the 25-database cap, and the full lifecycle (charge → sleep → wake → delete) is built and tested.

## What this plan changes (small guardrails)

1. **Per-user shared app cap.** One user can have at most N apps on the shared tier (proposed N = 10, configurable via `economics_config`). Prevents one free account from filling the shared instance with throwaway apps.
2. **Shared tier abuse limits become config.** Move the current hardcoded limits (5,000 rows / 25 collections / 32KB records) into `economics_config` so they can be tuned without a deploy.
3. **Upgrade prompt at the limit.** When an app hits a shared limit, the error response already says to upgrade — surface that in the builder UI as a one-tap "Upgrade this app's database" action that opens the existing enable flow, instead of only an API error.
4. **Admin visibility.** The admin economics view gains a small shared-tier panel: apps on shared, total rows, apps near their limit (top candidates for a dedicated upgrade).

## Org decision for you (not code)

The new "Petal Cloud" organisation should go on a paid Supabase plan before real users enable dedicated databases — on free, only 2 databases can exist and they pause after 7 idle days, which would break paying users' apps. That's a billing action only you can take in the Supabase dashboard; no code change needed.

## Out of scope

No pricing changes. No changes to the dedicated lifecycle built and tested earlier. No migration of existing shared apps.
