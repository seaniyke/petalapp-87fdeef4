## Goal

Let Petal users put their published app on their own domain (e.g. `acme.com`), matching the UX every major competitor uses (Lovable, Vercel/v0, Bolt/Netlify): **Publish first → Settings → Domains → enter domain → add DNS records → verified → SSL → Live**.

## Competitor research summary

All three flagship competitors use the exact same shape:

| Step | Lovable | Vercel/v0 | Bolt (Netlify) |
|---|---|---|---|
| Where | Project → Settings → Domains, *or* Publish modal → "Add custom domain" | Project → Settings → Domains | Publish → Custom domain |
| Required first | Project must be **published** | Project must be deployed | Project must be published |
| Records | `A @ → 185.158.133.1` + `A www → 185.158.133.1` + `TXT _lovable → lovable_verify=…` | `A @ → 76.76.21.21` (or CNAME) | `CNAME` to Netlify |
| Verification | TXT record proves ownership | TXT or DNS validation | TXT/DNS |
| SSL | Auto via Let's Encrypt | Auto | Auto |
| Statuses shown | Pending → Verifying → Setting up → Active (or Offline/Failed) | Pending → Valid Configuration → Active | Awaiting DNS → Live |
| Optional | "Buy domain" via registrar inside the product (Entri partner) | Vercel Domains marketplace | Netlify Domains |
| Proxy mode | "Domain uses Cloudflare" toggle switches A→CNAME setup | Same idea | — |

**Conclusion:** we copy the Lovable shape almost verbatim. Buying domains in-product and the Entri auto-DNS partner are nice-to-haves we explicitly defer; the manual A+TXT path is what 90 % of users actually hit and it's straightforward to ship.

## Where Petal stands today

- Builds already deploy to Cloudflare Pages; the deployment URL lives in `project_builds.dist_path` (e.g. `https://abc123.pages.dev`) and is referenced by `projects.latest_build_id`.
- "Share" today (`SharePopover`) only flips `projects.is_public` and exposes `/p/<slug>` on **petal's** domain — there is no notion of a "published" public URL, and no domains UI anywhere.
- `ProjectSettingsSheet` currently has just two sections (instructions + BYO Supabase backend), so there's a clean home for a new "Domains" section.
- No SSL/edge plumbing for arbitrary hostnames exists yet.

## Recommended approach: Cloudflare for SaaS

Since builds already live on **Cloudflare Pages**, the cheapest and best-fit way to terminate `acme.com` for an arbitrary user is **Cloudflare for SaaS** (Custom Hostnames API). It gives us:

- Automatic Let's Encrypt SSL per hostname
- TXT-based ownership verification
- A single fallback origin (our Pages project) that fans out by hostname
- A REST API we call from a server route — no per-customer infra

The UX and DNS records we expose to users are platform-agnostic, so if we ever swap providers (e.g. self-managed proxy) the user-facing flow doesn't change.

## Proposed scope (Tier A — ship now)

### 1. Database

New migration adding a `project_domains` table:

```
project_domains (
  id uuid pk,
  project_id uuid fk → projects (cascade delete),
  hostname text unique citext,        -- e.g. "acme.com" or "blog.acme.com"
  status text not null default 'pending',
    -- pending | verifying | active | failed | offline | removed
  is_primary boolean default false,
  verification_txt_name text,         -- "_petal-verify"
  verification_txt_value text,        -- random nonce
  cf_hostname_id text,                -- Cloudflare custom-hostname id
  ssl_status text,                    -- mirrored from CF
  last_checked_at timestamptz,
  error_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
)
```

- RLS: project owner can `select/insert/delete`; `update` limited to `is_primary` (status changes done by service role only).
- Trigger to enforce a single `is_primary=true` per project.
- Add `projects.primary_domain_id` (nullable FK) so the runtime knows which hostname to advertise.
- Realtime enabled on `project_domains` so the UI can react to verification flips.

### 2. Server routes (TanStack Start)

| Route | Purpose |
|---|---|
| `POST /api/domains?action=add` | Body `{projectId, hostname}`. Validates hostname (FQDN, length, no AAAA-only requirement check), generates TXT nonce, calls **Cloudflare for SaaS** `POST /custom_hostnames`, stores row as `pending`. |
| `POST /api/domains?action=verify` | Re-checks Cloudflare status + DNS, updates row, returns latest. |
| `POST /api/domains?action=set-primary` | Marks one domain primary, updates `projects.primary_domain_id`. |
| `POST /api/domains?action=remove` | Calls Cloudflare delete, removes row. |
| Background: a tiny pg_cron-style poll (or on-demand from the UI) that hits `verify` for any non-active domain in the last 24 h. |

All routes verify the Supabase JWT and project ownership, mirroring `src/routes/api/backend.ts`.

Secrets needed (added via `add_secret`):
- `CLOUDFLARE_API_TOKEN` (scoped to SSL: Edit + DNS: Edit on the SaaS zone)
- `CLOUDFLARE_SAAS_ZONE_ID`
- `CLOUDFLARE_FALLBACK_ORIGIN` (e.g. `proxy.petal.app`, the CNAME users would see if we go CNAME-mode)

### 3. UI — `ProjectSettingsSheet` gets a new "Domains" section

Place it **above** Backend, since it's the more common need. Shape mirrors `BackendSection`:

- **Empty state**: "Custom domain · Use your own domain like `acme.com`" + `Add domain` button. Copy explains "publish first" if `latest_build_id` is null and disables the button.
- **Add form**: single input + advanced toggle ("My domain uses Cloudflare or another proxy" → switches A-record instructions to CNAME).
- **Connected list**: each row shows hostname, status pill (Pending / Verifying / Active / Failed), and a `⋯` menu (View DNS records, Set as primary, Remove).
- **DNS instructions modal** (shown right after add, and re-openable): two records to add at the registrar:
  - `A   @   185.158.133.1` *(or CNAME to fallback origin in proxy mode)*
  - `TXT _petal-verify   <nonce>`
  Copy buttons on every value, "Check status" button that calls the `verify` action, helper note that DNS can take up to 72 h.
- **Realtime**: subscribe to `project_domains` row updates so status flips live.

Plus a **secondary entry point in `SharePopover`**: when the project is public, add a small "Use a custom domain" link that opens the settings sheet on the Domains tab — matches Lovable's "Publish modal → Add custom domain" affordance.

### 4. Runtime: serving the custom hostname

When Cloudflare for SaaS routes `acme.com` traffic to our Pages project, the request's `Host` header is `acme.com`. We:

1. In our Worker / Pages function, look up `project_domains.hostname = req.host` → get `project_id` → get `latest_build_id` → serve that deployment.
2. Set canonical/OG tags on `__root.tsx` so the published app advertises the user's primary domain when present (today they advertise the `.lovable.app` / `pages.dev` URL).

This is the only piece that touches the published-app rendering path. It's small and isolated.

### 5. Mobile + a11y

- The Domains section in the sheet must wrap long hostnames (`break-words`) and the DNS-records modal must clamp width to `max-w-[calc(100vw-1.5rem)]` like `RevertPreviewDialog` already does.
- Status pills use the same calm phase animation we just added to `BuildActivityCard`.
- All copy buttons announce "Copied" via `aria-live`.

## Out of scope (Tier B/C — explicitly deferred)

- **Buying domains in-product** (registrar + Stripe checkout). Big project; users can buy elsewhere and bring it.
- **Entri-style automatic DNS** (one-click OAuth into GoDaddy/Cloudflare/etc.). Add later — manual A+TXT covers most cases and the UI is identical.
- **Workspace-level domains** shared across projects. Petal doesn't have workspaces yet.
- **Wildcard / apex SSL nuances** beyond what Cloudflare for SaaS gives us by default.
- Email DNS (MX/SPF/DKIM) — out of scope for hosting.
- Paid-plan gating: Lovable gates this behind paid plans; we'll skip the gate for v1 unless you want it.

## Risks / things to confirm before building

1. **SSL provider**: Cloudflare for SaaS is the recommended path because builds already run on CF Pages. If you'd rather self-manage with Caddy / a custom proxy, the DB + UI stay the same but step 4 changes.
2. **Plan gating**: do we lock custom domains to a paid tier (Lovable does, Vercel does on Hobby+Custom)?
3. **Domain cap**: Lovable allows multiple per project (root + www, plus subdomains). Suggest defaulting to **5 domains per project** to match.
4. **Apex `A` vs CNAME-flat**: we'll require `A 185.158.133.1` (or whatever IP CF SaaS assigns us) for the apex; users on Cloudflare can flip the proxy toggle and use CNAME instead, mirroring Lovable's Advanced toggle.

## Suggested build order (one PR each, all on the same plan)

1. **Migration + RLS + realtime** for `project_domains` and `projects.primary_domain_id`.
2. **`/api/domains` server route** with add/verify/set-primary/remove (talks to Cloudflare for SaaS). Add the three Cloudflare secrets.
3. **`DomainsSection` in `ProjectSettingsSheet`** + DNS records modal + realtime subscription.
4. **`SharePopover` cross-link** to open the Domains tab.
5. **Worker routing** (`Host` → project lookup → serve `latest_build_id`) and canonical/OG tag updates.
6. Docs + in-product copy review.

I'll wait for your sign-off on the four open questions above (SSL provider choice, plan gating, domain cap, apex strategy) before writing the migration.