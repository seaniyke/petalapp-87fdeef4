# Petal Builder — automatic deploys (GitHub Actions → VPS)

When something under `builder/` lands on `main`, GitHub Actions connects to the
VPS with a restricted key and asks it to deploy that exact commit. The VPS
builds a new image, waits until no builds are running, swaps the
`petal-builder` container, checks health and the agent-core hash, and puts the
old container back if anything fails.

**Off by default.** Nothing runs until the repository variable
`BUILDER_AUTODEPLOY` is `true`.

## Files

| File | Where it runs | Purpose |
|---|---|---|
| `.github/workflows/deploy-builder.yml` | GitHub | Sends `deploy <sha>` over SSH. No checkout, read-only token. |
| `deploy/builder/petal-deploy-wrapper` | VPS `/usr/local/sbin` | Forced command: only `deploy <40-hex>` or `status`. |
| `deploy/builder/sudoers.petal-deploy` | VPS `/etc/sudoers.d` | Lets `petal-deploy` run only that one script. |
| `deploy/builder/petal-builder-deploy` | VPS `/usr/local/sbin` | Build, idle gate, swap, health, rollback. |

The VPS never runs these from the git checkout. Copy them by hand. When they
change in git, review the change, then reinstall them yourself. A commit cannot
change what runs as root.

## One-time VPS setup (as root)

These steps read and add files only. They do not restart Docker, nginx, Kimble
or CustardAI.

### 0. Confirm the live container matches the script

The script refuses to deploy if the live container differs from its expected
settings. Check first (this command leaves out environment values):

```bash
docker inspect petal-builder --format '{{.Config.Image}} | {{json .HostConfig.PortBindings}} | {{.HostConfig.Memory}} {{.HostConfig.NanoCpus}} {{.HostConfig.PidsLimit}} {{.HostConfig.ShmSize}} | {{.HostConfig.RestartPolicy.Name}} | {{json .Mounts}} | {{json .HostConfig.CapAdd}} {{json .HostConfig.SecurityOpt}} {{.HostConfig.Init}} {{.Config.User}} | {{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}'
```

Expected: port `127.0.0.1:8086→8080`, memory `8589934592` (8g), NanoCpus
`4000000000`, pids `4096`, restart `unless-stopped`, one volume
`petal-workspaces` at `/tmp`, network `petal-net` only, no caps or
security options. If any value differs (for example memory is `8000000000`),
edit the constants at the top of `petal-builder-deploy` before installing.
Shared memory size, `--init`, `--memory-swap` and log options are copied over
automatically.

The script also checks that every environment variable *name* in the running
container comes from the image or `/opt/petal-builder/.env`. If a variable was
passed with `-e` when the container was created, move it into `.env` first.

### 1. Tools

```bash
apt-get install -y jq rsync curl git   # flock/sha256sum ship with Ubuntu
sudo --version | head -1               # needs >= 1.9.10 (24.04 has 1.9.15)
```

### 2. Read-only access from the VPS to GitHub

`/opt/petal-source` must be able to `git fetch origin main` as root without a
prompt. If it doesn't already, create a **read-only deploy key** for the
repository and use it only for fetching:

```bash
ssh-keygen -t ed25519 -N '' -C petal-source-readonly -f /root/.ssh/petal_source_ro
# GitHub repo → Settings → Deploy keys → Add key → paste /root/.ssh/petal_source_ro.pub
#   (leave "Allow write access" UNCHECKED)
git -C /opt/petal-source remote set-url origin git@github.com:seaniyke/petalapp-87fdeef4.git
git -C /opt/petal-source config core.sshCommand "ssh -i /root/.ssh/petal_source_ro -o IdentitiesOnly=yes"
git -C /opt/petal-source fetch origin main    # must succeed without a prompt
```

### 3. Deploy user (no shell access, no docker group)

```bash
useradd --system --create-home --shell /bin/bash petal-deploy
passwd -l petal-deploy
install -d -o petal-deploy -g petal-deploy -m 0700 /home/petal-deploy/.ssh
```

Do **not** add `petal-deploy` to the `docker` group (that equals root).

### 4. Install the scripts and sudo rule

From a reviewed copy of this folder:

```bash
install -o root -g root -m 0755 petal-deploy-wrapper  /usr/local/sbin/petal-deploy-wrapper
install -o root -g root -m 0750 petal-builder-deploy  /usr/local/sbin/petal-builder-deploy
install -o root -g root -m 0440 sudoers.petal-deploy  /etc/sudoers.d/petal-deploy
visudo -cf /etc/sudoers.d/petal-deploy
```

### 5. Key used by GitHub Actions

Create this on your own machine, not on the VPS:

```bash
ssh-keygen -t ed25519 -N '' -C github-actions-petal-builder -f petal_deploy_gha
```

On the VPS, put the **public** key in `/home/petal-deploy/.ssh/authorized_keys`
as a single line:

```text
restrict,command="/usr/local/sbin/petal-deploy-wrapper" ssh-ed25519 AAAA...  github-actions-petal-builder
```

```bash
chown petal-deploy:petal-deploy /home/petal-deploy/.ssh/authorized_keys
chmod 0600 /home/petal-deploy/.ssh/authorized_keys
```

### 6. Dry checks (no deploy)

From your machine:

```bash
ssh -i petal_deploy_gha petal-deploy@<vps> status   # prints container + health
ssh -i petal_deploy_gha petal-deploy@<vps> id       # must print "command not allowed"
ssh -i petal_deploy_gha -t petal-deploy@<vps>       # must not give a shell
```

## GitHub settings

Repo → Settings → Secrets and variables → Actions:

| Name | Type | Value |
|---|---|---|
| `VPS_HOST` | Secret | VPS hostname or IP |
| `VPS_SSH_PORT` | Secret (optional) | SSH port, default 22 |
| `VPS_DEPLOY_KEY` | Secret | contents of `petal_deploy_gha` (private key) |
| `VPS_KNOWN_HOSTS` | Secret | `ssh-keyscan -t ed25519 <vps>` output, after checking the fingerprint against `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the VPS |
| `BUILDER_AUTODEPLOY` | Variable | leave unset until the first manual run passes |

Optional: Settings → Environments → `production` → Required reviewers, so every
deploy waits for your approval.

No Cloudflare, Petal, database or AI keys go into GitHub. Delete the local
`petal_deploy_gha` file after saving it as a secret.

## Turning it on

1. Set `BUILDER_AUTODEPLOY` = `true`.
2. Actions → **Deploy Petal Builder** → **Run workflow** on `main`.
3. Watch for `SUCCESS: <sha> live (version=... core=...)`.
4. From then on, every `builder/**` change on `main` deploys automatically.

To turn it off, delete the variable or set it to anything other than `true`.

## What a deploy does

1. Locks, so only one deploy runs at a time (exit 73 if one is already running).
2. Fetches `main`; refuses a commit that isn't on `origin/main`.
3. Reads `AGENT_CORE_VERSION` and the agent-core hash from that commit, and
   checks the bundle matches its hash file.
4. Checks the live container's settings match (exit 3, nothing changed, if not).
5. Unpacks `builder/` from that commit into `/opt/petal-builder/releases/<sha>`
   and copies it into `/opt/petal-builder`. `.env` and any other files you keep
   there are never touched or deleted.
6. Tags the running image `petal-builder:previous`, then builds
   `petal-builder:<sha12>` while the old builder keeps serving.
7. Waits up to 30 minutes for zero running or queued builds, exec sessions and
   generations (two zero readings in a row). If that never happens, it exits 75
   ("deferred"). Nothing is changed and the new image is kept, so re-running
   later is fast.
8. Renames the old container to `petal-builder-prev`, stops it, and starts the
   new one with the same flags and `.env` (so `AGENT_IN_PROCESS` is unchanged).
9. Requires, locally and through `https://builder-main.custardai.dev`:
   `/healthz` ok, and `/agent/healthz` with the new version, the exact core
   hash, and the same `inProcess` value as before.
10. On any failure: removes the new container, renames and starts the old one,
    checks it is healthy, exits 1. If even that fails: exit 90 (see below).
11. On success: removes the stopped old container, keeps `:previous` plus the 3
    newest `petal-builder:<sha12>` images, and deletes older ones by exact tag.

Logs: `/var/log/petal-builder-deploy/` (root only). They never contain
environment values.

| Exit | Meaning |
|---|---|
| 0 | Deployed and verified |
| 1 | Failed; previous builder restored (or build failed before any swap) |
| 2 | Bad usage |
| 3 | Refused before changing anything (not on main, hash mismatch, config drift, leftover container) |
| 73 | Another deploy is running |
| 75 | Deferred: builder stayed busy, nothing changed |
| 90 | Restore failed; manual action needed |

## Rollback runbook

**Undo the last successful deploy** (as root on the VPS):

```bash
/usr/local/sbin/petal-builder-deploy rollback
```

This waits for idle, swaps back to `petal-builder:previous` with the same flags,
and keeps the replaced image as `petal-builder:rolled-back`. It is not
available over the GitHub SSH key.

**Exit 90, or a leftover `petal-builder-prev` from an interrupted run:**

```bash
docker ps -a --filter name='^petal-builder' --format '{{.Names}}  {{.Status}}  {{.Image}}'
# If petal-builder is missing or broken and petal-builder-prev exists:
docker rm -f petal-builder 2>/dev/null || true
docker rename petal-builder-prev petal-builder
docker start petal-builder
curl -s http://127.0.0.1:8086/agent/healthz
```

Only `petal-builder*` names are touched. Never run `docker system prune`,
`docker image prune` or `systemctl restart docker` on this host.

## Known limits

- **Swap gap:** a request can arrive in the roughly 1 second between the last
  idle check and the stop. The new container starts in a few seconds, and Petal
  retries `/build` on 502/503 for about 37 seconds. A drain mode in the builder
  would close the gap completely; it isn't built yet.
- **CPU during build:** `docker build` shares CPU with live jobs while the old
  builder is still serving.
- **IP pinning:** GitHub's runner IPs change, so the key isn't limited by IP.
  The forced command plus the single sudo rule are the boundary.
- **Pushing the workflow file:** if the repo sync can't push files under
  `.github/workflows/`, add `deploy-builder.yml` through GitHub's web editor
  with the same contents.
