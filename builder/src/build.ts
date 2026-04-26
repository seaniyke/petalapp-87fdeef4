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

export type BuildResult = {
  url: string;            // e.g. https://petal-abc123.pages.dev
  deploymentId?: string;  // optional, parsed from wrangler output if available
  durationMs: number;
};

export class BuildError extends Error {
  constructor(message: string, public readonly logs: string) {
    super(message);
    this.name = "BuildError";
  }
}

/** Cloudflare Pages project names: lowercase, alphanumeric + hyphens, max 58. */
function projectNameFor(projectId: string): string {
  // Use first 12 chars of projectId UUID (no hyphens) — short, unique enough.
  const id = projectId.replace(/-/g, "").slice(0, 12).toLowerCase();
  return `petal-${id}`;
}

function run(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: Record<string, string>; timeoutMs?: number }
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    const timeout = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          reject(new BuildError(`Command timed out after ${opts.timeoutMs}ms: ${cmd}`, stdout + stderr));
        }, opts.timeoutMs)
      : null;

    child.on("error", (err) => {
      if (timeout) clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export async function buildAndDeploy(
  projectDir: string,
  projectId: string,
  cloudflare: { apiToken: string; accountId: string }
): Promise<BuildResult> {
  const startedAt = Date.now();
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
  const install = await run(
    "npm",
    ["install", "--include=dev", "--no-audit", "--no-fund", "--prefer-offline"],
    {
      cwd: projectDir,
      env,
      timeoutMs: 4 * 60 * 1000, // 4 min
    }
  );
  if (install.code !== 0) {
    throw new BuildError(
      `npm install failed (exit ${install.code})`,
      install.stdout + "\n" + install.stderr
    );
  }

  // 2) Build with vite (project's own script).
  const build = await run("npx", ["vite", "build"], {
    cwd: projectDir,
    env,
    timeoutMs: 3 * 60 * 1000, // 3 min
  });
  if (build.code !== 0) {
    throw new BuildError(
      `vite build failed (exit ${build.code})`,
      build.stdout + "\n" + build.stderr
    );
  }

  const distDir = join(projectDir, "dist");

  // 3) Ensure the Cloudflare Pages project exists. Recent wrangler versions no
  //    longer reliably auto-create a project from `pages deploy --project-name`,
  //    so we create it explicitly and ignore the "already exists" case.
  const createProject = await run(
    "npx",
    ["wrangler", "pages", "project", "create", projectName, "--production-branch", "main"],
    {
      cwd: projectDir,
      env,
      timeoutMs: 90 * 1000,
    }
  );
  const createLogs = createProject.stdout + "\n" + createProject.stderr;
  if (createProject.code !== 0 && !/already exists|Project name already exists/i.test(createLogs)) {
    throw new BuildError(
      `wrangler pages project create failed (exit ${createProject.code})`,
      createLogs
    );
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
      timeoutMs: 3 * 60 * 1000,
    }
  );

  if (deploy.code !== 0) {
    throw new BuildError(
      `wrangler pages deploy failed (exit ${deploy.code})`,
      deploy.stdout + "\n" + deploy.stderr
    );
  }

  // Parse deployment URL from wrangler stdout.
  // Wrangler prints lines like:
  //   "✨ Deployment complete! Take a peek over at https://abc123.petal-xyz.pages.dev"
  //   "✨ Deployment alias URL: https://main.petal-xyz.pages.dev"
  // We prefer the stable per-project URL `https://<project>.pages.dev`.
  const stableUrl = `https://${projectName}.pages.dev`;
  const aliasMatch = deploy.stdout.match(/https:\/\/[a-z0-9-]+\.pages\.dev/g);
  const url = aliasMatch?.find((u) => u.includes(projectName)) ?? stableUrl;

  return {
    url: stableUrl, // always the stable URL — every deploy overwrites it
    deploymentId: aliasMatch?.[0]?.split("//")[1]?.split(".")[0],
    durationMs: Date.now() - startedAt,
  };
}
