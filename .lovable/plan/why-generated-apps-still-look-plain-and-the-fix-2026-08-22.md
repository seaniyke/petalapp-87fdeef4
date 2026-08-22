# Why generated apps still look plain — and the fix

I traced this against the real files of the last build (Lumen Ledger). The design director did pick a palette and a font pair. A later repair pass then destroyed both. This is not a "the model has no taste" problem — it is a deterministic bug in our own post-processing.

## What actually happened (verified in the shipped `src/styles.css`)

1. **The palette was neutralised.** `src/server/tailwind-token-sweep.server.ts` only recognises tokens written as `--color-x` inside `@theme`. The generated app declares them the normal Tailwind v4 way (`--primary`, `--accent`, `--muted-foreground` …), so the sweep concluded *every* semantic token was missing and re-declared them in `:root`:

   ```text
   --primary: var(--primary);          /* circular -> invalid -> no colour at all */
   --destructive: var(--foreground);   /* everything collapses to near-black */
   --muted-foreground: var(--foreground);
   --accent: var(--primary);
   ```

   A self-referential custom property is invalid at computed-value time, so the whole brand palette silently evaporates and the app renders black text on white — exactly the screenshot.

2. **The display font was overwritten with a system serif.** The same pass saw the `font-display` utility, treated it as an unknown token, and appended
   `--font-display: ui-serif, Georgia, Cambria, "Times New Roman", serif;`
   That is why headings are Times. Worse, `design-finisher.server.ts` reads that value, sees a system stack, and therefore **skips loading any Google font** — the finisher's whole reason to exist is defeated.

3. **Dozens of junk tokens.** The class scanner mis-reads core Tailwind utilities (`bg-clip-text`, `bg-cover`, `border-collapse`, `bg-gradient-to-r`, `translate-y`) and emits `--color-clip-text`, `--color-cover`, `--color-collapse`, `--color-y`, `--color-r`, `--color-step-0` … noise that also proves the scanner is unsafe.

4. **No landing page, and leaked files.** That app shipped only dashboard screens — plus `src/pages/workouts.tsx` and `src/pages/workouts/$id.tsx`, which belong to a different app entirely. Nothing enforces "an app has a front door" or "no orphan pages from another brief."

## The fix

### 1. Make the token sweep safe (root cause)

- Recognise bare `--name` declarations in `@theme`/`:root`, not just `--color-name`. If a token already exists, never re-declare it.
- Never emit a self-referential value. Guard: if the derived value is `var(--<same-name>)`, skip the declaration entirely.
- Never touch `--font-*`: the type pair belongs to the design director and the finisher. The sweep may only add a `--color-*` *mapping* for a font utility, never a font value.
- Tighten the scanner with a proper Tailwind utility denylist (`clip-*`, `cover`, `contain`, `collapse`, `separate`, `gradient-to-*`, single letters, `step-*`, numeric scales) so only genuinely unknown semantic tokens are injected.
- Cap the sweep: if it wants to add more than ~12 tokens, that is a scanner failure, not a missing palette — add nothing and report a note.

### 2. Add a palette-integrity check

New deterministic check run after all repairs (and unit-tested):

- no custom property may resolve to itself, directly or through one hop;
- `--primary`, `--accent`, `--background`, `--foreground`, `--card`, `--border` must each carry a real colour value, not a chain that ends at `--foreground`;
- the declared display and body families must be non-system and actually loaded.

Failures are hard failures that feed the existing repair loop rather than shipping.

### 3. Strengthen the design finisher

- Treat "declared as a system stack" as *unset*: re-apply the locked pair from the design pick instead of accepting the system fallback.
- Carry the design pick (palette name + font pair) explicitly into the finisher rather than re-deriving it from CSS the sweep may have corrupted.
- Keep the existing depth/motion floors but also apply a surface floor to interior screens: cards get a border + soft shadow + real radius, tables get a styled header row, page headers get the display face at the correct scale. The screenshot's unstyled table is a direct symptom of having no interior floor.

### 4. Every app gets a front door

- If a build produces app screens but no landing/home route, generate one from the kit's landing blocks using the locked palette and type pair, wired into nav and routing.
- Flag orphan pages that belong to no planned route (the stray `workouts` pages) and drop them.

### 5. Prove it with a real build

Build a fresh app end to end, then verify in the browser before calling it done:

- computed styles show the picked brand colour on the primary CTA (not black);
- the Google font stylesheet is actually requested and applied to headings;
- the landing page exists with the full section set and reads as designed;
- interior screens use surfaces, not bare white;
- no console errors, no invalid CSS custom properties.

I'll iterate on whatever that build exposes rather than stopping at "build succeeded."

## Technical notes

Files touched: `src/server/tailwind-token-sweep.server.ts` (rewrite of the detection + derivation logic), `src/server/design-finisher.server.ts` (design-pick input, system-stack handling, interior surface floor), a new palette-integrity module wired into `repair-all.server.ts` and the quality gate, plus tests under `src/server/__tests__/`. No billing, marketplace, or builder-UX changes.
