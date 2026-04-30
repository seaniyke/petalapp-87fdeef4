# Petal Cloud panel — full parity with the Lovable screens

Today Petal only exposes a thin "Backend" block inside Project Settings + a global Cloud & AI balance sheet. The screenshots show a proper **per-project Cloud hub** with one card per capability. We'll build that hub and fill in the missing inner views, reusing what we already have where possible.

## What already exists (keep / lightly enhance)
- `CloudBalanceSheet` — Cloud + AI balance with project breakdown. Reuse as-is, link from new Cloud panel footer.
- `ManagedBackendCard` — provisioning / ready / paused / failed states. Reuse inside the new "Backend status" header of the Cloud panel.
- `EmailSection` — Petal Email enable/disable. Reuse, surfaced as the **Emails** card.
- `ai_call_log`, `petal_email_*`, `project_backends`, `project_integration_secrets` tables — already populated; just need read views.

## What's missing (build)

### 1. New `CloudPanelSheet` (per-project)
A right-side Sheet opened from the project header / settings. Layout mirrors the screenshots: a vertical stack of tappable cards, each opens a sub-view (drill-down pattern, with a `< Cloud` back chevron).

```text
Cloud
├── AI                  → AI usage view (existing data)
├── Emails              → Petal Email panel (existing)
├── Database            → tables list + row counts + open editor
│    ├── project_files (840 rows)
│    ├── ai_call_log    (242 rows)
│    └── …  [View all]
├── Users               → signups list + auth settings
├── Storage             → buckets list (petal-images, project-builds)
├── Secrets             → manage env vars (uses project_integration_secrets)
├── Logs                → recent edge / db logs for the project
├── Advanced settings   → instance size, danger zone (pause / disconnect)
└── Cloud & AI balance  → opens existing CloudBalanceSheet
```

Entry points:
- New "Cloud" button in `ProjectSettingsSheet` header (replaces today's inline Backend block — that block becomes the status pill at the top of CloudPanelSheet).
- Quick-access from the builder top bar next to Publish.

### 2. AI usage view (`CloudAiUsageView`)
- Header: "AI usage — view AI usage over time"
- Period dropdown: Last 7 / 30 / 90 days (default 7)
- "AI connection · Active" pill + 3 stats: Total requests, Number of models, Top model
- Stacked bar chart by day, segmented by model (recharts, already in deps)
- "Models" table: model name + call count, sorted desc
- Data: `select model, date_trunc('day', created_at), count(*) from ai_call_log where project_id = $1 group by …`

### 3. Database view (`CloudDatabaseView`)
- Lists every table in the project's managed backend (calls a new server fn that hits the project's Supabase via service role from `project_backends` credentials, runs `select tablename, n_live_tup from pg_stat_user_tables`).
- Row per table: icon + name + row count, tap to open a read-only data preview (paginated select * limit 50).
- "View all" expands the list.
- Empty state when project has no managed backend → CTA reuses `EnableBackendFromCloudDialog`.

### 4. Users view (`CloudUsersView`)
- Card header "Users — View user data and configure how — N Signups"
- Table: email, created_at, last_sign_in_at, provider — paginated
- Auth settings link → opens existing email-confirm / providers config (extend `managed-backend.server.ts` to expose toggle endpoints, scoped to the project's managed Supabase).
- Data via service-role list users RPC against the project's backend.

### 5. Storage view (`CloudStorageView`)
- Lists buckets in the project's managed backend
- Tap a bucket → file list (name, size, updated_at), with upload + delete in a follow-up
- This iteration: read-only browse + upload single file

### 6. Secrets view (`CloudSecretsView`)
- Reuses existing `project_integration_secrets` table + `secrets/requests.functions.ts`
- Add / rename / delete a secret (encrypted at rest via existing `crypto.server.ts`)
- "Used by" hint shows which integrations reference each secret

### 7. Logs view (`CloudLogsView`)
- Two tabs: Edge functions, Database
- Pulls last 100 lines from the project's managed Supabase (`function_edge_logs`, `postgres_logs`) via a new server fn that proxies `supabase.analytics_query` with the project's service-role key
- Severity filter + free-text search

### 8. Advanced settings view (`CloudAdvancedView`)
- Instance size selector (Micro / Small / Medium) — wired to existing managed-backend resize endpoint (placeholder if not yet implemented; show "Contact support" while infra wires it up)
- Pause backend
- Disconnect backend (existing flow, moved here from settings sheet)

## Technical details

### Routing & components
- New components under `src/components/cloud/`:
  `CloudPanelSheet.tsx`, `CloudAiUsageView.tsx`, `CloudDatabaseView.tsx`, `CloudUsersView.tsx`, `CloudStorageView.tsx`, `CloudSecretsView.tsx`, `CloudLogsView.tsx`, `CloudAdvancedView.tsx`.
- Shared `CloudSubView` shell with the back-chevron header pattern.
- All views are mounted inside the same Sheet — internal state (`view: 'home' | 'ai' | 'db' | …`) drives which one renders, like iOS push navigation.

### Server functions (new files in `src/server/`)
- `cloud-ai-usage.functions.ts` — aggregates `ai_call_log` filtered by `project_id` (already on the row).
- `cloud-database.functions.ts` — uses managed backend service-role key (decrypted via existing helper) to list tables + sample rows.
- `cloud-users.functions.ts` — list users from the project's managed Supabase.
- `cloud-storage.functions.ts` — list buckets/objects from the project's managed Supabase.
- `cloud-logs.functions.ts` — analytics_query proxy.
- All gated by `requireSupabaseAuth` + ownership check on `projects.owner_id = userId`.

### No DB migration required for v1
Everything reads existing tables. New per-table state (e.g. user-pinned secrets) only added if a view needs it — none in this iteration.

### Out of scope for this pass
- Bulk row editing in Database view (read-only first; matches Lovable's mobile screen scope).
- Bucket file upload UI beyond a single-file picker.
- Realtime Logs (poll on open + manual refresh button).

## Suggested build order
1. `CloudPanelSheet` shell + entry point from project settings/header (replace inline Backend block).
2. AI usage view (uses data we already have — quickest win).
3. Database view (tables + row counts; read-only sample later).
4. Users + Storage (read-only listings).
5. Secrets (CRUD on existing table).
6. Logs.
7. Advanced settings (pause/disconnect first, instance size last).
