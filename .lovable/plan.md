## Goal

Match Lovable's ability to run a single user turn for 2+ minutes without breaking the connection or the user's trust, while charging fairly for the actual work done. Three coordinated changes.

---

## 1. Agentic loop (replace one-shot + post-passes with bounded cycles)

Today `/api/generate` does **one big completion → verifier tiers → optional 1-round autofix → done**. The continuation tier (`tier-continuation.ts`) and post-stream autofix (`post-stream-autofix.server.ts`) already exist but each runs at most once. We convert this into a bounded **agent loop** owned by the staged orchestrator.

**Loop shape (per user turn):**

```text
cycle 1: plan + write   → verify (esbuild, render-risk, rls, file-budget, local)
                          if clean → exit
                          else     → cycle 2
cycle N: targeted fix   → verify
                          exit when clean OR limits hit
```

**Limits (hard stops, whichever first):**
- `MAX_CYCLES = 6` (cycle 1 is the initial write; up to 5 fix cycles)
- `MAX_WALL_MS = 180_000` (3 min — gives Lovable-like 2m17s headroom)
- `MAX_TOTAL_COMPLETION_TOKENS = 40_000` per turn

**Cycle picker (which model for which cycle):**
- Cycle 1: existing `resolveModel(...)` (smart/best/etc.)
- Fix cycles: prefer `MODEL_FAST` (gemini-3-flash-preview); escalate to `MODEL_BEST` only if the same error class repeats twice or if the verifier flags >5 files
- Reuses existing `recordAiOutcome` so the smart router learns from cycle outcomes

**Files touched:**
- `src/server/pipeline/staged-orchestrator.server.ts` — wrap stages in a loop, accumulate `usage` from each sub-call
- `src/server/pipeline/tier-continuation.ts` — drop the "run once" guard; let the orchestrator decide
- `src/server/post-stream-autofix.server.ts` — same; expose as a callable cycle, not a one-shot epilogue
- `src/routes/api/generate.ts` — replace the inline "verify → autofix once → done" block with `runAgenticLoop(...)`

---

## 2. SSE heartbeats + silent-gap narration

There's already a 12 s heartbeat in the outer wrapper (`generate.ts` line 1909) but it emits the same string repeatedly and **only fires while the inner pipeline holds the stream silent**. Two problems:
- Repeated identical status feels like a stuck spinner, not progress
- The new agent loop has 5–10 second silent gaps during verifier/fix cycles where users see nothing

**Changes:**

a) **Cycle narration events.** Add new `StreamEvent` types:
   - `cycle_start` — `{ cycle: number, intent: "writing"|"fixing"|"verifying" }`
   - `cycle_progress` — short human strings like "Checking imports across 12 files…", "Re-running esbuild…", "Patching 2 files Petal noticed had broken JSX…"
   - `cycle_end` — `{ cycle, outcome: "clean"|"retrying"|"hard-stop" }`

b) **Heartbeat upgrade.** Replace the static "Still working…" with a rotating, intent-aware ticker driven by the current cycle's intent. The interval stays at 12 s but the message reflects the actual phase. Add `: ping\n\n` SSE comments every 8 s as the **transport** keep-alive (passes through proxies without touching the UI).

c) **Activity card consumer.** `BuildActivityCard.tsx` already prioritises model narration → derived narration → file counts. Insert `cycle_progress` strings between path narrations so the card never sits silent for >12 s.

**Files touched:**
- `src/server/generate.server.ts` — extend `StreamEvent` union
- `src/routes/api/generate.ts` — emit `cycle_*` events from the loop; rewrite heartbeat
- `src/components/BuildActivityCard.tsx` — render `cycle_progress` as the live sub-caption when present

---

## 3. Per-turn usage aggregation + redesigned cap

Today `priceBuild()` is called **once** with the gateway's `usage` from the single completion. With cycles, we'd either undercharge (sum nothing) or nickel-and-dime (charge per cycle). The fix is to aggregate then charge once.

**Changes to `src/server/credit-pricing.server.ts`:**
- New helper `priceTurn(usages: GatewayUsage[]): PricedBuild` — sums prompt + completion tokens across all cycles, then runs the same formula
- Bump `BUILD_CAP` from `6.0` → `12.0` (Lovable's 2.40 for ~2m17s suggests our token-rate math is in the right ballpark; the cap just needs room for legit long turns)
- Keep `BUILD_FLOOR = 1.0`, `BUILD_HOLD = 1.0`, `MISSING_USAGE_FALLBACK = 1.0`

**Changes to `src/routes/api/generate.ts`:**
- Replace the single `priceBuild(collected.usage)` call (line 1641) with `priceTurn(turnUsages)` where `turnUsages` is the array the orchestrator returns
- Internal autofix cycles triggered by Petal's own mistakes (e.g. continuation tier rerunning because cycle 1 truncated) are **excluded** from the user's bill — they go to the same "isAutoFix" exemption already wired in
- User-requested fix cycles (e.g. model retried because verifier found a real bug in user-requested code) **are** billed

**Telemetry:** `pipeline-telemetry.server.ts` already records per-step events. Add `cycle_count` and `total_completion_tokens` fields to the turn summary so we can watch the cost distribution after rollout.

---

## Out of scope (deliberately)

- No model swap. Same Lovable AI gateway, same supported models.
- No new UI screens. Reuses `BuildActivityCard`, recap line, backend chip.
- No DB schema changes. `priceTurn` writes the same single `spendCredit` row.
- No change to `/api/discuss` or `/api/coach` — chat-only paths are still flat.

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Loop runs forever on a flaky model | Hard `MAX_CYCLES` and `MAX_WALL_MS`; reaching either emits a friendly "Petal stopped after N attempts — try again or break this into a smaller step" |
| Cap raise lets a runaway cost a user $$ | Cap is in **credits**, not tokens. 12 credits ≈ same as 2 long discusses today. We'll watch `cycle_count` telemetry for a week before considering further raises |
| Heartbeat spam in console | Use `: ping` SSE comments (ignored by EventSource consumers) for transport keep-alive; only emit `cycle_progress` when something actually changed |
| Existing handoff/continuation telemetry double-counts | Keep `requestHandoff` flag for telemetry only (already noted in `tier-continuation.ts`); don't surface to UI |

---

## Rollout

1. Land changes behind `LABS_AGENT_LOOP` flag (already have `loadLabsFlagsForRequest`)
2. Internal dogfood: I run it on Petal itself + 2 fresh projects
3. Compare `cycle_count` / total credits / wall time vs current baseline
4. Flip default to on once p95 wall time < 90 s and p95 credits < 5

---

## What "done" looks like

- A user prompt that today truncates after one big completion now silently runs 2–3 cycles and ships clean code
- The activity card narrates every 5–10 s through the whole turn — never silent for >12 s
- Charged credits scale with actual tokens spent across all cycles, capped at 12.0
- Free internal autofix cycles still cost the user nothing
