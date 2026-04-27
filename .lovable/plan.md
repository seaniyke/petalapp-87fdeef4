## Problems

**1. Build progress stops updating mid-deploy.** The activity card stays stuck on "Putting your app online…" even after the build is actually live. The screenshot shows two adjacent "Putting your app online…" lines with "Your app is live!" muted underneath — the row is in a permanent active state.

**2. Preview iframe doesn't refresh** when a new build finishes — users have to manually reload to see their changes.

## Root causes

**Stuck spinner:**
- `useBuildActivity` polls every 5s but **stops polling the moment `prev?.status === "ready" || "failed"`**. If realtime delivered the wrong row (or no row), polling can miss the transition.
- More importantly, the parent `builder.tsx` **never subscribes to `projects.latest_build_id` changes via realtime**. When a new build row is created (e.g. user sends a second prompt), the parent only learns about the new `latest_build_id` from the `triggerBuild()` → `getProject()` round-trip. If that fetch is in flight, the activity hook is still subscribed to the *old* build id and never sees the new "ready" event.
- On iOS Safari + spotty mobile networks (the user's screenshot shows airplane-mode + low battery), Supabase Realtime websockets drop silently. The polling fallback exists but only on `project_builds`, not on `projects`.
- The polling backoff condition (`prev?.status === "ready"`) prevents recovery if the row is updated to `ready` between two polls and the realtime channel is dead — actually this case works, BUT the auto-collapse timer in `BuildActivityCard` only fires on `isComplete && !error`, which depends on `phases` being marked `live`. That happens via `setPhases((p) => completeThrough(p, "live"))` in builder.tsx ONLY when `buildSnap.status === "ready"`. So if the snap never updates, the card is permanently stuck even if the build is genuinely live.

**Stale preview:**
- `MobilePreviewFallback` does subscribe + poll, but only for the build id passed in via props. When a new build replaces the old one, the parent's `project.latest_build_id` only updates after `triggerBuild().then(getProject)` resolves. There's no reactive path from "build callback → projects table updated → client re-renders".

## Fix

### 1. Subscribe to `projects` row updates in `builder.tsx`

Add a realtime + polling subscription on `projects` filtered by `id=eq.<projectId>` so any change to `latest_build_id` (or `title`, etc.) flows back into local state. This is the missing link: the build callback writes the new build id into `projects`, and the client should pick it up immediately even if no follow-up `getProject()` call ever happens.

```
useEffect(() => {
  if (!project?.id) return;
  const channel = supabase.channel(`project:${project.id}`)
    .on("postgres_changes", {
      event: "UPDATE", schema: "public", table: "projects",
      filter: `id=eq.${project.id}`,
    }, (payload) => setProject((prev) => prev ? { ...prev, ...payload.new } : prev))
    .subscribe();
  // 10s polling fallback for mobile/iOS where WS often dies
  const poll = setInterval(async () => {
    const r = await getProject(project.id);
    if (r) setProject((prev) => (prev?.latest_build_id === r.latest_build_id ? prev : r));
  }, 10_000);
  return () => { supabase.removeChannel(channel); clearInterval(poll); };
}, [project?.id]);
```

### 2. Make `useBuildActivity` self-healing on mobile

- Keep polling for ~30s after reaching a terminal state (or until tab focus changes), so a flapping realtime channel can't strand the UI.
- Re-fetch immediately on `visibilitychange` (returning from background tab on iOS) and on `online` events.
- Lengthen the polling interval to 4s but **always poll** (don't gate on prior status) for the first 90s of a pending build — the deploy window is short, the cost is negligible.

### 3. Auto-refresh `MobilePreviewFallback` when a NEW build goes ready

Already bumps `iframeKey` when `dist_path` changes. Confirm the prop chain works after fix #1: when the parent's `project.latest_build_id` updates reactively, the `latestBuildId` prop changes → effect re-subscribes → first fetch hits the new ready row → `applyBuild` bumps `iframeKey` → iframe reloads.

Also add a short cache-busting query string to the iframe `src` (`?v=<buildId>`) so Cloudflare's edge cache (which can serve stale HTML for ~30s post-deploy) is bypassed on the new-version reload.

### 4. Add `visibilitychange` re-fetch in both hooks

iOS Safari aggressively suspends background tabs. When the user switches back to Petal, immediately re-poll both `projects` and `project_builds` so they don't see a frozen "deploying…" forever.

### 5. Optional safety net: failsafe phase advance

In `builder.tsx`, after entering the `deploying` phase, set a 3-minute timer that triggers a one-shot `getProject` + `project_builds` direct fetch. If the row is `ready` but local state still says pending, force-apply it. This is belt-and-suspenders for the rare case where both realtime AND polling missed the row.

## Files touched

- `src/routes/builder.tsx` — add `projects` realtime subscription + polling fallback (~25 lines).
- `src/hooks/use-build-activity.ts` — visibility/online listeners, broader polling window (~20 lines).
- `src/components/MobilePreviewFallback.tsx` — visibility listener + cache-bust param on iframe src (~10 lines).
- No DB changes, no new dependencies.

## What the user will see

- The "Putting your app online…" line will reliably flip to "🌟 Your app is live!" within ~5s of the actual deploy completing — even on mobile Safari, even with the chat tab backgrounded, even on flaky networks.
- The Preview tab will auto-reload to the new deploy as soon as it's ready, no manual refresh needed.
- Switching back to Petal after backgrounding the tab triggers an instant state catch-up instead of leaving the UI frozen.