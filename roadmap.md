# Execution-engine replacement roadmap
- [x] Stage 1–2: ExecutionState + execution loop replaces batch page writer and router harvest (deleted `writePlannedPages`, `pagesReferencedByRouter`, `[...planned, ...fromRouter]`)
- [x] Stage 3: missing shared modules resolved inside the loop (re-run on newly written files); write-gate and late passes deleted
- [x] Stage 4: inspector AI call + module deleted; critic model review deleted (deterministic rules kept)
- [x] Stage 5: product-usefulness check merged into prd-acceptance (one acceptance authority); backend table check and feature flags stay — different jobs, not duplicates
- [x] Stage 6: reviewed — context already has one entry point (context/index); design-intel (what the project is) and design-knowledge (craft rules) are intentionally separate inputs, no merge
- [x] Stage 7: build-server syntax fixer is report-only (never rewrites verified source); callback shim and chunk-recovery rewrite already gone
- [ ] Stage 8: live benchmarks (small edit, 4-page site, medium app, hospital) — blocked on user publishing

## Webby-style engine (approved)
- [x] Stage A: tool-calling loop (read/list/search/create/edit/plan/finish), per-write validation, periodic typecheck, state-based finish, circuit breaker, tests
- [x] Stage B (first builds; edits still on patch path): wire first builds + edits to the loop; delete planFirstBuild shell scheduling, rawPageCompletion, runChunkedGeneration, swallowed catch
- [x] Readiness consolidation: finish + commit read one readiness verdict; stable-foundation model from the import graph; old step engine (agent-loop.ts) deleted
- [ ] Edits: move existing-app edits onto the tool loop (still on patch path)
- [ ] Stage C: compaction at 70%, per-call tracing (TTFT, tokens, tool/validation time) into turn_events/turn_economics
- [ ] Stage D: live benchmarks A-D, then hospital (E) only after A-D pass
