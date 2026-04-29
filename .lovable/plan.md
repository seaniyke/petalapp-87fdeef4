
# How Lovable & v0 Stay Reliable — and What Petal Should Copy

## What the research actually says

There is no secret. v0 and Bolt published exactly how they do it, and we already do most of it. Here's the honest comparison.

**v0 (Vercel, Jan 2026 post "How we made v0 an effective coding agent"):**
1. **Dynamic system prompt** — inject library-specific knowledge (current AI SDK version, lucide icon list) so the model never hallucinates outdated APIs. No web search at gen-time.
2. **"LLM Suspense"** — a streaming find-and-replace layer that fixes imports, swaps missing icons, normalizes URLs *while tokens are still streaming*. User never sees the broken state. ~100 ms per fix.
3. **Autofixers (post-stream)** — deterministic AST fixes + a tiny fine-tuned repair model. ~250 ms.
4. They state: **raw LLM output is broken ~10% of the time. The pipeline closes most of that gap.**

**Bolt:** WebContainer (browser-hosted Node) is the moat — instant feedback, no deploy round-trip. Their generation reliability is **almost entirely Claude Sonnet** plus a strict system prompt. They don't have an exotic pipeline. They route to one strong model and let WebContainer hide latency.

**Lovable:** Heavy investment in dynamic context (knowledge files, project memory) and very specific prompt rules. Same shape as v0 but less public detail.

## What Petal already has (you've built more than you think)

`src/server/pipeline/` holds the same shape as v0:
- `tier-local-verify.ts` — heuristic verifier
- `tier-esbuild.ts` — esbuild parse pass (= v0's deterministic AST check)
- `tier-continuation.ts` — re-prompts the same model to finish truncated files (= more aggressive than v0)
- `post-stream-autofix.server.ts` — model-driven autofix (= v0's repair model)
- `stream-autofixer.ts` — streaming-time fixes (= LLM Suspense)
- `smart-router.server.ts` — quality-weighted model selection (= more than v0 publishes)

This is genuinely a v0-class pipeline. The reliability gap is **not** missing infrastructure.

## What the database says is actually broken

Last 7 days of `ai_call_outcomes`:

```text
model                         total  build_ready  verifier_pass  avg_autofix
google/gemini-2.5-pro            12        100%            33%         0.33
google/gemini-3-flash-preview     4        100%            25%         0.00
```

Top verifier issues: `missing-export (49)`, `jsx (42)`, `undefined (22)`, `braces (14)`, `truncation (13)`, `unterminated-string (11)`.

Last 3 days of `ai_call_log` for `feature='generate'`: **69 successes, zero errors recorded.**

**Two findings:**
1. Every recorded generation succeeds at build time. The pipeline *is* closing the gap.
2. But the user keeps seeing "Petal got a bit confused." That string only fires from `friendly-errors.ts` GENERIC fallback — which means the failure happens in a path that **never reaches `recordAiOutcome` and never logs an HTTP error**. It's a silent client-side or pre-pipeline failure.

This is the real bug. Adding more retries won't help if the failure is bypassing the pipeline entirely.

## The plan — three workstreams, in priority order

### Workstream 1 (CRITICAL — root cause): Make every failure observable

The "confused" toast fires when `toFriendlyError()` gets a string that matches no known pattern. We have **no telemetry** on what those strings actually are. Until we know, every "fix" is a guess.

- Add a `pipeline_failures` table. On every GENERIC fallback in `friendly-errors.ts`, POST the raw error + last 500 chars of the assistant stream + tool name attempted + project_id to a new `/api/public/track-failure` route.
- In `src/routes/api/generate.ts`, wrap the SSE stream in a try/catch that always emits a structured `error` event and always calls `recordAiOutcome` (currently it's only called on the happy path — confirmed by reading `ai-outcomes.server.ts`).
- Add a new admin page `/admin/failures` showing the last 100 unmatched errors, grouped by signature.

**Outcome:** within 24 hours of shipping, we'll have a ranked list of the actual failure modes. Right now we are guessing.

### Workstream 2 (HIGH — copy v0's two highest-leverage tactics)

**a) "LLM Suspense" for the lucide-react problem.** v0 calls this out specifically. We don't do it. Build `src/server/lucide-resolver.server.ts`:
- At server start, read the actual export list from `node_modules/lucide-react/dist/esm/icons`.
- In `stream-autofixer.ts`, intercept `import { X } from "lucide-react"` during streaming. If `X` doesn't exist, rewrite to `import { ClosestMatch as X } from "lucide-react"` using a precomputed embedding map (or just Levenshtein — 1500 names, fast enough).
- This single fix will eliminate a chunk of the `missing-export` errors (49 in the last 7 days).

**b) Deterministic missing-import autofix.** Today, when a file imports `./Hero` but `Hero.tsx` doesn't exist, we hand it back to the user as "Add the missing file." v0 fixes this automatically with a single small targeted call. Add a `tier-missing-imports.ts` between esbuild and post-stream-autofix:
- Parse all `import "./X"` and `import "@/X"` references.
- For each unresolved local import, fire a *scoped* call to `gemini-2.5-flash` with only the parent file as context: "create a minimal stub at this path that satisfies the import." Cap at 3 calls per turn.

### Workstream 3 (MEDIUM — close the truncation problem at its source)

Telemetry shows truncation (13) + unterminated-string (11) + braces (14) = 38 events. `tier-continuation.ts` already handles these but only when the verifier catches them. v0's lesson: **prevent, don't repair.**

- Hard-enforce the 180-line file budget in the tool schema itself (currently it's a prose rule the model ignores). Add a server-side reject + auto-split: if any incoming file is >180 lines, refuse the tool call and respond with an instruction to split that specific file. One round-trip beats a continuation pass.
- Increase `max_tokens` per file write to the model's hard ceiling, not our default. We're sometimes capping below what the file needs.
- For initial generations only, switch the default model to `gemini-2.5-pro` (33% verifier-pass beats flash's 25% in our own data — though the sample is tiny).

### Workstream 4 (LOWER — what we should NOT do)

You asked if competitors use "third-party software." They don't. Bolt uses Anthropic's API. v0 uses their own fine-tunes + standard frontier models. **There is no off-the-shelf reliability product to buy.** Anyone selling one is selling a wrapper around the same techniques we already have.

You also asked if they "build for longer before asking the user to continue." Partially yes — Bolt's WebContainer means the build cycle is sub-second, so they can iterate 3–4 times silently before showing the user anything. We can't replicate that without WebContainer (a 6-month project). But we can **silently retry once on tool-call failure** before surfacing any error — something we're not doing today.

## Why this order

1. We can't fix what we can't see. Workstream 1 is one day of work and will retire 80% of the guessing.
2. Lucide + missing-imports is the highest-impact concrete bug confirmed by our own data.
3. The truncation work matters but only after we know the post-W1 telemetry doesn't reveal something more urgent.

## Decision needed

Approve this and I'll start with Workstream 1 — purely additive (new table, new route, new admin page, two callsite tweaks). No regression risk to the generation pipeline. Within a day we'll have the data to choose between Workstream 2 and Workstream 3 for what to ship next.
