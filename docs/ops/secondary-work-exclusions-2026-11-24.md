# Excluded requirements and routine first-build work — 24 November 2026

## Changes

- Requirement extraction removes whole exclusion spans before comma/conjunction splitting. “No bookings, customer accounts or payment processing” no longer contributes those requirements. Explicit positive clauses resume scope. The original user brief remains intact. Existing requirements removal and dependency/evidence rules remain unchanged.
- The existing first-build tool conversation gains `focus_secondary_page`. Argon supplies the page specification and the paths of already validated dependencies; this tool may be bundled with a foundation write instead of adding a separate planning call.
- Deterministic admission requires a planned secondary page, at least one authored shared foundation, and current clean dependency validation. Core pages, shared files, and task specifications mentioning complex behaviour remain on Argon. A refused handoff is not a refused user feature: Argon continues it.
- An admitted informational/read-only-list page gets one Flash step. It may inspect the workspace, but runtime enforcement permits writes only to that selected page. It cannot delete files, hand off more work, or declare the full product finished. Argon then resumes with the same conversation and real validation evidence to review/repair the result. That page cannot repeatedly consume fast handoffs in the same turn.
- Existing syntax, semantic, import, design ownership, readiness and revision-guarded commit checks remain unchanged. Ordinary edit routing, customer pricing and image requirements are unchanged.
- Requests, durable usage records, traces and cost estimates use the selected call's model. The whole-turn safety ceiling stays conservatively frontier-priced; it is not lowered to force cheaper output.

## Verification

- Final full regression suite: **2,203 tests passed across 242 test files**, including 19 new exclusion/routing cases.
- New tests exercise the observed excluded list, booking/checkout under one negation, positive scope resumption, alternative exclusion phrases, real payment requests, no-code/not-only wording, and existing removal semantics.
- Model tests cover Argon/Flash configuration, validated dependency admission, core/complex/shared/stale cases, frontier → fast → frontier in one conversation, per-step predictions and cost accumulation, shared-file protection, failed writes escalating with evidence, no-write steps never implicitly completing, and ordinary edits retaining their current path.
- The app's automatic compilation/typecheck is clean. All content-route head metadata inspected; no UI or content route changed for this request.
- Rebuilt agent package: `2026-11-24-secondary-work-exclusions`, SHA-256 `531d5e19b5b48b62bad300be026ac3296ca1f067a79b1166579c68f91e6d17c9`.
- Production health checked after packaging: still `2026-11-24-proof-led-repairs`, SHA-256 `589909974913dd94abb56a7f6d8818608599080ebfabfbef18900699d6c86abe`. The new behaviour has NOT been verified against a real delivered first build. Scripted integration tests are not production evidence.

## Deployment and percentage validation

1. Deploy through the existing idle-gated **Deploy Petal Builder** workflow, after this commit reaches the repository. Publish Petal for the app-side update. Do not replace the live worker with an old version for benchmarking.
2. Confirm `/agent/healthz` reports the new version AND matching core hash before paid validation. A publish alone does not update the generation worker.
3. Use isolated projects and identical briefs, page counts, explicit style, assets, integration requirements and verification expectations. Capture a baseline before updating if available; otherwise label the missing matched baseline rather than attributing the historical large-app cost to a smaller website.
4. Include a website with routine secondary pages and an application with complex secondary flows. Confirm actual Flash handoff traces where eligible, Argon ownership elsewhere, all requested functions, real saved data where required, and phone/desktop verification. A scripted handoff does not prove the real model will choose it.
5. Compare durable **total recorded cost per equivalent successful task**, including setup, writes, failed/retried work and review. Report basis (ACTUAL/ESTIMATED), sample sizes, delivery rate, recorded verification rate, handoff counts, escalation counts and duration.
6. Report savings as `(baseline cost − new cost) / baseline cost × 100` with a positive measured baseline. A negative result means cost increased. Compare percentage points for pass-rate changes separately from relative cost reduction.

Savings remain **unmeasured**. No 30–50% reduction, 100% reliability or guaranteed profitability is claimed. This is selective handoff support, not an automatic cheap-model substitution for every secondary page; requests with no suitable handoff may stay entirely on Argon.