# Automatic build server updates (GitHub Actions + SSH) — review plan

Nothing in this plan turns on automatic updates, touches the VPS, or deploys anything. It ends with files in the repo, switched off.

## What I found in the repo

- `builder/` is a standalone Node 20 service (Fastify). `builder/Dockerfile` installs deps and Chromium, compiles TypeScript, and copies `vendor/agent-core.mjs`.
- `builder/vendor/agent-core.version.json` holds the sha256 of the bundle. `/agent/healthz` hashes the file inside the running container and returns `version`, `coreHash`, `inProcess`, `inFlight` and `queued`. The deploy can compare the two directly.
- `AGENT_CORE_VERSION` is a constant in `builder/src/server.ts` (currently `2026-11-07-distinct-pictures`).
- `/healthz` returns `inFlight`, `queued` (builds), `execInFlight`, `execQueued` (exec, browse, install, test) and `active[]` (live build heartbeats).
- All job state lives in memory, in 3 pools: builds, exec/browse, and agent generation. Replacing the container kills anything running.
- Petal's app already retries `/build` on 502/503/504 for about 37 seconds (`src/server/builder.server.ts`). A swap of a few seconds behind nginx is absorbed for builds. The agent-generation caller's handling of a brief 502 is unverified, so the idle gate below matters.
- Generation-code changes always rebuild `builder/vendor/*`, so a `builder/**` path filter catches every change that needs a redeploy.
- The repo has no `.github/` folder yet. `builder/railway.json` and the README still describe Railway. They stay as they are.

## Files to add (all inert until you enable them)

```text
.github/workflows/deploy-builder.yml     workflow, gated off by a repo variable
deploy/builder/petal-deploy-wrapper      forced-command SSH gate (reference copy)
deploy/builder/petal-builder-deploy      root deploy + rollback script (reference copy)
deploy/builder/sudoers.petal-deploy      one-line sudo rule
deploy/builder/README.md                 one-time VPS setup, rollback runbook
builder/AGENTS.md                        one rule: how the builder is deployed
```

The VPS never runs the copies in `deploy/` from the git checkout. You install them once into `/usr/local/sbin`, owned by root. That way, a commit that changes those files cannot change what runs as root.

No changes to the Petal app, the database, billing, auth, nginx, Kimble or CustardAI.

## 1. GitHub workflow

- Triggers: `push` to `main` with `paths: builder/**`, plus `workflow_dispatch` (a manual button).
- Off switch: the job runs only when the repo variable `BUILDER_AUTODEPLOY == 'true'`. Manual runs work only from `main`.
- `concurrency: { group: petal-builder-deploy, cancel-in-progress: false }`. Runs queue and never overlap.
- `permissions: contents: read`. No code checkout and no third-party actions; only the runner's own `ssh`.
- Uses a GitHub Environment `production`, so you can require your approval for each deploy.
- Host key pinned from a secret (`StrictHostKeyChecking=yes`). Never `no`.
- The commit id goes in through `env:` and is never written directly into the shell script. Interpolation-safe. The only thing sent over SSH is `deploy <40-hex-sha>`.
- Job timeout: 45 minutes.

## 2. Restricted SSH identity

- New user `petal-deploy`: no password, not in the `docker` group (docker access is equal to root), no sudo except one rule.
- `authorized_keys` entry: `restrict,command="/usr/local/sbin/petal-deploy-wrapper" ssh-ed25519 ...`. No shell, no pty, no forwarding.
- The wrapper reads `SSH_ORIGINAL_COMMAND` and accepts only `deploy <sha>` or `status`. The sha must match `^[0-9a-f]{40}$`. Anything else exits 2. It then runs `sudo /usr/local/sbin/petal-builder-deploy <sha>`.
- sudoers allows exactly that one script, `NOPASSWD`, with no other commands.
- The VPS uses its own separate read-only GitHub deploy key to fetch `seaniyke/petalapp-87fdeef4` into `/opt/petal-source`. The Actions key cannot read the repo, and the VPS key cannot push.

## 3. Deploy script (`petal-builder-deploy <sha>`)

1. **Lock:** `flock -n /run/lock/petal-builder-deploy.lock`. If it is held, exit with "deploy already running".
2. **Source:** `git fetch origin main` in `/opt/petal-source`. Refuse unless the sha is on `origin/main` (`merge-base --is-ancestor`).
3. **Expected values from that commit:** `AGENT_CORE_VERSION` from `builder/src/server.ts`, the hash from `agent-core.version.json`, and the actual sha256 of `agent-core.mjs`. Abort if the file and the json disagree.
4. **Config drift check:** read the live `petal-builder` container through `docker inspect` (formatted fields only, never `Config.Env`). Confirm the ports, network, volume, memory, CPUs, pids, restart policy and shm size match the script's expected values. On any mismatch, abort without changing anything.
5. **Stage:** `git archive <sha> builder | tar -x` into `/opt/petal-builder/releases/<sha>` (a clean tree, no stray files). Then `rsync` into `/opt/petal-builder`, protecting `.env` (`--filter='P .env'`).
6. **Build:** `docker build -t petal-builder:<short-sha>` while the old container keeps serving. Tag the running image as `petal-builder:previous` first.
7. **Idle gate (bounded):** poll `127.0.0.1:8086/healthz` and `/agent/healthz` every 20 seconds. Every counter (`inFlight`, `queued`, `execInFlight`, `execQueued`, `active.length`, agent `inFlight`/`queued`) must be 0 on two reads in a row. Wait up to 30 minutes, then exit `75 (deferred)` with nothing changed. The new image stays built, so a manual re-run is fast.
8. **Swap:** `docker rename petal-builder petal-builder-prev`, then `docker stop` it (not `rm`). Run the new container with the identical flags: `--name petal-builder --network petal-net -p 127.0.0.1:8086:8080 --env-file /opt/petal-builder/.env -v petal-workspaces:/tmp --memory 8g --cpus 4 --pids-limit 4096 --restart unless-stopped`, plus any extra flags the inspect step finds. `AGENT_IN_PROCESS` stays whatever `.env` already says. No new variables.
9. **Health:** within 90 seconds, `/healthz` must be `ok: true`, and `/agent/healthz` must report the expected `version`, a `coreHash` equal to the commit's hash, and the same `inProcess` value as before. Then the same checks run through `https://builder-main.custardai.dev`.
10. **Rollback on any failure from step 8 on:** stop and remove the new container, rename `petal-builder-prev` back, start it, and re-check `/healthz`. Exit non-zero so the GitHub run shows red.
11. **Success:** remove the stopped `petal-builder-prev` container. Keep `petal-builder:previous` plus the last 3 `petal-builder:<sha>` images. Remove older ones by exact tag only. Never `docker system/image prune`, never restart Docker, never touch other containers.
12. **Logs:** only step names, the sha, version and hash prefix, and health counters. Never env vars, inspect env output or headers.

## 4. Manual rollback runbook (in `deploy/builder/README.md`)

- `ssh petal-deploy@vps status` shows the current and previous image tags and the health result.
- Rolling back to `petal-builder:previous` uses the same run flags, done by an admin on the VPS. The README gives the exact commands, and they are scoped to `petal-builder` only.

## GitHub settings you will add (when we enable it)

| Name | Kind | Value |
|---|---|---|
| `VPS_HOST` | Secret | VPS address |
| `VPS_SSH_PORT` | Secret (optional) | defaults to 22 |
| `VPS_DEPLOY_KEY` | Secret | private ed25519 key for `petal-deploy` |
| `VPS_KNOWN_HOSTS` | Secret | output of `ssh-keyscan -t ed25519 <host>`, checked against the VPS fingerprint |
| `BUILDER_AUTODEPLOY` | Variable | leave unset (off) until the first manual run passes |
| Environment `production` | Setting | optional: require your approval per deploy |

No Cloudflare, Petal, database or AI keys go to GitHub.

## Needed from you before I write the scripts

Run this read-only command on the VPS and paste the output. It leaves out environment variables, so no secrets are shown:

```bash
docker inspect petal-builder --format '{{.Config.Image}} | {{json .HostConfig.PortBindings}} | {{.HostConfig.Memory}} {{.HostConfig.NanoCpus}} {{.HostConfig.PidsLimit}} {{.HostConfig.ShmSize}} | {{.HostConfig.RestartPolicy.Name}} | {{json .Mounts}} | {{json .HostConfig.CapAdd}} {{json .HostConfig.SecurityOpt}} {{.HostConfig.Init}} {{.Config.User}} | {{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
```

Also confirm: is `/opt/petal-source` a clone of the GitHub repo, and over HTTPS or SSH?

## Known limits

- **Swap gap:** a request can arrive between the last idle check and the stop. The gap is about 1 second, and the new container starts in a few seconds. Builds retry through it.
- **Optional extra fix (needs your OK):** a drain flag in `builder/src/server.ts`. New `/build`, `/exec`, `/browse` and `/agent/generate` requests get 503 while existing jobs finish. This would close the gap completely. It is a small builder code change, so it is not included unless you approve it.
- **Load during build:** `docker build` competes for CPU with live jobs while the old container serves. Chromium layers are cached unless `builder/package.json` changes.
- **GitHub runner IPs** change constantly, so `from=` IP pinning on the key isn't practical. The forced command plus single sudo rule is the boundary.
