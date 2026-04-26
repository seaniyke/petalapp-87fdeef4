# Mobile build & preview — Phase 7.1

## Context: how the others do it

I researched Bolt, Lovable, and Base44:

- **Bolt.new** — explicitly tells mobile users it isn't supported. Same dead-end you're hitting now. They picked correctness over UX.
- **Lovable (real one)** — ships every project as a published PWA. On mobile, the "preview" you see is the *published deployment* served from their CDN, not a WebContainer. Editing happens via chat, deploys auto-update.
- **Base44** — renders previews server-side (their apps run as normal SSR web pages, not in-browser Node), so mobile previews "just work." They also added a desktop-only "Mobile preview mode" that simulates a phone frame.
- **WebContainers themselves** — *do* technically run on iOS 16.4+ Safari (since April 2023, still beta), but installing 200 packages of a fresh Vite + React project over a phone network reliably exceeds our 3-minute timeout. The current "iOS = unsupported" message is too aggressive but the underlying constraint is real.

## What we'll do

Adopt the **Lovable model**: on mobile, swap the WebContainer for a snapshot of the *last successfully built* version, served as a normal iframe. The user can keep chatting and re-generating; the preview updates whenever a new version saves.

For projects that have never been built (brand-new), we show the static `buildPreviewDoc` placeholder you already have, but with a clearer message.

We also fix the layout so chat + preview no longer fight for space on a 430px viewport.

### 1. Tabbed Chat / Preview layout on mobile

Today the builder uses a 2-column grid (`md:grid-cols-[360px_1fr]`) that stacks vertically below `md`. On a phone you scroll past the chat to find the preview. Replace the mobile stack with a **tab bar** at the top: `Chat | Preview`. Desktop layout stays unchanged.

- Add `mobileTab` state (`"chat" | "preview"`, default `"chat"`).
- Below `md`, render only the active panel; above `md`, show both side-by-side as today.
- The tab bar lives directly under the header, with a small dot indicator on `Preview` when files have changed since last view.

### 2. Mobile-aware preview component

Create a `<MobilePreviewFallback />` that replaces `<WebContainerPreview />` when:
- `useIsMobile()` is true, **or**
- `detectUnsupportedBrowser()` returns a message.

Behavior of the fallback:
- If the project has at least one saved version → render an iframe pointing to a server route that returns `buildPreviewDoc(files)` (a self-contained HTML doc — already exists in `src/lib/preview.ts`). Reason for a route vs. `srcDoc`: srcDoc breaks COEP isolation in some mobile browsers; a same-origin route inherits our CORP headers cleanly.
- If no version yet → friendly empty state: "Your preview will appear here as soon as Petal generates it." with a spinner that pulses while a generation is in flight.
- A small banner at the bottom: "Static preview — interactive features need a desktop browser to run live. [Learn why]" with a popover explaining WebContainers + linking back to chat.

### 3. New server route for the static preview

Add `src/routes/api/preview.$projectId.tsx` (TanStack server route, `GET` handler):
- Loads the project's latest files via the existing `getProjectFiles` server function.
- Auth-checks the caller (must own the project or it must be public via `is_featured` / `share_slug`).
- Returns `new Response(buildPreviewDoc(files), { headers: { "Content-Type": "text/html", "Cross-Origin-Resource-Policy": "same-origin" } })`.
- Wrapped in CORS headers per the troubleshooting guide so the iframe loads cleanly under our COEP.

The mobile fallback iframe `src` becomes `/api/preview/${projectId}?v=${versionCount}` so it busts cache when a new version saves.

### 4. Smarter desktop detection

Soften `detectUnsupportedBrowser()` in `src/components/WebContainerPreview.tsx`:
- Keep returning a message for iOS / non-Chromium Android (the real-world install rarely succeeds), but pass that message *up* to the parent instead of rendering the dead-end card.
- The parent (builder) decides what to render — on mobile it picks the fallback; on a desktop browser that *happens* to be unsupported (rare: old Firefox, Safari < 16.4) it still shows the existing card.

### 5. Tighten install UX on slow desktops

While we're in here:
- Show install progress as `npm install (47s elapsed)` instead of just "Installing dependencies…" so 60-90s installs feel less stuck.
- Bump the timeout from 3 → 5 minutes (cold installs on shared CI-style runners can cross 3min).
- Add a "Cancel and retry" button next to the timer.

### 6. Out of scope for this pass

- **Real WebContainer-on-iOS attempt**: not worth it given network reality; revisit if StackBlitz publishes perf benchmarks.
- **PWA manifest for generated apps** (Base44/Lovable feature): bigger lift, separate phase.
- **Mobile frame simulator in desktop editor** (Base44 "Mobile preview mode"): nice-to-have, defer.

## Files touched

- `src/routes/builder.tsx` — add `mobileTab` state + tab bar, swap component on mobile.
- `src/components/WebContainerPreview.tsx` — surface unsupported message via callback, add elapsed timer, raise timeout.
- `src/components/MobilePreviewFallback.tsx` — **new**, renders the static iframe + empty state + info banner.
- `src/routes/api/preview.$projectId.tsx` — **new**, TanStack server route returning static preview HTML with CORS + CORP headers.
- `src/lib/preview.ts` — minor: tweak the placeholder copy to mention "open on desktop for live preview."
- No new dependencies; no DB changes.

## Risks

- **Auth on the new route**: must reuse the same Supabase server client / RLS path used by `getProjectFiles`. If we get this wrong, we leak private project source. I'll mirror the exact pattern from `src/server/generate.server.ts`.
- **COEP/iframe interaction**: our global `Cross-Origin-Embedder-Policy: require-corp` middleware (in `src/start.ts`) means the iframe's response *must* send `Cross-Origin-Resource-Policy: same-origin` — already planned, but worth flagging.
- **Cache invalidation**: the `?v=` query bust relies on the version counter being available client-side. It is (we already pass it to `WebContainerPreview` as `reloadKey`).

## Verification plan after build

1. Desktop Chrome: existing WebContainer flow unchanged, builds + previews React app.
2. Desktop Firefox: same.
3. iOS Safari (your phone): tabs visible; "Chat" works; "Preview" tab shows static render of the kanban app within ~1s of generation completing.
4. Brand-new empty project on iOS: friendly empty state, not the broken-spinner card.
5. Confirm the published `/p/$slug` and `/gallery` routes still work (they share `buildPreviewDoc`).
