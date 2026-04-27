## What's wrong today

When the user types **"Hello"** in Build mode, Petal jumps straight into the build pipeline (Reading → Designing → Writing → Putting online). It treats every message as a build request, even greetings, questions, and clarifications. Competitors (Lovable, Bolt, v0, Base44) always say a few warm, intelligent sentences first — and only start building when the user has actually described something to build.

Two root causes:

1. **Build mode has no conversational triage.** `/api/generate` is forced to call the `write_project` / `patch_files` tool on every turn (`tool_choice` is hard-coded to one of those functions). The model literally cannot reply with words.
2. **Even when it does build, the warm preamble is buried.** The `plan` field already streams first, but in the chat it's hidden inside a "Plan" collapsible chip, and the activity card with its 6 phases dominates the screen the moment a build starts.

## What we'll change

### 1. New "Triage" step before building (the main fix)

When the user sends a message in Build mode, we no longer go straight to `write_project`. Instead:

```text
user message
   │
   ▼
[ tiny, fast triage call ]  ── classifies: chat | clarify | build
   │
   ├── chat     → warm reply, no build. ("Hi! I'm Petal…")
   ├── clarify  → warm reply that asks ONE focused question, no build.
   └── build    → 1–2 sentence warm acknowledgement streams first,
                  THEN the build pipeline kicks in.
```

The triage uses `google/gemini-3-flash-preview` (cheap, fast, ~300ms) with a tiny system prompt and a structured JSON response: `{ intent, reply, buildBrief? }`.

- `intent: "chat"` — for greetings, thanks, questions about Petal itself, smalltalk. We just stream `reply` into the chat. Zero credits charged for these (they're conversational; competitors don't charge either).
- `intent: "clarify"` — when the request is too vague to build well ("make it nice", "build something cool"). We stream `reply` which contains one warm follow-up question.
- `intent: "build"` — we stream `reply` (1–2 sentences like *"Love it — an ecommerce site for handmade jewelry. I'll set up a clean storefront with a hero, product grid, and cart, and I'll keep it mobile-friendly. Building now…"*) and **then** kick off the existing `/api/generate` build flow with the original prompt.

### 2. Promote the warm preamble in the chat

The current "Plan" chip is too technical and collapsed by default. We'll:

- Show the triage `reply` (or for builds, the streamed `plan`) as a **plain warm paragraph at the top of the assistant bubble**, not behind a "Plan" toggle.
- Keep the "What changed" recap collapsible (that one is genuinely a detail).
- Keep the activity card, but it now appears **after** the warm sentence, so the user always reads a human-feeling line before the build UI takes over.

### 3. Tone & prompt changes

Update the Build system prompt's `plan` instructions so it sounds like a smart, friendly collaborator — not a status line. Examples we'll seed:

- ✅ *"Love it — let's build a calm, modern storefront for your jewelry. I'll start with a hero, then a product grid, then a simple cart. Here we go."*
- ❌ *"I'll create src/App.tsx with a hero component and a product grid component."*

Same warmth in the new triage prompt and in Discuss mode.

### 4. No-build messages don't trigger the build UI

Today, the moment `busy` is true, the activity card with all six phases mounts. We'll only mount the activity card when `intent === "build"`. For chat/clarify replies, the user sees a normal assistant bubble — same as Discuss mode — and the input stays free for them to keep talking.

## Files we'll touch

**New**
- `src/routes/api/triage.ts` — the new fast classifier endpoint (`POST /api/triage` → `{ intent, reply, buildBrief? }`, streams `reply` as SSE).
- `src/lib/triage.ts` — client helper that streams the triage response, mirrors the shape of `streamGenerate`.

**Edited**
- `src/routes/builder.tsx` — new send flow: triage first, then conditionally build. Only mount `BuildActivityCard` when intent is `build`. Render the warm preamble as the headline of the streaming bubble.
- `src/server/generate.server.ts` — soften and rewrite the `plan` field instructions so it sounds human (1–2 warm sentences directly addressing the user, never file paths).
- `src/routes/api/discuss.ts` — minor tone tightening so chat/clarify and Discuss feel consistent.

## Technical notes

- **Cost**: triage runs on the cheapest flash model and uses ~150 input tokens + ~80 output. Negligible. Chat-intent turns are NOT charged a build credit (matches competitor behavior). Build-intent turns charge as today.
- **Latency**: triage adds ~300–500 ms before the build starts. To hide that, the warm preamble streams during those ms — so the user perceives an instant, intelligent reply rather than dead time.
- **Backward compatibility**: existing in-flight build messages, drafts, and the `partial_plan` rehydration still work; the only new state is `streamingPreamble` (lives next to `streamingPlan`).
- **Abort**: the abort controller in `builder.tsx` will be extended to cancel both the triage call and the downstream build call as a single unit.
- **Discuss mode unchanged** — users who prefer the existing Discuss button still have it; this just makes Build mode itself smart enough to handle conversational turns.

## Out of scope

- No changes to the build pipeline itself, the Cloudflare deploy flow, or pricing.
- No changes to Discuss mode behavior beyond a small tone refresh.
- No new tracking — we'll wire analytics in a follow-up if you want intent metrics.
