# Petal Architecture Review — and the v3 Engine

You asked the right question. The architecture *is* the problem. Here is what I found, then what to do about it.

## Part 1 — Your actual question about Lovable

When a Lovable user says "build me a Lovable clone", Lovable builds the **product surface, not the machine**: landing page, auth, project list, credits UI, and a split-pane builder route with chat on the left and an iframe on the right, a file tree, a code viewer. With Cloud on, the chat really calls a model and really streams.

What it cannot build from a prompt: a sandbox that runs `npm install` + a real bundler per project, a build queue, per-project hosting, a deploy pipeline, verification, repair loops, promotion of green builds, or compute-backed metering. The clone's "preview" is an `srcdoc` iframe of model-emitted HTML — convincing in a demo, dead on the second prompt.

So a clone prompt reproduces the top ~20% (UI + chat) and none of the bottom 80%. Petal already has the bottom 80%. The gap is not features. It is architecture.

## Part 2 — What Petal's architecture actually looks like today

Verified by reading the code:

- **166 modules in `src/server/`.** The dominant category is post-hoc text repair on model output: markdown-fence fixer, source-escape fixer, JSX attribute literal fixer, import-syntax fixer, extension normalizer, shadcn-import fixer, array-safety fixer, brand wiring, local import resolver, router import fixer, TanStack fallback, router-provider injector, bare-import resolver, sibling resolver, scope repair, tag scanner, style validator, and more.
- **`repair-all.server.ts` is a 300-line ordered pipeline** whose comments literally document the ordering hazards: "must run FIRST", "must precede the import resolver", "must run BEFORE bare-import resolution", "this must be the very first thing that runs." Three separate passes exist only because an earlier pass can *reveal* the bug a later pass fixes (fences run twice).
- **Generation is one giant single-shot tool call.** The model calls `write_project` and emits whole files as strings. `SYSTEM_PROMPT_INITIAL` alone is thousands of words of "do not do X" rules, and the scaffold kit files total ~760 KB of prompt-adjacent material.
- **A real tool layer already exists** — `agent-tools.server.ts` has `read_file`, `list_dir`, `run_check`, patching tools — **but `shouldRunAgentLoop()` gates it to narrow cases** like dependency work. The common path never uses it.
- **The compile step is remote and terminal.** Files are shipped to the Railway builder, which runs `npm install` + `vite build` and calls back. The model never sees a compiler error while it is still writing.

### The structural verdict

```text
CURRENT:  prompt rules  ->  model emits whole-file text blob
          ->  ~30 ordered regex/AST repair passes
          ->  ship to remote builder  ->  npm install + vite build
          ->  pass/fail arrives after the turn is over
```

Three compounding flaws:

1. **Correctness is enforced by English, not by types.** Every rule ("no fences", "no bare imports", "use the kit", "180-line cap") is a sentence in a prompt. Prompts are probabilistic. Every rule the model breaks becomes repair pass #N+1.
2. **Repair is unbounded and self-conflicting.** Output space is infinite; repair coverage is finite. Passes now depend on each other's ordering, so each new fix risks breaking two old ones. This is why the errors never end — it is not sloppiness, it is the design.
3. **The feedback loop is open, not closed.** The compiler's verdict arrives *after* generation completes. The model cannot fix its own type error, because it never sees it. Humans don't code that way and neither should the engine.

Petal is currently a **text-repair engine wearing a builder's coat**. World-class builders are compilers with a model attached.

## Part 3 — What the engine should be

```text
TARGET:   spec  ->  model calls typed tools against a LIVE, COMPILING workspace
          ->  each edit parsed + typechecked AT WRITE TIME (invalid = rejected, returned to model)
          ->  model sees diagnostics and fixes itself, in-turn
          ->  browser verification  ->  promote only if green
```

Nine stages, each with a hard contract:

1. **Understand** — prompt becomes a machine-readable spec (type, target, routes, data model, auth, design direction). Never generate from a raw prompt.
2. **Plan** — pick a versioned, already-compiling scaffold. Router, config, tokens, brand, head metadata come from the scaffold. The model does not write them.
3. **Generate** — no file blobs. Typed tool calls only: `create_file`, `patch_range`, `rename`, `add_dependency`, `add_route`. Each call parsed at write time; a call that doesn't parse is **rejected back to the model as a diagnostic**, never written and repaired later.
4. **Compile** — a warm per-project workspace with cached `node_modules`. Incremental typecheck after every accepted edit. Sub-second feedback.
5. **Self-correct** — the model loops on real diagnostics until green or budget exhausted. Repair moves from *after* the turn to *inside* the turn.
6. **Verify** — build → headless browser (renders, no blank page, no console errors, nav/forms work) → visual QA. Typed defects, not strings.
7. **Promote** — fail closed. A broken candidate never replaces a working preview.
8. **Iterate** — follow-ups read and patch ranges; no regeneration. One build per turn, idempotent, one charge.
9. **Ship & meter** — deploy, logs, errors back into chat. Charge only for completed verified turns.

The single most important shift: **make invalid output unrepresentable instead of repairable.** That deletes whole error categories rather than patching instances.

## Part 4 — The plan

### Phase A — Close the loop (highest leverage, do first)
Make `run_check` mandatory and in-turn instead of gated. Before a turn can be reported complete, the model must have run a real parse/typecheck against its own output and resolved the diagnostics. Turn `shouldRunAgentLoop` from an exception into the default path.
*Deletes: the entire "user discovers the build broke" experience.*

### Phase B — Write-time validation
Replace whole-file `write_project` emission with per-file validated writes. Every file is esbuild-parsed the moment it arrives; failures return to the model with the exact line and column, and it retries in-turn at no charge (bounded retries).
*Retires: fence fixer, source-escape fixer, import-syntax fixer, JSX attr literal fixer, tag scanner, markdown fence re-runs.*

### Phase C — Scaffold owns structure
An enforced write-allowlist. The model may never write `vite.config.ts`, `package.json` internals, router bootstrap, `main.tsx`, `index.html`, or `styles.css` base. Petal owns them from a versioned template.
*Retires: router-provider injector, TanStack fallback, router-imports, build-config repair, vite alias sync, most of the styles validation.*

### Phase D — Warm workspace
Persistent per-project sandbox with cached `node_modules` between turns, exposing incremental diagnostics as a first-class tool. This is what makes Phase A fast enough to be mandatory.

### Phase E — Consolidate the survivors
Whatever repair remains collapses into three named, ordered, fully-tested stages: **Resolve** (imports, siblings, deps), **Hygiene** (a11y, layout, overlays, interactions), **Polish** (visual QA, anti-sameness). One ledger, one report. Target: from ~30 ad-hoc passes to 3 documented stages.

### Phase F — Legibility & trust
Surface the spec, the gates that ran, and the verdict in chat, so a failure is explainable instead of mysterious. Audit one-build-one-charge and refund-on-system-failure end to end.

## Sequencing and why

A and B together remove the error class you are tired of, and they are additive — nothing gets deleted until C proves the passes are dead. D makes A sustainable. E is the cleanup that is only safe after A–D. F is the finish.

Order: **A → B → C → D → E → F.** A alone should visibly cut the error stream.

## Technical notes

- Phase A: `agent-loop.server.ts` (`shouldRunAgentLoop`), `agent-tools.server.ts` (`runCheck`), `generate.server.ts`.
- Phase B: `generate.server.ts` tool contract, `tool-call-guard.server.ts`, `esbuild-verifier.server.ts`; feature-flag the old path for rollback.
- Phase C: an allowlist enforced in the tool layer plus `scaffold-kit*.ts`, `build-blueprint.server.ts`, `app-spec.server.ts`.
- Phase D: `builder/src/server.ts`, `deps.ts`, `exec.ts`; may need a sandbox-session table.
- Phase E: `repair-all.server.ts` restructure; extend `src/server/__tests__/repair-safety.test.ts` before any pass is deleted.
- No schema migration needed for A–C. Every phase ships behind a flag with tests extended before cutover.
