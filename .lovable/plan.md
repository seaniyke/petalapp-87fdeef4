# Backend cost optimization plan

## Current situation

Petal runs on Supabase (Lovable Cloud) for its own auth, database, and storage. In addition, every user project that enables "Cloud" gets a separate, provisioned Supabase project via the managed-backend flow. With only 6 users and a $60/month bill, the per-user economics are already $10/user — too high for a free tier and risky for scaling.

## Recommendation: keep Supabase, but stop giving every project its own database

Replacing Petal's core backend would require rewriting auth, RLS, migrations, billing, and all admin tools — months of work. The faster, lower-risk path is to keep Supabase for Petal's own platform and introduce a **shared-tenant backend** for user projects, reserving dedicated managed Supabase projects for paying users who actually need isolation.

## What we'll build

1. **Shared backend tier on Petal's existing Supabase**
   - Add a new `backend_type` column to `projects` (default: `shared`).
   - When a free or low-tier user enables backend, provision their tables/auth/storage inside Petal's own Supabase project, namespaced by `project_id`.
   - This gives them a real database, auth, storage, and RLS without spawning a new Supabase project.

2. **Dedicated managed backend becomes a premium feature**
   - Gate `managed_petal` provisioning to projects owned by users on a paid plan with a positive Cloud balance.
   - Update `EnableBackendFromCloudDialog` to show the shared backend as the default and "Upgrade to dedicated backend" as an optional upgrade.
   - Charge for dedicated backends via the existing backend-slot/add-on flow.

3. **Backend hibernation for idle dedicated projects**
   - Track last activity on `project_backends`.
   - Pause Supabase projects that have been idle for 7+ days (or when balance hits $0).
   - Auto-restore on the next user request, with a brief "warming up" state.

4. **Optimize existing Supabase usage**
   - Review large/unnecessary columns, unused indexes, and high-frequency reads.
   - Add caching for read-heavy admin queries.
   - Reduce realtime subscriptions where polling is sufficient.

5. **Monitoring and billing transparency**
   - Add a simple admin cost dashboard showing estimated Supabase project count and spend per user project.
   - Surface backend type in the project Cloud panel so users understand why their project is shared vs. dedicated.

## Expected outcome

- Free/low-tier users still get a real backend, but it costs Petal a fraction of a dedicated Supabase project.
- Dedicated backends remain a core premium promise, but only paying users trigger them.
- The $60/month bill should drop significantly as shared tenants replace isolated projects.

## Out of scope

- Full migration away from Supabase.
- Rewriting auth or RLS from scratch.
- Multi-region or self-hosted Postgres.
