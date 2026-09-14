# Cloud for Petal users: what's sorted, what's leaking, how we test it

## Where things stand (checked against the live system)

The cost fix you asked for is real and it is working:

- Every one of the 54 projects is on the **shared** tier — a real database, sign-in and API for the generated app, served from Petal's own database, with no per-app Supabase project behind it. Generated apps import the same files either way, so the app code doesn't know the difference.
- Only **3** separate Supabase projects were ever created. All three are paused today.
- A separate project is paid-plan only, metered at 4¢/hr of usage, and paused after 7 days idle.

Four real problems remain, all of them cost or trust issues:

1. **Nothing is ever deleted.** Disconnecting a project removes Petal's record but leaves the Supabase project alive forever. The delete call exists in the code and is never used. The 3 paused ones are still sitting there.
2. **The hourly bill marks the app as "in use".** The billing job stamps "last active" every time it charges, so an app nobody opens looks permanently active and never hibernates — we keep paying for it and so does the user.
3. **The hourly meter has never actually charged anything** — there is not a single backend-hour charge on record — and it now runs through the credits system we changed today, so it is unproven.
4. **A paused app can't wake itself**, and it tells the user "top up to bring it back online" when the real reason was inactivity.

Plus: the shared tier has 6 stored rows and 0 end users across all projects — it is wired up but essentially unproven in real use, and has no automated test.

## What I'd fix

1. **Reclaim unused databases.** When a user disconnects, or a database has been paused and untouched for a set period, delete it upstream — with a clear warning and the data exported first. Includes a one-off cleanup of the 3 existing paused ones.
2. **Only real usage counts as usage.** Billing stops stamping activity; activity comes from app requests, status checks and migrations. Idle apps then actually hibernate.
3. **Wake on demand.** Opening a paused app or its settings restores it automatically, and the paused message states the real reason.
4. **A ceiling on separate databases.** Before creating one, check how many are already live; past the limit the user gets a clear message instead of a failed provision.
5. **Confirm the hourly meter now charges credits** after today's billing change.

## How we prove it (this is the testing part)

- **Shared tier, end to end:** create a throwaway project, have a generated app sign up an end user, create/read/update/delete records, then confirm from a second project that it cannot see or touch the first project's data or users, and that the row/collection limits hold.
- **Separate database, end to end:** provision one on a test project, run its generated tables, confirm credits are drawn hourly, let it pause, wake it, then delete it and confirm it's gone from our Supabase organisation.
- **Automated tests** for project isolation on the shared API, and for "billing does not count as activity".

## Needs your go-ahead

- Deleting the 3 existing paused databases (Bibliophile Book Tracker, Snackwave, Heirloom Kitchen). They belong to real projects; I'd export their data first, but this is permanent.
- The retention window before an untouched paused database is deleted — my suggestion is 30 days, with an email warning at 23 days.
- The maximum number of separate databases live at once — my suggestion is a configurable limit starting at 25.

## Technical notes

- `handleDisconnect` (`src/routes/api/backend.ts`) to call `deleteProject` (`supabase-mgmt.server.ts`, currently unreferenced) after an export step; a new daily cron reaps `project_backends` rows in `paused` status past the retention window.
- `runtime-backend-hour.ts` drops its `last_active_at` write; `backend-hibernate.ts` message corrected and its pause reason recorded separately from balance.
- Auto-restore hooks into the existing `refreshStatus`/`restoreForProject` path on status read when `status = 'paused'` and the pause reason is inactivity.
- Provision cap read from `economics_config` so it is tunable without a deploy.
- New tests in `src/server/__tests__/`: shared-API project scoping and owner scoping, hibernate/meter interaction.
- No pricing changes: 4¢/hr, paid-plan gating, ₦5,000 minimum and Paystack all stay as they are.
