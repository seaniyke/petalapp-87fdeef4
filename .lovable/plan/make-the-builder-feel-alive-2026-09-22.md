# Make the builder feel alive

Today the build card states facts and then sits still: one headline, one line, a spinner. Nothing moves, nothing shows, nothing rewards watching. This plan turns the waiting time into the best part of using Kimble — something you *want* to watch until your app is ready.

## The idea

While Kimble works, the card becomes a small live stage:

- **It talks like a person working**, not a status field. Lines change often, in Kimble's voice, tied to what's really happening: "Sketching the hero…", "Made the trail photos — they look good", "Reading your existing menu page before I touch it".
- **It shows, not just says.** When pictures are made, their thumbnails pop in one by one. When a page is written, its name lands on the stack with a soft animation. You can see the app being assembled.
- **It has a heartbeat.** A gentle progress arc that fills as the turn moves through its stages, a live timer, and the current line typing itself in rather than snapping.
- **It rewards finishing.** The moment it's done, the card transforms with a satisfying beat — a quick count-up of what got made ("6 pictures · 12 files · 1m 04s"), then settles into the ready card you already have.

## What changes on screen

**1. Living narration line**
One line under the headline, but never stale. It swaps with a soft slide as each real event lands, types in character by character, and when nothing new is happening for a few seconds it fills with a short in-character aside instead of freezing ("Still shaping this one…", "Lining up the spacing"). Every line comes from something Kimble actually did — never fake progress.

**2. Picture strip**
When Kimble makes images, small rounded thumbnails appear in a row in the card, one popping in per image as it lands. This is the single most watchable moment of a build and today it is the text "Generated 6 images".

**3. File stack**
A compact row of filename chips for the pages being written, newest first, each sliding in as it lands, with the active one softly pulsing. Names stay human ("Home page", "Menu"), not paths.

**4. Progress that breathes**
The flat six-segment bar becomes one smooth arc that advances with the stage and shimmers while active, with the elapsed timer next to it. No internal step names.

**5. Finish moment**
On completion the card does a short celebratory transition: numbers count up, the strip of pictures settles, then it becomes the existing "Your app is ready" card with its three actions. One card, one moment — nothing added to the thread.

**6. Personality, lightly**
Kimble's lines vary so two builds never read identically, and it occasionally reacts to the work ("this one's got a lot of pages"). Warm and brief — never cute, never chatty, never explaining machinery.

All motion respects reduced-motion settings and stays quiet on low-power devices.

## Guardrails

- Nothing invented: every line and every thumbnail is backed by a real event.
- No internal step names, no costs, no under-the-hood mechanics anywhere on the card.
- Build behaviour, credits and the questions flow are untouched — this is presentation only.

## Technical notes

- `src/lib/activity-language.ts` gains variant phrasings per step plus an idle-filler set, keeping `humanizeActivity` pure and testable; selection is seeded per turn so a turn reads consistently.
- New `src/components/build/LiveNarration.tsx` (typed-in, cross-faded line), `ImageStrip.tsx` (thumbnails from image events), `FileStack.tsx` (animated filename chips), `ProgressArc.tsx`.
- `BuildActivityCard.tsx` composes these instead of rendering a static headline block; existing props (`phases`, `timelineEvents`, `writtenPaths`, `latestPath`) already carry everything needed. Image thumbnails need the resolved asset URLs surfaced on the `image_resolve` timeline event; if the event does not carry URLs, fall back to placeholder tiles that fill in from the preview.
- `BuildResultCard.tsx` gains a mount-time count-up for the summary stats.
- Animations use existing tokens/utilities plus `motion-reduce` variants; no new dependency unless Motion is already present.
- Tests: extend `activity-language.test.ts` for variants and determinism; add a render test asserting narration never shows a stale line and that reduced-motion disables animation.
