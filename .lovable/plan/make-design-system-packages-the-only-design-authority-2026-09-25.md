# Make design-system packages the only design authority

## What the audit found

| Mechanism | Today | Decision |
|---|---|---|
| `themes.server.ts` (THEMES, `pickThemeForBrief`) | Only used as base colours/fonts inside `commitDesignSystem` | DELETE after new projects derive from a package |
| `PicDesignSystem` + `commitDesignSystem` | Real production path deciding colours/fonts; rendered in `picBlock` | KEEP as storage only. With a package, its visual fields are *derived from the package*; it no longer invents a palette. Legacy projects keep their stored contract read-only |
| Design Director (`pickDesignDirection`) | `designBlock` in every prompt: palette, fonts, layout | KEEP for layout/composition/motion. Strip palette + font output when a package is selected |
| `designSystemBlockFor` (package block) | Wired, but no project has a package | KEEP — becomes the single visual-identity block |
| `design-taste` / `app-ui-library` | General design intelligence | KEEP, below the package block |
| `design-enforce.server.ts` | Dead (a test asserts it is absent from generation) | DELETE |
| `design-finisher.server.ts` | No caller found | DELETE (after confirming no caller in builds/callbacks) |
| `palette-floor.server.ts` | Only reachable through the dead finisher | KEEP, make package-aware, call from the apply engine |
| `design-system-lint.server.ts` | Only reachable through dead code | KEEP, make package-aware, wire as a post-generation check |
| `/themes` page + `themes-and-snippets` | Link to builder with a canned AI prompt | MIGRATE: presets map to package + accent; applying on an open project calls the package engine, no AI |
| DB columns | None — design lives in project intelligence JSON | No new tables or columns |

## Changes

1. **Real registry package.** Promote the synthetic coastal package (accents lagoon/ember) to an installed, selectable package (no customer library UI). Registry exposes `resolveDefaultPackage(brief)` — deterministic; with one package it returns it.
2. **Initial generation.** On first build: resolve package + default accent, persist `design.package`, derive the `PicDesignSystem` visual fields from the package, then after the AI writes files run `applyDesignSystem` deterministically inside the same turn transaction, so tokens/fonts are in the committed revision the build uses.
3. **One visual block.** When a package is selected: package block is the only colour/font/token source; `picBlock` omits palette/typography; Director omits palette/fonts. Authority text stays: user request > requirements > design system > general defaults. No raw `tokens.css` in prompts.
4. **Edits.** Package selection is preserved (existing guard); the apply step re-runs idempotently so the AI cannot overwrite the marked token block.
5. **Re-theme.** `applyDesignSystemToProject` → `rethemeProject` → committed revision → existing server build trigger bound to that revision. Unchanged → no revision, no build. Scoped AI clean-up is not wired unless the lint finds hard-coded colours after apply; then it only offers the scoped fix.
6. **Existing projects (migration, metadata only).** Projects with a stored contract and no package get `design.migration = "legacy-unmapped"`; their code and look are untouched, and their stored contract remains the reference only for them. Nothing regenerates. They move to a package only via an explicit re-theme.
7. **Checks.** Lint accepts `var(--kimble-*)` and package token names, flags the marked block if edited/removed, still flags raw hex/Tailwind colours/arbitrary fonts. Palette floor skips when a package block is present, still fires on untouched scaffold colours otherwise.
8. **Cleanup.** Delete `themes.server.ts`, `design-enforce`, `design-finisher` and their tests/imports; grep for `themes.server`, `theme_preset`, `designDirection` palette use, etc., and report each remaining hit's role.

## Verification

- Typecheck, full suite, production build.
- Tests A–E from the brief (initial gen, normal edit, re-theme, failed apply, identical reapply) as integration tests using the real registry, real apply engine and real revision/build deps with an in-memory store.
- A live run against a real test project in the backend where the build service is reachable from here; if the build service can't be reached from the sandbox I'll say so rather than claim READY.

## Technical notes

- Safety model untouched: apply runs inside TurnTransaction / `replace_project_files`; revision CAS unchanged; build bound to returned revision.
- Record in AGENTS.md: package is the sole visual authority; Director = composition only.
- Open risk: removing Director palettes changes how new projects look (all new projects share one package until more packages exist).
