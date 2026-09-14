# Completing Petal: from "it compiled" to "it works"

I audited the existing generation pipeline rather than assuming. Below is what is actually there, the three real reasons a build can be declared done while still unusable, and the work to fix it. Nothing here rebuilds Petal or replaces the architecture — every phase is additive and reuses the builder, verifier, Cloud integration and AI provider layer that already exist.

## What the audit found

**The pipeline is far more complete than the symptoms suggest.** Petal already has: a product contract (PRD) with acceptance scenarios, a pre-emit gate with a bounded repair loop, a remote builder that installs and compiles for real, a headless-browser verifier that visits every route, signs in with a throwaway account, runs drafted user flows and captures screenshots, a vision pass for layout defects, a defect judge that drops noise, and defect routing that assigns each finding to an owning layer.

The problem is not missing capability. It is **three gaps in where that capability is wired**.

### Gap 1 — The autonomous loop lives in the browser tab

This is the big one. The inspect → fix → rebuild → retest cycle is driven from the builder page, not the server: attempt counters live in React refs mirrored to session storage, with caps of 3 build-failure fixes and 3 silent repair turns per user request. Consequences:

- Close the tab, lose connection, or switch device mid-build and the loop simply stops. The app is left broken with no one retrying.
- The budget is per browser session, so the same project can re-enter the loop unevenly.
- Nothing on the server knows a project is in an unfinished state, so nothing can resume it.

### Gap 2 — "Complete" means compiled, not usable

The turn ends when the single generation emit passes the static gates (parse, verifier, render risk, RLS sanity). The browser verification that would prove usefulness runs **after** the turn is already reported complete, out of band. The usefulness checks that do exist are deliberately warning-only — they only block when a utility has no interactive element at all. So a build with dead buttons, an unreachable core workflow, or a form that writes nothing can be announced as finished.

### Gap 3 — The initial build is the one turn with no tools

Petal has a real tool loop (read, search, run scripts, run the static check, install packages) capped at 5 rounds. It is explicitly disabled for initial builds and only enabled for cross-cutting edits, dependency work and mechanical refactors. The turn that most needs to inspect its own output — the first V1 — is the turn that generates blind. Backend work has the same shape: schema and policies are checked statically, but nothing executes a query against the real database to prove CRUD works before calling the build done.

## The plan

### Phase 1 — Move the completion loop to the server (highest impact)

Introduce a server-owned **turn completion record**: one row per user request holding the current stage, attempt counts, the outstanding defect list and a terminal reason. The builder callback writes to it, and a small scheduled worker resumes any project sitting in an unfinished stage.

- The existing client loop stays as the live progress view, but it stops being the source of truth. The counters become reads of the server record instead of refs.
- If the user closes the tab, the worker continues the cycle to completion or to a genuine blocker.
- One shared budget, enforced server-side, so build-failure fixes, verification fixes and no-op recoveries draw from the same pool and cannot ping-pong.

### Phase 2 — Make V1 acceptance the definition of done

Promote the browser verification result from after-the-fact report to the gate that decides whether a turn is complete.

- A turn reaches "delivered" only when: the build succeeded, every declared route rendered real content, the PRD's primary workflow completed end to end in the browser, and no blocking defect remains.
- Anything short of that keeps the turn in the repair cycle rather than reporting success.
- The user-facing completion message carries the evidence: which routes loaded, which flows completed, which checks ran. No claim without proof.
- When the budget runs out, Petal says plainly what still fails and what it needs, instead of quietly declaring victory.

### Phase 3 — Give the first build hands

Enable the existing tool loop for initial builds, with a tighter budget than edits get, so the first generation can read what it just wrote and run the static check before emitting. This converts a whole class of "partial frontend, no backend wiring" failures into in-turn corrections, at the cost of a few extra rounds on the first build only.

### Phase 4 — Prove the backend, not just the schema

Extend the verification plan with a backend pass that runs against the project's real Cloud backend using the throwaway test identity already minted for browser checks:

- Every table the app reads or writes is reachable with the permissions the app assumes.
- One create-read cycle for the primary entity actually returns the row.
- Auth state carries through to a protected read.
- Anonymous access to owner-scoped data is refused.

Failures land as defects in the same shape the repair loop already consumes, so no new plumbing is needed.

### Phase 5 — Keep the cost bounded and honest

- Hard ceiling on total autonomous rounds per user request, enforced server-side, with a distinct exit for "blocked, needs you" versus "budget spent".
- No repeating an identical fix attempt: if a round produces the same defect set, escalate the approach instead of retrying.
- Never charge for a turn that ended in an unresolved blocking gate and was rolled back.
- Surface the cycle in the build details view so a long repair is visible, not mysterious.

## Sequencing

| Step | Phase | Why this order |
| --- | --- | --- |
| 1 | Server-owned completion loop | Everything else is unreliable while the loop can die with a tab |
| 2 | Acceptance-based completion | Turns the existing verifier into the definition of done |
| 3 | Tools on the initial build | Cuts the failure class at its source |
| 4 | Backend acceptance | Closes the frontend/backend integration gap |
| 5 | Budgets, honesty, visibility | Depends on 1 and 2 existing |

I suggest shipping Phases 1 and 2 together as the first change, then testing against real builds before continuing.

## Technical notes

- New: a `turn_completion` table (project, turn, stage, attempts, outstanding defects, terminal reason) with owner-scoped RLS and explicit grants; plus a resume worker on the existing cron pattern under `src/routes/api/public/cron/`.
- Changed: `src/routes/api/public/builds/callback.ts` writes stage transitions; `src/routes/builder.tsx` reads server state instead of owning the counters; `src/routes/api/generate.ts` consults the completion record before reporting a turn done.
- Phase 3 flips `shouldRunAgentLoop` to allow initial builds behind a flag, with its own round cap.
- Phase 4 extends `src/server/verify-plan.server.ts` and the builder's verify step with a backend probe, emitting the existing defect shape.
- Every phase ships behind a feature flag that fails open to today's behaviour, matching the existing flag convention.
