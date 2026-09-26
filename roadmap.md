# Execution-engine replacement roadmap
- [x] Stage 1–2: ExecutionState + execution loop replaces batch page writer and router harvest (deleted `writePlannedPages`, `pagesReferencedByRouter`, `[...planned, ...fromRouter]`)
- [ ] Stage 3: fold `repair.ts` post-gate repair + the 2 later `resolveMissingNodes` passes into the loop
- [ ] Stage 4: simple-edit fast path; remove inspector + critic AI calls
- [ ] Stage 5: merge 4 completion/acceptance modules into one
- [ ] Stage 6: one compact context (merge design-intel + design-knowledge), stable prefix
- [ ] Stage 7: legacy sweep (callback shim, chunk-recovery rewrite, builder syntax-heal → report-only)
- [ ] Stage 8: live benchmarks (small edit, 4-page site, medium app, hospital) — blocked on user publishing
