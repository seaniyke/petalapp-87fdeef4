# Roadmap — core execution correction (Sept 26)

- [ ] Trace hospital failure end-to-end (plan → commit → cost → finalize → UI)
- [ ] Intent/archetype contract persisted on PRD; deterministic request-vs-plan validation before generation; re-plan on divergence
- [ ] Foundation-first: shared deps (auth/data/backend helpers) generated before pages
- [ ] Recovery: missing import target → create missing node first, not repair dependents
- [ ] Remove "oversized file" rejection (size = decomposition signal only)
- [ ] Terminal boundary: durable terminal record + assistant message + economics on every failure path
- [ ] Economics row opened at turn start, finalized at end
- [ ] Stuck "running": heartbeat-based dead-build detection
- [ ] Classification changes execution strategy (verify light fast path)
- [ ] Tests, typecheck, build; redeploy builder; verify fingerprint
- [ ] Live hospital run; eight small benchmarks; final four questions answered
