# Roadmap — core execution correction (Sept 26)

- [x] Trace hospital failure end-to-end (plan → commit → cost → finalize → UI)
- [x] Intent/archetype contract persisted on PRD; deterministic request-vs-plan validation before generation; re-plan on divergence
- [x] Foundation-first: shared deps (auth/data/backend helpers) generated before pages
- [x] Recovery: missing import target → create missing node first, not repair dependents
- [x] Remove "oversized file" rejection (size = decomposition signal only)
- [x] Terminal boundary: durable terminal record + assistant message + economics on every failure path
- [x] Economics row opened at turn start, finalized at end
- [x] Stuck "running": heartbeat-based dead-build detection
- [ ] Classification changes execution strategy (verify light fast path)
- [x] Tests, typecheck, build; redeploy builder; verify fingerprint
- [ ] Live hospital run; eight small benchmarks; final four questions answered
