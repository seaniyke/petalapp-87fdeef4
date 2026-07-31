# Petal Builder Service

This is a small Node.js service that builds Petal-generated projects (`npm install` + `vite build`) and deploys them to **Cloudflare Pages**. It runs separately from the main Petal app because Cloudflare Workers can't run `npm install` or spawn child processes.

## Architecture

```
┌─────────────┐    POST /build     ┌──────────────────┐    wrangler deploy    ┌────────────────┐
│  Main app   │ ─────────────────▶ │ Builder (Railway)│ ───────────────────▶  │ Cloudflare     │
│  (Worker)   │                    │  npm + vite +    │                       │ Pages          │
└─────────────┘ ◀──────────────────│  wrangler        │                       │ <id>.pages.dev │
   webhook         POST /api/      └──────────────────┘                       └────────────────┘
                builds/callback
```

Communication is signed with HMAC-SHA256 using a shared secret on both sides.

## Deploy to Railway

1. **Install Railway CLI** (one time)
   ```sh
   npm i -g @railway/cli
   railway login
   ```

2. **From this `builder/` folder**, link a new project and deploy
   ```sh
   cd builder
   railway init      # creates a new project, name it e.g. petal-builder
   railway up        # builds the Dockerfile and deploys
   ```

3. **Set the environment variables** in Railway's dashboard (Project → Variables):
   - `BUILDER_SHARED_SECRET` — random 32+ char string. Petal's app needs the same value.
   - `CLOUDFLARE_API_TOKEN` — from https://dash.cloudflare.com/profile/api-tokens (permission: `Account → Cloudflare Pages → Edit`).
   - `CLOUDFLARE_ACCOUNT_ID` — from any Cloudflare dashboard page (right sidebar).
   - `PETAL_CALLBACK_URL` — `https://<your-petal-app>.lovable.app/api/builds/callback`.
   - (optional) `MAX_CONCURRENT_BUILDS` — default 2. Bump if your Railway plan can handle more.
   - (optional) `PORT` — default 8080.

4. **Generate a public URL** in Railway: Settings → Networking → "Generate Domain".

5. **Copy the URL** (e.g. `https://petal-builder-production.up.railway.app`). You'll paste this into the main Petal app as `BUILDER_SERVICE_URL`.

## Redeploying (after changing anything in `builder/`)

The builder is a **separate service** from the Petal app. Publishing Petal does
not touch it — code under `builder/` only goes live when you redeploy here.

```sh
cd builder
railway up          # rebuilds the Dockerfile and rolls out
```

If the CLI isn't linked on this machine: `railway login` then
`railway link` (pick the existing `petal-builder` project) before `railway up`.
You can also redeploy from the dashboard: Railway → petal-builder → Deployments
→ **Redeploy** on the latest commit.

**Verify it took**, from anywhere:

```sh
curl -s https://<your-builder>.up.railway.app/healthz
# {"ok":true,"inFlight":0,"queued":0,"execInFlight":0,"execQueued":0}
```

The `execInFlight` / `execQueued` keys only exist on builds that include the
`/exec` command surface. If they're missing, the old image is still running.

No new environment variables are required for `/exec` — it reuses
`BUILDER_SHARED_SECRET`. Optional tuning: `MAX_CONCURRENT_EXEC` (default 4),
`MAX_EXEC_QUEUE` (default 30). Until the redeploy lands, the Petal app simply
reports script execution as unavailable and falls back to normal edits.

### `/exec` modes

`/exec` takes a `mode`, and each mode has a different safety posture:

| mode | what runs | network | writes back |
|---|---|---|---|
| `inspect` | allowlisted read-only binaries (`ls`, `cat`, `rg`, `find`…) | no | nothing |
| `codemod` | `node` / `python3` script piped on stdin | no | every changed file |
| `install` | `npm install <specs>` | yes | `package.json`, `package-lock.json` only |
| `test` | `npm install` then the project's own `npm test` | yes | nothing |

`install` validates every spec against a strict registry-package pattern —
no URLs, git specs, `file:` paths, or flags — and runs with `--ignore-scripts`
so a malicious postinstall cannot execute. `install` and `test` deliberately do
**not** run through the exec allowlist: giving every codemod script network
egress to reach the registry would be a much larger hole than these two narrow,
argument-validated commands.

Both are minutes-scale (install 4 min, test 5 min plus its install), so the
Petal side allows a 10-minute round trip for them while ordinary inspect and
codemod sessions stay capped at 90 seconds.


## Local development

```sh
cd builder
npm install
cp .env.example .env   # fill in the four required vars
npm run dev
```

The service listens on `localhost:8080`. Test with:

```sh
curl http://localhost:8080/healthz
```

## Build flow

1. Main app calls `POST /build` with `{ projectId, buildId, files: ProjectFile[] }`.
2. Builder writes files to `/app/builds/<buildId>/`.
3. Runs `npm install --prefer-offline` (shared cache speeds up repeat installs).
4. Runs `npx vite build`.
5. Runs `npx wrangler pages deploy dist --project-name petal-<projectId> --branch main`.
6. POSTs callback to `PETAL_CALLBACK_URL` with `{ status: "ready", url }` or `{ status: "failed", errorMessage, logs }`.
7. Cleans up the scratch directory.

The Pages project is auto-created on first deploy. Subsequent deploys overwrite the production deployment, so the URL `https://petal-<projectId>.pages.dev` always serves the latest version — perfect for an iframe `src`.

## Cost & quotas

- **Cloudflare Pages free tier:** 500 builds/month, 1 concurrent build. Pro plan: $20/mo for 5,000 builds/5 concurrent.
- **Railway:** $5/month free credit, then ~$5/month for an always-on small Node service.
- **Build time:** typically 30–90 seconds per generation. Repeat builds of the same project hit the npm cache and run faster.
