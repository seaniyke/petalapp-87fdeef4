# Phase 5 (revised) — Render-risk linter as Tier 2.8

A real React render mount isn't possible inside the Cloudflare Worker (no jsdom, no runtime module resolution). Instead, ship a deterministic linter that catches the top white-screen patterns we've observed in telemetry. Same tier shape as Phase 4. Runs in <50ms, no LLM cost, no new infra.

## What it catches (three rules, ship-conservatively)

**R1 — Optional-prop crash (highest signal).** A prop typed as `prop?:` or `prop: T | undefined | null` is destructured WITHOUT a default and then accessed via `.length`/`.map`/`.filter`/`.forEach`/`.find`/`.reduce`/`.slice`/`.some`/`.every`/`.includes`/`.indexOf`/`.join`/`.concat`/`.flat`/`.flatMap`/`.sort`/`.reverse` without `?.` chaining or an `if (prop)` guard. This is the exact `RUNTIME_CRASH_PAGE` fixture we left waiting in the harness.

**R2 — Conditional hooks.** A React hook (`useState`/`useEffect`/`useMemo`/`useCallback`/`useRef`/`useContext`/`useReducer`/`useLayoutEffect`/etc.) is called inside an `if`/`else`/ternary branch in a component body. React throws "Rendered fewer hooks than expected" on the next render.

**R3 — Undeclared JSX identifier.** A `{ident}` expression in JSX references a name that isn't imported, declared locally, destructured, or a global. Catches typos like `{titel}` for `{title}`.

Each rule independently disable-able via an `ENABLED_RULES` set so we can hot-rollback any single rule without touching the orchestrator.

## Skips (same as other verifiers)

- `src/components/ui/` (scaffold)
- `src/integrations/` (scaffold)
- `src/components/examples/` (intentionally partial reference snippets)
- non-`.tsx`/`.jsx` files

## Files

```text
src/server/render-risk-linter.ts          (new — pure function, ~370 lines)
src/server/pipeline/tier-render-risk.ts   (new — wraps linter for the orchestrator)
src/server/pipeline/tier-types.ts         (extended — add RenderRiskTierOutput)
src/routes/api/generate.ts                (call runRenderRiskTier after Tier 2.7)
src/lib/stream.ts                         (add "render_risk" to step union)
src/server/generate.server.ts             (add "render_risk" to StreamEvent step union)
src/components/BuildActivityCard.tsx      (add label + icon for render_risk)
src/server/__tests__/pipeline.fixtures.ts (flip RUNTIME_CRASH_PAGE expectation; add 3 fixtures)
src/server/__tests__/pipeline.test.ts     (no change — fixtures auto-run)
.lovable/plan.md                          (mark Phase 5 shipped)
```

## Where it slots in

```text
Tier 2.4  file budget          (existing)
Tier 2    stream autofix       (existing)
Tier 2.5  local verifier       (existing — extracted)
Tier 2.45 npm pre-flight       (existing — extracted)
Tier 2.6  continuation         (existing — extracted)
Tier 2.7  esbuild parse        (existing — extracted)
Tier 2.8  render-risk linter   (NEW)  ← this phase
Tier 2    post-stream autofix  (existing)
```

`render-risk` issues feed into `combinedAutofixIssues` so the post-stream autofix model fixes them in the same round — no extra round-trip.

## Behavior contract

- **Failure mode = soft warn**, not a hard reject. The linter's issues are appended to `combinedAutofixIssues` so post-stream autofix tries to fix them, BUT a stubborn render-risk issue does NOT block shipping the turn. Reasoning: a false positive must never wedge a clean build, and the existing build will surface a real white-screen quickly anyway.
- Emits one `timeline` event per turn with `step: "render_risk"`, `outcome: "ok" | "failed"`, `count: <issues>`.
- Adds `<100ms` to turn latency (no I/O, no LLM).

## Regression harness updates

Flip `RUNTIME_CRASH_PAGE` to assert `expectIssueIncludes: ["items"]` (it was a deliberate slip-through fixture waiting for Phase 5).

Add three new fixtures:
1. **Conditional hook**: `if (cond) { useState(...) }` → expect R2 fires.
2. **JSX typo**: `<div>{titel}</div>` with `title` declared → expect R3 fires.
3. **Safe optional prop**: `function X({ items = [] }: { items?: T[] }) { return items.map(...) }` → expect NO issue (default makes it safe). This guards against R1 false positives.
4. **Safe optional prop with guard**: `if (!items) return null; items.map(...)` → expect NO issue.

## Risks and mitigations

- **False positives blocking clean turns**: Mitigated by (a) soft-warn behavior, (b) ENABLED_RULES kill switch, (c) two "must NOT fire" fixtures in the harness.
- **Hook-rules false negatives**: Conservative scan — we only flag hooks where the immediate ancestor is a clear conditional. Real false negatives are acceptable; false positives are not.
- **R3 over-flagging on dynamic JSX**: We only check single-identifier expressions (`{foo}`), not member access or calls. Tight scope minimizes noise.

## What ships in this turn

Implementation in one batch:
1. `src/server/render-risk-linter.ts` (the three rules)
2. `src/server/pipeline/tier-render-risk.ts` (thin wrapper, returns `EmitList`)
3. Type-union updates across the three places that declare timeline `step`
4. `BuildActivityCard.tsx` — add `render_risk: "Render-risk check"` label + `ShieldCheck` icon
5. Wire into `generate.ts` after Tier 2.7
6. Fixture updates + run `bun src/server/__tests__/pipeline.test.ts` to confirm 12/12 pass

## Phase 5b — RLS sanity check (Tier 2.9) — SHIPPED

Tier 2.9 scans changed `.tsx?/.jsx?` files for `<supabase-ish>.from('name')` literal-arg calls and cross-references against parsed `supabase/migrations/*.sql` in the same file set. Three rules:

- **M1 — MISSING_TABLE.** Call references a table with no `CREATE TABLE` in any migration. Catches typos and forgotten migrations.
- **M2 — NO_RLS.** Table exists but has no `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`. Fully-open via the publishable key.
- **M3 — NO_POLICY.** RLS enabled but no `CREATE POLICY ... ON <table>`. Every non-admin query 403s.

**Skips**: reserved schemas (`auth.*`, `storage.*`, `realtime.*`, `vault.*`, `supabase_functions.*`), `src/integrations/`, dynamic `.from(<expr>)` calls, files using the service-role client (`SUPABASE_SERVICE_ROLE_KEY` / `supabaseServiceKey` / `serviceRoleKey` referenced, or `supabaseAdmin` imported, or a `*.server.ts` file using `createClient`), receivers like `Array.from`/`Object.from`/etc. If the project has zero migrations, all three rules go silent — early scaffolding shouldn't get flagged.

**Behavior**: Soft-warn, identical to Tier 2.8. Issues feed into `combinedAutofixIssues` but do not independently open the autofix gate. Three independent kill switches in `ENABLED_RULES`.

**Files shipped**:
- `src/server/rls-sanity-linter.ts` (new — pure function)
- `src/server/pipeline/tier-rls-sanity.ts` (new — orchestrator wrapper)
- `src/server/local-verifier.ts` (kind union: `+ "rls-sanity"`)
- `src/lib/stream.ts`, `src/server/generate.server.ts`, `src/components/BuildActivityCard.tsx` (timeline step `+ "rls_sanity"`, label "RLS sanity check", `ShieldCheck` icon)
- `src/routes/api/generate.ts` (call `runRlsSanityTier` after Tier 2.8; spread `rlsSanityIssues` into `combinedAutofixIssues`)
- `src/server/__tests__/pipeline.fixtures.ts` + `pipeline.test.ts` (4 fixtures: healthy must-not-fire, M1, M2, M3 — all green; harness 17/17)

**Verification**: All 17 pipeline fixtures pass. Host-project scan confirmed admin-bypass detection works for the email infrastructure (10 false positives → 0). Remaining 5 host-scan hits are inside string-template fixtures and the linter's own template literal — not real code paths the linter sees in production.

