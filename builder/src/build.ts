/**
 * Build a project (npm install + vite build) and deploy the dist/ folder to
 * Cloudflare Pages using wrangler. We shell out to wrangler instead of
 * implementing the Direct Upload protocol by hand because the protocol uses
 * a multi-step JWT-signed upload flow that wrangler keeps in lockstep with
 * Cloudflare's evolving API. Wrangler is bundled as a runtime dependency.
 *
 * Conventions:
 * - Pages project name = `petal-${slug}` where slug is derived from projectId.
 *   We create the project on the first deploy before asking wrangler to upload.
 * - Each deployment is unique; the project's stable URL `petal-<slug>.pages.dev`
 *   always points to the latest "production" deploy.
 * - We use --branch=main so every deploy is a "production" deployment, giving
 *   us a stable URL — preview deploys would each have their own random subdomain.
 */
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { healMaterializedProject } from "./fs-helpers.js";
import { startPreviewServer } from "./preview-server.js";
import { partitionVerificationDefects } from "./verification-report.js";
import { Heartbeat } from "./progress.js";

/** Origins allowed to embed deployed sites (Custard AI canvas + Petal). */
const FRAME_ANCESTORS_CSP =
  "frame-ancestors 'self' https://custardai.dev https://*.custardai.dev https://*.lovable.app https://usefuljohn.com https://www.usefuljohn.com https://buildwithpetal.com https://*.buildwithpetal.com;";

/**
 * How long a child process may stay completely silent before we call it
 * wedged. Generous on purpose: a large npm install on a cold cache can pause
 * for minutes between lines, and killing that is the exact failure this
 * change exists to prevent.
 */
const QUIET_MS = Number(process.env.STAGE_QUIET_MS ?? 14 * 60 * 1000);

/**
 * Result of the pre-deploy browser check. Kept structural rather than importing
 * `VerifyReport` so `build.ts` does not depend on the verifier's shape.
 */
export type PreDeployReport = { defects?: string[] };

/**
 * Runs against a local static server over `dist/`, before anything is uploaded.
 */
export type PreDeployCheck = (baseUrl: string) => Promise<PreDeployReport | undefined>;

export type BuildResult = {
  url: string;            // immutable deployment URL when Wrangler provides one
  deploymentId?: string;  // optional, parsed from wrangler output if available
  durationMs: number;
};

export class BuildError extends Error {
  constructor(message: string, public readonly logs: string) {
    super(message);
    this.name = "BuildError";
  }
}

/**
 * The app compiled and bundled, but the browser check found a runtime failure
 * while driving the built output locally. Nothing was deployed. Carries the
 * full report so the caller can hand the specific defects to a repair pass
 * instead of dead-ending the user on an opaque failure.
 */
export class VerificationBlockedError extends BuildError {
  constructor(
    message: string,
    logs: string,
    public readonly report: PreDeployReport,
    public readonly blocking: string[],
  ) {
    super(message, logs);
    this.name = "VerificationBlockedError";
  }
}


// Pages can acknowledge a successful upload several minutes before every edge
// can resolve the immutable hostname. A short retry ladder used to give up
// after only ~39 seconds despite advertising a 75-second timeout, turning a
// healthy upload into a failed deployment. Keep polling for the full five
// minute propagation window instead.
const DEPLOY_READY_TIMEOUT_MS = 25 * 60_000;
const DEPLOY_READY_POLL_MS = 10_000;
const TRANSIENT_DEPLOY_STATUSES = new Set([404, 408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]);

/**
 * Wrangler prints the immutable deployment URL first and may print branch and
 * stable aliases afterwards. Verification must use the immutable URL: the
 * stable project hostname can still point at the previous deployment while
 * the new upload is propagating, and concurrent builds can move it underneath
 * a browser check.
 */
export function deploymentUrlFromWranglerOutput(output: string, projectName: string): string {
  const urls = Array.from(output.matchAll(/https:\/\/[a-z0-9.-]+\.pages\.dev\b/gi), (match) =>
    match[0].replace(/[),.;]+$/, ""),
  );
  const immutable = urls.find((candidate) => {
    try {
      const host = new URL(candidate).hostname.toLowerCase();
      return host.endsWith(`.${projectName}.pages.dev`) && !host.startsWith("main.");
    } catch {
      return false;
    }
  });
  return immutable ?? `https://${projectName}.pages.dev`;
}

export function isTransientDeploymentStatus(status: number): boolean {
  return TRANSIENT_DEPLOY_STATUSES.has(status);
}

async function probe(url: string): Promise<{ status: number | null; error: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "PetalDeployReadiness/1.0" },
      signal: controller.signal,
    });
    return { status: response.status, error: null };
  } catch (error) {
    return { status: null, error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wait until the freshly uploaded deployment answers HTTP.
 *
 * Two things this must never do:
 *  - Fail the build because DNS for the immutable `<hash>.<project>.pages.dev`
 *    host has not propagated yet. The upload already succeeded; the stable
 *    project hostname usually serves the same deployment minutes earlier, so
 *    poll it as a fallback and verify against whichever answers first.
 *  - Turn "not reachable from this container yet" into a user-facing failure.
 *    On timeout we return `ready: false` and let verification treat an
 *    unreachable deployment as inconclusive instead of broken app code.
 */
async function waitForDeploymentReady(
  url: string,
  fallbackUrl: string,
): Promise<{ url: string; ready: boolean; detail: string }> {
  const startedAt = Date.now();
  const candidates = fallbackUrl && fallbackUrl !== url ? [url, fallbackUrl] : [url];
  let detail = "deployment did not respond";

  while (Date.now() - startedAt < DEPLOY_READY_TIMEOUT_MS) {
    for (const candidate of candidates) {
      const { status, error } = await probe(candidate);
      if (status !== null && status >= 200 && status < 400) {
        return { url: candidate, ready: true, detail: `HTTP ${status}` };
      }
      if (status !== null && !isTransientDeploymentStatus(status)) {
        throw new BuildError(
          `Deployed app returned a non-retryable response (${status})`,
          `${candidate} returned HTTP ${status}`,
        );
      }
      detail = `${candidate}: ${status !== null ? `HTTP ${status}` : error}`;
    }

    const remaining = DEPLOY_READY_TIMEOUT_MS - (Date.now() - startedAt);
    if (remaining > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(DEPLOY_READY_POLL_MS, remaining)),
      );
    }
  }

  return {
    url,
    ready: false,
    detail: `still unavailable after ${Date.now() - startedAt}ms (${detail})`,
  };
}


/** Cloudflare Pages project names: lowercase, alphanumeric + hyphens, max 58. */
function projectNameFor(projectId: string): string {
  // Use first 12 chars of projectId UUID (no hyphens) — short, unique enough.
  const id = projectId.replace(/-/g, "").slice(0, 12).toLowerCase();
  return `petal-${id}`;
}

/**
 * Spawn a child process and wait for it — for as long as it keeps talking.
 *
 * `quietMs` is an *inactivity* window, not a wall clock: every chunk of
 * stdout/stderr resets it and beats the shared heartbeat. A slow npm install
 * that prints progress runs to completion no matter how long it takes; a
 * genuinely wedged process (no output at all for the quiet window) is killed.
 */
function run(
  cmd: string,
  args: string[],
  opts: {
    cwd: string;
    env: Record<string, string>;
    /** Kill only after this long with zero output. */
    quietMs?: number;
    heartbeat?: Heartbeat;
    label?: string;
  }
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let lastOutputAt = Date.now();

    const quietMs = opts.quietMs ?? 0;
    const onOutput = () => {
      lastOutputAt = Date.now();
      opts.heartbeat?.beat(opts.label);
    };
    child.stdout.on("data", (d) => {
      stdout += d.toString();
      onOutput();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      onOutput();
    });

    const watchdog = quietMs
      ? setInterval(() => {
          if (settled) return;
          if (Date.now() - lastOutputAt < quietMs) return;
          settled = true;
          clearInterval(watchdog!);
          child.kill("SIGTERM");
          reject(
            new BuildError(
              `${opts.label ?? cmd} produced no output for ${Math.round(
                quietMs / 1000,
              )}s and looked wedged`,
              stdout + stderr,
            ),
          );
        }, Math.max(5_000, Math.min(30_000, Math.floor(quietMs / 6))))
      : null;

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      if (watchdog) clearInterval(watchdog);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (watchdog) clearInterval(watchdog);
      opts.heartbeat?.beat(opts.label);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/**
 * Run `tsc --noEmit` and return the first ~40 diagnostic lines, or null when
 * the project typechecks (or has no TypeScript at all). Never throws: the
 * typecheck is diagnostic-only and must not be able to fail a build on its own.
 */
async function runTypecheck(
  projectDir: string,
  env: Record<string, string>,
  heartbeat: Heartbeat,
): Promise<string | null> {
  try {
    const res = await run("npx", ["tsc", "--noEmit", "--pretty", "false"], {
      cwd: projectDir,
      env,
      quietMs: QUIET_MS,
      heartbeat,
      label: "checking types",
    });
    if (res.code === 0) return null;
    const lines = (res.stdout + "\n" + res.stderr)
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /error TS\d+/.test(l));
    if (lines.length === 0) return null;
    const head = lines.slice(0, 40).join("\n");
    const more = lines.length > 40 ? `\n…and ${lines.length - 40} more` : "";
    console.warn(`[typecheck] ${lines.length} diagnostic(s) in ${projectDir}`);
    return head + more;
  } catch (e) {
    console.warn("[typecheck] skipped:", (e as Error).message);
    return null;
  }
}

export async function buildAndDeploy(

  projectDir: string,
  projectId: string,
  cloudflare: { apiToken: string; accountId: string },
  options: { preDeployCheck?: PreDeployCheck; heartbeat?: Heartbeat } = {},
): Promise<BuildResult> {

  const startedAt = Date.now();
  const heartbeat = options.heartbeat ?? new Heartbeat("installing dependencies");
  heartbeat.beat("installing dependencies");
  const projectName = projectNameFor(projectId);

  const env = {
    CLOUDFLARE_API_TOKEN: cloudflare.apiToken,
    CLOUDFLARE_ACCOUNT_ID: cloudflare.accountId,
  };

  // 1) Install deps. Use a shared cache (set on the Dockerfile) so repeat builds
  //    of similar projects skip the slow part.
  //
  //    --include=dev is REQUIRED: Railway sets NODE_ENV=production by default for
  //    Node services, and `npm install` silently skips devDependencies in that mode.
  //    Petal-generated package.json files put vite, @vitejs/plugin-react, typescript,
  //    and @types/* under devDependencies (see src/server/generate.server.ts), so
  //    without this flag `npx vite build` fails with "Cannot find package 'vite'".
  // --legacy-peer-deps: Petal scaffolds occasionally combine packages with
  // conflicting peerDependencies (e.g. Expo + React 18 + a transitively
  // resolved @react-three/fiber@9 that wants React 19). npm 7+ treats this
  // as a hard error by default; we fall back to npm 6 behavior so the
  // install succeeds. We separately pin known packages to compatible
  // versions in known-packages.ts, but this is the belt to the suspenders.
  const install = await run(
    "npm",
    ["install", "--include=dev", "--legacy-peer-deps", "--no-audit", "--no-fund", "--prefer-offline"],
    {
      cwd: projectDir,
      env,
      quietMs: QUIET_MS,
      heartbeat,
      label: "installing dependencies",
    }
  );

  if (install.code !== 0) {
    throw new BuildError(
      `npm install failed (exit ${install.code})`,
      install.stdout + "\n" + install.stderr
    );
  }

  // Compile-time last line of defense. Vite reads bytes from disk, so re-run
  // the deterministic healer against those exact bytes after dependency
  // installation and immediately before tsc/Vite. This closes every payload,
  // retry, and materialization bypass by construction.
  const preCompileNotes = await healMaterializedProject(projectDir);
  if (preCompileNotes.length > 0) {
    console.warn(`[pre-compile-heal] ${preCompileNotes.join("; ")}`);
  }

  // 1b) TypeScript gate. `vite build` does NOT typecheck — it hands modules to
  //     esbuild/rollup, which fails late and reports a truncated rollup tail
  //     that says nothing about the actual mistake. 76% of all Petal build
  //     failures land here. Running `tsc --noEmit` first costs one pass over an
  //     already-installed tree and gives us the real diagnostics.
  //
  //     This is deliberately NON-FATAL: a type error that rollup can still
  //     bundle must never cost the user a working preview. We only surface the
  //     diagnostics, and attach them to the failure when vite does blow up.
  //     Runs ALONGSIDE vite rather than before it: it is diagnostic-only, and
  //     type-checking the whole starter kit sequentially added its full
  //     duration to every build's critical path.
  const typecheckPromise = runTypecheck(projectDir, env, heartbeat);

  // 2) Build with vite (project's own script).
  heartbeat.beat("compiling the app");
  const build = await run("npx", ["vite", "build"], {
    cwd: projectDir,
    env,
    quietMs: QUIET_MS,
    heartbeat,
    label: "compiling the app",
  });
  const typecheck = await typecheckPromise;
  if (build.code !== 0) {
    const viteLogs = build.stdout + "\n" + build.stderr;
    throw new BuildError(
      `vite build failed (exit ${build.code})`,
      typecheck
        ? `TypeScript diagnostics (root cause is usually here):\n${typecheck}\n\n--- vite output ---\n${viteLogs}`
        : viteLogs
    );
  }


  const distDir = join(projectDir, "dist");

  // 2b) Write a Cloudflare Pages `_headers` file into dist/ so every response
  //     from the deployed preview includes `Cross-Origin-Resource-Policy:
  //     cross-origin`. Without this, the petal app (which sets COEP on its own
  //     pages to enable WebContainers) cannot embed the deployed preview in
  //     an iframe — the iframe renders blank. We do this in the builder rather
  //     than the AI template so existing projects also pick up the fix on
  //     their next deploy.
  //     See: https://developers.cloudflare.com/pages/configuration/headers/
  //     frame-ancestors lets Custard AI's canvas (and Petal) embed the site.
  const headersFile = `/*\n  Cross-Origin-Resource-Policy: cross-origin\n  Access-Control-Allow-Origin: *\n  Content-Security-Policy: ${FRAME_ANCESTORS_CSP}\n`;
  await writeFile(join(distDir, "_headers"), headersFile, "utf8");

  // 2c) Pre-deploy browser check. The verifier drives the real built output
  //     over a throwaway localhost server, so a runtime failure is caught
  //     before anything is uploaded and before the user ever sees it. Running
  //     it here also means CDN propagation can no longer masquerade as an app
  //     defect — there is no CDN in front of 127.0.0.1.
  //
  //     A verifier that cannot run is not a build failure: the bundle is real
  //     either way, so we deploy and report the check as skipped.
  if (options.preDeployCheck) {
    heartbeat.beat("testing the app in a browser");
    let verification: PreDeployReport | undefined;
    const preview = await startPreviewServer(distDir);
    try {
      verification = await options.preDeployCheck(preview.baseUrl);
    } finally {
      await preview.close().catch(() => {});
    }
    const blocking = partitionVerificationDefects(verification?.defects).blocking;
    if (blocking.length > 0) {
      throw new VerificationBlockedError(
        "The app built successfully, but Petal's browser check found a runtime failure before deploying.",
        blocking.map((defect) => `- ${defect}`).join("\n"),
        verification ?? {},
        blocking,
      );
    }
  }

  // 3) Ensure the Cloudflare Pages project exists. We hit the Cloudflare REST

  //    API directly instead of `wrangler pages project create` because wrangler
  //    surfaces the "already exists" case as an opaque `code: 8000000` unknown
  //    error on some accounts, which is indistinguishable from a real failure.
  //    GET-then-POST is unambiguous: 200 = exists, 404 = create it.
  heartbeat.beat("publishing the app");
  // This step is advisory. For every redeploy the project already exists, so a
  // network hiccup while *checking* must never cost the user a build — carry on
  // to wrangler, which fails loudly and specifically if the project is really
  // missing. Only a definitive API answer (auth, validation) still stops us.
  try {
    await ensurePagesProject(projectName, cloudflare);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const transport =
      !(err instanceof BuildError) ||
      /abort|timeout|fetch failed|network|ECONNRESET|ETIMEDOUT|\(5\d\d\)|\(429\)/i.test(detail);
    if (!transport) throw err;
    console.warn(`[build] Pages project check skipped (${detail}); deploying anyway`);
  }


  // 4) Deploy to Cloudflare Pages. --branch=main makes this a production deploy
  //    so the URL `<project>.pages.dev` updates. --commit-dirty avoids the "you
  //    have uncommitted changes" prompt.
  const deploy = await run(
    "npx",
    [
      "wrangler",
      "pages",
      "deploy",
      distDir,
      "--project-name", projectName,
      "--branch", "main",
      "--commit-dirty=true",
    ],
    {
      cwd: projectDir,
      env,
      quietMs: QUIET_MS,
      heartbeat,
      label: "publishing the app",
    }
  );

  if (deploy.code !== 0) {
    throw new BuildError(
      `wrangler pages deploy failed (exit ${deploy.code})`,
      deploy.stdout + "\n" + deploy.stderr
    );
  }

  // Parse the immutable deployment URL from wrangler stdout.
  // Wrangler prints lines like:
  //   "✨ Deployment complete! Take a peek over at https://abc123.petal-xyz.pages.dev"
  //   "✨ Deployment alias URL: https://main.petal-xyz.pages.dev"
  // Browser verification must not start until the host has finished publishing
  // the upload. A transient 522 here is deployment propagation, not broken app
  // code, and must never be sent into the user's repair loop.
  const url = deploymentUrlFromWranglerOutput(`${deploy.stdout}\n${deploy.stderr}`, projectName);
  const stableUrl = `https://${projectName}.pages.dev`;
  const readiness = await waitForDeploymentReady(url, stableUrl);
  if (!readiness.ready) {
    // Upload succeeded; only our reachability probe timed out. Ship the URL and
    // let verification decide — failing here would burn the user's build.
    console.warn(`[deploy] readiness probe inconclusive: ${url} ${readiness.detail}`);
  }
  const hostname = new URL(url).hostname;

  return {
    url: readiness.ready ? readiness.url : url,
    deploymentId: hostname.endsWith(`.${projectName}.pages.dev`)
      ? hostname.split(".")[0]
      : undefined,
    durationMs: Date.now() - startedAt,

  };

}

/**
 * Ensure a Cloudflare Pages project exists. Uses the REST API directly:
 *  - GET /accounts/:id/pages/projects/:name → 200 if it exists, 404 if not.
 *  - POST /accounts/:id/pages/projects     → create when missing.
 *
 * This sidesteps wrangler's habit of mapping "already exists" to an opaque
 * `code: 8000000` error on some accounts, which blocked every redeploy.
 */
/**
 * Cloudflare API calls occasionally abort at the network layer on Railway
 * ("The operation was aborted due to timeout"). That is infrastructure noise,
 * not a broken app, so retry a few times before burning the user's build.
 */
async function cfFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, Math.min(8_000, 1_500 * attempt)));
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(90_000) });
      if (res.status >= 500 || res.status === 429) {
        lastError = new Error(`Cloudflare responded ${res.status}`);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function ensurePagesProject(
  projectName: string,
  cloudflare: { apiToken: string; accountId: string }
): Promise<void> {
  const base = `https://api.cloudflare.com/client/v4/accounts/${cloudflare.accountId}/pages/projects`;
  const headers = {
    Authorization: `Bearer ${cloudflare.apiToken}`,
    "Content-Type": "application/json",
  };

  const projectUrl = `${base}/${projectName}`;
  const projectExists = async (): Promise<boolean> => {
    const response = await cfFetch(projectUrl, { headers });
    if (response.ok) return true;
    if (response.status === 404 || response.status === 410) return false;

    const body = await response.text().catch(() => "");
    throw new BuildError(
      `Cloudflare Pages GET project failed (${response.status})`,
      body
    );
  };

  if (await projectExists()) return;

  let lastStatus = 0;
  let lastBody = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      // A successful create is not always immediately visible through the GET
      // endpoint. Re-check before issuing another POST so concurrent builds do
      // not fight over the same deterministic project name.
      await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
      if (await projectExists()) return;
    }

    const createRes = await cfFetch(base, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: projectName,
        production_branch: "main",
      }),
    });
    if (createRes.ok) return;

    lastStatus = createRes.status;
    lastBody = await createRes.text().catch(() => "");
    // A concurrent request can create the project between our GET and POST.
    if (/already exists|duplicate/i.test(lastBody)) return;

    // Cloudflare sometimes accepts creation but responds with its opaque
    // 8000000 error. Only that response, rate limits, and server failures are
    // safe to retry; auth and validation failures remain immediately visible.
    const retryable =
      createRes.status === 429 ||
      createRes.status >= 500 ||
      /"code"\s*:\s*8000000/.test(lastBody);
    if (!retryable) {
      throw new BuildError(
        `Cloudflare Pages create project failed (${createRes.status})`,
        lastBody
      );
    }
  }

  // One final eventual-consistency check handles a create accepted by the last
  // POST even when its response was an opaque 500.
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  if (await projectExists()) return;

  throw new BuildError(
    `Cloudflare Pages create project failed after retries (${lastStatus})`,
    lastBody
  );
}
