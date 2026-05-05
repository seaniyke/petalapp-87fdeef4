# Plan: Three upgrades to Petal's generation pipeline

Three independent workstreams. Each ships value on its own; together they sharply reduce first-turn failures and the "doesn't look designed / can't edit again" complaints.

---

## A. Force `replace` ops for non-trivial existing files

**Goal:** stop the model from rewriting whole files for tiny edits — the root cause of timeouts, truncated streams, and "AI did not return usable edits".

**Where it lands:** `src/server/generate.server.ts`, `src/routes/api/generate.ts`, system prompt + retry refinement.

**Mechanism:**
1. Add a server-side gate in `applyOps` (and the streaming validator that wraps it): if a `write` op targets an **existing** file whose prior content is > 60 lines AND the new content keeps > 70% of the original verbatim, reject the op with a structured error: `must_use_replace`.
2. The retry loop already exists — feed that error back into the model with the offending path, the prior content, and an explicit instruction: "Re-emit this change as one or more `replace` ops."
3. Tighten the system prompt: replace the soft "prefer replace" wording with a hard rule + concrete examples. New files and full redesigns still use `write`.
4. Telemetry: count `must_use_replace` rejections per turn so we can tune the 60-line / 70% thresholds from `admin.pipeline`.
5. Extend `src/server/__tests__/apply-ops.test.ts` with cases covering the new gate.

**Outcome:** edits to large files (landing pages, dashboards, route files) become surgical by default. Token use per edit turn drops dramatically; idle-timeout failures effectively disappear for edit turns.

---

## B. Expand the block library

**Goal:** give the model a wider vocabulary of pre-shaped, design-consistent blocks so it composes pages instead of inventing layout from scratch each turn.

**Where it lands:** new files under `src/server/scaffold-kit-blocks-3.ts` (and a small refactor of `kit-manifest.server.ts` to register them).

**Block categories to add (priority order):**
1. **Auth blocks** — `SignInCard`, `SignUpCard`, `ForgotPasswordCard`, `OtpVerifyCard`. All pre-wired to Lovable Cloud auth so the model never hand-writes auth wiring again.
2. **Data display** — `EmptyState`, `StatCard`, `KpiGrid`, `ComparisonTable`, `PricingTable`, `ActivityFeed`.
3. **Forms** — `MultiStepWizard`, `FileUploadDropzone`, `OtpInputGroup`, `InlineEditField`.
4. **Dashboard shell** — `SidebarShell` (collapsible nav + topbar + Outlet), `SectionHeader`, `FilterBar`.
5. **Commerce** — `ProductCard`, `CartLineItem`, `CheckoutSummary`, `OrderConfirmation`.

**Ground rules for every block:**
- Single file, ≤ 180 lines (respects `file-budget.server.ts`).
- Uses only existing shadcn/ui primitives + Tailwind tokens — no new deps.
- Theme-token driven (no hardcoded colors) so themes from workstream C apply automatically.
- Documented in the kit manifest with a one-line "use when…" hint the model reads at planning time.

**Outcome:** higher visual quality on first turn, fewer hallucinated layouts, more predictable file shapes (which makes workstream A's `replace` ops succeed more often).

---

## C. Hidden themes + templates system

**Goal:** first-turn output looks intentional and on-brief, without surfacing "we picked template X" to the user.

### C1. Themes (palette + type pairings)

**Where it lands:** `src/server/themes.server.ts` (new), consumed by `design-director.server.ts`.

- Define 6 named themes internally: `editorial`, `saas-cool`, `warm-brand`, `brutalist`, `soft-pastel`, `mono-dark`.
- Each theme is a struct: HSL token map for `--background`, `--foreground`, `--primary`, `--accent`, `--muted`, plus radius scale and a font pairing (heading/body from the existing Google Fonts allow-list).
- Design Director picks one theme based on brief keywords + audience hints already in the triage `meta`. The chosen theme is written into `src/styles.css` as token values; the model never sees the theme name in user-facing copy.
- Override path: if the user states brand colors, those win and the theme becomes a starting point, not a constraint.

### C2. Templates (full app starters)

**Where it lands:** `src/server/templates/` directory, registry in `src/server/templates/index.ts`, integration in `src/server/brief-expander.server.ts`.

- Six starter templates: `saas-landing`, `marketplace`, `dashboard-app`, `blog`, `portfolio`, `mobile-social`.
- Each template = a small set of route files + components + a recommended theme.
- Brief expander scores the user's idea against template descriptors and picks the best match (or `none` → fall through to current behavior).
- Scaffold copies the template files in BEFORE the model's first turn. The model's job becomes: customize copy, swap imagery, adjust accents — not build from zero.
- Strictly invisible: no template name in chat, no "starter" badge, no comments referencing the template in generated code.

**Outcome:** dramatically better first impression, fewer "this looks generic / unfinished" turns, and far less first-turn token spend (which also reduces timeouts).

---

## Sequencing

1. **A first** (smallest blast radius, biggest reliability win) — ~1 turn.
2. **B second** (additive, no risk to existing flows) — ~1–2 turns, can ship categories incrementally.
3. **C last** (touches design director + brief expander, benefits compound on top of A and B) — ~2 turns: themes, then templates.

## Out of scope (intentionally)

- No changes to billing, auth, or wallet logic.
- No user-facing UI for picking themes/templates — strictly internal.
- No new third-party deps.
- KeshPay rules remain ignored per project memory.

## Risks & mitigations

- **Over-aggressive replace gate** could block legitimate large rewrites → tunable thresholds + telemetry from day one.
- **Template mismatch** could feel worse than no template → confidence threshold; fall back to scaffold when score is low.
- **Theme clash with user brand** → user-specified colors always override theme tokens.
