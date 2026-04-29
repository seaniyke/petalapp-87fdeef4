## Navigation & UX audit — what's broken today

I walked the whole shell (`SiteHeader`, `index`, `projects`, `profile`, `builder`, `admin.*`, all sheets/modals) and the picture is clear: **features exist, they're just hidden behind inconsistent entry points**. Nothing is structurally wrong — it's discoverability + a missing mobile nav.

### What I found

**1. The header carries everything but reveals little.**
- Desktop nav only shows `Features`, `How it works`, `Gallery` (marketing links). Real product surfaces — Projects, Credits, Cloud, Profile, Admin — only exist inside the avatar dropdown or as a single pill.
- On viewports `< sm` (the user's current 430px viewport): `Projects` link is hidden (`sm:inline-flex`), the "credits" word is hidden, marketing links are hidden — leaving just a logo, a credit number, and an avatar. New users see no way in.

**2. Three different "money" surfaces, no map between them.**
- `CreditBadge` → opens `BillingSheet` (plans + AI message credits + Paystack top-up).
- Avatar → "Cloud & AI balance" → opens `CloudBalanceSheet` (runtime $ balance, project caps, Cloud/AI usage split).
- `RuntimeTopupModal` (in `BillingSheet` and elsewhere) → another top-up path.
Users land on one and don't realise the other exists. Nothing in either sheet links to the other.

**3. Profile is a deep route with one form.** `/profile` is a full page just to set display name + avatar URL. It's reached only via the avatar dropdown and has no link to billing, cloud, or projects from inside it. Compare to Lovable's settings hub pattern.

**4. Admin links are siloed.** `/admin` shows section cards, but each `/admin/*` page is a flat top-level route with no shared sidebar — you bounce back to the index every time.

**5. Builder has its own private "Billing" entry** (`setBillingOpen` in `builder.tsx`) that opens the same sheet — fine — but there's no equivalent in-builder shortcut to Cloud balance, even though that's where users are most likely to hit cloud-cost limits.

**6. No global mobile nav.** On mobile the header collapses to logo+avatar+credits. Gallery, Projects, Cloud, Profile, Admin all require the user to know to tap the avatar — and the avatar doesn't include `Gallery` or any marketing/help links.

**7. Inconsistent re-entry from the landing page.** A signed-in user on `/` sees no "back to projects" affordance in the hero — only via the avatar.

### What I will NOT touch (to avoid breaking anything)

- No route renames, no removing existing routes, no schema changes.
- `BillingSheet`, `CloudBalanceSheet`, `RuntimeTopupModal` keep their props and current open/close call sites.
- `useAuth`, `useWallet`, `useIsAdmin`, `adminApi` unchanged.
- Builder's existing `billingOpen` state stays exactly where it is.

---

## Plan — three focused, additive changes

### 1. Upgrade `SiteHeader` into a real nav (desktop + mobile parity)

Same component, same props. Internal changes only:

- **Desktop**: keep marketing links but add an authed "product" cluster between logo and avatar when signed in: `Projects · Gallery · Cloud · Credits · Avatar`. Cloud becomes a button that opens `CloudBalanceSheet` directly (parity with Credits → BillingSheet). One click to either money surface.
- **Mobile (`< md`)**: add a `Sheet`-based hamburger (left of logo) that contains the same nav, mirroring the dropdown for parity. Inside the sheet:
  - Section A "Product": Projects, Gallery, New project (deep-links `/?focus=composer`).
  - Section B "Account": Credits & plan (opens `BillingSheet`), Cloud & AI balance (opens `CloudBalanceSheet`), Profile, Admin (if `isAdmin`), Sign out.
  - Section C "Help": link to docs, "What's new" (gallery for now).
- The avatar dropdown stays for desktop power-users; both surfaces wire to the same handlers — no duplicate logic.
- Both sheets get a tiny "See {other}" cross-link at the footer:
  - In `BillingSheet`: "Looking for Cloud usage? Open Cloud & AI balance →"
  - In `CloudBalanceSheet`: "Looking for AI message credits? Open Plans & credits →"
  This is a 3-line addition per sheet, no logic change.

### 2. Turn `/profile` into a lightweight "Account hub"

Same route, same form on top — but underneath the existing form, add a 2×2 grid of `SectionCard`s (the same component pattern already used on `/admin`):

- **Plans & credits** → opens `BillingSheet`
- **Cloud & AI balance** → opens `CloudBalanceSheet`
- **My projects** → `Link` to `/projects`
- **Admin** (only when `isAdmin`) → `Link` to `/admin`

This makes `/profile` a real settings hub without renaming the route or moving the form. Anyone who was bookmarking `/profile` keeps it working.

### 3. Add a persistent admin sub-nav

Add a small `<AdminTabs />` component (just `Link`s with active styling using `useRouterState`) and render it under `<SiteHeader />` on every `admin.*` page. Pages: Overview · Users · Projects · Ledgers · Billing · AI Providers · Pipeline. No route changes, just a shared tab strip — same pattern as `SiteHeader` reuse today.

### 4. (Tiny) Builder convenience

In the existing builder header area where `setBillingOpen` is wired, add a sibling "Cloud" button that opens `CloudBalanceSheet`. Same pattern, ~10 lines. The `RuntimeLowBalanceBanner` already exists; this just makes the entry visible before users hit a low-balance state.

---

## Technical details

**Files to add**
- `src/components/MobileNavSheet.tsx` — hamburger sheet content (uses existing `Sheet`, `useAuth`, `useIsAdmin`, opens the two existing sheets via callback props).
- `src/components/AdminTabs.tsx` — horizontal scroll-safe tab strip with `Link` + `useRouterState`.
- `src/components/AccountHubGrid.tsx` — 2×2 `SectionCard` grid for `/profile`.

**Files to edit (additive)**
- `src/components/SiteHeader.tsx` — add the product cluster (desktop), add hamburger trigger + `MobileNavSheet` (mobile), pass through `onOpenBilling`/`onOpenCloud` handlers; keep all existing markup/classes intact.
- `src/components/BillingSheet.tsx` — append a footer link that calls a new optional `onOpenCloudBalance?: () => void` prop. When undefined (existing call sites), render nothing — zero breakage.
- `src/components/CloudBalanceSheet.tsx` — same, with optional `onOpenBilling?: () => void`.
- `src/routes/profile.tsx` — render `<AccountHubGrid />` below the existing form; manage `billingOpen` / `cloudOpen` local state and reuse the two sheets.
- `src/routes/admin.index.tsx`, `admin.users.tsx`, `admin.projects.tsx`, `admin.ledgers.tsx`, `admin.billing.tsx`, `admin.ai-providers.tsx`, `admin.pipeline.tsx` — insert `<AdminTabs />` directly under `<SiteHeader />`. One-line addition each.
- `src/routes/builder.tsx` — add `cloudBalanceOpen` state next to existing `billingOpen`, render `<CloudBalanceSheet>` once, add the trigger button next to the existing billing trigger.

**Safety guarantees**
- No route file is renamed, deleted, or has its `head()` changed.
- Every prop added is optional (`?:`) so all existing call sites keep working without edits.
- All new openers reuse the same `Sheet`/`Dialog` instances already in production; nothing is forked.
- No DB, RLS, edge function, or env changes. No new dependencies.
- I'll verify after the edit that `SiteHeader` still renders identically when signed-out (acceptance: snapshot of marketing nav unchanged).

**Acceptance checks I'll do after the edit**
1. Signed-out landing on mobile (430px): hamburger appears; tapping it shows Sign in / Get started + Gallery / Features. Header logo + CTAs unchanged.
2. Signed-in mobile: hamburger lists Projects, Gallery, Credits & plan, Cloud & AI balance, Profile, (Admin if admin), Sign out — all open the same sheets/routes the avatar dropdown opens.
3. Desktop signed-in: header shows `Projects · Gallery · Cloud · Credits · Avatar` and clicking each opens the existing surface (no duplicate sheets mounted twice).
4. `/profile` still saves; new card grid opens BillingSheet/CloudBalanceSheet with the same data shown today.
5. Any `/admin/*` page shows the tab strip with the current tab highlighted.
6. Builder still works; new Cloud button opens `CloudBalanceSheet` and existing `billingOpen` flow unchanged.

After approval I'll implement in this order: SiteHeader + MobileNavSheet → cross-links in the two sheets → AccountHubGrid in /profile → AdminTabs across admin pages → builder Cloud button. Each step is independently shippable so even if you stop me halfway, nothing regresses.
