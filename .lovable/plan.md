# Shared vs dedicated database — automatic, not a user choice

## Your instinct is right

The user should never have to understand the difference. Every app starts on the shared database. When an app actually grows into needing its own, Petal upgrades it — quietly, funded by the credits the user already holds.

So: **no choice screen, no "pick a tier"**. Just an app that outgrows its starter database and gets moved.

## Why shared-first is still the rule

- A dedicated database costs Petal money every hour it exists. A shared app costs almost nothing — it lives inside one database we already run.
- The shared tier already gives a generated app sign-in, per-user data, and full save/load (proven live). Its limits (5,000 rows, 25 collections, 32KB per record) cover any early-stage app.
- Most apps never grow past that. Provisioning up front means paying for thousands of databases that never see a second user.

## When Petal upgrades automatically

An app is moved to its own database when it crosses any real growth signal:

- Row count passes a threshold (proposed: 80% of the shared limit).
- End-user count passes a threshold (proposed: 50 real signed-up users).
- The app needs something shared can't do: file storage, its own SQL, direct database access.

Plus two gates that are about money, not size:

- The owner must have enough credits to cover the running cost, with a small buffer.
- The owner is told before it happens — a short note that the app is growing and its database is being upgraded, with the ongoing credit cost stated plainly. They can decline and stay shared.

If credits run short, the app **stays on shared and keeps working** — it never breaks, it just doesn't upgrade, and the owner sees why.

## What happens during an upgrade

1. A dedicated database is created.
2. The app's existing rows and end-user accounts are copied across.
3. The generated app's data layer switches over — same code shape either way, so nothing in the app needs rewriting.
4. Shared rows are kept for a short window, then cleared.

If any step fails, the app stays on shared and nothing is lost.

## Deleting databases without getting billed

Short answer: yes, but with a caveat worth knowing.

- Deleting a database stops its cost from that moment. There's no exit fee.
- Hours already used are still charged — a database that lived 6 hours costs 6 hours. That's exactly how Petal already meters it at 4¢/hr, and it's what your users pay too.
- On a free organisation there is no bill at all, but only 2 databases can exist at once — which is why the organisation must move to a paid plan before real users start upgrading.
- Everything that prevents waste is already built: unused databases sleep after 7 days, sleeping ones are deleted after 30 with a week's warning, disconnecting removes the database upstream after exporting its data, and there's a cap of 25 live at once.

So the only cost that can ever accumulate is databases genuinely in use, and every idle path already ends in deletion.

## What this plan builds

1. **Growth watcher.** A daily job scores every shared app against the upgrade signals and flags candidates. Thresholds live in `economics_config` so they're tunable without a deploy.
2. **Automatic upgrade with migration.** Provision, copy rows and end users across, switch the app over, verify, then clear the shared copy. Any failure rolls back to shared.
3. **Credit gate and notice.** Check the owner's balance plus a buffer before upgrading; email/notify the owner with the cost and a way to decline.
4. **Capability-triggered upgrade.** Asking Petal for file storage or direct SQL on a shared app triggers the same upgrade path instead of an error.
5. **Never-break guarantee.** Hitting a shared limit while an upgrade isn't possible returns a clear, calm message and the app keeps running on what it has.
6. **Admin visibility.** A shared-tier panel: apps on shared, rows, upgrade candidates, blocked-by-credits.

## Needs your decision

- The upgrade thresholds (my suggestion: 80% of the row limit, or 50 end users).
- Whether the owner is asked first or simply told. My suggestion: **told**, with a decline option — asking puts the choice back on them, which is what you're trying to avoid.
- Moving the "Petal Cloud" organisation to a paid Supabase plan before this goes live. On free, only 2 databases can exist and they pause after 7 idle days — that would break paying users' apps. This is a billing action only you can take.

## Out of scope

No pricing changes (4¢/hr, paid-plan gating, ₦5,000 minimum, Paystack all stay). No changes to the dedicated lifecycle already built and tested. No migration of existing apps except through the new automatic path.
