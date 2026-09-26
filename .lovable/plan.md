# Webby-style execution engine for Kimble

## What the live runs showed (today)
| Build | Time | AI calls | Kimble cost | Charged | Outcome |
|---|---|---|---|---|---|
| 4-page bakery | 2.5 min | 5 | $0.018 | 0 | Failed: About cut off, Contact never written |
| Hospital | 10.5 min (was 42) | 31 | $0.25 | 0 | Failed: Prescriptions page broken, 4 files blocked |

Both failed for the same reason. The first AI call was told to write only the shared shell, but it wrote pages as well. Those pages skip the per-page check, the step-by-step engine treats them as finished, and any error inside that engine is silently ignored. The broken pages are only discovered at the final check, which then rejects the whole build.

## Webby vs Kimble (from source)
| Mechanism | Webby | Kimble today | Decision |
|---|---|---|---|
| Loop | One conversation; the model picks next actions via tool calls; stops when it makes no more calls. 100 + 8 iterations | Code-driven: one shell call, then one AI call per page | REPLACE with one tool-calling loop |
| Work per call | Many file writes and edits in one reply | One page per call; pages the shell wrote are unchecked | REPLACE |
| Edits | `editFile` exact search/replace (must read the file first; blocks replacing >50% of it), plus `createFile` | `patch_files` on edits only; first builds are whole-file | KEEP patch, add read-before-edit |
| Per-write check | Syntax check on every write; type check every 3 writes, errors fed back into the same conversation | Per page, but only for pages the engine itself asked for | MODIFY: check every write, from any source |
| Recovery | Circuit breaker (per tool, per file, global, same-error ×5); backoff 3× | Same-writer fix + separate final repair passes | ADD circuit breaker; final repair passes become a fallback only |
| Context | Stable cached prefix; compaction at 70% (summary + last 6 turns) | Cached prefix; each page call rebuilds its context | ADD compaction; one conversation reuses the cache |
| Parallelism | None: all tools run one at a time | Up to 4 pages in parallel | KEEP read-only parallel lookups; writes one at a time |
| Durability | Go process runs apart from the browser; progress sent by webhook | Build server + checkpoints | KEEP (Kimble is stronger) |
| Sub-agents | None | None | Do not add |

The main source of Webby's efficiency: each AI reply carries several file writes and edits inside one cached conversation, and errors come straight back into that conversation. It does not make one fresh, full-context AI call per page.

## What to build
1. **Tool-calling loop** in `agent-loop.ts`, replacing the shell-call-then-pages sequence. Tools: `read_file`, `list_files`, `search`, `create_file`, `edit_file` (exact search/replace), `plan_tasks`, `finish`. One model conversation per turn, capped at 100 + 8 iterations. Read-only tools run concurrently; writes run one at a time into the staged transaction.
2. **Every write validated when it lands:** parse + undefined-names check, with the result returned as that tool call's output. A type check runs every 3 writes and its errors are fed back into the same conversation. This applies to every file whatever wrote it, so an unchecked shell page can't slip through.
3. **Completion comes from workspace state:** `finish` is refused while planned pages are missing or failing, or the router points at files that don't exist. This makes a bakery-style gap impossible.
4. **Circuit breaker:** per tool 3, per file 2, global 10, same error ×5, then a clean stop. Failures are classified as today.
5. **Compaction** at 70% of the model's context window: summary + last 6 turns, with the static prefix kept for caching.
6. **Fast path:** LIGHT edits get the same loop, capped at ~6 iterations, with no planner, design or PRD stages.
7. **Deletions:** shell-only instruction and `planFirstBuild` page scheduling; the per-page `rawPageCompletion` writer; the edits-only `runChunkedGeneration` continuation (replaced by the loop's own continuation); the swallowed `catch (chunkErr)`. Final verification, repair and quarantine stay as the authority, but should rarely have work to do.
8. **Kept unchanged:** TurnTransaction, revision check-and-commit, one running turn, credit ledger and refunds, cancellation, checkpoints (each write saved as it lands), provider failure classification, final verification, publish safety.
9. **Tracing:** per AI call, record duration, time to first token, input/cached/output tokens, and tool time, in `turn_events` and `turn_economics`.

## Rollout
Stage A: loop + tools + per-write validation behind the existing entry point; tests.
Stage B: switch first builds and edits to it; delete the old paths.
Stage C: circuit breaker, compaction, tracing.
Stage D: live benchmarks: one-file edit, 4-page site, medium feature, medium app, hospital. Report the time, calls, tokens, cost, charges and the step-by-step trace for each.

## Risks
Large change to the core build path. The model must handle tool calling reliably. Webby uses deepseek-v4-flash, the same model Kimble uses, so this is proven. No price changes and no file-size caps.
