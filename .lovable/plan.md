# Why the builder is stuck — and what to fix

## 1) Root cause of the "Putting your app online…" freeze

Confirmed via the database + worker logs:

- The last 4 build rows (since 10:52 today) are all `status='pending'` with no `ready_at` and no `error_message`. Trigger logs show `POST /api/builds/trigger → 200`, so our server handed the job to the Railway builder cleanly.
- Worker logs show **no `POST /api/public/builds/callback` from Railway in the past hour** — only an unrelated `GET` probe. The Railway builder accepted the job but never reported back.
- The bigger UX bug exposed by this: our UI has **no timeout, no "still working", no manual retry** for the deploy phase. The activity card just sits on "Putting your app online… (16s)" forever, the preview tab never lights up, and the user has nothing to click. That is exactly what the screenshot shows.

There's a secondary bug that will bite the next time Railway flips a row to `'building'`: our schema allows `'pending' | 'building' | 'ready' | 'failed'` but `useBuildActivity` and the builder's phase wiring only handle `pending`/`ready`/`failed`. A `'building'` value freezes the phases the same way.

## 2) What we'll do — Phase A: deploy reliability + escape hatch

Goal: never strand the user on a silent "Putting your app online…" again, regardless of what the Railway worker does.

```text
trigger build ──▶ pending ──[timer starts]──▶ building ──▶ ready
                     │              │            │
                     │   60s        │  90s       │
                     ▼              ▼            ▼
              "Almost there…"  "Taking longer"  "Still building, you can keep
                                                 working — we'll notify you"
                              ▼
                  150s with no callback
                              ▼
              auto-mark stalled → friendly error card with
              [Retry deploy] and [View logs] buttons
```

Concrete changes:

- Add a `'building'` branch to the build-status hook + builder phase sync so the activity card progresses through `pending → building → ready` instead of getting stuck.
- Track `deployStartedAt` on the client. After 60s on `pending|building`, swap the sub-caption to "Almost there — bundling assets…". After 90s, "Taking longer than usual — your app is still being built." After **150s with no callback**, surface a `friendlyDeployStalled` error card (same component as build-failure) with two buttons: **Retry deploy** (calls `triggerBuild` again on the same files) and **Keep editing** (dismisses the card; build will still flip to ready in the background if/when Railway responds).
- Also add a **Cancel deploy** affordance on long-running deploys (sets the local build row to `failed` with a "you cancelled this" message so it doesn't haunt the project history).
- Add a server-side reaper migration: any `project_builds` row stuck in `pending` or `building` for >10 minutes is auto-flipped to `failed` with `error_message='Build timed out — Railway did not report back'`. Keeps the database honest and unblocks polling clients that load the project later.
- Surface the underlying issue more openly: when `friendlyDeployStalled` fires, log it as an event so we can spot a Railway outage in aggregate.

## 3) What we'll do — Phase B: richer streaming + smarter messages

Looked at how Lovable, Bolt, and v0 handle this: they all run a **multi-part narrative**, not a single static reply. We'll mirror that without breaking our existing summary contract.

The new assistant turn becomes three streamed segments inside one bubble:

```text
┌─ petal ─────────────────────────────────────────┐
│ ★ Plan          (streams first, ~2-3 lines)      │
│   I'll add a hero section, swap the form for a   │
│   2-step modal, and wire submission into…        │
│                                                  │
│ ▸ Working       (live activity card, in-thread) │
│   Designing → Writing 4 files → Polishing → Live│
│                                                  │
│ ✓ What changed  (streams after build, expandable)│
│   • New: src/components/Hero.tsx                 │
│   • Updated: src/pages/Index.tsx (+42 −18)       │
│   • Why: cleaner visual hierarchy, mobile-first  │
│   ▸ Tap to see all 6 files                       │
└──────────────────────────────────────────────────┘
```

Implementation:

- **New tool field** in `WRITE_PROJECT_TOOL` and `PATCH_FILES_TOOL`: alongside `summary`, ask the model for `plan` (1-3 sentence intent statement, written BEFORE any files) and `recap` (2-5 bullet "what I changed and why"). Both are tool-call fields so they stream the same reliable way `summary` already does.
- **Server**: extend the SSE relayer in `/api/generate` to detect and emit `plan_delta` events for the `plan` field as soon as its first characters arrive (it's the first key the model emits → user sees activity within a second). Keep emitting `summary_delta`/`file_progress` as today, then emit `recap_delta` for the recap field.
- **Client**: replace `streamingAssistant: string` with `streamingAssistant: { plan: string; summary: string; recap: string }`. The chat bubble renders the three segments as they fill in, with the BuildActivityCard nested between Plan and Recap so it feels like one continuous thought rather than a separate widget.
- **Persistence**: when the run completes, store the assembled message as one assistant turn whose content is markdown like `**Plan**\n…\n\n**What I built**\n…\n\n**Files**\n…` so it round-trips through `appendMessages` and re-renders correctly on reload.
- **Always-visible re-render**: when the user reloads the project, today's static one-liner becomes a richer multi-section card (because we're persisting the plan + recap, not just the summary). The *next* turn's plan also streams the same way, so every turn — not just the first — feels alive.
- **Keep the discuss flow**: discuss replies already stream as plain markdown — we'll just add a one-line "thinking…" placeholder while the upstream call is in flight (today it's a static "Petal is thinking…" line; we'll switch to typewriter dots so it doesn't look frozen).
- **Markdown polish**: `MarkdownMessage` already does GFM + syntax highlighting; we'll add a "show all files" `<details>` for the recap so long file lists collapse by default — keeps mobile bubbles short.

## 4) Acceptance checks before shipping

- Trigger a build, manually kill the Railway callback (simulate by using a fake build id) → activity card escalates to "Taking longer", then surfaces `friendlyDeployStalled` with Retry+Cancel within ~150s.
- Reaper migration cleans an ancient pending row to `failed` after 10min.
- New chat turn shows the **Plan** segment within ~1s, the **activity card** during work, and a **Recap** bullet list after the build — all in one bubble, all streamed.
- Reload the project → the assistant message still has plan/recap rendered (not lost).
- Discuss mode unaffected — still streams plain markdown.

## 5) Files we'll touch

- `src/hooks/use-build-activity.ts` — handle `'building'`, surface `startedAt` so the UI can escalate copy.
- `src/routes/builder.tsx` — phase sync for `'building'`, deploy stall escalation + retry/cancel actions, new `streamingAssistant` shape, persistence of plan/recap.
- `src/components/BuildActivityCard.tsx` — long-wait sub-captions ("Almost there", "Taking longer"), Retry/Cancel buttons in stalled state.
- `src/lib/friendly-errors.ts` — new `friendlyDeployStalled` factory.
- `src/lib/build-phases.ts` — minor copy tweaks for the longer waits.
- `src/server/generate.server.ts` — add `plan` + `recap` fields to both tool schemas; tighten system prompts so the model fills them.
- `src/routes/api/generate.ts` — relay `plan_delta` + `recap_delta` SSE events; persist all three in the assembled assistant message.
- `src/components/MarkdownMessage.tsx` — small `<details>` styling for collapsible file lists.
- `supabase/migrations/<ts>_reap_stalled_builds.sql` — pg_cron job (or trigger function) that flips >10-min-pending rows to `failed`.

## Notes

- The Railway worker outage itself is infra, not code — we'll surface it gracefully but not try to "fix" Railway from the app. If the next deploy still doesn't report back after this lands, we'll page that separately.
- No DB column changes are needed for the chat upgrade — the assembled markdown rides on the existing `messages.content` column.
