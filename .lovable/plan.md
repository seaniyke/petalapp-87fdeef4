## Goal

Replace the single hardcoded "habit-tracker" showcase block on `src/routes/index.tsx` (lines ~155-213) with a **rotating gallery** that cycles through several sample apps in the **same window frame**, with smooth fade/slide animations between them.

This matches the look of your reference screenshot (the cream Petal window with chat + index.html + preview), but the **chat messages, code, and preview swap out** every few seconds to demo different apps.

## What you'll see

A single mac-style window (traffic-light header, monospace title) staying anchored on the page, while every ~5 seconds:
- The window title changes (e.g. `petal — habit-tracker` → `petal — pomodoro`)
- The chat bubbles fade out and a new conversation fades in
- The `index.html` snippet swaps to the new app's code
- The preview card morphs into the new app's UI
- Small dot indicators below let users click to jump to a specific sample

All animations use the existing `animate-fade-in` / `animate-scale-in` keyframes already in the project (no new deps).

## Sample apps included

1. **Habit tracker** — current one (kept as the first slide)
2. **Pomodoro timer** — pastel circular timer + stats
3. **Recipe generator** — recipe card with photo placeholder + ingredients
4. **Coffee shop landing** — hero + menu items

Each sample has its own:
- Window title
- 3 chat bubbles (user prompt → petal reply → follow-up)
- Short `index.html` snippet
- A small JSX preview block (tinted background, card, list/items, accent badge)

## Implementation plan

### 1. New file: `src/components/SampleAppShowcase.tsx`
- Defines a `SampleApp` type and a `SAMPLE_APPS` array (4 entries) where each `preview` is a small render function returning JSX.
- Holds an `activeIndex` state, advances it on a 5-second `setInterval` (pauses on hover so people can read).
- Renders the outer mac-window chrome **once**, then renders the active sample's chat/code/preview keyed by index so they remount and trigger the `animate-fade-in` entrance.
- Renders a row of clickable dot indicators (active dot uses `bg-primary`, others `bg-border`) below the window.
- Respects `prefers-reduced-motion` (no auto-rotate, no slide animations) for accessibility.

### 2. Edit `src/routes/index.tsx`
- Remove the hardcoded showcase block (lines ~155-213).
- Import and render `<SampleAppShowcase />` in its place inside the existing `<section id="showcase">` wrapper, keeping the same outer spacing (`-mt-16 px-6 pb-24`).

### 3. No styling additions needed
- Reuses existing tokens: `bg-coral`, `bg-butter`, `bg-mint`, `bg-lilac`, `bg-sky`, `bg-aurora`, `font-display`, `font-mono`, `border-border`, etc.
- Reuses existing animations: `animate-fade-in`, `animate-scale-in` (already configured in the project).

## Files touched
- **Create**: `src/components/SampleAppShowcase.tsx`
- **Modify**: `src/routes/index.tsx` (replace one section, add one import)

## Out of scope (can do later if you want)
- Manual prev/next arrows (dots-only feels cleaner at this size)
- Real WebContainer previews inside each card (these are static mockups, like the current one)
- New sample apps beyond the 4 listed — easy to add more entries to the array later

Want me to go ahead and build this?