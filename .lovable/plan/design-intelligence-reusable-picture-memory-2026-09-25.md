# Design Intelligence + Reusable Picture Memory

## What the audit found

Most of Part 1 already exists and is live. Part 2 is the real gap.

**Design knowledge already in the build path** (all deterministic, no AI call, already injected into the single code-writing request):
- Themes/tokens, layout templates, composition rules, brand rules, app-screen library, design taste and landing checklists.
- A one-time "design direction" (fonts, palette, density, motion) chosen on the first build and saved to project memory, then re-applied unchanged on every later turn — this is what keeps later edits consistent.
- Post-build checks that catch generic/samey output and repair the design floor.
- One existing AI call picks the first-turn direction. It stays as-is. No new AI call is added anywhere.

**Two design gaps worth fixing:**
1. The per-industry composition catalogue (restaurant, SaaS, agency, etc.) exists but is not connected to building — it only powers marketing pages. Different site types therefore get less category-specific composition than they could.
2. There is no explicit guarantee that a user's own words ("make it brutalist") outrank the auto-picked direction.

**Picture gaps:**
- Kimble already picks pictures in order: the project's own uploaded photos → the curated shared library → generate a new one → safe fallback. Matching is keyword/tag scoring, no embeddings.
- Generated pictures are already stored permanently, but they are *not recorded anywhere*, so they can never be found or reused again. Identical prompts dedupe by chance only.
- There is no admin view of generated pictures and no way to promote a good one into the shared library.

## What I will build

### 1. Connect category composition (small, deterministic)
Feed the existing industry catalogue into the existing design context block for the first build only, so a restaurant, a fintech and a portfolio get different section composition. No new module, no new call.

### 2. Make user wording win
An explicit precedence rule in the design context: when the user's own request names a style, palette, font feeling or vibe, that overrides the auto-picked direction and is recorded as the project's direction. Covered by tests.

### 3. Remember generated pictures
Add one table recording each picture Kimble generates: storage URL, size, aspect ratio, orientation, prompt/subject, style, mood, tags, model, owning project and owner, created time, and a "shared" flag that defaults to off.

### 4. Reuse before generating
Insert one lookup step into the existing picture-choosing order, using the existing scoring code and the same quality bar:

```text
project's own photos -> curated shared library -> remembered pictures -> generate new -> safe fallback
```

Remembered pictures are only visible to:
- the same project, and
- the same owner's other projects, and
- everyone, only if an admin has explicitly marked that picture shared.

A weak match is never used; it generates instead. If the lookup errors, the build continues and generates.

### 5. Admin view
Extend the existing pictures admin page with a second tab listing remembered generated pictures, with search and a single "share to library" action. No new admin system.

## Safety and limits

- Zero additional AI calls; the design layer only adds text to the request that already happens.
- No change to the code writer, validation, completeness checks, browser verification, cancellation, atomic commit, billing or provider routing.
- Nothing runs in the browser: recording and lookup happen inside the durable build path, so a refresh cannot affect them.
- A cancelled turn records nothing and charges nothing.
- Generated apps only ever receive a plain picture URL — never library access or any credential.
- Row-level rules enforce ownership on the new table; cross-user reuse requires an explicit admin action.

## Technical detail

- New migration: `public.generated_pictures` (+ GRANTs, RLS: owner reads own rows, admin full, everyone reads `shared = true`), GIN index on tags, index on `(owner_id, created_at desc)`.
- Recording hook lives in the existing image-generation module after a successful upload, inside the turn-active check so a stopped turn writes nothing.
- Lookup reuses the existing tokenizer and scorer with the existing minimum-score bar; wired as a third tier in the existing placeholder resolver.
- Category composition is merged into the existing design-direction block; user-stated style is extracted before the auto-pick and short-circuits it.
- Observability: existing telemetry gains `picture_source` (project/library/remembered/generated/fallback), asset id, latency, and failure reason.

## Tests

Design: context enrichment happens, no extra AI call, no second writer, user wording overrides defaults, direction persists across edits, categories differ, mobile/desktop guidance consistent.

Pictures: generated picture is recorded with correct metadata, suitable remembered picture is chosen, weak match rejected, User A's private picture never reachable by User B, project isolation holds, shared/admin pictures reusable, duplicates deduped, generation failure and lookup failure both leave the build intact, cancelled turn records nothing, no credentials reach generated apps.

Regression: builds without pictures behave exactly as today; existing routing, validation, completeness, verification and billing unchanged.

Then the full suite and typecheck run before any live build.
