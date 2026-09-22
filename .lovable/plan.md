# Make small changes finish fast

You're right. Today almost every request — even "add a back arrow to the login page" — goes through the same heavy finishing routine as a brand-new app: rebuild, open a real browser, walk pages at three screen sizes, take screenshots, have a second model grade the design, sometimes sign up a test user and run form flows, and occasionally start a quiet touch-up round on top of that. That's why a ten-second change takes a minute.

The compile-and-safety checks are cheap (milliseconds). The expensive parts are the browser pass, the design grading, the test-account flows, and any follow-up polish round. Those should be reserved for work that can actually break the app's look or behaviour.

## What changes

**1. Size the finishing pass to the change**

- Tiny change (a button, a label, a colour, a link, one small file): rebuild and load only the page that changed, once, at one size. Check only for real breakage — page errors, a blank screen, a broken image. No screenshot grading, no test sign-up, no form flows.
- Normal change (a section, a component used by a couple of pages): visit the affected pages, capture phone and desktop, grade only if something looks off structurally.
- Big change (new page, layout/theme/global files, many files, first build, publishing): the full pass exactly as it is today.

**2. Stop cosmetic notes from triggering extra work on tiny changes**

Design-taste notes ("this heading could be larger") will no longer start another build round on a small edit. They are collected and applied on the next substantial change or before publishing, so the user's small request finishes when it's done.

**3. Never skip the cheap safety net**

Type checking, compile checks, and the instant repair passes stay on for every change — they cost milliseconds and catch the failures that actually matter.

**4. Always full quality before shipping**

Publishing, the first build, and any change to global styling/layout still get the complete review. Quality at the moment it counts, speed in between.

**5. Honest waiting**

The live card will reflect the shorter path instead of implying a full review is running.

## Technical notes

- Reuse `edit-classifier.server.ts` output (micro / targeted / structural) as an input to `computeVerifyScope` in `src/server/verify-scope.server.ts`; add a `micro` tier: single route, single width `[1440]` (or `[390]` on mobile targets), `skipFlows: true`, and a new `skipVisualScoring: true`.
- `buildVerifyPlan` (`verify-plan.server.ts`) honours the new tier: omit `plan.auth` sign-up pass and `plan.flows` for micro, cap `plan.visual.routes` to one.
- `src/routes/api/public/builds/callback.ts`: skip `scoreVisualQA` when the plan was micro; keep hard defect detection (page errors, blank route, broken images). Park craft notes on the project for the next non-micro turn instead of opening a repair round.
- Keep esbuild, local verifier, autofix, and the TypeScript gate unchanged on every path.
- Record the chosen tier and its reason on the build (already supported by `plan.scope`) so timings can be compared per tier.
- Tests: scope-selection unit tests per tier, plus a callback test asserting no vision call and no repair round on a micro build.

## Expected effect

Tiny edits drop from roughly a minute to the rebuild-and-deploy floor (a few seconds plus deploy), with no loss of protection on the changes that can genuinely break an app.
