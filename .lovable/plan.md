
# Human-friendly build progress (Lovable-style activity feed)

## The product goal

Right now, while Petal builds, non-technical users see one of:
- "Thinking…" → "Writing project…" → "Applying changes…" (vague, technical)
- A blank chat with a spinner
- "Building your live preview…" with no sense of progress

**Lovable's magic** isn't that it tells you *what's happening* — it's that it tells you a **story** in plain English, in real time, that makes the wait feel intentional and intelligent. That's what we'll build.

We will **not** show users any of these technical terms: `write_project`, `patch_files`, `tool call`, `Cloudflare`, `Railway`, `esbuild`, `npm install`, `dist_path`, `wrangler`, `HMAC`, `SSE`, `bundling`. They never need to know any of it exists.

---

## What the user will see (non-technical language)

A **live activity card** appears in the chat the moment they send a prompt. It updates in place — never scrolls past — until the app is live. Each step has a friendly icon, a one-line action, and a soft elapsed-time stamp. Done steps stay visible (collapsed); the active step pulses gently.

### The 5-stage story

| Stage | What user sees | What's actually happening |
|---|---|---|
| 1. **Thinking** | "🌸 Reading your request…" then "💭 Sketching out the design…" | LLM cold-start + first tokens |
| 2. **Designing** | "✨ Designing your app…" with a 1-line live caption from the AI's summary | `summary_delta` events |
| 3. **Writing** | "📝 Writing your app… (3 of 12 files)" with a live counter | We count `"path":` occurrences in the streaming JSON |
| 4. **Polishing** | "🎨 Adding finishing touches…" | The `Applying changes…` phase + saving to DB |
| 5. **Going live** | "🚀 Putting your app online…" → "Almost there" → "Your app is live!" | Cloudflare build pending → ready |

If a step takes >10s, we add a soothing reassurance line ("This usually takes about a minute" / "Hang tight, we're nearly there") so users don't think it's stuck.

### When something goes wrong

Errors stay friendly. Instead of `AI gateway error (502)` we show:
- "😅 Petal got a bit confused. Want to try that again?" → **Try again** button
- Build failures: "🔧 Your app needs a small fix" → **Ask Petal to fix it** button (auto-prepends "Please fix the build error" to the next prompt)

Behind the scenes we log the technical detail to the console for ourselves but **never** surface it unless they click a small "Show details" link.

---

## What we'll build (technical, internal only)

### 1. Extend the streaming protocol — `src/server/generate.server.ts`

Add new event types to `StreamEvent`:
```ts
| { type: "phase"; phase: "thinking" | "designing" | "writing" | "polishing" }
| { type: "file_progress"; written: number; latestPath?: string }
```

Existing `status` and `summary_delta` events stay; we just stop using their raw text in the UI and use them as triggers.

### 2. Detect file boundaries during streaming — `src/routes/api/generate.ts`

While accumulating tool args, lightweight regex-scan the growing JSON to count completed `"path": "..."` occurrences and emit `file_progress` events. We don't try to fully parse mid-stream — just count.

Emit explicit `phase` events at known transitions:
- Stream start → `thinking`
- First `summary_delta` → `designing`
- First `"path":` detected → `writing`
- `relayAndCollect` returns → `polishing`

### 3. Bridge into the build phase — new hook `src/hooks/use-build-activity.ts`

Subscribes to `project_builds` for the current `latest_build_id` and translates DB states into friendly phases:
- `pending` → "Putting your app online…"
- `ready` → "Your app is live!"
- `failed` → friendly error

Tracks elapsed time per phase. This unifies AI generation + Cloudflare deploy into **one continuous timeline** the user perceives as a single action.

### 4. New component — `src/components/BuildActivityCard.tsx`

A self-contained card rendered inside the chat thread (replaces the bare "Thinking…" line). Visual style:
- Soft pastel card matching Petal's existing aesthetic (`bg-card/90`, `bg-aurora`)
- Active phase: gentle pulsing dot + rotating sparkle icon
- Done phases: small green check, collapsed to one line
- Failed: warm orange icon + reassuring copy + action button
- Smooth height transitions (CSS-only `transition-all` — no new dependencies)

Mobile: full-width, sticky at top of chat scroll area so it stays visible while reading.

### 5. Wire it up — `src/routes/builder.tsx`

Replace current `streamStatus` / `streamingSummary` UI with `<BuildActivityCard>`. Drives state from both the SSE stream and the realtime `project_builds` subscription. `MobilePreviewFallback` simplifies — it no longer needs to show "Building…" copy because the activity card already covers that story; it just shows the iframe when ready.

### 6. Friendly error mapping — `src/lib/friendly-errors.ts` (new)

Single source of truth that turns technical errors into plain English:
- `"Rate limit reached..."` → "Petal needs a quick breather. Try again in a moment."
- `"AI credits exhausted..."` → "We've used up today's free generations. Add credits in Settings → Workspace to keep going."
- `"AI returned invalid project data"` → "Petal got a bit tangled up. Let's try that again."
- `"Could not reach build service"` → "Couldn't reach the publishing service. We'll keep trying."
- build `"failed"` with logs → "Your app has a small error. Ask Petal to fix it." (logs hidden behind "Show details")

---

## Before vs. After

| Today | After |
|---|---|
| "Thinking…" / "Writing project…" / "Applying changes…" | A warm activity card with 5 friendly stages |
| Spinner with no progress signal | Live file counter ("Writing your app… 7 of 12") |
| Build phase invisible until iframe appears | "Putting your app online… 🚀" with reassurance copy |
| Errors shown as raw API messages | Friendly copy + clear next-action button |
| Two disconnected loading states | One continuous story from prompt → live app |

---

## Out of scope

- Underlying generation, Railway builder, or Cloudflare deploy — all working
- Database schema (`project_builds` already has everything we need)
- `MobilePreviewFallback` iframe rendering once the build is ready
- Auth, project creation, version history

---

## Risk assessment (KeshPay-style caution)

| Risk | Likelihood | Mitigation |
|---|---|---|
| Regex-based file counting miscounts | Low | Counter is optional — UI works fine without a number |
| New SSE event types break older open tabs | Very low | Unknown events ignored by `switch` — no crash |
| Activity card eats mobile vertical space | Medium | Auto-collapses to single "✓ Built in 47s" line after success |
| Friendly mapping hides a real bug from us | Low | Full technical error always logged to `console.error` |

---

## Files

**New (4)**
- `src/components/BuildActivityCard.tsx`
- `src/hooks/use-build-activity.ts`
- `src/lib/friendly-errors.ts`
- `src/lib/build-phases.ts` — pure helpers for phase definitions

**Modified (4)**
- `src/server/generate.server.ts` — extend `StreamEvent` type
- `src/routes/api/generate.ts` — emit `phase` + `file_progress` events
- `src/lib/stream.ts` — handle new event types
- `src/routes/builder.tsx` — render `<BuildActivityCard>` instead of the current status text

**Untouched**
- `src/components/MobilePreviewFallback.tsx`
- All Railway / Cloudflare / Supabase backend code
- DB schema

---

## Three small choices for you

1. **Step iconography** — soft emoji (🌸 💭 ✨ 📝 🎨 🚀) matching Petal's pastel/floral identity, OR clean lucide icons (Brain, Sparkles, FileText, Palette, Rocket). *My pick: emoji — warmer for non-technical users.*

2. **Auto-collapse after success** — collapse to "✓ Built in 47s · Open preview" after 3s, or keep expanded? *My pick: auto-collapse with expand affordance.*

3. **Stream AI summary as live caption** — show the AI's summary text streaming live under the Designing phase, or hide until the end? *My pick: stream it — it's the most "magical" moment in Lovable.*

Tell me your picks (or say "use your defaults") and I'll implement.
