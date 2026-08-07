# Petal v3 — From Repair Engine to Correct-by-Construction Builder

## First, your actual question

When a Lovable user says "build me a Lovable clone", Lovable builds the **product surface, not the machine**:

- Marketing/landing page, auth, project list, credits/billing UI
- A split-pane "builder" route: chat on the left, iframe preview on the right, a file tree, a read-only code viewer
- With Cloud on: real tables (`projects`, `messages`, `credits`), and a chat that genuinely calls an AI model and streams tokens back

What it does **not** build, and cannot build from a prompt:

- A sandbox that runs `npm install` + a real bundler per generated project
- A build queue, per-project hosting, deploy pipeline, promotion of green builds
- Repair/verification loops, syntax healing, TypeScript gates, browser checks
- Credit metering tied to real compute

The clone's "preview" is an `srcdoc` iframe of model-emitted HTML. It looks right in a demo and collapses on the second prompt. Roughly the top 20% (UI + chat) is reproducible from a prompt; the bottom 80% is infrastructure that lives outside the generated repo.

So: Petal's moat is real. The problem is not capability coverage — it's **architecture**.

## The diagnosis

`src/server/` currently holds 166 modules. The large majority are post-hoc **text repair** on model output: markdown-fence strippers, escape fixers, JSX attribute literal fixers, import syntax fixers, sibling resolvers, scope repair, router provider injection, tag scanners, style validators.

That is the root cause of the error stream you keep seeing. The pipeline is:

```text
model emits a text blob  ->  30+ regex/AST passes try to make it valid  ->  build  ->  hope
```

Every new failure mode adds pass #N+1, which can conflict with passes 1..N-1. This is unbounded. You will never finish it, because the model's output space is infinite and repair coverage is finite.

The fix is to change the shape of the problem: **make invalid output unrepresentable instead of repairable.**

```text
model calls typed tools against a live, compiling workspace
  -> every edit is validated at write time, rejected if it doesn't parse
  -> continuous typecheck/build feedback goes back to the model
  -> only a green, browser-verified build is ever promoted
```

## What a world-class AI software builder does, start to finish

**1. Understand — Intent & Spec**
Convert the prompt into a written, machine-readable spec: app type, target (web/mobile), routes, data model, auth, integrations, design direction. Show it to the user for one-tap confirmation on ambiguous builds. Never generate code from a raw prompt.

**2. Plan — Deterministic scaffold**
Choose a real, versioned, already-compiling template. Routes, tokens, layout shell, brand, head metadata come from the scaffold, not the model. The model never writes config, router bootstrap, or `package.json`.

**3. Generate — Tools, not text**
The model does not emit a file blob. It calls tools: `create_file`, `edit_range`, `rename`, `add_dependency`, `add_route`. Each tool call is parsed and typechecked at write time. A call that doesn't parse is **rejected and returned to the model as an error**, not written to disk and repaired later. This alone deletes the entire fence/escape/attribute/import-syntax class of bugs.

**4. Compile — The workspace is always live**
A persistent per-project sandbox with warm `node_modules`. Every accepted edit triggers an incremental typecheck and bundle. The model sees diagnostics within a second and fixes its own work in-loop, before the turn ends.

**5. Verify — Multi-layer gates**
Typecheck → build → headless browser (renders, no blank page, no console errors, nav/forms work) → visual QA score. Failures are typed defects, not strings.

**6. Promote — Fail closed**
A build only replaces the live preview if it is green. A broken candidate never touches a working preview. (Partly built already — keep it, make it universal.)

**7. Iterate — Scoped edits**
Follow-up prompts do not regenerate the app. The model reads the current file, edits ranges, and the same gates run. One build per turn, idempotent, one charge.

**8. Ship — Deploy + observe**
Publish, custom domain, logs, error reporting back into the chat.

**9. Trust — Metering**
Charge for a completed, verified turn. Never charge for a turn the system failed. Show the breakdown.

## The plan for Petal

### Phase A — Tool-based emission (kills ~60% of the repair surface)
- Add a strict tool protocol for generation: `create_file`, `patch_file`, `delete_file`, `add_dep`. No free-form file blobs.
- Validate each tool call at write time with esbuild/TS parse. Invalid → reject with the exact diagnostic, let the model retry in the same turn (max N retries, no extra charge).
- Retire the syntax-repair passes that become dead: fences, source escapes, import syntax, JSX attr literals, tag scan.

### Phase B — Live compiling workspace
- Keep the per-project sandbox warm between turns with cached `node_modules` (already partly there via dependency caching).
- Expose incremental typecheck + build diagnostics to the agent loop as a first-class tool (`get_diagnostics`).
- Target: the model fixes its own type errors before the turn is reported complete.

### Phase C — Spec-first, scaffold-owned structure
- Every build starts from a versioned compiling scaffold. Router bootstrap, `vite.config`, `package.json`, tokens, head metadata, brand mark are **owned by Petal**, never model-writable.
- Retire `router-provider`, `tanstack-router-fallback`, `router-imports`, `build-config-repair`, `sync-vite-aliases` — they exist only because the model is allowed to touch files it shouldn't.

### Phase D — Consolidate what remains
- Collapse the surviving repair passes into three named stages with a fixed, tested order: **Resolve** (imports/siblings/deps), **Hygiene** (a11y, layout, overlays, interactions), **Polish** (visual QA, anti-sameness).
- One ledger, one report, deterministic ordering, full test coverage.

### Phase E — Trust surface
- One build per turn, one charge, refund on system failure — audit and close any remaining gaps.
- Surface the spec, the gates that ran, and the verdict in the chat so failures are legible instead of mysterious.

## Sequencing

A → B are the high-leverage moves and should ship first; they remove the error class you're tired of rather than adding another patch. C is the structural lock-in. D is cleanup that becomes safe only after A–C. E is polish.

## Technical notes

- Phase A touches `src/server/generate.server.ts`, `agent-tools.server.ts`, `agent-loop.server.ts`, `tool-call-guard.server.ts`, and retires passes from `repair-all.server.ts`.
- Phase B touches `builder/src/build.ts`, `deps.ts`, `exec.ts`, `server.ts` and adds a diagnostics endpoint.
- Phase C touches `scaffold-kit*.ts`, `app-spec.server.ts`, `build-blueprint.server.ts`, plus a write-allowlist enforced in the tool layer.
- No schema migration is required for A; B may need a sandbox-session table.
- Each phase ships behind a flag with the existing reliability test suite extended before cutover.
