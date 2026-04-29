## Goal

Add a real **bundle-grade syntax/parse check** to the build pipeline using `esbuild-wasm` (already installed). Today the local verifier counts braces and JSX tags heuristically — strong, but not semantic. esbuild is the same parser Vite uses to ship the bundle, so if it parses cleanly here, it will parse cleanly in the deployed app. This is the single biggest jump in "the build is green when we say it's green."

This is **quality-only** — no new UI, no new feature surface. It plugs into the existing pipeline as a new tier between the local verifier and the post-stream autofix.

## Where it fits in the pipeline

Current order in `src/routes/api/generate.ts`:

```text
stream → styles.css validator → regex autofixer (Tier 2) →
  local verifier (Tier 2.5) → continuation (Tier 2.6) →
  post-stream autofix (Tier 2) → image resolution → self-check
```

New order:

```text
… → local verifier (Tier 2.5) → continuation (Tier 2.6) →
  esbuild parse (Tier 2.7 — NEW) → post-stream autofix → …
```

The esbuild pass runs **after** continuation (so we don't flag files we know are mid-repair) and **before** the autofix gate (so its findings can open the gate just like the local verifier does today).

## Technical design

### 1. New file: `src/server/esbuild-verifier.server.ts`

Worker-safe wrapper around `esbuild-wasm`. Exposes:

```ts
export type EsbuildIssue = {
  path: string;
  line: number;
  column: number;
  message: string;
  // "parse" = syntax error, "resolve" = bare import esbuild can't see (we ignore these — own resolver above)
  kind: "parse";
};

export type EsbuildVerdict = { ok: boolean; issues: EsbuildIssue[] };

export async function verifyFilesEsbuild(
  files: { path: string; content: string }[],
  changedPaths: string[],
): Promise<EsbuildVerdict>;
```

Implementation notes:
- Initialize esbuild-wasm **lazily and once** per Worker instance (`initialize({ wasmURL })` cached in a module-level promise). Worker cold start cost is ~80ms; subsequent calls are sub-millisecond per file.
- For each changed `.ts/.tsx/.jsx/.js` file, call `transform(content, { loader, sourcefile: path })`.
- We only care about **parse errors**, not bundling. No plugins, no resolve, no minify. This sidesteps the "esbuild can't find `@/components/ui/button`" noise (we already cover that in `findUnresolvedImports`).
- Skip the same paths the local verifier skips: `src/components/ui/*`, `src/integrations/*`, `src/components/examples/*`.
- Catch and downgrade: if esbuild itself throws (e.g. wasm init failure on a cold worker), log and return `{ ok: true, issues: [] }` so a transient infra hiccup never breaks a build that would otherwise pass.

### 2. Wire into `src/routes/api/generate.ts`

Insert immediately after the existing continuation block (around line 875), before the autofix gate (line 891):

```ts
// Tier 2.7 — esbuild parse pass. Authoritative syntax check using the
// same parser Vite ships with. If this passes, the bundle will parse.
const esbuildVerdict = await verifyFilesEsbuild(nextFiles, earlyChangedPaths);
controller.enqueue(encoder.encode(sse({
  type: "timeline",
  step: "esbuild_parse",
  outcome: esbuildVerdict.ok ? "ok" : "failed",
  message: esbuildVerdict.ok
    ? `Parsed ${earlyChangedPaths.length} file${earlyChangedPaths.length === 1 ? "" : "s"} cleanly`
    : `Found ${esbuildVerdict.issues.length} syntax issue${esbuildVerdict.issues.length === 1 ? "" : "s"}`,
  count: esbuildVerdict.ok ? earlyChangedPaths.length : esbuildVerdict.issues.length,
  ts: Date.now(),
})));
```

Then update the autofix gate one line below to also open on esbuild failure, and pass esbuild's structured issues into the autofix call so the model has line/column context:

```ts
const autofixGateOpen =
  !localVerdict.ok ||
  !esbuildVerdict.ok ||
  autofixOut.report.fixedCount >= 2;

const combinedIssues = [
  ...localVerdict.issues,
  ...esbuildVerdict.issues.map((i) => ({
    path: i.path,
    kind: "parse" as const,
    detail: `${i.message} (line ${i.line}:${i.column})`,
  })),
];

if (autofixGateOpen) {
  const fixOut = await runPostStreamAutofix(nextFiles, combinedIssues);
  …
}
```

### 3. Extend `LocalIssue` kind union

In `src/server/local-verifier.ts`, add `"parse"` to the `kind` union so the autofix prompt template (which already prints `kind: detail`) renders esbuild errors without a type cast workaround.

### 4. Surface in the build timeline

The `BuildActivityCard` already renders any `step` it receives — no changes needed. The new `esbuild_parse` step appears between `local_verifier` and `post_stream_autofix` automatically.

## Out of scope (explicitly NOT this turn)

- Full **typecheck** (`tsc --noEmit`). Worth doing later, but tsc-on-Worker is a much bigger investment (no native binary, programmatic API is heavy, multi-second cost). esbuild parse covers ~80% of what users hit.
- Hard server-side enforcement of the 180-line cap.
- Runtime smoke check / preview boot loop.

These three are the remaining items from the readiness audit. We can plan #2 next once #1 is shipped and we have telemetry on how many turns it catches.

## Files to edit

- **new** `src/server/esbuild-verifier.server.ts` — esbuild-wasm wrapper, lazy init, per-file `transform`.
- **edit** `src/server/local-verifier.ts` — add `"parse"` to `LocalIssue["kind"]`.
- **edit** `src/routes/api/generate.ts` — insert Tier 2.7 block, update autofix gate + issue payload.

No DB changes. No new env vars. No new dependencies (esbuild-wasm is already in `package.json`).

## Success criteria

- A turn where the model emits a file with a real syntax error (e.g. missing `)`) is now flagged by `esbuild_parse` in the timeline, the autofix gate opens, and the repaired file parses cleanly on the next pass.
- A clean turn shows `esbuild_parse: Parsed N files cleanly` and adds <100ms warm / <250ms cold to total turn time.
- Zero false positives on scaffold-managed files (UI kit, examples, integrations) — they're skipped by path filter.
