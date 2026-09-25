# Make Kimble’s parser authoritative and reliable on Railway

## Goal
Prevent valid generated code from being rejected when the authoritative parser is unavailable, while continuing to block genuinely broken code.

## Changes
1. **Fix the Railway parser runtime**
   - Trace and correct the bundled Node ESM setup used by `agent-core.mjs` so `esbuild-wasm` receives valid module location information.
   - Avoid broad global shims; apply the compatibility fix only to the parser dependency/bundle boundary.

2. **Represent parser outcomes explicitly**
   - Change the parser result to distinguish `pass`, `fail`, `unavailable`, and `not_checked` instead of treating an initialization failure as a clean result.
   - Include a structured unavailability reason for logs and progress reporting.

3. **Fail closed without misclassifying code**
   - Update write-time validation, final validation, local confirmation, tool checks, and page truncation checks.
   - A parser failure blocks broken code.
   - A parser pass overrides syntax heuristics.
   - Parser unavailability blocks/defer validation as an infrastructure error; it never quarantines a file based only on a heuristic and never silently accepts an unchecked write.
   - Preserve all existing repair limits, completeness checks, cancellation, commit, billing, provider routing, and project isolation.

4. **Fix JSX prose scanning and defensive copy**
   - Keep JSX text masked from JavaScript string analysis while preserving expressions inside `{...}`.
   - Add apostrophe/quote regressions and genuine unterminated-string regressions.
   - Change the generated 404 sentence to “This page has not been built yet.”

5. **Prove the exact failure path**
   - Add tests showing valid `App.tsx` with JSX apostrophes passes and remains present.
   - Add the inverse test showing malformed JavaScript remains rejected.
   - Add a bundled Node ESM smoke test that loads the same Railway artifact and parses valid and invalid TSX.

6. **Validate and deploy the runtime copy**
   - Run focused tests, the full test suite, and the project typecheck.
   - Rebuild and inspect the committed Railway agent bundle.
   - Check the preview build signal.
   - Then run the requested real Railway build and report whether compile, browser verification, and ready state were reached.

## Technical detail
The installed `esbuild-wasm` Node entry reads CommonJS `__filename`/`__dirname` and launches its packaged WASM runner. Bundling that entry directly into a single ESM file removes both the module location and its adjacent runtime assets. The implementation will preserve the dependency at its real package location for Railway’s Node runtime, rather than pretending the bundled file is the package entry.
