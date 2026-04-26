# How the leaders actually build apps — and what Petal is missing

## How Lovable, Bolt and Base44 actually work

All three follow the **same five-step pattern** under the hood:

1. **One big system prompt** that pins the tech stack (React + Vite for all three) and forbids placeholders / partial files.
2. **The first prompt produces the WHOLE project in a single response.** Bolt calls this a "single comprehensive artifact" with every file + shell commands. Lovable does the same via a tool-call. They do NOT build incrementally on the first turn — it's faster and more coherent to emit the entire scaffold at once.
3. **Every follow-up prompt is a PATCH.** They send the *current file tree* back to the model and only ask for files that change (Bolt: unified diffs OR full files, whichever is shorter; Lovable: tool-call with full file contents per changed file). **Petal already does this with `patch_files` — you got this right.**
4. **Conversation history IS the memory.** They send the last N user/assistant messages plus the current files. There is no separate "memory store" — the file tree is the state, the chat is the intent log.
5. **Errors are surfaced as another turn.** When a build fails, Bolt and Lovable inject the error log back into the next prompt as a system message and let the AI patch its own mistake. Base44 calls this "agentic self-healing".

On top of that shared core, each one adds polish:

| Capability | Lovable | Bolt | Base44 | **Petal today** |
|---|---|---|---|---|
| Single-shot initial build | ✓ | ✓ | ✓ | ✓ |
| Incremental patch on follow-ups | ✓ | ✓ | ✓ | ✓ |
| Sends full file contents (no `// ...rest`) | ✓ | ✓ | ✓ | ✓ |
| Streaming activity feed | ✓ | ✓ | ✓ | ✓ (just shipped) |
| **Plan / Discuss mode** (chat without editing) | ✓ | ✗ | ✓ | ✗ |
| **Message queue** (type while AI works) | ✓ | ✗ | ✓ (up to 7) | ✗ |
| **Per-message revert** | ✓ | ~ | ✓ | ✗ (only version-level restore) |
| **Visual / element edit** (click in preview) | ✓ | ✗ | ✓ | ✗ |
| **Auto-fix from build errors** (feed error → AI) | ✓ | ✓ | ✓ | ✗ ("Ask Petal to fix" doesn't include the log) |
| **Model routing** (Flash for simple, Pro for hard) | ✓ | ✗ | ✓ ("Automatic") | ✗ (always Gemini Flash) |
| **Project Knowledge / Custom Instructions** | ✓ | ✓ | ✓ | ✗ |
| **Freeze Files** (lock files from edits) | ~ | ✗ | ✓ | ✗ |

## What this means for Petal

**Your core architecture is already correct.** Single-shot scaffold, patch model, full-file emission, streaming, activity feed — you're 60% of the way there.

The gap is the **collaboration & control surface** — what makes users *trust* the AI on attempt #5 instead of giving up after attempt #2.

---

# Implementation plan — 5 phases, ship one per session

## Phase 1 — Self-healing builds (highest leverage, smallest change)

When the Cloudflare/Railway build fails, the user sees a generic "Ask Petal to fix" button. Lovable, Bolt and Base44 all automatically include the actual build log so the AI can fix the real cause.

Changes:
- Migration: `ALTER TABLE project_builds ADD COLUMN logs text;` (Railway already sends `logs` in the callback — we just throw it away today).
- `src/routes/api/public/builds/callback.ts` — persist `logs` into the new column.
- `src/hooks/use-build-activity.ts` — expose `logs` alongside `errorMessage`.
- `src/routes/builder.tsx` — change `askPetalToFix` to send a structured prompt that includes the last ~50 lines of the actual log:
  > "The build failed with this error:
  > ```
  > <log>
  > ```
  > Look at the relevant files and fix it."

**Effort:** ~1 hour. **Impact:** turns dead-ends into one-click recoveries.

## Phase 2 — Discuss mode (Base44's killer feature for non-technical users)

Today every prompt costs an AI call AND mutates files. Non-technical users are scared to ask "can you also make it work on mobile?" because they think it'll break things.

Changes:
- **Discuss / Build** toggle next to the chat input (default: Build).
- New `/api/discuss` route: same chat history + current files context, but emits **plain markdown advice** (no tool call). Reply renders as a normal assistant message; no patches applied.
- Mirrors Base44 Discuss + Lovable Plan exactly. Cheap (always `gemini-3-flash-preview`), safe.

**Effort:** ~2 hours.

## Phase 3 — Message queue + per-message revert

**Message queue:**
- When `busy` is true and the user submits a new prompt, push it into a `pendingQueue` state instead of disabling the input.
- Queued items render as faded chips above the input with remove + drag-reorder.
- When `send()` finishes, automatically dequeue the next.

**Per-message revert** (we already have all the pieces):
- We already create a `version` row for every assistant turn.
- Surface a **"Revert to here"** menu under each user message in the chat.
- Loads that version's files via the existing `handleRestore` flow and trims chat history back.

**Effort:** ~3 hours combined.

## Phase 4 — Smart model routing + Project Knowledge

**Smart routing:**
- In `/api/generate.ts`, simple heuristic: if prompt mentions "refactor / redesign / architecture / all pages" or the patch will likely touch >5 files, switch from `gemini-3-flash-preview` to `gemini-2.5-pro` or `gpt-5-mini`.
- **"Smart / Fast / Best"** dropdown in the toolbar (matches Base44 Automatic/Manual). Defaults to Smart.

**Project Knowledge:**
- Add `projects.custom_instructions` text column.
- "Project settings → Instructions" sheet ("Always use a pastel palette", "This is for KeshPay — be cautious", etc.).
- Prepend to the system prompt on every generate call.

**Effort:** ~2 hours.

## Phase 5 — Visual element edit (the magic moment)

Lovable's headline demo: click an element in the preview iframe → describe a change → AI edits only that element's component.

How: inject a small script into the iframe that listens for clicks, draws a hover outline, `postMessage`s the clicked element's selector back to the parent. Parent opens an "Edit element" prompt that becomes *"In `src/App.tsx`, the `<button>` with text 'Sign up' should be larger and green"*.

- **Cheap version (~half a day):** capture `tagName`, `textContent`, CSS classes; send to AI as context.
- **Real version (~2 days):** add `babel-plugin-transform-react-jsx-source` for exact file+line mapping (what Lovable does). Recommend cheap version first.

---

# What I am NOT recommending

1. **Bolt-style `<diff>` blocks.** Tool-calling already gives the same benefit with no parser complexity. Don't trade a working pattern for a fashionable one.
2. **WebContainer-only previews.** You already moved to Cloudflare Pages builds — that's the right call for shareable real apps.
3. **A full Bolt-style autonomous agent loop.** Petal's domain is small apps. The single-tool-call pattern is a *feature*, not a limitation. Base44 reached the same conclusion.

---

# Recommended order

1. **Phase 1** — ship first. Biggest UX win, smallest change.
2. **Phase 2** — lowers anxiety for non-technical users.
3. **Phase 3** — completes the chat-as-command-center.
4. **Phase 4** — quality polish.
5. **Phase 5** — the "shared on Twitter" moment.

**Strong recommendation: approve Phase 1 only**, ship it, use it for a day, then come back for Phase 2. That's how the leaders built these features themselves — one at a time.