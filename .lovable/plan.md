# Frontend audit of Petal — findings first, no changes

Your document asks for a complete frontend engineering audit and explicitly says: do not implement fixes yet. This plan is how I'll produce that audit, and what I'll deliberately leave out of it.

## What I'll cover (and what I'm dropping from the brief)

The brief lists 22 parts with heavy overlap. I'm collapsing it into six areas that actually produce different findings, and cutting the parts that would just restate each other:

1. **Inventory and architecture** — every page, shared component, layout, sheet, form, and the routing/data/state model behind them. Each item labelled: production-ready, incomplete, visual-only, duplicated, fragile, or obsolete.
2. **Design system reality check** — whether colour, type, spacing, radius, elevation and the component library are genuinely systemised, or whether pages invent their own. Measured from the actual stylesheet and usage counts, not by eye.
3. **The running app at four sizes** — mobile, tablet, desktop, large desktop, driven in a real browser with screenshots: overflow, broken grids, touch targets, navigation, modals, tables.
4. **Interaction, states and accessibility** — hover/focus/disabled/loading/empty/error states, keyboard navigation, focus trapping in dialogs, labels, contrast, heading order. Severity-classified, evidence attached.
5. **Performance and frontend↔backend boundaries** — bundle and route splitting, the heaviest screens, and for each major feature whether loading, error, empty, expired-session and duplicate-submit cases are actually handled.
6. **Petal's ability to produce modern frontends** — the generation and editing pipeline judged on the question your document singles out: can Petal prove the change the user asked for is really in the running app, not just that it compiled.

**Dropped as noise:** separate sections for "modern UI quality" and "visual quality" (folded into area 3), and the 20-row scorecard is compressed to the six areas plus a short blocker list — a 20-row grid of RED/YELLOW invites inflated, unevidenced scores, which the brief itself warns against.

## How the findings get graded

Every finding carries evidence (a file, a count, a screenshot, or a browser observation) and a confidence level. Anything I couldn't verify is marked unverified rather than asserted. No claim without a check behind it.

## What you get

One report written for you, not for an engineer, ending in three lists:

- **Fix now** — only what materially stops Petal producing reliable, modern frontends.
- **Build next** — real improvements that aren't blockers.
- **Later** — nice-to-haves that shouldn't distract from reliability.

Plus an explicit **do not touch** list: the parts that already work and would only be made worse by rewriting.

## Early signals (already checked)

- 53 routes, 81 components plus 46 library primitives — a large surface, so the audit is sampled by weight, not evenly.
- Hardcoded colours appear in only 7 files, which is a good sign for theming discipline; I'll confirm those 7 are deliberate.
- The builder screen is 5,675 lines in a single file, and three admin screens exceed 1,000 — a fragility signal worth grading carefully.

## Notes

No application files change during this work. The only output is the report. The live pass runs against the local preview with Playwright and stores screenshots outside the project.
