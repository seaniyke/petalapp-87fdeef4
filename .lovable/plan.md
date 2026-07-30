# Petal Builder UX — beat Lovable at its own game

Goal: the moment-to-moment feel of using Petal (streaming, details trace, publish, preview) should read as more alive, more legible and more confident than Lovable's. Four surfaces need work, judged against the reference shots.

## 1. Streaming trace that reads like a colleague working

Today Petal's Details sheet renders one flat list: phases, then a "thinking log", then every file, then verifier events — all in fixed groups, out of true chronological order, all rows the same weight. Lovable instead shows a single interleaved trace of typed steps: `Thought for 8s` (expandable, with the actual reasoning paragraph), `Reading billing library and email registry`, `Read database`, `Edited receipt-pdf.ts`.

Changes:

- **One chronological trace.** Replace the four stacked lists with a single time-ordered stream of typed entries (`thought`, `reading`, `edit`, `check`, `phase`, `deploy`). Every entry carries a timestamp so the order is real, not grouped by kind.
- **Thought entries with duration.** Group consecutive reasoning narration into a single `Thought for Ns` row, collapsed by default, expanding to the full text — same as the reference. Duration comes from the gap between the first and last narration tick in the group.
- **Step-type icons and weights.** Thought (lamp), read/scan (magnifier), edit (pencil + filename chip + `+n/−n`), check (tick/wrench/cross), deploy (rocket). Filenames stay as monospace chips; full path shown on expand.
- **Live tail.** While active, the last row pulses and the sheet auto-scrolls to it; a sticky footer shows elapsed time and current phase so it never feels frozen.
- **Petal's edge over Lovable:** a `Summary` tab alongside Timeline/Changes with a plain-English "what I did and why" recap plus counts (files touched, checks passed, credits) — Lovable makes you read the trace to work that out.

## 2. Chat-thread activity card

The compact card is close but static. Make the collapsed card carry more signal without growing:

- Show the current step line the way the reference does — action verb + filename chip ("Editing `receipt-pdf.ts`") with a secondary caption underneath.
- Rotate the caption smoothly (fade, not jump), keep a two-line max.
- On completion the card collapses to one line: `Done · 7 files · 1m 12s · 2 credits`, with Details / Preview.
- Add a thin phase progress rail across the card top (six segments, filling) so progress is visible at a glance.

## 3. Publish flow (reference: "Updating your project" → "Your website was updated")

Petal currently has no in-progress or celebratory publish state and no share surface.

- **In-progress card:** compact centered spinner, "Publishing your app — this takes a minute or two. You can close this and keep building."
- **Success card:** animated check, "Your app is live", then a live SEO/social preview row (favicon, title, domain, description) rendered from the project's real metadata, plus a hint to ask Petal to change title/description/icon.
- **Share row:** X, LinkedIn, Reddit, WhatsApp (better fit for Petal's audience than Discord), each opening a prefilled intent URL.
- **Actions:** Copy link / Visit site.
- Keeps the existing compact popover-on-desktop, drawer-on-mobile shape.

## 4. Preview failure state (reference: blank frame + sad file icon)

The broken-preview frame currently shows a bare icon. Replace with a recovery card: plain-language cause when we know it (syntax error, build failed, dependency install), a `Reload preview` button, an `Ask Petal to fix it` button that fires a real repair prompt with the captured error, and a link to open the file at fault.

## 5. Young, confident tone pass

Keep the phase copy young but tighten it so it never reads as filler: short verb-first lines, no exclamation spam, one emoji max per phase, and consistent past tense on completion.

## Technical notes

- New `src/lib/build-trace.ts`: `TraceEntry` union + `buildTrace()` that merges phases, narration, file writes and timeline events into one sorted array, and `groupThoughts()` for the `Thought for Ns` rollup. Pure functions, unit-testable, no React.
- `BuildDetailsSheet.tsx` rewritten to render `TraceEntry[]` with per-type rows; gains a third `Summary` tab.
- `BuildActivityCard.tsx` gains the progress rail and the verb+file current-step line; props unchanged apart from what already flows in.
- `PublishSheet.tsx` gains `publishing` / `published` states and a new `PublishSuccessCard` subcomponent; share links are plain `window.open` intents, no SDKs.
- `PreviewCrashFallback.tsx` gains the recovery actions, wired to the existing send-prompt path in `builder.tsx`.
- No server, schema or billing changes. Streaming event shapes stay as-is — the richer trace is derived client-side from events Petal already emits (`narration`, `cycle_progress`, `phase`, `file_complete`, `timeline`).
