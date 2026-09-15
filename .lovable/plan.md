# Stabilise Petal: fewer moving parts, no timeouts, no half-built apps

## Where things stand (verified today)

Today's live test build of "Trailhead" exposed four separate problems. Three are fixed in the code already; one is only partly proven:

1. Blank sign-in/sign-up pages — a screen imported a component by a name the file never published. Fixed (the missing name is now published automatically) and covered by a test.
2. An app that shipped with only its landing page — the builder left notes saying "auth routes will be added here" and stopped. Fixed: those notes are now detected and the missing screens get written and wired up.
3. Publishing failed because the hosting edge briefly answered with an error while the deploy was still spreading. Fixed: Petal now re-checks a few times before declaring failure.
4. Not yet proven end-to-end: the run that would have confirmed all three together was still finishing when this plan was written. The first thing this plan does is finish that proof.

## Why a new bug appears on almost every build

Not over-engineering in the sense of "too ambitious" — the real cause is that safety checks were added one incident at a time, each as its own pass, with no shared owner:

- The build pipeline is one 6,500-line file that pulls in 33 separate helper steps, out of 229 server modules.
- Several of those steps overlap: more than one thing repairs imports, more than one thing rewrites screens, more than one thing decides whether a build is "good enough". When two passes disagree, the later one silently undoes the earlier one — that is the "disconnect" you are seeing.
- Each pass fails open on its own, so nothing ever reports "these two just fought each other".
- Checks run on the code, but only one late check runs on the finished, rendered app — so a build can be green and still be missing two-thirds of what the user asked for.

## The plan

**1. Close out today's run.** Re-run the Trailhead build and confirm landing page, sign up, sign in and dashboard all render on the published URL with no errors. Any new failure gets root-caused before anything else starts.

**2. Map every repair pass, then merge the duplicates.** Produce one ordered list of every check and repair the pipeline runs, what each one touches, and which ones overlap. Merge overlapping passes into a single owner per concern (imports, exports, styles, routing/screens, quality). Delete passes that are fully superseded. Nothing that is the sole guard against a real past incident gets removed.

**3. Make passes visible instead of silent.** Every pass records what it changed on the build record. When two passes touch the same file in one turn, that gets logged. This turns "mysterious disconnect" into something we can read after any bad build.

**4. Remove timeouts as a user-visible failure.** Go through every deadline in the build path — model calls, the builder, publishing, the browser check — and raise them so a slow-but-working build finishes instead of dying. Where a hard platform limit exists, replace "give up" with "keep waiting and report progress", and keep retrying transient hosting errors rather than failing the build.

**5. Add one completeness check before shipping.** Before a build is published, confirm that every screen the user asked for actually exists, is routed, and renders something real. If not, Petal finishes it rather than shipping a fraction of the product.

**6. Prove it with real builds.** Run five different app types end to end on the ikemadu account (landing+auth+dashboard, a marketplace, a booking app, a dashboard-only tool, a mobile app). Fix every failure found. Repeat until five consecutive builds publish clean.

## Technical notes

- Inventory target: `src/routes/api/generate.ts` (33 dynamic imports), `src/server/repair-all.server.ts`, and the `src/server/design/*` gates. Consolidation happens behind the existing call sites, so behaviour is preserved while the duplicates collapse.
- Known overlap candidates to review together: `import-resolver`, `bare-import-resolver`, `import-syntax-fixer`, `strip-hallucinated-imports`, `export-shape-fixer`; and the quality gates `generation-quality-gate`, `preemit-gate`, `page-completion`, `unwritten-routes`.
- Timeout sites: `ai-provider.server.ts` tiers (120s non-stream / 900s stream), builder run/quiet windows, `deploy-verify.server.ts` probe, and the browser verification step.
- All gates keep their fail-open behaviour; none may block a turn.
- No billing, pricing, or credit changes. No redesign of Petal's own UI.

## Out of scope

Rewriting the builder or deployment stack, changing pricing, and any change that makes a gate able to block a build outright.
