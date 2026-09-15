# Save project thumbnails once, show them instantly

Today every card that shows an app preview asks an outside screenshot service to
render the page again, live, while you watch. That's why tiles spin, arrive late,
or fall back to a coloured square. The fix: capture each app's preview **once**,
store it as a real image file in Petal's own storage, and serve that saved image
everywhere.

## What changes for people using Petal

- Gallery, project page, projects drawer and the homepage showcase all show the
  saved preview image immediately — no spinner, no waiting.
- A preview is captured once per shipped build. Ship a new build, a fresh preview
  is captured in the background and swaps in on the next visit.
- If an app has never shipped, the branded tile still shows (unchanged).

## How it works

1. **Storage record.** New table `public.project_thumbnails`
   (`project_id` PK, `build_id`, `url`, `width`, `height`, `captured_at`).
   Public read (anon + authenticated) so gallery cards can read it; writes are
   service-role only. GRANTs + RLS included in the migration.

2. **Saved image file.** Captured images are uploaded to the existing public
   `petal-images` bucket at `thumbs/{projectId}/{buildId}.jpg` and the public
   URL is stored on the row. Files are immutable per build, so the CDN can cache
   them forever.

3. **Capture path** — new `src/server/project-thumbnail.server.ts`:
   - resolve the live URL exactly as the component does today
     (published URL → custom domain → subdomain → latest READY build URL),
   - fetch the Microlink screenshot **server-side** (generous timeout, one
     retry with `force=true`),
   - upload the bytes, upsert the row.
   Single-flight per `projectId:buildId` so a 60-card gallery triggers one
   capture, not sixty. Failures are silent and simply leave the tile as-is.

4. **Read path** — `src/lib/project-thumbnail.functions.ts`:
   - `getProjectThumbnails({ projectIds })` → one batched read of saved URLs,
   - `ensureProjectThumbnail({ projectId, buildId })` → returns the saved URL,
     or captures it now and returns the fresh one.

5. **Component** — `src/components/ProjectThumbnail.tsx` stops pointing `<img>`
   at Microlink. It renders the saved URL when one exists; otherwise it shows the
   branded tile and quietly asks the server to capture, swapping the image in when
   it lands. The live-render retry/timeout machinery goes away.

6. **Warm on ship** — the build callback (`api/public/builds/callback.ts`) kicks
   off a capture as soon as a build is marked ready, so in practice the image is
   already saved before anyone opens the gallery.

7. **Self-healing** — a small sweep in the existing cron area captures any ready
   build that has no saved image yet (bounded batch), so older projects backfill
   themselves.

## Notes

- No pricing, billing, or build-pipeline behaviour changes.
- Capture failures never block anything; the branded tile remains the fallback.
- Verified with Playwright on `/gallery` and a `/p/...` page: saved image present,
  no spinner on reload, no console errors. Typecheck + test suite must stay green.
