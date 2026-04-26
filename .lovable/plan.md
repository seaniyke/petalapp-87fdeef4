## Goal

Match the polish of the Lovable mobile UI (image 3 reference) on Petal's builder screen. Concretely, fix two confirmed issues visible in the screenshots:

1. **Header is hidden behind the iOS status bar** (image 1). The `/builder` page uses `h-screen` and renders edge-to-edge, but the header has no safe-area padding, and the global `viewport` meta is missing `viewport-fit=cover`, so iOS doesn't expose `env(safe-area-inset-top)` to the layout.
2. **Long code/path strings overflow horizontally** in chat messages (visible in both screenshots — `node_modules/...` and `file:///app/builds/...` push the bubble wider than the viewport, contributing to the "cut off" feel).

While we're in the area, apply small, verified mobile-responsiveness improvements that don't change desktop behavior.

## Verified findings (read-only)

- `src/routes/__root.tsx:33` sets `viewport` to `width=device-width, initial-scale=1` — **no `viewport-fit=cover`**. This is why iOS Safari draws content under the status bar without exposing safe-area insets.
- `src/routes/builder.tsx:890` wraps the page in `flex h-screen flex-col` and the header at line 892 is `flex h-14 ... px-4` with no top padding. Combined with the missing viewport-fit, the header sits *under* the iOS status bar.
- `src/routes/builder.tsx:892` header is **not sticky** — when iOS Safari collapses the URL bar on scroll, the page can shift such that the header appears partially clipped.
- `src/components/MarkdownMessage.tsx:67` `<pre>` uses `overflow-x-auto` (good), but the `<code>` inline element (line 58) has no `break-all`/`overflow-wrap`, so very long unbroken paths inside paragraphs can stretch the parent bubble. The chat bubble itself also has no `min-w-0` on its flex parent, which is what causes the bubble to grow past the viewport.
- `src/components/RevertPreviewDialog.tsx:111` uses `max-w-xl` only, with no horizontal margin clamp — fine on most phones but feels edge-to-edge.

## Scope (small, surgical)

### 1. Add `viewport-fit=cover` and safe-area support
- **`src/routes/__root.tsx`** (line 33): change viewport content to `width=device-width, initial-scale=1, viewport-fit=cover`.
- **`src/styles.css`**: add a tiny utility `.safe-top { padding-top: env(safe-area-inset-top); }` and `.safe-bottom { padding-bottom: env(safe-area-inset-bottom); }` so we can opt in without changing global behavior.

### 2. Make the builder header safe-area-aware and sticky
- **`src/routes/builder.tsx`** (~line 892): apply `safe-top` + `sticky top-0 z-30` to the header so it always stays visible and clears the iOS status bar. Also apply `safe-bottom` to the chat composer footer area (line ~1312-1357) so the input is not hidden behind the iOS home indicator.
- The mobile Chat/Preview tab bar (line 1022) becomes `sticky top-14 z-20` so it stays under the header during chat scrolling.

### 3. Prevent long code strings from blowing out chat bubbles
- **`src/components/MarkdownMessage.tsx`**: 
  - Add `break-words` to the wrapper `div` (line 38) and `overflow-wrap-anywhere` to inline `<code>` (line 58) so long unbroken tokens wrap.
  - Keep `<pre>` as-is (already has `overflow-x-auto`).
- **`src/routes/builder.tsx`** chat message bubble (line ~1080+ where messages render): add `min-w-0` to the flex parent and `max-w-full` to the bubble so flexbox actually allows children to shrink. (Read confirmed the bubble structure earlier; we'll only add `min-w-0` where it's missing.)

### 4. Modal/sheet polish for small screens
- **`src/components/RevertPreviewDialog.tsx`** (line 111): change `max-w-xl` → `max-w-[calc(100vw-1.5rem)] sm:max-w-xl` so the dialog gets a comfortable 12px gutter on phones.
- **`src/components/ProjectSettingsSheet.tsx`** (line 112): already `w-full max-w-md` — fine. No change.
- **`src/components/HistoryPanel.tsx`** (line 147): already `w-full ... sm:max-w-md` — fine. No change.

## Out of scope (won't touch this turn)

- Restructuring the builder layout, theming, or the WebContainer preview.
- Changes to the index/landing page or auth screens.
- The previously-cancelled "modal and sheet layouts" sweep — only the one mobile clamp on `RevertPreviewDialog` is included here because it's directly adjacent.
- Any change to `src/integrations/supabase/*`, `routeTree.gen.ts`, or generated files.

## Verification

- `bunx tsc --noEmit` to confirm no type regressions.
- Visually verify on the 430×661 viewport (current preview) that:
  - Header is fully visible below the iOS status bar.
  - Header stays put while scrolling the conversation.
  - The Chat/Preview tab bar stays under the header.
  - A pasted long path (e.g., `node_modules/@tailwindcss/...`) wraps inside the bubble instead of pushing it wider than the viewport.
  - The chat composer is not obscured by the iOS home indicator.

## Files to edit

- `src/routes/__root.tsx` — viewport meta
- `src/styles.css` — `.safe-top` / `.safe-bottom` utilities
- `src/routes/builder.tsx` — sticky safe-area header, sticky tab bar, safe-area composer, `min-w-0` on chat bubbles
- `src/components/MarkdownMessage.tsx` — wrap long inline code/text
- `src/components/RevertPreviewDialog.tsx` — mobile width clamp

Six total edits, all narrowly scoped, no behavior changes on desktop.