## Goal

Today the build experience collapses everything into 4 bullets ("Plan ready / Design locked in / Wrote 8 files / Verified"). The SSE pipeline in `/api/generate` already emits much richer events — phase, design_vibe, narration, cycle_start/progress/end, file_progress, file_complete, file_validated, timeline, status. Lovable shows these as a continuous, friendly trace. We'll do the same.

Out of scope for this turn:
- Changes to the server-side generation logic itself (we'll only add a couple of `status` emit points where the pipeline currently goes silent).
- Plan-mode card, error card, publish/deploy cards — only the in-flight build trace.
- Payments fix is already shipped this turn.

## What the user will see

While Petal works, the assistant message renders a live trace card pinned in place of today's "Deploying to your preview" card:

```text
┌─ Petal is building ──────────────────────────── 1m 12s ─┐
│ 🌸  Reading the request                                  │
│     Detected: SaaS landing page, Stripe payments        │
│ ✨  Picking the design direction                         │
│     Modern SaaS · Aurora hero · Space Grotesk           │
│ 📝  Writing the code                              7 / 12 │
│     ✓ src/routes/index.tsx           +180 lines         │
│     ✓ src/components/Hero.tsx         +96 lines         │
│     ✓ src/components/Pricing.tsx      +74 lines         │
│     ⠋ src/components/Footer.tsx       writing…          │
│        "Adding social links and legal nav"              │
│ 🎨  Verifying the changes                                │
│     · Type-check passed                                  │
│     · No render risks                                    │
│ 🚀  Deploying to your preview                            │
└──────────────────────────────────────────────────────────┘
```

Behavior:
- **Auto-expanded by default** while a turn is in flight; collapses to today's compact form after the turn ends.
- **Live thinking line** under the active phase — the most recent `status` / `cycle_progress` / `narration` text, replaced as new ones arrive (no infinite scroll).
- **File rows** stream in as `file_complete` events arrive, with a spinner row for the file currently being written (`file_progress.latestPath` + last `narration` for that path). Show +N lines from `file_complete.bytes` heuristic when available.
- **Cycle awareness**: when `cycle_start({intent:"fixing"})` arrives, append a sub-row "🔧 Fixing an issue (round 2)" with its own progress line, so users understand why a build sometimes loops.
- **Timeline checks** (esbuild_parse, render_risk, rls_sanity, post_stream_autofix) render as bullet items under the Verifying phase with their outcome icon.
- Auto-scrolls to the latest row; user scroll-up pins the view (standard chat-log behavior).

## Technical changes

### Client (the bulk of the work)

1. **`src/components/BuildActivityCard.tsx`** — rewrite the body. Today it groups events into the 4 phase bullets and hides the rest. New version keeps the phase headings but renders, under each:
   - latest live thinking line (status / cycle_progress / narration)
   - a list of file rows for the writing phase
   - a list of verifier rows for the polishing phase
   - timeline rows for verifier checks
   Keep the existing collapsed/expanded chevron, but default to expanded while `status !== "done" && status !== "failed"`.

2. **`src/routes/builder.tsx`** — extend the per-turn state that already feeds BuildActivityCard:
   - track `latestThinking: { phase, text }` updated from `onStatus`, `onCycleProgress`, `onNarration`
   - track `fileRows: Array<{ path, status: "writing" | "done" | "failed", bytes?, validationError? }>` driven by `onFileProgress` / `onFileComplete` / `onFileValidated`
   - track `verifierRows: Array<{ step, outcome, message }>` from `onTimeline`
   - track `currentCycle: { n, intent }` from `onCycleStart`/`onCycleEnd`
   Pass them all into `<BuildActivityCard …/>`.

3. **`src/lib/build-phases.ts`** — add a small `LiveTrace` type and helpers (`appendFileRow`, `setFileStatus`, `appendTimeline`) so reducers stay pure and testable.

### Server (small, surgical)

4. **`src/routes/api/generate.ts`** — add `status` emits at the few points the pipeline currently goes silent for >5s:
   - "Reading existing files…" before scaffold context build
   - "Choosing components…" between design vibe and first file write
   - "Bundling for preview…" right before the result event
   No new event types — reuse `status` so the client doesn't need new parsing.

5. **No changes** to credit logic, plan-mode flow, error envelope, abort handling, or `/api/turns/$id/events` replay (the new card will rehydrate from replayed events because it consumes the same handlers).

## Validation

- Manual: start a fresh build, watch the trace populate; trigger a fix loop by editing into a syntax error; abort mid-stream; refresh mid-stream and confirm replay rebuilds the trace.
- Check that the collapsed (post-done) card still matches today's compact summary so chat history doesn't suddenly look different for old turns.
- No console errors; no layout shift inside the chat thread.

## Risk

Medium. All the events already exist server-side, so the blast radius is one component file + reducers in builder.tsx. The main pitfall is auto-scroll fighting user scroll — we'll use the same scroll-pinning pattern the chat list already uses.
