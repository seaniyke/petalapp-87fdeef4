## What's happening

The screenshot shows the user-generated app crashing with **Minified React error #31** ("Objects are not valid as a React child, found: object with keys {...}"). This is a generation-quality bug in the code Petal emitted for the "crypto wallet exchange" prompt — not a Petal-platform crash. Two things need to change:

1. **Catch the crash class earlier** so this prompt (and similar ones) stop shipping broken code.
2. **Make the landing-first plan-and-save flow stronger for high-stakes prompts** like "crypto wallet exchange", as the user describes.

The HMAC/builder issue from earlier turns appears resolved (no `Invalid signature` in the screenshot — the build went out, deployed to `petal-0f64a3aa37bc.pages.dev`, and the runtime is the failure now).

---

## Part 1 — Eliminate React #31 in generated apps

Today `src/server/render-risk-linter.ts` rule **R5** only catches forwardRef icons rendered as `{Icon}`. The actual #31 the user hit (`object with keys {...}` — not the icon-shaped `{$$typeof,render,displayName}`) is the more general pattern: a plain object/state/config rendered directly in JSX. Add a new rule:

**R8 — object-as-JSX-child.** Scan `.tsx/.jsx` for `{ident}` and `{a.b}` expressions that sit as a JSX child (not in an attribute, not in a callback) where `ident` is locally bound to a plain object literal, `useState` initializer that's an object, or a destructured prop whose type is `Record<...>` / `{...}`. Emit a `render-risk` issue with autofix hint ("render `{ident.field}` or `JSON.stringify(ident)` — passing an object renders React error #31").

Wire R8 into `ENABLED_RULES` and into the same feed-to-autofix gate as R1–R7 (already handled by `local-verifier.ts` consumers).

Also tighten `src/routes/builder.tsx` line 4718 (the existing #31 sniffer): when the preview reports #31 at runtime, auto-attach the offending file+line to the next "Try to fix" prompt so the autofix model gets the exact crash site instead of a generic message.

## Part 2 — Landing-first flow for high-stakes prompts

`src/lib/high-stakes-intent.ts` already detects crypto-wallet / neobank / trading / lending / kyc and tells the model "build a marketing landing page, not a fake dashboard." Two gaps remain:

**A. Persist the plan to project memory.** Today the landing instruction is splice-only — nothing is saved. Update `src/routes/api/generate.ts` (around line 1709 where `highStakesBlock` is built) so that on the **first turn** of a high-stakes project we:
   1. Generate a short structured plan: `{ productName, sections[], futureFeatures[], providersToWireLater[] }` (e.g. for a crypto wallet: futureFeatures = [send, receive, swap, stake]; providers = [Alchemy, viem, WalletConnect]).
   2. Save it via `saveProjectBlueprint(projectId, ...)` from `src/server/build-blueprint.server.ts` (already exists, already round-trips through `project_blueprints`).
   3. Also write it to project memory via `src/lib/project-memory.functions.ts` so the user can see "What Petal remembers" reflects the plan (internally — the UI surface stays hidden per existing memory rule).

**B. Render the plan in the assistant preamble** so the user can iterate. The first response should say in one short paragraph: "Here's the roadmap I saved — landing first, then [feature 1], [feature 2]. Tell me which to build next." This matches how competitors do it (plan → landing → iterate).

Subsequent turns reuse `loadProjectBlueprint(projectId)` (already in the build path) so Petal doesn't re-plan on every message.

## Out of scope

- Builder HMAC / Railway signing: appears fixed; will only revisit if `Invalid signature` reappears in logs after this turn.
- Cloud/billing copy and the broader `Build me a crypto wallet exchange` user journey beyond the landing-first behavior described above.
- Any changes to KeshPay (project memory says ignore KeshPay rules here — already respected).

## Files I'll touch

- `src/server/render-risk-linter.ts` — add R8 (object-as-JSX-child) + wire into ENABLED_RULES.
- `src/server/local-verifier.ts` — surface R8 results in the same issue bucket already feeding autofix.
- `src/routes/builder.tsx` — enrich the #31 runtime sniffer with file/line context for the next autofix turn.
- `src/routes/api/generate.ts` — on first turn for a high-stakes project, build + save the blueprint and force a one-paragraph plan preamble.
- `src/server/build-blueprint.server.ts` — extend `BuildBlueprint` with optional `futureFeatures[]` and `providersToWireLater[]` (additive, back-compat).
- `src/lib/high-stakes-intent.ts` — add a small helper `highStakesRoadmap(domain)` returning the canned futureFeatures/providers list per domain.

No DB migration needed (the blueprint blob column already stores arbitrary JSON).

## Verification

- Add a unit-style test for R8 against three fixtures: `{user}` where `user` is `useState({})`, `{cfg.theme}` where `cfg` is an object literal, and a clean control that should NOT fire.
- After deploy, retry "Build me a crypto wallet exchange" in a fresh project and confirm: (a) preview boots without #31, (b) "What Petal remembers" contains the saved roadmap, (c) assistant preamble names the next iteration steps.
