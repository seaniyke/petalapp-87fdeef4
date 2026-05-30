
## Goal

Audit Petal end-to-end against Lovable, Bolt.new, v0, Replit Agent, and Base44; ship a prioritized backlog; and fix the P0 reliability issues that are causing builds to crash, blank-screen, or be lost.

## Phase 1 — Deliverable: Audit Report

Write `/mnt/documents/petal-audit.md` with:
1. Executive summary (1 page).
2. Per-stage map of the pipeline (prompt → generate → verify → heal → save → preview) with file:line refs.
3. Competitor comparison table (Petal vs Lovable, Bolt, v0, Replit Agent, Base44) across: system prompt strategy, scaffold/lock-in, verifier/autofix, error recovery UX, preview infra, plan persistence, mobile path, security defaults.
4. Findings list: 8 P0, 7 P1, 5 P2, each with file:line evidence and proposed fix sketch.
5. "Things we left behind" — features competitors ship that Petal does not (real TS typecheck, streaming preview, interactive file diff, server-side file persistence, decision-time guidance, RFT autofixer, ephemeral micro-prompts).

No code changes in this phase — just the document and tracker tasks.

## Phase 2 — P0 Reliability Fixes (start immediately after the audit is written)

Each P0 below has a confirmed file:line target and is small enough to ship behind verification.

### P0-A. Server-side file persistence (highest priority)
**Problem:** `src/routes/api/generate.ts:3265-3279` emits `nextFiles` as an SSE event and depends on the client to write to `project_files`. SSE drop / tab close / nav-away = lost generation. This is the single largest cause of "the work disappeared".
**Fix:** Write `project_files` server-side inside `generate.ts` after the final-parse guard passes and before the `result` SSE is emitted. Keep the SSE payload for the client to update local state, but make the DB write authoritative. Use `supabaseAdmin` with `project_id` scoping. Add `turn_id` for idempotency.

### P0-B. Runtime bridge in CDN/Railway builds
**Problem:** `src/routes/api/builds/trigger.ts` calls `injectPreviewGuard` but the runtime error bridge that detects blank screens (`__petal_runtime.js`, currently only injected in WebContainer path) is not baked into the Railway build output. CDN previews on mobile / published apps go blank with zero signal.
**Fix:** Extend `preview-guard.server.ts` so the same picker + runtime bridge that `webcontainer.ts:279-294` injects gets written into `index.html` during build-trigger as well. Add a `/api/public/track-runtime-error` ingestion endpoint scoped by `project_id` so CDN blanks surface in the same dashboard as WebContainer blanks.

### P0-C. Builder job timeout and auto-retry
**Problem:** `builds/trigger.ts:267-283` — Railway can drop a job; `project_builds` stays `pending` for 5 min before timeout, no retry.
**Fix:** Server-side build watchdog: when triggering, also schedule a follow-up check at 90s. If still `pending` and Railway has no record, mark `failed_transient` and trigger one auto-retry. Cap at 2 retries before surfacing `failed`.

### P0-D. Multi-cycle autofix on by default (bounded)
**Problem:** `generate.ts:2784-2798` — single autofix cycle is default; multi-cycle (`agent_loop`) is behind a Labs flag. When the one-cycle fix doesn't close the verifier, final-parse-guard reverts the entire turn and the user sees "I rolled it back" with no work.
**Fix:** Promote bounded agentic loop out of Labs: 2 extra cycles, 45s wall budget, hard stop on no-progress (same issues twice). Keep cost ceiling enforced via existing wallet pre-flight.

### P0-E. WebContainer → CDN preview fallback
**Problem:** `WebContainerPreview.tsx:131-137` — if `crossOriginIsolated` is false, COOP/COEP misconfigured, or boot fails, the user sees a static "preview unavailable" message instead of the existing CDN preview that already works.
**Fix:** In the parent that selects preview path, if WebContainer's `boot()` rejects or `crossOriginIsolated` is false, automatically render `MobilePreviewFallback` (which polls the Railway-built CDN preview) with a small banner explaining live-edit is disabled but preview is live.

### P0-F. Continuation tier hardening
**Problem:** `pipeline/tier-continuation.ts` — uses same model with same token budget that already truncated; can truncate again.
**Fix:** Two attempts max with escalating model (`MODEL_STRUCTURED_RETRY` → `MODEL_STRUCTURED_RETRY_BACKUP`), and request a strict "complete only the truncated tail" continuation with explicit anchor (last 200 chars of the truncated file). Drop the file if both attempts truncate, and let the verifier flag it instead of shipping half a file.

### P0-G. Snack SDK version + asset pipeline
**Problem:** `SnackPreview.tsx:120` pins SDK 51 (sunset risk) and `ASSET_EXTS` silently skips images/fonts so `require()` calls crash the RN bundle.
**Fix:** Bump to Expo SDK 52, inline a tiny `__petal_assets.ts` map that resolves missing asset paths to a 1×1 transparent PNG at runtime so missing assets degrade instead of crashing, and surface a console warning the runtime bridge can pick up.

### P0-H. installDeps concurrency
**Problem:** `webcontainer.ts:416-428` — module-level `installPromise` singleton can let `startDevServer` run before install finishes on fast remount.
**Fix:** Gate `startDevServer` on `await installPromise` explicitly inside the start path; reset both promises together on `dispose`.

## Phase 3 — Backlog seeded (tracker tasks, not implemented in this loop)

P1 (next loop): blocks-4 prop contracts, blueprint route extraction fix (TanStack `src/routes/*`), always-on Tailwind v4 snippet, mobileApp/mobileNative snippet merge, quality gate for game/mobile/extension/backend subtypes, self-check → autofix feedback, sibling-file context preservation.

P2 (parity): real TS typecheck tier (worker-pooled `tsc --noEmit` on changed files only), streaming partial preview (per-file HMR), interactive file diff before commit, file-tree browser, decision-time guidance classifier (Replit pattern), RFT-style narrow autofix model, ephemeral micro-prompt injection.

## Verification

For each P0 ship:
- Reproduce the failure mode on a test project before fixing.
- After the fix, re-run the same repro and confirm green.
- For P0-A/B/C, also tail `server-function-logs` and confirm no regressions on a normal generate→build→preview path.

## Out of scope this loop

- Visual edits / click-to-source (would need a Vite plugin like Lovable's stable JSX IDs — separate workstream).
- Full RN scaffold replacement for mobile (Snack-as-web is a band-aid we'll keep until a real RN scaffold lands).
- WebContainer → Fly.io per-project VM migration (multi-quarter infra project).

## Order of work after approval

1. Write `/mnt/documents/petal-audit.md`.
2. Create P0/P1/P2 tasks in tracker.
3. Ship P0-A → P0-H in order (A and B first — biggest user-visible reliability wins).
4. Stop. Hand back for review before touching P1/P2.
