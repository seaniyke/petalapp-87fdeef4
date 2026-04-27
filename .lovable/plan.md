# Refresh persistence audit & fixes

## What I checked

I went through every place the app holds user-entered data or AI output, and tested each against the question: *"if the user hits Refresh right now, do they lose anything?"*

### Already persistent (good — no changes needed)

| Area | How it survives refresh |
|---|---|
| Authentication / login session | Supabase stores the session in `localStorage` — refresh keeps you logged in. |
| Project list | Loaded from the `projects` table on every visit. |
| Project files (the app being built) | Stored in `project_files`; reloaded on builder mount. |
| Chat history (your prompts + Petal's replies) | Stored in `messages` (with `plan` and `recap` JSON-encoded). Reloaded on builder mount. |
| **Your prompt while Petal is mid-build** | Already saved to the DB *before* the stream starts, specifically so a refresh during a 30–60s build doesn't lose what you asked. |
| Project Knowledge / custom instructions | Saved to `projects.custom_instructions` via the settings sheet. |
| Backend connection (BYO Supabase) | Saved to `project_backends`. |
| Theme (light/dark) and first-run tour | `localStorage`. |
| Home-page prompt + attached images (when bouncing through /auth) | Already stashed in `sessionStorage` and rehydrated on return. |

### Gaps I found (these DO get lost on refresh)

1. **Petal's in-flight reply.** If you refresh while Petal is streaming a Plan / writing files / writing a Recap, all the partial text you've already seen disappears. The user message is saved, but the half-finished assistant reply is purely in React state. After refresh you see your prompt with no reply under it, even though the build may still be running on the server.

2. **A failed build's partial reply.** When a build errors mid-stream, the code keeps the partial text in local state only (it's deliberately not written to the DB because the run failed). A refresh wipes it — the user sees their prompt with no context about what Petal had said before failing.

3. **Composer draft inside the builder.** What you've typed into the chat input on `/builder` is only in React state. Refresh = empty box. (The home-page composer at `/` already saves drafts; the builder composer doesn't.)

4. **Queued messages.** Messages you typed while Petal was busy (the "your next message will queue" UI) live only in React state. Refresh loses the entire queue.

5. **Composer image attachments inside the builder.** Same as above — only in React state.

6. **Auth form email field.** If you mistype your password and the page reloads (or you accidentally refresh), you have to retype your email. Low priority but easy.

7. **Project Knowledge sheet draft.** If you start editing your custom instructions and refresh before clicking Save, the edits are lost. (The saved value is preserved, but unsaved edits aren't.)

## What I'll change

### 1. Persist Petal's streaming reply to the DB live, not just at the end

Right now `streamingPlan / streamingAssistant / streamingRecap` only update React state. I'll add a debounced (every ~500ms) write to a new tiny table `message_drafts` (one row per project, holds the latest in-flight assistant chunks + the plan/recap). On builder mount, if there's a draft for the project, render it as a "still working…" bubble while we re-attach to the live stream — or, if the stream is already finished server-side, promote the draft into a proper message.

This single change fixes gaps **#1 and #2**.

### 2. Save composer draft + queued messages + attachments to `sessionStorage`

Per-project keys: `petal:builder:{projectId}:composer`, `petal:builder:{projectId}:queue`, `petal:builder:{projectId}:attachments`.

- Loaded on builder mount (after `searchId` is known).
- Cleared automatically when the message is sent or the queue drains.
- `sessionStorage` (not `localStorage`) so it stays scoped to the browser tab and never leaks between users.

Fixes gaps **#3, #4, #5**.

### 3. Remember last-typed email on the auth form

Save to `localStorage` under `petal:auth:last-email` whenever the email field changes; prefill it on mount. Cleared on successful sign-in. Password is *never* stored.

Fixes gap **#6**.

### 4. Auto-save Project Knowledge drafts to `sessionStorage`

Per-project key: `petal:knowledge:{projectId}:draft`. Restored when the sheet opens; cleared on Save. The sheet already shows a "dirty" indicator — this just means a refresh won't blow away unsaved edits.

Fixes gap **#7**.

## Technical notes

- New table `message_drafts` with one row per `project_id` (PK on project_id, ON DELETE CASCADE from `projects`). Columns: `partial_content text`, `partial_plan text`, `partial_recap text`, `updated_at`. RLS: owner can read/write their own; admin can read.
- Streaming write is debounced (~500ms) and uses an `upsert` so we don't hammer the DB. Cleared in the `finally` block of `send()` so successful and aborted runs both clean up.
- `sessionStorage` writes are throttled and tab-scoped; they're capped at 200KB total per project to stay well under quota.
- All keys are namespaced by project ID so switching between projects doesn't show stale drafts.
- No changes to existing message storage format — the JSON-encoded `plan`/`recap` flow already works for refresh.

After these changes, every meaningful piece of state — your prompts, your edits in flight, Petal's streaming reply, queued messages, attached images, auth email, and knowledge drafts — will survive a browser refresh.