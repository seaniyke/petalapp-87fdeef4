# Why option C didn't fix it

You're right — the previous turn (tighter prompts + clearer error copy) was **preventative**, not corrective. If the AI still emits invalid CSS (a stray `1`, a malformed at-rule, a typo), the file is:

1. Persisted to `project_files` as-is by `/api/generate`.
2. Re-applied by `applyScaffoldKit` during `/api/builds/trigger`, but with `overwrite: false` for `src/styles.css` (line 2474 of `scaffold-kit.ts`) — so the AI's broken version is kept.
3. Shipped straight to Tailwind v4 on Railway, which aborts the build with `Invalid declaration: '1'`.

There is **no validation gate** anywhere between the AI and the build. That's the real root cause.

# Root cause, in one sentence

`src/styles.css` is the only scaffold file the AI is allowed to overwrite **and** the only file whose contents can break the build with a single stray character — and we never check it.

# The fix: validate styles.css and fall back when it's broken

Add a tiny server-side validator that runs in two places:

**A. `src/server/validate-styles.server.ts` (new)** — a lightweight CSS sanity check that catches the failure modes Tailwind v4 actually rejects, without re-implementing a full parser:

- File must start with `@import "tailwindcss";` (case/quotes flexible).
- Every non-blank, non-comment line at the top level must be one of: an `@`-rule, a selector line ending in `{`, a closing `}`, or a `property: value;` declaration *inside* a block.
- Reject bare tokens at the top level (e.g. a line that's just `1`, `foo`, `;`, etc.) — this is the exact class of error from the build log.
- Balance check: `{` count must equal `}` count.

If validation fails, the helper returns `{ ok: false, reason }`. Cheap, deterministic, no dependency on Tailwind itself (we don't want to ship Tailwind into our SSR worker).

**B. Wire it into the build trigger** (`src/routes/api/builds/trigger.ts`), right after `applyScaffoldKit`:

- Find the `src/styles.css` entry in `scaffolded`.
- Run `validateStylesCss(content)`.
- If invalid: replace that entry's content with the canonical `STYLES_CSS` from the scaffold kit (export it from `scaffold-kit.ts` so we can reuse the exact same string), and `console.warn` with the project + build id and the reason. The build proceeds with safe CSS instead of dying.

**C. Optionally wire it into `/api/generate`** (`src/server/generate.server.ts`), in the `write_project` and `patch_files` paths, *after* the AI returns files but *before* we persist them. Same logic: if the AI's `src/styles.css` doesn't validate, drop it (let the scaffold default win) and stream a small `phase` event so the client can show a soft notice. This stops the bad file from ever entering `project_files`.

# Why fall back instead of overwrite-always

Earlier we discussed flipping `overwrite: true` for `styles.css`. That would also fix the build, but it permanently kills the AI's ability to customize tokens (colors, fonts, radii) — which is exactly what shadcn/ui apps need. Validating-and-falling-back is the v0/Lovable industry pattern: editable in the happy path, safe in the failure path.

# What this changes / doesn't change

- ✅ Tailwind v4 can no longer abort the build because of bad CSS the AI emitted.
- ✅ The user's `styles.css` is still respected when it's valid (so theme customization keeps working).
- ✅ Same prompt rules from the previous turn stay in place — they reduce how often the validator has to fire.
- ✅ `friendlyBuildFailure` styling-error branch stays as a last line of defence (in case some *other* CSS bug slips past — e.g. an `@apply` of an unknown utility, which is harder to catch without running Tailwind).
- ❌ No DB migration. No changes to the builder service. No change to the AI gateway.

# Files touched

- **New**: `src/server/validate-styles.server.ts` (~40 lines + a small test).
- **Edit**: `src/server/scaffold-kit.ts` — `export const STYLES_CSS` (currently a module-local `const`) so the build trigger can reuse it as the fallback.
- **Edit**: `src/routes/api/builds/trigger.ts` — after `applyScaffoldKit`, run the validator and swap in `STYLES_CSS` on failure.
- **Edit (optional but recommended)**: `src/server/generate.server.ts` — same validation in the `write_project` and `patch_files` finalize steps, so bad CSS never reaches the database in the first place.

# Verification plan

1. Unit-test the validator with: the canonical `STYLES_CSS` (must pass), a file containing a stray `1` line (must fail), an unbalanced `{` (must fail), missing `@import "tailwindcss";` (must fail).
2. Type-check passes (`bunx tsc --noEmit`).
3. Manually trigger a build for a project whose stored `src/styles.css` has the bad `1` line — the build trigger logs `[styles.css invalid] falling back to scaffold default` and the build succeeds.
