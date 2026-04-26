## Why the build failed

The bundler said `Cannot find package 'vite'` and `Could not resolve '@vitejs/plugin-react'`. Both are listed in the generated project's `package.json` under `devDependencies` (see `src/server/generate.server.ts` line 10). They didn't end up in `node_modules`.

Root cause: the Railway builder container runs with `NODE_ENV=production` (Railway's default for Node services). When `NODE_ENV=production`, **`npm install` silently skips `devDependencies`** — so `vite`, `@vitejs/plugin-react`, `typescript`, and the React types never get installed. Then `npx vite build` fails to resolve them.

The "Project not found" error from `wrangler pages deploy` lower in the log is a downstream symptom: no `dist/` was produced because the build crashed, so Cloudflare never got a successful first deploy to auto-create the project. Fixing the install fixes the deploy automatically.

This is a **builder-service bug**, not a problem with the user's app. Every Petal-generated project hits it.

## The fix (one line)

In `builder/src/build.ts`, change the `npm install` arguments to force devDependencies regardless of `NODE_ENV`:

```ts
// Before
const install = await run("npm", ["install", "--no-audit", "--no-fund", "--prefer-offline"], { ... });

// After
const install = await run(
  "npm",
  ["install", "--include=dev", "--no-audit", "--no-fund", "--prefer-offline"],
  { ... }
);
```

`--include=dev` is npm's explicit, supported flag that overrides the `NODE_ENV=production` skip. It's the smallest possible change.

## Why not other approaches

- **Move vite to `dependencies`** in the system prompt — works but bloats every user's `package.json` with build-only packages, which is wrong semantically and hurts published bundle introspection.
- **Unset `NODE_ENV` in the spawned env** — works, but more invasive (changes behaviour of any other npm script that reads `NODE_ENV`) and easier to regress.
- **`npm ci` instead of `npm install`** — would also respect `--include=dev`, but requires a `package-lock.json` we don't generate.

`--include=dev` is the minimum-risk, intent-revealing fix.

## Files to change

- `builder/src/build.ts` — add `--include=dev` to the npm install args (one line).

## Deployment note

The builder runs on Railway as a separate service (see `builder/README.md`). After this code change is merged, **the builder must be redeployed to Railway** for the fix to take effect. The Lovable Cloud Worker (which runs `/api/builds/trigger`) does not need redeploying — it just forwards build requests.

## Verification

After redeploy:
1. Trigger a new build from any Petal project.
2. The "deploying" phase should complete and the `petal-<id>.pages.dev` URL should go live.
3. The first build for any project also creates the Cloudflare Pages project automatically (per `--commit-dirty=true` in the wrangler call), so the "Project not found" error disappears on its own.

If the very next build still says "Project not found" for a project whose previous build failed, that's expected for one more attempt — the project gets auto-created on the first *successful* deploy. The build after that will work.
