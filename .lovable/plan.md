# Can Petal build a complete app right now? — verify, then fix

## Short answer

Nothing structural is blocking it. Sign-up is open, the build service answers, and the AI keys are in place. But there is no recent evidence: the last real app build in the database was 24 August, three weeks ago. Zero builds, zero AI calls and zero recorded turns in the last 7 days. So today the honest position is "probably yes, unproven".

The only way to answer properly is to run real builds and watch them, then fix what breaks.

## What the records do show

The last handful of failed builds failed for four concrete reasons, all fixable:

1. A generated app imported an animation package that was never added to its dependencies.
2. Two builds broke on mismatched component props (chart config, layout component) coming from the shipped component kit.
3. One build produced type errors in a notifications page.
4. One deployed app answered with a server error, so Petal correctly kept the previous preview live.

These are the same class of problem: the app is generated, but a final consistency check between what the code imports and what the project actually has lets a few runs through broken.

## Plan

### Step 1 — Run five real end-to-end builds

Drive the live app in a browser as a normal signed-in user and build five apps from plain descriptions, one per common shape:

- marketing site with waitlist capture
- SaaS dashboard with login and a database
- marketplace with listings, detail pages and search
- booking app with a calendar and confirmation email
- mobile app

Each run is scored against a completeness checklist: landing page quality, every navigation link lands on a real page, sign-up and login actually work, data saves and reloads, empty and error states exist, mobile layout holds, page titles and previews set, and the published version matches the preview.

### Step 2 — Report

A single scorecard: what each app got right, what was missing or broken, how long it took, what it cost. No guesses — anything not observed is marked unknown.

### Step 3 — Fix, in priority order

Fix only what the runs actually expose, hardest failures first: missing dependencies, component-kit prop mismatches, unreachable pages, broken auth or saving. Each fix is retested by re-running the prompt that exposed it.

### Step 4 — Re-run and confirm

Repeat the five prompts after the fixes and confirm the checklist passes end to end, including publishing one of them.

## Technical notes

- Verification is done with Playwright against the running app; no production data is touched beyond the test projects created.
- Test runs consume AI credits on the account used.
- Fixes stay inside the generation pipeline (dependency closure, component-kit contracts, verification gates). No architecture change, no UI redesign, no removal of existing functionality.
- Failures found are recorded so the existing completion and economics tracking can be checked at the same time (both tables are currently empty purely because nothing has run since they were added).
