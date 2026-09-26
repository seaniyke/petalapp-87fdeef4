# Execution-engine replacement roadmap
- [x] Stage 1–2: ExecutionState + execution loop replaces batch page writer and router harvest (deleted `writePlannedPages`, `pagesReferencedByRouter`, `[...planned, ...fromRouter]`)
- [x] Stage 3: missing shared modules resolved inside the loop (re-run on newly written files); write-gate and late passes deleted
- [x] Stage 4: inspector AI call + module deleted; critic model review deleted (deterministic rules kept)
- [x] Stage 5: product-usefulness check merged into prd-acceptance (one acceptance authority); backend table check and feature flags stay — different jobs, not duplicates
- [x] Stage 6: reviewed — context already has one entry point (context/index); design-intel (what the project is) and design-knowledge (craft rules) are intentionally separate inputs, no merge
- [x] Stage 7: build-server syntax fixer is report-only (never rewrites verified source); callback shim and chunk-recovery rewrite already gone
- [ ] Stage 8: live benchmarks (small edit, 4-page site, medium app, hospital) — blocked on user publishing
