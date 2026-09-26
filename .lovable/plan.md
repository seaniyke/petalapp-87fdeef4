# Replace Kimble's batch page generator with one agent loop

## What the map found (from the actual code)

- The whole build runs inside one 8,659-line request handler that plans a fixed page list up front, writes every page, then runs several repair passes and reviews around it.
- **Why Dashboard was written 3 times:** the planner calls the home page `Home.tsx`, the router scan doesn't recognise "Dashboard" as home and adds it again, and the edit-time coverage check has the same blind spot. Three separate schedulers each think it's missing.
- **Four separate "fix it" systems:** in-page self-correction, post-check targeted repair, the missing-file creator (called from 3 places with no shared budget), and a separate syntax fixer on the build server.
- **Four separate "is it done" systems:** product acceptance, PRD acceptance, backend acceptance, turn completion.
- **Two AI review calls** (inspector for edits, critic before commit) that mostly repeat what the checks already know.
- **Two verification stacks** (app-side checks and build-server checks) kept in sync by hand.
- No second hidden pipeline and no server-side `Phase[]` engine exist; `Phase[]` is only the progress bar.
- Webby's Go source is not in this project. The only reference is the earlier forensic report, so the loop copies Webby's behaviour, not its code.

## The new single path

```text
USER GOAL
 -> classify (simple edit | app build)
 -> simple: locate -> targeted edit -> validate -> commit
 -> app build: AGENT LOOP
      inspect workspace state (read-only, parallel)
      select next operation from ExecutionState (deps first, never done work)
      execute ONE bounded operation (create/edit file, component, hook, route, schema)
      validate immediately (syntax, imports/exports, undefined names)
      on failure: same loop, same writer, real error -> targeted fix
      record result + durable checkpoint
      repeat until requirements satisfied
 -> final verification (unchanged, authoritative)
 -> TurnTransaction / revision CAS commit (unchanged)
```

## KEEP / MODIFY / REPLACE / DELETE

| Component | Decision | Why |
|---|---|---|
| TurnTransaction, revision CAS, controlled writes, credit ledger, refunds, cancellation, one-running-turn claim, circuit breaker, provider-failure classification, observability | KEEP | Safety underneath the loop |
| Final verification gates, TS undefined-name checker, structural-deps guard | KEEP | Authoritative checks |
| Checkpoints / resume | MODIFY | Store loop state (done ops, remaining), not "shell + pages" |
| `plan.ts` fixed page list + `pagesReferencedByRouter` + `const pages = [...planned, ...fromRouter]` | REPLACE | Requirements become goals; next work chosen from live workspace |
| `write.ts` batch writer + `work-unit.ts` sections | MERGE into the loop's operation executor | One execution primitive |
| In-page self-correction + `repair.ts` targeted repair | MERGE into loop "correct" step | One repair authority |
| `resolveMissingNodes` ×3 call sites | MERGE — a missing dependency becomes the next operation | No separate passes |
| Chunk-recovery rewrite (`assessRouteCoverage`, `buildChunkInstruction`) | DELETE | Loop never rewrites finished work |
| Inspector AI call | DELETE for edits (deterministic locate replaces it) | Redundant |
| Critic AI call | DELETE | Immediate checks + final verification cover it |
| product/PRD/backend acceptance + turn-completion | MERGE into one completion check over ExecutionState | One "done" authority |
| Duplicate design context builders (`design-intel` + `design-knowledge`) | MERGE | One context module, stable prompt prefix |
| `src/routes/api/builds/callback.ts` shim | DELETE if unused | Legacy |
| Build-server `syntax-heal.ts` | MODIFY to report-only; repairs happen in the loop | No second repair system |
| Two verification stacks | Share one rule set; build server runs the build/browser checks only | No drift |

## Rollout (each stage ends with tests, typecheck, production build)

1. **ExecutionState + operation executor** — one state object (goal, requirements, workspace, done, remaining, deps, current op, errors, checkpoint, revision). Frontend derives display from it.
2. **Agent loop for app builds** — replaces the page batch; delete planner list, router harvest, batch writer, chunk recovery.
3. **Merge repair** — delete `repair.ts` separate path and extra missing-file passes.
4. **Fast path for simple edits** — delete inspector/critic calls.
5. **One completion authority** — merge the four modules.
6. **Context reuse** — one compact context, stable prefix, per-op reads only; merge design builders.
7. **Legacy sweep** — search and delete any remaining old path; update tests to the new architecture.
8. **Tests required by your brief**, then you publish, then the 4 live benchmarks (small edit, 4-page site, medium app, hospital) with runtime, AI calls, tokens, cost, operations, corrections, duplicates, files created/edited, outcome, plus the final DELETE/MODIFY/KEEP report.

## Technical notes

- Loop operations are chosen deterministically from ExecutionState plus import/export facts; the AI is asked only to produce the content of one operation, never to rediscover the file list.
- Duplicate work is impossible by construction: an operation key (path + purpose) completed in state is never re-selected; tests cover "Dashboard" vs "Home".
- Writes still go only through the existing staged tree and TurnTransaction; read-only inspection runs concurrently.
- Provider retries stay bounded (429/5xx) on the same model; worker loss resumes from the last recorded operation.
- No price changes, no file-size limits, no second orchestrator — old stages are removed as each new stage lands.
- Risk: this rewrites most of `generate.ts`. Stages land one at a time so every step is testable; the live site keeps the current engine until you publish.
