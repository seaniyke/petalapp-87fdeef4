# Making Petal genuinely intelligent

## Honest starting point

Last turn we shipped a triage layer (chat / clarify / build) with a warm preamble. That gives Petal a friendly **voice**, but voice is not intelligence. Today Petal still:

- Takes any "build" intent at face value — even if the request is contradictory, broken English, or missing the one piece of info that would make the result good.
- Has no memory of who the user is, what they're building, or how they like things — every turn starts cold.
- Doesn't push back, doesn't suggest, doesn't have a point of view on design.
- Treats "make me a website for my barber shop" the same as "fix the navbar padding" — same pipeline, same prompts, same effort budget.
- Can't recover gracefully from its own mistakes (failed builds, wrong assumption, misread intent).

A "preferred AI builder" is not one prompt — it's a system of small intelligences working together. Here is the plan to get there, broken into 5 honest layers.

---

## Layer 1 — Real intent understanding (not just 3 buckets)

The current triage returns `chat | clarify | build`. That's too coarse. We extract a **structured intent** on every turn:

```text
{
  mode: "chat" | "clarify" | "build" | "edit" | "fix" | "explain" | "redesign",
  confidence: 0..1,
  language: "en" | "fr" | "pidgin" | ...,   // detected, not assumed
  audience_level: "non_technical" | "mixed" | "technical",
  topic: "auth" | "layout" | "data" | "copy" | "branding" | ...,
  scope: "tiny" | "small" | "medium" | "large",
  brief: "<one-line normalized restatement of what they want>",
  unknowns: ["<the single most important missing piece>", ...]
}
```

Why each field matters:
- **mode `edit` vs `build` vs `fix`** lets us pick the right pipeline (a 2-line CSS tweak should not run the 6-phase build card).
- **language** lets Petal reply in pidgin / French / broken English in the same register the user wrote in — not just "translate the same corporate sentence".
- **audience_level** lets us hide jargon from a barber and lean in for a developer.
- **scope** drives how much context we load and how long we let the model think (small = fast & cheap, large = reasoning model + more files in context).
- **brief** is a normalized restatement we can show back ("Got it — a one-page site for your shop with hours, photos, and a WhatsApp button. Building now.") — this single line is what makes users *feel* understood.
- **unknowns** drives the clarify question (only ask the ONE thing that would change the output).

Implementation: extend `/api/triage` to return this structured object via tool-calling (not free-form JSON). Keep the streamed preamble.

## Layer 2 — Ambiguity handling that doesn't annoy

Today: if intent is `clarify`, we ask one question. That's fine but lifeless.

Better: when confidence is low OR `unknowns` is non-empty, return **smart suggestion chips** alongside the question, generated from the brief:

> "Quick check — what's this for?
> [ My barber shop ] [ A side project ] [ A client ] [ Other → tell me ]"

The user clicks once and we proceed. Only fall back to typing when none fit. This is what makes Lovable's "Ask" mode feel fast vs. an interrogation.

Implementation: add an optional `suggestions: string[]` to the triage response. Render as chips in the chat bubble. Clicking a chip auto-sends as the next user turn.

## Layer 3 — Project memory (so it stops feeling cold)

Right now every turn rebuilds context from scratch. We add a tiny per-project memory stored in Lovable Cloud:

```text
project_memory(project_id, key, value, updated_at)
```

We seed it from the very first build with things like:
- `audience` — who the app is for (barber shop customers, students, …)
- `tone` — playful / professional / minimal
- `palette_intent` — "warm earthy", "clean monochrome", from their own words
- `must_have` — running list of things they've said matter ("WhatsApp button", "booking", …)
- `dont_do` — running list of things they've rejected ("no carousels", "stop using purple")

Every triage + build call loads this memory into the system prompt. After every turn, a tiny "memory writer" model decides whether to update it (it does NOT rewrite — only appends or tweaks). This is how Petal stops repeating mistakes you already corrected.

Implementation: new `project_memory` table + RLS, tiny `updateProjectMemory()` server fn called after each successful build, memory injected into both `/api/triage` and `/api/generate` system prompts.

## Layer 4 — Design taste (not just "use shadcn")

The build prompt today says "use the kit". That keeps things consistent but not *good*. We add a lightweight **design director** pass before generation for any `build` or `redesign` mode at `medium`+ scope:

- Picks a vibe (3-5 named presets: "warm-editorial", "clean-saas", "bold-consumer", "luxury-minimal", "playful-startup") based on brief + memory.
- Picks 2-3 hero moves (e.g. "oversized serif headline + warm cream background + single product photo" vs "tight grid of cards + monochrome").
- Returns a short style brief that gets prepended to the build prompt.

This is the difference between "an app that works" and "an app the user shows their friend". It's also cheap — one extra fast-model call per real build, skipped for tiny edits.

Implementation: new `pickDesignDirection()` server fn calling `google/gemini-3-flash-preview`, output appended to `SYSTEM_PROMPT_INITIAL` for new builds, skipped for patches.

## Layer 5 — Self-recovery and honesty

Petal currently fails silently or with a generic "build failed". Real intelligence is knowing when you're wrong:

- After a build, run a **self-check** pass: read the generated `App.tsx`, score it against the brief ("does this actually do what was asked?"). If score is low, attempt one auto-correction patch before showing the result.
- When a build fails (lint, type, runtime), surface a human sentence — "I tried to add the booking form but I used a date picker that doesn't exist in our kit. Fixing it now." — and auto-retry once.
- When the user says "this isn't what I wanted", trigger a **diagnosis turn**: instead of jumping to a new build, ask one focused "what specifically?" with chips drawn from the diff between brief and result.

Implementation: add `selfCheck()` step at the end of `runGenerate()`, add structured failure reasons to `BuildActivity`, route "isn't what I wanted" replies through triage with mode `fix` (already covered by Layer 1).

---

## Technical sequencing

I'd ship this in 4 deployable steps so you see value fast and we don't break what's working:

1. **Structured intent + chips** (Layer 1 + 2). Replaces today's tiny triage. ~1 file changed, 1 new field on the SSE stream, chip rendering in the chat bubble.
2. **Project memory** (Layer 3). New table + RLS migration, two new server fns, prompt injection.
3. **Design director** (Layer 4). One new server fn, wired only into initial builds and explicit redesigns.
4. **Self-check + recovery** (Layer 5). New post-build pass + better failure messaging.

Each step is independently useful and reversible. After step 1 the product *already* feels meaningfully smarter; steps 2-4 compound it.

## What I'm NOT promising

- Petal won't suddenly match the best of Lovable on day one — they have years of compounding eval data we don't.
- "Understands broken English in any manner" is a direction, not a switch. Layer 1's language detection + Layer 3's memory will make it dramatically better than today, but edge cases will remain and we'll need real user logs to keep tuning.
- None of this fixes underlying build failures from the model — it only handles them more gracefully.

If you approve, I'll start with **Step 1 (structured intent + suggestion chips)** because it's the single biggest jump in perceived intelligence per line of code, and you'll feel it in the very next message you send.
