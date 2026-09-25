# Design-system packages for Kimble

Give Kimble a structured, installable "design system package" (visual language + accents + fonts + AI playbook), built on what Kimble already has. One synthetic test package proves it works. No new screens, no marketplace, nothing copied from Substrate.

## What already exists (and will be reused, not duplicated)

- **Themes** — `themes.server.ts` (`THEMES`, `pickThemeForBrief`): Kimble's built-in looks, picked by code, not AI. Stays authoritative for new builds.
- **Committed design contract** — `PicDesignSystem` inside the project intelligence record (`pic-store.server.ts`), committed on turn 1 and inherited by later turns. This becomes the home of the project's selected system + accent (no new columns).
- **Palette floor / palette integrity / design lint** — keep repairing and checking the stylesheet; they learn to recognise package tokens.
- **Markdown knowledge loader** (`agent-knowledge/`, `?raw` bundling) — DESIGN.md loads through the same mechanism.
- **Revision transaction** (`replace_project_files`) + build trigger + snapshots — used as-is for applying a system.
- **/themes page** — untouched.

## Package contract

```text
src/server/design-systems/packages/<slug>/
  design.json     required  metadata (slug, name, description, when_to_use, default_accent,
                            accents list, capabilities, token_categories, has_components,
                            schema_version, version)
  tokens.css      required  :root + .dark blocks of --kimble-* tokens mapped onto Kimble's
                            existing shadcn roles (--background, --primary, ...)
  accents.json    required  { accentId: { light: {...}, dark: {...} } } — only accent roles
  fonts.html      required  <link> tags for the fonts
  DESIGN.md       required  AI playbook (how to use the tokens)
  preview.html    optional
  components/     optional  files copied into the project on apply
```

New systems are added by dropping a folder in — a Vite glob registry discovers them; no code list.

## Pieces to build

1. **Loader/validator** (`design-systems/loader.ts`) — zod schemas for design.json and accents.json, required-file checks, accent ⊂ system check, token parsing; returns a typed package or a safe error. Never throws into generation.
2. **Project association** — `design.systemId` + `design.accent` stored on the existing committed contract. Normal generations read and keep them; a server-side guard restores them if a generation tries to change them.
3. **AI context** — when a project has a system: metadata, DESIGN.md, a compact token summary (names + roles, not raw CSS), active accent, fonts, component list. Rendered through the existing skills/knowledge block and context budget, placed below the user's request and project requirements, above generic design defaults.
4. **Deterministic apply** (`design-systems/apply.ts`, pure) — writes a marked token block into `src/styles.css`, merges accent overrides, installs font links into the root document head (marked region, idempotent), copies optional components. Same input → same files; unchanged files report "no change".
5. **Re-theme server function** — validate system + accent → snapshot → apply → save through `replace_project_files` (revision only advances when content changed; all-or-nothing, so failure leaves the project untouched) → trigger build on the new revision (old build can't become ready — existing rule). Optional cleanup hook is defined but limited to colour/font fixes and not wired to AI in this task.
6. **Synthetic package** `kimble-test-system` with invented values and two accents; internal only, not shown to customers.

## Tests

New `design-systems.test.ts` covering every item in section 12 of the brief (valid load, missing file, malformed JSON, bad accent, metadata/DESIGN.md/tokens/fonts, optional preview/components, association, stable across generations, deterministic apply, accent change, rollback on failure, revision only on real change, stale build invalidation, AI context contents, generation can't replace the system). Then typecheck and the full suite; the known timing-flaky `root-reliability` test is left alone.

## Technical notes

- No database migration: selection lives in the existing project intelligence JSON.
- Server-only modules (`*.server.ts`) so packages never ship to the browser.
- AGENTS.md gets one rule: design-system packages live only in `src/server/design-systems/packages/` and are applied deterministically.
- Final report follows the 15 headings in the brief.
