# Fix: build dies on `import { Separator } '@/components/ui/separator'`

## What the log says

esbuild aborts the whole Vite build because one import statement is missing the `from` keyword. One bad line takes the entire deploy down.

## What I verified

- Petal already has a deterministic repair for exactly this shape: `src/server/import-syntax-fixer.server.ts`. I ran it against the failing line and it correctly rewrites it to `import { Separator } from '@/components/ui/separator';`. So the pass is not broken — the payload that reached the builder never went through it.
- `runAllRepairs` (which contains that pass) runs in the generate path, `api/builds/trigger`, and `api/publish`.
- `src/routes/api/builds/watchdog.ts` re-posts builds loaded straight from `project_files` and applies only `applyScaffoldKit` (line 168) — it never calls `runAllRepairs` before `postBuildToRailway`. Any retried/stuck build therefore ships unrepaired source.
- `postBuildToRailway` in `src/server/builder.server.ts` is the single choke point every path funnels through, and today it only freshens years and injects the badge — no syntax safety net.

## The fix

1. **Close the watchdog gap.** Run `runAllRepairs` plus the styles.css validation in the watchdog retry path, matching what `builds/trigger` already does.

2. **Make the choke point safe.** Add a cheap, idempotent last-mile heal inside `postBuildToRailway`: literal-escape repair and import-syntax repair over the outgoing files. Every build pathway — generate, trigger, publish, watchdog, and any future one — is then covered by construction, and repairs are logged so we can see when they fire.

3. **Builder-side pre-flight.** In the builder service, before `vite build`, run the same missing-`from` / literal-escape heal over the files it just wrote to disk. This is the true last line of defense: it operates on the exact bytes esbuild will parse, regardless of what the app server sent.

4. **Broaden the repair.** Cover the remaining shapes the current patterns miss (default + namespace combos such as `import React, * as ns '…'`, and a missing `from` followed by a trailing line comment), and add a regression test using a real route path (`src/routes/products/$slug.tsx`) so the `$` in the filename is covered.

5. **Honest failure when it still breaks.** If a build fails with an esbuild "Expected …" parse error, the error card should name the file, line, and the offending statement in plain language instead of dumping the stack — the friendly-error card already supports this shape.

## Technical notes

- Files touched: `src/routes/api/builds/watchdog.ts`, `src/server/builder.server.ts`, `src/server/import-syntax-fixer.server.ts`, `builder/src/build.ts` (pre-build heal helper), plus a test in `src/server/__tests__/import-syntax-fixer.test.ts`.
- The builder-side heal must be a small self-contained helper in `builder/src/` (the builder is a separate deploy and cannot import from `src/server`), and shipping it requires a builder redeploy from the admin Builder tab.
- All passes stay pure and idempotent: running them twice must produce byte-identical output.
