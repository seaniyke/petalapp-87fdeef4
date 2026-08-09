# Petal: from pipeline to closed-loop agent

## My honest read

Your diagnosis is about 80% right, and the 20% that's off matters, because it points at a rewrite you don't need.

**Right:** the advantage is the execution system around the model, not the model. Right that build-completion and app-quality are different metrics and you're only measuring the first. Right that a senior engineer plans architecture before writing `App.tsx`.

**Wrong:** the conclusion that Petal is missing the six brains. It isn't. I audited the pipeline. Petal already has a Product Architect (`prd-model.server.ts` + a 699-line deterministic PRD engine), a UI Director (`design-director.server.ts`, 534 lines), a pre-emit reasoning loop with tools (`agent-loop.server.ts`, 5 rounds, 14 tool calls), a Builder, a Critic (`critic-agent.server.ts`), a spec-adherence checker (`prd/prd-acceptance.server.ts`), and a full Playwright Browser Agent (`builder/src/verify.ts`, 787 lines — it navigates routes, fills signup forms, clicks submit, reads console errors, screenshots, and a vision model scores the shots in `visual-qa.server.ts`).

So Petal is not an LLM-powered code generator. It is already a multi-agent system. The apps are still mediocre. That means adding a seventh brain will not fix it, and "Build Petal's Agent Operating System" as a project would land another orchestration layer on top of three that already exist (`staged-orchestrator`, `agent-loop`, `pipeline/tier-*`). That is the actual risk in front of us.

## What's actually broken

Four things, all structural, none of them "a missing agent."

**1. The loop is open at the only place that matters.** The Browser Agent runs *after* deploy, in the builder service — not inside the turn. When it finds a real defect, `api/public/builds/callback.ts:190` marks the build **failed**, refunds the credit, keeps the old preview, and stops. A human has to read a pink card and click "ask Petal to fix it." There is no code path anywhere in the repo that turns a verification defect into a repair turn automatically. Petal can see that the app is broken and does nothing about it. That single fact explains most of what you're feeling.

**2. Judgement is delegated to regex exactly where semantics are required.** `preemit-gate.server.ts:106` decides whether a defect blocks the build by asking *which tool produced it* (`source === "esbuild"`), not how bad it is. `write-gate.server.ts:85` fails **open** — if esbuild isn't available it accepts every write. "Is this app actually functional" is a static function (`product-acceptance.server.ts`, 99 lines). Visual defects are explicitly parked "for a later polish pass" that never runs.

**3. Model spend is inverted.** The expensive model writes code. The cheap models do the thinking: a "tiny memory writer," a budget-tier Critic, `gemini-2.5-flash-lite` for autofix. Code-writing is the most commoditised thing a model does; taste and judgement are where a better model actually shows up. We are paying for the wrong half.

**4. 6-9 sequential model calls per turn, zero parallelism.** Every gate waits on the previous one. This is why builds feel slow, and slow turns are what make users abandon mid-flow.

## Where I'd push back harder

- **More agents = more cost per turn, on every turn.** You have a credit economy. Six brains on a one-line CSS edit is a business problem, not just a latency one. Any new stage must be conditional on turn class.
- **Bolt's real edge is the free iteration loop**, not agent count: the model gets a filesystem and terminal and can try, fail, and retry before anyone sees it. Petal's equivalent exists but sits behind a deploy. Moving verification *before* deploy is worth more than three new agents.
- **Replit's parallel agents solve greenfield decomposition.** Most of Petal's traffic is iterative edits on an existing app, where parallelism buys little and risks conflicting writes.
- **98.5% build success isn't a vanity metric — it's a ceiling you already hit.** The next metric is harder and you can't fake it: does the app do what was asked.

## The plan

Five workstreams, strictly ordered by leverage. Each is independently shippable.

### W1 — Close the loop (highest impact by a wide margin)
Move browser verification in front of the deploy gate and make a defect trigger a repair, not a pink card.
- Run the Playwright plan against the local built preview inside the builder, before Cloudflare deploy.
- On blocking defects: feed the defect list + the implicated files back into a bounded repair generation (2 rounds max, reusing the existing post-stream autofix machinery), then **re-verify**. Only surface to the user if repair fails twice.
- Non-blocking visual defects: queue them as a real polish pass, not a comment.

### W2 — Replace proxy judgement with real judgement
- `preemit-gate` blocks on *severity*, decided by a classifier, not on which tool emitted the finding.
- `write-gate` fails **closed** when esbuild is unavailable.
- Promote "spec adherence" from a static function to a model call that receives the PRD acceptance criteria plus the actual rendered routes and console state, and answers per criterion: met / not met / can't tell.

### W3 — Invert the model spend
Route the good model to Critic, spec-adherence and design review; route a cheap model to codemods and autofix. Net cost should be roughly flat.

### W4 — Persist architecture, not just facts
PRD stores surfaces and criteria; project memory stores 30 flat facts. Neither stores the route graph, data model, or component tree — so every turn re-derives structure from source and drifts. Persist a compact architecture document per project, updated on each successful turn, and feed it to the planner.

### W5 — Measure what you claimed you'd measure
A nightly benchmark of ~15 fixed prompts scored on: build completion, functional correctness (browser agent), spec adherence (PRD criteria met), visual quality (vision score), regression safety (previously-passing criteria still pass). Without this every subsequent change is a guess.

## Technical notes

- No new orchestrator. W1 rewires `builder/src/server.ts` + `api/public/builds/callback.ts` and reuses `runPostStreamAutofix` and the existing 3-round bounded loop.
- Verification currently runs against the deployed URL; running it against the local preview removes the 52x edge-noise handling that exists purely to work around deploy timing.
- Repair rounds must remain cost-capped via `turn-cost-ceiling.server.ts` and must not charge the user — a fix for Petal's own defect is Petal's cost.
- W5 needs a fixture project set and a scoring table; it does not touch the production path.

## Suggested order

W1 alone. Ship it, measure with W5's harness, then W2. W3 and W4 after we can see whether they moved the number.
