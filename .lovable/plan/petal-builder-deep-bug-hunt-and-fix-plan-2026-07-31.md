# Petal Builder — Deep Bug Hunt and Fix Plan

Four parallel audits covered the generation/repair pipeline, credits and billing enforcement, the builder UI and preview runtime, and the publish/API surface. Every item below was confirmed by reading the code; file and line references are included in the technical section.

## What was found

**23 confirmed defects.** Grouped by how badly they hurt a user compared with what competitors ship.

### Tier 1 — Security and money (fix first)

1. **Anyone can edit or delete other users' data in shared-tier apps.** In generated apps on the free shared backend, update and delete requests skip the ownership filter entirely when the caller sends no login token. The app's public key is embedded in every generated app's browser code, so anyone can wipe any record belonging to any other end user. This is the single most serious finding.
2. **Shared-tier list reads return everybody's rows.** Unless the generated code opts into "mine only", listing a collection returns every user's records — a silent privacy leak in every multi-user app Petal ships.
3. **Voice transcription is free forever.** The endpoint checks the balance but never charges it. One credit in the wallet buys unlimited transcription.
4. **A failed final charge still delivers the build.** If the post-build charge fails, Petal logs a warning and ships the files anyway. Combined with a pre-flight check that only reserves a small floor, several builds started at once against a near-empty wallet can all complete while at most one pays.
5. **Comments contradict the shipped billing policy.** Two comment blocks still say auto-fix turns are "on Petal's tab", but the code correctly charges them (as you required). The comments are stale and will mislead the next fix.
6. **A refund can silently fail.** For discuss, coach, and image generation, Petal debits first and refunds on failure — but a failed refund is only logged. The user loses a credit with no visible error and no reconciliation.
7. **Public forms are unauthenticated and unthrottled.** Tip and investor-pledge endpoints accept arbitrary name, email and amount with no rate limit, writing straight into tables that hold personal data. The waitlist lookup also lets anyone test whether an email has been approved.
8. **Cron secrets are compared with plain string equality** instead of the constant-time comparison used elsewhere in the same codebase.

### Tier 2 — Builds that break or get stuck

9. **The preview never recovers from a failed boot.** The "already booted" flag is set before the install actually runs, so once install or dev-server startup fails, every later turn skips the retry path. The preview stays on the error screen forever, and the Reload button only remounts the frame — it cannot recover. This is the most visible day-to-day quality gap versus competitors.
10. **The dependency cache can serve stale packages.** Petal only checks that a package folder exists, never its version. Bumping a dependency, or a project pinning different versions than the prewarm baseline, silently keeps the old version running.
11. **Builds can be stuck as "running" forever.** If the build service accepts a job and then loses it, only a browser-side timer un-sticks it. Close the tab and the build stays pending permanently — there is no server-side sweep.
12. **Duplicate build retries.** The watchdog reads the retry count then writes it back; two overlapping calls both fire a retry and both bypass the retry cap.

### Tier 3 — Repair passes that corrupt or under-fix code

13. **The render-wrapper repair can truncate valid code.** Its pattern stops at the first closing bracket, so any root render with an inline callback in a prop gets mangled.
14. **The App-wrapper repair can wrap the wrong function** — it matches the first return statement in the file, which may belong to a helper or a list item, so the router fix silently does nothing while reporting success.
15. **A router mention inside a comment suppresses a real fix.** Provider detection scans raw text without stripping comments and strings.
16. **Router imports get injected because of prose.** Same raw-text problem: an example inside a comment or string triggers a needless import.
17. **One bad section header silences the rest of the file.** The blank-band repair stops after the first object it cannot parse, leaving every later gap unfixed in that file.
18. **An icon-rename pass runs before the logo swap** and renames one of the very placeholder glyphs the logo pass looks for, so some apps still ship with no brand mark.
19. **Removing an icon import can crash the app.** The logo pass only checks for the icon in markup, so an icon also passed as a plain value loses its import and throws at runtime.
20. **The CSS repair rewrites escape sequences everywhere**, including inside comments and quoted content values, where it can move a brace and change meaning.
21. **Bad version pins are never healed** once they look like real versions.

### Tier 4 — UI correctness

22. **Switching projects mid-build corrupts the new project's UI.** The old turn's cleanup runs unconditionally, killing the new project's spinner and streaming text. Per-turn progress state also isn't cleared on switch.
23. **The credit reset countdown always says "soon"** because a date-only column is treated as a future timestamp. Also: two file-streaming imports have no error handler, and the console warning you're seeing (`RESET_BLANK_CHECK`) comes from a stale cached preview script, not from current code — it needs a live capture to confirm and then a version stamp on the injected runtime.

## Fix plan

**Phase 1 — Security and money.** Require an owner scope on shared-tier update and delete, and default list reads to owner-scoped unless a collection is explicitly marked public; add a migration-safe rollout so existing apps don't break. Wire the real charge into transcription. Make build delivery conditional on a successful charge (with a clear out-of-credits result instead of a silent free build), and move the pre-flight to reserve the estimated amount rather than a token floor. Record failed refunds to a reconciliation table instead of only logging. Add per-IP throttling and honeypot validation to the public tip, pledge, and waitlist endpoints, and make the waitlist lookup non-enumerable. Switch cron secret comparison to constant-time. Correct the stale billing comments.

**Phase 2 — Build reliability.** Only mark the preview as booted after a successful boot, reset the flag on failure, and make Reload perform a real re-boot. Version-aware dependency caching keyed on a hash of the dependency manifest. Add a server-side sweep for builds stuck pending, and make the retry counter increment atomically in the database.

**Phase 3 — Repair-pass correctness.** Replace the two bracket-counting-by-regex passes with the balanced-brace walker already used elsewhere in the pipeline, and route all detection scans through the existing comment/string stripper. Make the section-header pass skip a bad occurrence instead of aborting the file. Move the logo pass ahead of the icon-rename pass, or exclude the placeholder glyph names from renaming. Check general identifier usage before removing an icon import. Scope the CSS escape fix to declaration values outside comments and quoted content. Add fixtures so each pass is proven idempotent.

**Phase 4 — UI correctness.** Tag each turn with its project and ignore completion callbacks from a stale project; clear per-turn progress state on project switch. Fix both reset countdowns. Add error handlers to the streaming imports and stamp a version on the injected preview runtime so stale scripts are detectable.

## Technical notes

Key locations: `src/routes/api/public/shared/$.ts:114-149` and `src/server/shared-backend.server.ts:226-313` (ownership bypass); `src/routes/api/transcribe.ts:43-44` (uncharged); `src/routes/api/generate.ts:1393-1408` and `3796-3910` (pre-flight vs final charge, stale comments at `3748-3757`); `src/server/credits.server.ts` (`refundCredit` swallow); `src/components/WebContainerPreview.tsx:120-200` (boot flag); `src/lib/webcontainer.ts:492-542` (cache check); `src/routes/api/builds/watchdog.ts:118-124` (non-atomic retry); `src/server/router-provider.server.ts:64-81,109,162`; `src/server/router-imports.server.ts:69-74`; `src/server/block-props.server.ts:151-155`; `src/server/brand-identity.server.ts:26-37,160-177` with `src/server/bare-import-resolver.server.ts:146-160`; `src/server/css-escape-fixer.server.ts:31-40`; `src/routes/builder.tsx:1262-1267,2470-2484`; `src/components/BillingSheet.tsx:252-268`.

The database layer itself is sound: `spend_credit` takes a row lock and re-validates inside it, and `refund_credit` is idempotent per ledger entry. Ownership checks and input validation on publish, build trigger, backend, subdomain, domains and visitors are correct, and the build and payment webhooks verify signatures properly. The problems are in the layers around them.

Phases are independent and can be approved individually or run in order.
