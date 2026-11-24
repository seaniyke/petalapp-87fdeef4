# Request-led scope and automatic routine-page scheduling

## Implemented

- Keyword families no longer inject pages, data entities or workflows into the required intent contract. Explicit named pages and necessary public/app surface entry points are required. Vague briefs may receive optional domain examples; explicitly scoped briefs receive no family page suggestions.
- Legitimate cross-domain pages are no longer discarded simply because they fall outside one family. Catalogues/product lists are not automatically treated as online shops. Unrequested shop/cart/checkout drift still has its existing check, and explicitly requested commerce remains allowed.
- Exclusion spans are removed before intent-family classification as well as requirement extraction.
- First-build scope is re-derived before generation. Resume reconciles old checkpoint file identities with the current request-derived plan instead of restoring obsolete template-required pages. Existing validated source is not deleted.
- The existing conversation automatically reserves recognised informational pages and explicitly read-only list pages. After authored shared dependencies validate at their current content, it schedules one page-scoped Flash step; Argon reviews before the next handoff and retains final completion ownership. It is no longer dependent on Argon voluntarily calling the handoff tool.
- A frontier response that tries to write a reserved page is deferred to that fast step, not accepted as a frontier page write. Already-authored pages are not rewritten to manufacture cheap-model activity.
- Complex or uncertain pages remain on Argon. A missing shared-dependency proof, failed fast write, no-write reply or attempt to overwrite shared files returns ownership to Argon. These are model-routing decisions, never user-feature bans.
- Pricing, images, data/privacy rules, final verification, revision-guarded commits and normal edit routing are unchanged. Prediction, durable call records and settlement continue using each call's actual selected model.

## Verification

- **2,221 tests passed across 243 files**, including 18 new cross-domain and automatic scheduling regressions.
- Tests include hotel stock, school/cafeteria, event/logistics and real-estate/CRM scopes; excluded commerce; requested commerce; checkpoint plan reconciliation; stale dependency proof; a frontier bulk-write response with no delegation; frontier → Flash → frontier for each routine page; failed/no-write/shared-write escalation; and no-proof fallback without losing requested pages.
- The automatic compilation/typecheck reports `build OK`.
- Agent bundle rebuilt: `2026-11-24-request-scope-auto-secondary`.
- SHA-256: `70df490885f8023fdc48d89bbfac5cade2c6ffa7a92f55760392ca542a84d14b` (7,733,765 bytes).
- Production health still reports the preceding version, `2026-11-24-secondary-work-exclusions`, hash `531d5e19b5b48b62bad300be026ac3296ca1f067a79b1166579c68f91e6d17c9`. This new version has not been deployed or exercised through the production generation endpoint.

## What this does not prove

Tests prove deterministic scope and scheduling behaviour; they do not establish a measured production cost reduction, flawless AI output, or guaranteed margins. The previous complex run cost $6.97 initially and $0.94 for its edit. Its initial cost was approximately 24% higher than the historical $5.62 first build; that remains the measured evidence, not a savings result.

Automatic routing is intentionally selective: requested CRUD, booking, payments and complex workflows do not become read-only just to save money. A request without provably routine secondary work may remain entirely on Argon. A model could still spend tokens attempting a deferred write; the execution-phase instruction should avoid that, but real call telemetry must confirm it.

Removing forced template requirements is not proof that a model can never invent an optional page. Nor does one successful benchmark establish 100% reliability.

## Production acceptance

1. Deploy the committed builder via the existing idle-gated workflow and publish the app-side changes. Confirm both the exact new version and hash before validation.
2. Use isolated projects with a matched complex brief, explicit page list, fixed style/assets and the same integrations. Include informational/read-only secondary work and fully interactive core workflows. Follow with the same site-wide layout edit used for the baseline.
3. Verify delivered workflows with real saved input and readback, sign-in where required, and phone/desktop layout. Check that excluded modules did not appear and requested features did not disappear.
4. Read durable per-call totals for setup, writing, review, provider retries and repairs. Count actual fast-model page writes, frontier escalations and automatic repair attempts separately.
5. Report sample size, cost basis, total cost, elapsed time, delivery/verification rates and repair outcomes. Savings = `(matched baseline cost − new cost) / matched baseline cost × 100`. A negative percentage means increased cost. Without a matched baseline, report the observed costs without attributing a percentage to this change.

Deployment and measured production savings remain pending.
## Live validation (24 Nov 2026, builder 2026-11-24-request-scope-auto-secondary)

Project `6413e415-815d-42cf-8062-e182c9015a2c`, first turn `288e893e-808d-41d6-8a44-158fa39b9a31`, edit turn `bc879c6c-debb-4a42-8be9-63e4179f0a76`.

- First build: 9 pages, exactly the 8 named + Home; no suppliers/purchase orders/stock/settings. 8 AI calls, estimated $4.51 (vs $6.97 previous test, -35%; vs Shiftwell $5.62, -20%). 0 retries, 0 recovery calls. Automatic handoff fired twice (Facilities, About on Flash). Flash calls carried 80k–99k prompt tokens with 0 cached tokens. 0 pictures generated although Facilities asked for real pictures. App title in index.html said "Shiftwell Internal Shop".
- Site-wide layout edit: failed, nothing changed, not charged, $0.43 internal cost. Commit rejected `write src/styles.css` with reason "other" (most likely ledger `unread_write`: the stylesheet was never read into the edit context because the structural edit resolved an empty target scope). The saved chat reply wrongly blamed the build server and still says "Kimble".
