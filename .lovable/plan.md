# Kimble builder upgrade — my verdict on the brief, and what to do next

## Short answer

I agree with about 80% of it, and a meaningful part is already built or was shipped in the last session. The brief is right about the direction (fewer AI calls, tighter context, deterministic work stays deterministic, complete telemetry). Where I disagree is the parts that would duplicate systems Kimble already has, or that ask for a tool-agent rewrite of the generation loop — that is the highest-risk change in the whole document and the least proven benefit for us.

## Already in place (verified in the code, do not rebuild)

- Targeted context selection: import/dependent graph, open-route and clicked-element context, conversational focus memory, file budget, context budget guard. Measured at ~7 files per build call, not whole projects.
- Prompt caching: 91% of build-call input tokens served from cache.
- Central model config: one file, OpenRouter only, explicit model, build tier plus cheap utility tier with a hard output cap.
- Preflight caching by prompt hash, recovery only on real failure signals, non-retrying cosmetic helpers (shipped last session).
- Per-call token and cost telemetry on both streamed and non-streamed paths, with a platform/user key owner column.
- Deterministic verification: typecheck, production build, route verification, import resolution, browser QA at three widths.
- Project memory (PIC), PRD store, design director, brand contract, composition contract, copy-slop filter, anti-sameness pass.
- A tool layer for the agent (list_dir, read_file, search_files, run_check, run_script, install_packages, run_tests).
- Checkpoints and revision/restore around builds.

## Where I disagree or would soften

- **Full tool-based edit loop (sections 5–8).** Turning generation into a multi-turn tool conversation raises calls per turn, which is the opposite of the brief's own goal, and destroys prompt-cache hit rate. I would keep single-shot generation with targeted context and add only the two missing safety pieces: read-before-write exact-match edits and an atomic batch edit.
- **Design sections 19–21** are largely duplicates of the design director, composition contract and copy-slop filter. I would only add the motion personality, which we genuinely lack.
- **Section 4 structure index** already exists as the impact graph; strengthen, don't create.

## What I would actually implement, in order

**Phase 1 — Finish the measurement story (small, unblocks everything else)**
- Attach turn ID to every build call (70% currently have none) and a build ID where one exists.
- Add the per-build rollup view: cost per turn, per successful build, per failed build, recovery cost, preflight cost, retries per build, cache-hit rate, calls per turn.
- Surface it on the existing admin economics page.

**Phase 2 — Safe editing (highest user-visible payoff)**
- Read-before-write: an edit carries the file, the exact existing text and the replacement; a failed match fails loudly and re-reads instead of silently writing the wrong place.
- Atomic batch edit: several related edits applied as one operation, all-or-nothing, one verification afterwards.
- Never full-file rewrite for a small change; whole-file replacement allowed only for a declared rewrite.

**Phase 3 — Change-aware verification**
- Tier QA by the change class the edit classifier already computes: copy/style → the affected route only; component → its consuming routes; new page → page plus route wiring; design-system or structural → broad sweep; publish → full QA. Visual QA is never removed, only scoped.

**Phase 4 — Targeted repair**
- Repair prompts carry only the failing file, the exact error with surrounding lines, direct graph neighbours and the recent diff, under an explicit cap. No whole-project resend.
- Bounded recovery: same error twice means re-inspect; identical third time stops and surfaces the problem instead of looping.

**Phase 5 — Memory and design intelligence, selectively injected**
- Persist a motion personality (surgical / physical / cinematic) and the stable design decisions per project, and inject only what the current task touches rather than the whole memory blob.
- Cache project structure and analysis keyed to a project revision hash, invalidated on file change.

**Phase 6 — Prove it**
- Five real builds before and after, reporting calls per turn, input/output/cached tokens, preflight and recovery counts, build success rate, duration, and cost per successful and failed build.

## Not changing

Cloudflare, Supabase Cloud, Railway builder, OpenRouter gateway, Paystack, billing and credits, mobile generation, custom domains, visual QA capability, project memory, deployment architecture. No new provider, no queue, no Go service.

## Technical notes

Files most likely to change: `src/routes/api/generate.ts` (turn/build id wiring only), `src/server/ai-provider.server.ts`, `src/server/change-set.server.ts` and `src/server/ast-patch.server.ts` (exact-match and batch edits), `src/server/edit-classifier.server.ts` plus `builder/src/verify.ts` (QA tiering), `src/server/self-recovery.server.ts` and `src/server/repair-ledger.server.ts` (focused repair, bounded retries), `src/server/pic/*` and `src/server/design-director.server.ts` (motion personality, selective injection), one migration for the rollup view, and tests under `src/server/__tests__/`.

Phases are independent and each ships with tests, so we can stop after any one of them.
