# Fix: staged pipeline is shipping empty apps

## What actually happened in your screenshots

1. You prompted "community app where users can create posts anonymously".
2. Petal ran the **staged pipeline** (Plan → parallel Scaffold → Wire-up) because admins have `staged_pipeline` defaulted ON.
3. The plan stage produced ~7 files but **never included** `src/App.tsx`, `src/main.tsx`, or `index.html`.
4. Scaffold wrote those 7 files. Wire-up's verifiers passed (the files it had were syntactically fine).
5. The orchestrator returned the result **without running `ensureRenderableShell`** — that safety net only runs on the monolithic path.
6. Vite then failed (no `index.html`), the auto-fix turn injected a stub `index.html`, and `ensureRenderableShell` injected the "Your app is being prepared" placeholder for the missing `src/App.tsx`. That placeholder is what you saw.

So you got a 7-file build with no entry, no root view, and a polite "ask Petal to retry" card. That's the bug.

## Root causes (three, all in the staged pipeline)

1. **Plan stage has the wrong stack in its prompt.** `stage-plan.server.ts` tells the model "TanStack Start + Tailwind v4", but the kit the scaffold stage actually writes is **Vite + React + Tailwind v4** with `src/App.tsx` as the root. The model dutifully plans `src/routes/index.tsx` etc., none of which mount.
2. **Nothing enforces the entry trio.** Neither plan, scaffold, nor wire-up requires `index.html` + `src/main.tsx` + `src/App.tsx` to exist. They're treated like any other file the model "might" plan.
3. **`ensureRenderableShell` is bypassed.** On the monolithic path it injects a deterministic `index.html`/`main.tsx` and only falls back to the placeholder `App.tsx` as a last resort. The staged orchestrator returns straight from wire-up, skipping it entirely.

## Fix

### 1. `src/server/pipeline/stage-plan.server.ts`
- Rewrite the system prompt: "You plan MVPs for a **Vite + React + TypeScript** app using Tailwind v4 and the bundled shadcn UI kit. The root view is **always `src/App.tsx`** — every plan must include it as file #1 and treat it as the rendered shell (header, main content, footer). Other files are components imported by `src/App.tsx`. Never plan `index.html` or `src/main.tsx` — Petal owns those. Never plan `src/routes/*` — this is not TanStack."
- Bump cap from 8 → 10 to leave room for App + 8 components.
- After parsing the model's plan, **deterministically prepend** a `src/App.tsx` entry if the model omitted it, with `purpose: "Root view — renders the full MVP shell with real content for: <brief>"`.

### 2. `src/server/pipeline/stage-scaffold.server.ts`
- Strengthen the per-file system prompt for `src/App.tsx` specifically: "This file is the rendered root. It MUST contain real domain UI matching the brief — header, primary content area showing the feature, and any nav. Never return a 'coming soon' / 'placeholder' / 'is being prepared' card. Import and use the components listed in deps."
- On retry (the existing `retryShrink` path), if the failing file is `src/App.tsx`, do NOT shrink the line cap — instead retry at full budget with the stricter prompt. Losing App.tsx is worse than truncation risk.

### 3. `src/server/pipeline/stage-wireup.server.ts`
- After verifiers pass, call the existing `ensureRenderableShell` (export it from `src/routes/api/generate.ts` or move it to a shared module — recommend moving to `src/server/renderable-shell.server.ts` and re-importing from generate.ts).
- Add one new fatal check: if `src/App.tsx` is missing OR matches the "is being prepared" placeholder regex, return `ok: false, reason: "missing_root_view"`. This forces the orchestrator to fall back to the monolithic path instead of shipping a placeholder.

### 4. `src/server/pipeline/staged-orchestrator.server.ts`
- When wire-up returns `missing_root_view`, return `null` (not an error SSE) so the caller falls back to the monolithic path silently. The user gets a real app on the same turn instead of a "try again" card.
- Keep the existing error SSE for other wire-up failures.

### 5. Quick win for the auto-fix turn
- In `ensureRenderableShell`, the `src/App.tsx` placeholder branch should **also** signal to the orchestrator that this is a degraded result — currently it silently masks the failure. Add a `degraded: string[]` return field and have `/api/generate.ts` log a `quality_event` row when `degraded.includes("src/App.tsx")` so we can measure recurrence after the fix.

## Why not just disable `staged_pipeline`?

That would mask the bug — the monolithic path also benefits from the entry-trio invariants, and we lose the parallel-scaffold latency win. The fix is in the contract, not the toggle.

## Files touched

- `src/server/pipeline/stage-plan.server.ts` — prompt + cap + deterministic App.tsx injection
- `src/server/pipeline/stage-scaffold.server.ts` — App.tsx-specific prompt, no shrink on retry
- `src/server/pipeline/stage-wireup.server.ts` — call `ensureRenderableShell`, fail on missing root view
- `src/server/pipeline/staged-orchestrator.server.ts` — silent fallback on `missing_root_view`
- `src/routes/api/generate.ts` — move `ensureRenderableShell` to shared module, add degraded telemetry
- `src/server/renderable-shell.server.ts` — new (extracted)

## Out of scope (separate followups)

- Adding a "golden eval" harness that runs 10 canonical prompts (community app, todo, dashboard, marketing site, etc.) through both pipelines on every deploy. Worth doing next, but separate PR.
- The agent loop and pgvector retrieval from the Week-1+ roadmap remain queued.
