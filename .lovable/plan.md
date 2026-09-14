# Petal Test Lab — build it, then prove it works

## What I found first (audit)

Petal already does more of this than the brief assumes. Nothing needs rebuilding.

Already in place:
- A real headless browser runs on every build (in the existing build service), loads each page, signs up a throwaway test account, runs a write flow, and captures phone (390px) and desktop (1440px) screenshots.
- Those screenshots are reviewed by an AI reviewer that only reports provable defects (overlap, clipped text, blank hero, unreadable contrast).
- The live app is re-checked over the internet after publishing, and a broken deploy never replaces the last working preview.
- The database is probed for real: every table the generated code touches is queried through the live API and classified as missing / blocked / fine.
- There is a working tool-using agent (list, read, search, run script, run check, install, run tests) and a bounded repair loop (3 attempts) with a completion state machine.

The real gaps:
1. The browser runs a **fixed script**. The AI cannot look at a page and decide the next click, so anything not predicted in advance is untested.
2. Test results are not kept as structured evidence — findings collapse into defect strings, so nothing can be shown, compared, or re-tested later.
3. There is no distinction between "tested and passed" and "could not be tested". A build can be called ready on thin evidence.
4. Nothing is retested after a repair, so a fix can silently break something that used to work.
5. Hard clocks everywhere: a run is abandoned after ~22 minutes, browser checks after 8, a tool command after 60 seconds, and background sweepers kill anything older than 15–20 minutes — even while it is actively working.

## How runs stop being cut off

You said it must never stop while it is working. The rule I will implement: **a run is only stopped when it stops producing progress.**

Every stage writes a heartbeat with a short line of what it is doing. As long as heartbeats keep arriving, the run continues with no upper limit. If heartbeats stop for a set quiet period (the process died or hung), the run is marked stalled and recovered. You or the user can always stop a run on purpose.

This covers the failure the old clock was protecting against, without ever punishing a run that is genuinely still working.

## Phases

**1 — Never cut while working.** Replace fixed clocks with progress heartbeats across the build service, the sweepers, the watchdog and the progress UI. Long runs survive closed tabs and reconnect to live progress.

**2 — Steerable browser.** Reuse the browser already installed in the build service and expose it as a controllable session: go to page, click, type, choose, press, scroll, wait, read visible text, read page structure, read the accessibility tree, read console errors, read network calls, screenshot. The AI drives it step by step instead of following a fixed script.

**3 — Tests inferred per app.** Extend the existing planner so the test plan comes from the app that was actually built — its pages, forms, database tables and sign-in setup. A booking app gets booking tests; a shop gets cart and checkout tests. Tests are ranked P0 (app loads, sign-in, main journey, data saves), P1 (secondary journeys, forms, CRUD, responsive), P2 (edge cases), and P2 is skipped when budget is tight.

**4 — Evidence that is kept.** New records for each test run, each test case and its evidence. Every case carries passed / failed / blocked / skipped, what was expected, what happened, console and network errors, screenshots, database results and duration. **Blocked never counts as passed.**

**5 — Diagnose, fix the smallest thing, retest.** Failures feed the existing repair loop with real evidence attached. After each repair, the failed cases plus every previously passing P0 case are re-run, so a fix cannot quietly break something else. Bounded by the existing 3-attempt budget; stops and explains itself when the problem needs you (missing credentials, dead third-party service, real payment required, CAPTCHA, ambiguous requirement, destructive action).

**6 — A real "ready" gate.** "Your app is ready" stops meaning "it compiled". It will mean: it builds, it starts, critical pages load, sign-in works where applicable, data reads and writes work, no critical visual defects, and previously passing journeys still pass.

**7 — Safety.** Test accounts stay clearly tagged and are cleaned up. Payments, emails and SMS are suppressed during tests. Secrets are redacted from evidence. Tests never touch anything outside the project being tested.

**8 — What people see.** Users get plain-language progress ("Checking sign-up works") and can open the results and screenshots for their own build. A deeper internal view shows the full chain: build → tests → failures → screenshots → diagnosis → repairs → retests → final result.

**9 — Cost.** Cheap deterministic checks run first, then the browser, and only then AI review — on screenshots that already exist. Cheap models classify; stronger models are used only on repeated or visual failures. Every run is recorded in the existing economics records so we can see the true cost per build. No price change; included for everyone for now.

**10 — Test the tester.** A purpose-built sample app with a deliberate visual defect and a deliberate backend defect. Petal must build it, test it, find both, fix both, retest, and only then call it ready. This is the acceptance test for the whole feature.

## Technical notes

- New build-service endpoint for interactive browser sessions, reusing the existing Chromium install, the local preview server for built output, and the same signed-request auth. No new service, no second browser framework.
- Heartbeats: a progress column plus lease on build/turn records; sweepers switch from `started_at` age to `last_progress_at` quiet period; the job clock in the build service becomes an inactivity clock.
- New tables for test runs, cases and evidence, owner-scoped, with screenshots in storage rather than inline.
- The steerable browser is exposed as new agent tools alongside the existing seven, so the current loop, repair budget and completion state machine are reused unchanged.
- Acceptance moves into the existing `recordBuildOutcome` authority — one decision point, now fed by test evidence.
- Existing build endpoint, signed callback, deployment, backend, provider gateway and build UI are untouched.

## Verification after each phase

Type check, the full test suite, then a real end-to-end build through the live pipeline before moving to the next phase.
