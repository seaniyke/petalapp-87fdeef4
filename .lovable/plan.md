# Hybrid: Free Blocks + Prompt Engineering Investment

You said **stay free / cautious on licensing** and pursue the **hybrid** path. So this plan does two things, in one focused pass — no premium kit code is copied, redistributed, or referenced. Everything is hand-written in the spirit of premium aesthetics (generous whitespace, modern type scale, soft surfaces, restrained color), but written from scratch using only your existing kit.

---

## Part 1 — Add 8 new "premium-feel" reference blocks under `src/components/examples/`

These slot into your existing examples pattern (auto-injected by the scaffold, protected from edits, AI reads & adapts but never imports directly). Each one teaches the AI a different *page archetype* the current 4 examples don't cover.

**New files** (added to `KIT` in `src/server/scaffold-kit.ts`, registered in the system prompt):

1. **`hero-centered.tsx`** — Modern marketing hero: eyebrow Badge, large headline (text-5xl/6xl), supporting paragraph, primary + secondary CTA Buttons, soft gradient/blurred background using semantic tokens.
2. **`feature-grid.tsx`** — 3-column feature section using `<Grid preset="features">`, each cell a Card with a Lucide icon in a tinted `bg-primary/10` square, title, and description.
3. **`pricing-tiers.tsx`** — `<Grid preset="pricing">` with 3 Cards (Starter / Pro / Enterprise), the middle one elevated via `border-primary` and a "Most popular" Badge, checkmark feature lists, single CTA per tier.
4. **`stats-dashboard.tsx`** — `<Grid preset="stats">` of 4 stat Cards (label, big number, delta with up/down arrow Lucide icon in green/red via semantic tokens), then a wide Card for a chart placeholder.
5. **`empty-state.tsx`** — Centered Card with a circular icon backdrop, headline, supportive copy, and a primary CTA Button. The "no data yet" pattern done right.
6. **`auth-card.tsx`** — Centered single-Card sign-in layout with Label+Input pairs, Separator with "or" divider, OAuth Buttons row. Reference for any auth screen.
7. **`settings-list.tsx`** — Stacked rows pattern: each row is `<Inline justify="between">` with Label/description on the left and a `<Switch>` or `<Select>` on the right, separated by `<Separator>`. Common settings/preferences UI.
8. **`app-shell-sidebar.tsx`** — Two-column app shell: left rail with vertical nav (icon + label Buttons, active state via `bg-accent`), top bar with breadcrumbs + Avatar, main content area with Container. Reference for any dashboard/admin app.

Each file:
- Uses **only** existing kit primitives + layout components you already added (Container, Stack, Inline, Grid).
- Uses **only** semantic Tailwind tokens (`bg-background`, `text-muted-foreground`, `bg-primary/10`, etc.) — zero hardcoded colors.
- Is annotated with a top comment explaining what archetype it demonstrates.
- Is small and copyable (~80–150 lines each), not a kitchen sink.

## Part 2 — Tighten `SYSTEM_PROMPT_INITIAL` with design directives that punch above their weight

Currently your prompt tells the AI *which components* to use. It says less about *how to make things look premium*. Add a new section between REUSE-FIRST and Hard rules:

```
DESIGN QUALITY RULES (treat these as non-negotiable):
- Spacing rhythm: page sections use py-16 or py-24, cards use p-6 or p-8, stack gaps are 4/6/8 — never 1/2/3.
- Type hierarchy: page H1 = text-4xl/5xl font-semibold tracking-tight, section H2 = text-2xl/3xl font-semibold, body = text-base text-muted-foreground.
- Color restraint: ONE primary accent per screen. Use bg-primary for the main CTA only. Secondary actions = variant="outline" or "ghost". Never two competing colors.
- Surface depth: prefer subtle borders (border border-border) over shadows. When you do need elevation, shadow-sm is usually enough — shadow-lg is loud.
- Whitespace is the design: when in doubt, add more padding/gap, not more borders or background colors.
- Icons: always paired with text labels (icon-only Buttons need an aria-label). Standard sizes: h-4 w-4 inline with text, h-5 w-5 for nav, h-6 w-6 for hero/feature icons. Wrap feature icons in a tinted square: <div className="rounded-lg bg-primary/10 p-3"><Icon className="h-6 w-6 text-primary" /></div>.
- Page archetype: every page starts with <Container> and uses <Stack gap=...> for vertical rhythm. NEVER stack multiple <main> or <section> elements with raw margin classes.
```

Then expand the examples registry block in the prompt to list the 8 new files with one-line descriptions, mirroring the existing format.

## Part 3 — Mirror the same registry block in `SYSTEM_PROMPT_PATCH`

So patch-mode edits also know the new blocks exist and can use them as references when extending an app.

---

## Files touched

- `src/server/scaffold-kit.ts` — add 8 new constants, register them in `KIT`.
- `src/server/generate.server.ts` — add DESIGN QUALITY RULES section to both prompts, expand the examples registry list in both prompts.

**Not touched** (already handles this correctly):
- `src/routes/api/generate.ts` — the `isProtectedPath` guard already covers `src/components/examples/*`, so new files are auto-protected.

## Out of scope for this pass

- **Buying any premium kit.** Per your "cautious on licensing" answer, we're staying 100% original. If you ever want to revisit, the safe path is: buy a personal Tailwind Plus license, study patterns, then re-implement equivalents from scratch in `examples/` (which is what this plan does anyway, just without paying for inspiration).
- **Per-archetype prompt routing** (auto-detect "they want a pricing page" → inject pricing-tiers as a starting point). That's a meaningful next step but a separate project — would touch `src/routes/api/generate.ts` and add a classification step.
- **Theme/brand variations** (multiple color palettes the user can pick from). Worth doing later but distinct from "make the default look better."

## What you'll see after this ships

- New generations should produce noticeably more polished landing pages, dashboards, settings screens, and auth flows on first try.
- The AI will copy from the new blocks when you ask for "a pricing section," "a stats dashboard," "a sign-in page," etc.
- No change to existing generated apps — this only affects future generations.
- Zero licensing exposure: every line is hand-written for Petal.