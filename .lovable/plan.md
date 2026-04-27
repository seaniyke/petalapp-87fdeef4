## Where Petal stands today vs Lovable / Base44

### What Petal already has
- Every AI prompt triggers a Cloudflare Pages build via `/api/builds/trigger`. The build streams live status (pending → ready/failed) into `BuildActivityCard`.
- A `/p/$slug` public share route gated by `is_public`, controlled in `SharePopover`.
- Custom domains (`project_domains`) with proxy routing in `host-routing.server.ts`, and a Domains section in project settings.
- A subdomain pattern (`petal-<id>.pages.dev`) that already serves the latest successful build.

### The gap vs Lovable / Base44
There is **no separation between "preview" and "published"**. Today, every prompt's build is what visitors see — there's no concept of:

1. **A dedicated Publish action** ("Publish" / "Update" button surfaced in the header).
2. **A Publish dialog** showing the live URL, visibility (Public / Private / Workspace), domain manager link, "Up to date" / "Update" CTA, and visitor count.
3. **A pinned production build** distinct from the latest preview build, so the user can keep iterating without instantly pushing every change to their audience.
4. **Visibility controls** on the published site (currently only a slug share toggle, not a true public/private/unpublish state).
5. **A first-time Publish flow** (the Lovable bottom sheet "Publish" with website URL + "Manage domains" + "Who can see this website").

So the answer: **plumbing parity (we already build & deploy on every change), but UX parity is missing.** Users can't tell whether their app is "live" in the public sense, can't manually push an update, and can't pause publishing.

---

## Plan

Add a real Publish surface that matches the Lovable screenshots. Two phases — Phase 1 ships parity with Lovable's dialog using existing build infra, Phase 2 adds the preview/production split.

### Phase 1 — Publish UI parity (small, ships immediately)

1. **Header "Publish" button**
   - Desktop (`SiteHeader` in builder + `builder.tsx` top-right): add a Publish button next to Share.
   - Mobile: add "Publish" entry to the existing `BuilderActionsSheet` (matches the third uploaded screenshot).

2. **`PublishSheet` component** (new, mobile bottom sheet + desktop dialog)
   - Header: "Published" title + visitor count placeholder.
   - **Website URL** row showing the live URL (custom domain if set, else `petal-<id>.pages.dev` or the configured subdomain), with copy + "Manage domains" link that opens existing Domains section.
   - **Who can see this website** row: Public / Private toggle (drives a new `projects.published_visibility` column — `public` | `private` | `unpublished`). Default `public` for current behavior.
   - **Primary CTA**:
     - "Up to date" (disabled, green) when latest build is ready and no newer files exist.
     - "Update" (primary) when the user has made changes since last successful build → calls `triggerBuild(projectId)`.
     - "Publishing…" with spinner when build is pending.
     - "Retry publish" (destructive tone) when latest build is failed.
   - Secondary actions: "Edit settings" (opens project settings), "Review security" link (placeholder for now).

3. **Published-status indicator** in the header
   - Tiny dot + label next to the project title: "Live", "Update available", "Publishing…", or "Not published".
   - Derived from `latest_build_id` build status + a new `last_published_build_id` column (Phase 2). For Phase 1 just mirror `latest_build_id`.

4. **Friendly URL resolution helper** (`src/lib/published-url.ts`)
   - Centralize: primary custom domain → workspace branded subdomain → `petal-<id>.pages.dev`.

### Phase 2 — Preview vs Production split (the real win)

This is where we close the gap with Lovable / Base44. Today every keystroke deploys to production. Instead:

1. **DB migration** on `projects`:
   - `published_build_id uuid null` (the build currently serving public visitors).
   - `published_visibility text not null default 'public'` (`public` | `private` | `unpublished`).
   - `published_at timestamptz`.

2. **`/api/builds/trigger`** keeps building on every prompt (these become **preview** builds — used by `MobilePreviewFallback`, the iframe preview, and `/p/$slug`).

3. **New `/api/publish` route**: pins the current `latest_build_id` as `published_build_id`, sets `published_at`, optionally updates `published_visibility`. This is what the "Update" / "Publish" button in the new dialog calls.

4. **`host-routing.server.ts`** changes:
   - Custom domains and the canonical published subdomain proxy to the **published** build (`published_build_id` → its `dist_path`), not the latest preview.
   - `/p/$slug` and the in-builder iframe continue to show the latest preview build.
   - Honor `published_visibility`: `private` → 403 (or auth-gated), `unpublished` → 404 with "This app isn't published yet" page.

5. **Diff detection**: "Update available" surfaces when `latest_build_id !== published_build_id` and the latest build is `ready`.

### Phase 3 — Polish (parity touches)

- **Visitor count** on the Publish sheet (we already have a Plausible integration helper — wire it up).
- **First-publish onboarding**: if `published_build_id is null`, the dialog opens with a single "Publish" CTA + a short copy block ("Your app will be live at …"), matching Lovable's first-publish state.
- **Unpublish** action in the visibility menu.
- **Push-update toast** after a successful prompt: "Changes ready to publish — Update".

---

## Files affected

**Phase 1**
- `src/components/PublishSheet.tsx` (new)
- `src/components/BuilderActionsSheet.tsx` (add Publish entry)
- `src/routes/builder.tsx` (wire button + sheet, header status pill)
- `src/lib/published-url.ts` (new helper)

**Phase 2**
- DB migration (`projects` columns above)
- `src/routes/api/publish.ts` (new)
- `src/server/host-routing.server.ts` (proxy to `published_build_id`)
- `src/lib/projects.ts` (typing + helpers)
- `src/hooks/use-build-activity.ts` (also expose "update available" derived state)

**Phase 3**
- `src/components/PublishSheet.tsx` (visitor count, unpublish, first-run copy)
- Toast hook in `builder.tsx` after successful generation.

---

## Recommendation

Ship **Phase 1 first** — it gives users the Publish/Update dialog, visibility control, and live URL in one place, which is the visible UX gap vs Lovable. Phase 2 (preview/production split) is the more strategic change but requires the DB migration and host-routing rewrite, so it's worth landing separately once Phase 1 is validated.

Want me to start with Phase 1 only, or queue Phase 1 + 2 together?