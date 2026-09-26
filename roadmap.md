# Execution-engine replacement roadmap
- [x] Stage 1–2: ExecutionState + execution loop replaces batch page writer and router harvest (deleted `writePlannedPages`, `pagesReferencedByRouter`, `[...planned, ...fromRouter]`)
- [x] Stage 3: missing shared modules resolved inside the loop (re-run on newly written files); write-gate and late passes deleted
- [x] Stage 4: inspector AI call + module deleted; critic model review deleted (deterministic rules kept)
- [ ] Stage 5: merge 4 completion/acceptance modules into one
- [ ] Stage 6: one compact context (merge design-intel + design-knowledge), stable prefix
- [ ] Stage 7: legacy sweep (callback shim, chunk-recovery rewrite, builder syntax-heal → report-only)
- [ ] Stage 8: live benchmarks (small edit, 4-page site, medium app, hospital) — blocked on user publishing
