/**
 * Dependency + test surface for the builder.
 *
 * `exec.ts` deliberately runs with a stripped environment, no network-capable
 * binaries, and short wall clocks — that's right for grep/codemod work and
 * wrong for the two things it cannot do: install a package, and run the
 * project's own test suite. Those need the real npm registry, the shared npm
 * cache, and minutes rather than seconds, so they live here behind their own
 * validation instead of being bolted onto the exec allowlist (which would have
 * handed every codemod script a network egress it has no business having).
 *
 * Both entry points take an already-materialized project directory.
 */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface ProjectFile {
  path: string;
  content: string;
}

export interface CommandResult {
  bin: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
  timedOut: boolean;
}

export interface DepsSessionResult {
  results: CommandResult[];
  /** package.json / lockfile after an install. Empty for test runs. */
  changedFiles: ProjectFile[];
  deletedPaths: string[];
}

export class DepsError extends Error {}

export const MAX_PACKAGES_PER_INSTALL = 12;
export const INSTALL_TIMEOUT_MS = 4 * 60 * 1000;
export const TEST_INSTALL_TIMEOUT_MS = 4 * 60 * 1000;
export const TEST_TIMEOUT_MS = 5 * 60 * 1000;
const OUTPUT_CAP_BYTES = 48 * 1024;

/**
 * npm package spec: optional scope, name, optional @version range.
 * Deliberately strict — no URLs, no git specs, no `file:`, no flags. Anything
 * that isn't a plain registry package is rejected rather than sanitized.
 */
const PACKAGE_SPEC =
  /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(@[a-z0-9][a-z0-9.^~*+><=|\- ]*)?$/i;

export function assertPackageSpecs(specs: unknown): string[] {
  if (!Array.isArray(specs) || specs.length === 0) {
    throw new DepsError("packages must be a non-empty array");
  }
  if (specs.length > MAX_PACKAGES_PER_INSTALL) {
    throw new DepsError(`Too many packages (max ${MAX_PACKAGES_PER_INSTALL})`);
  }
  return specs.map((raw) => {
    if (typeof raw !== "string") throw new DepsError("package specs must be strings");
    const spec = raw.trim();
    if (!spec || spec.length > 128) throw new DepsError(`Invalid package spec: ${raw}`);
    if (spec.startsWith("-")) throw new DepsError(`Flags are not allowed: ${raw}`);
    if (!PACKAGE_SPEC.test(spec)) throw new DepsError(`Invalid package spec: ${raw}`);
    return spec;
  });
}

function run(
  bin: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<CommandResult> {
  const started = Date.now();
  return new Promise<CommandResult>((resolvePromise) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      shell: false,
      env: {
        ...process.env,
        // Never hand project scripts our deploy credentials.
        CLOUDFLARE_API_TOKEN: "",
        CLOUDFLARE_ACCOUNT_ID: "",
        BUILDER_SHARED_SECRET: "",
        PETAL_CALLBACK_URL: "",
        CI: "1",
        NODE_ENV: "development",
        NO_COLOR: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        bin,
        args,
        exitCode,
        stdout,
        stderr,
        truncated,
        timedOut,
        durationMs: Date.now() - started,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      finish(null);
    }, opts.timeoutMs);

    const append = (chunk: string, which: "out" | "err") => {
      const current = which === "out" ? stdout : stderr;
      if (current.length >= OUTPUT_CAP_BYTES) {
        truncated = true;
        return;
      }
      const room = OUTPUT_CAP_BYTES - current.length;
      const slice = chunk.length > room ? chunk.slice(0, room) : chunk;
      if (which === "out") stdout += slice;
      else stderr += slice;
      if (chunk.length > room) truncated = true;
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (c: string) => append(c, "out"));
    child.stderr?.on("data", (c: string) => append(c, "err"));
    child.on("error", (err) => {
      stderr += `\n${err.message}`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}

/** Files an install is allowed to hand back. Nothing else can change. */
const INSTALL_RETURNABLE = ["package.json", "package-lock.json"];

async function readIfChanged(
  root: string,
  path: string,
  original: ProjectFile[],
): Promise<ProjectFile | null> {
  const content = await readFile(join(root, path), "utf8").catch(() => null);
  if (content == null) return null;
  const before = original.find((f) => f.path === path)?.content;
  if (before === content) return null;
  // A lockfile can be megabytes; the caller keeps it out of model context but
  // still needs it persisted, so we cap only absurd sizes.
  if (content.length > 4 * 1024 * 1024) return null;
  return { path, content };
}

/**
 * `npm install <specs>` against the materialized project, returning the
 * updated package.json (and lockfile) so the caller can persist them.
 */
export async function runInstallSession(args: {
  root: string;
  packages: string[];
  dev: boolean;
  original: ProjectFile[];
}): Promise<DepsSessionResult> {
  const specs = assertPackageSpecs(args.packages);
  const result = await run(
    "npm",
    [
      "install",
      args.dev ? "--save-dev" : "--save",
      ...specs,
      "--legacy-peer-deps",
      "--no-audit",
      "--no-fund",
      "--ignore-scripts",
    ],
    { cwd: args.root, timeoutMs: INSTALL_TIMEOUT_MS },
  );

  const changedFiles: ProjectFile[] = [];
  if (result.exitCode === 0) {
    for (const path of INSTALL_RETURNABLE) {
      const file = await readIfChanged(args.root, path, args.original);
      if (file) changedFiles.push(file);
    }
  }
  return { results: [result], changedFiles, deletedPaths: [] };
}

function testCommandFor(pkgJson: string): { bin: string; args: string[] } | null {
  let scripts: Record<string, string> = {};
  try {
    scripts = (JSON.parse(pkgJson)?.scripts ?? {}) as Record<string, string>;
  } catch {
    return null;
  }
  const script = scripts.test;
  if (!script || /no test specified/i.test(script)) return null;
  // vitest/jest watch by default outside CI; force a single run.
  if (/\bvitest\b/.test(script) && !/\brun\b/.test(script)) {
    return { bin: "npm", args: ["run", "test", "--", "--run"] };
  }
  return { bin: "npm", args: ["run", "test"] };
}

/**
 * Install the project's own dependencies, then run its own `npm test`.
 * Read-only with respect to source: nothing is diffed back.
 */
export async function runTestSession(args: {
  root: string;
}): Promise<DepsSessionResult> {
  const pkgJson = await readFile(join(args.root, "package.json"), "utf8").catch(() => null);
  if (!pkgJson) throw new DepsError("This project has no package.json, so it has no test suite.");
  const cmd = testCommandFor(pkgJson);
  if (!cmd) {
    throw new DepsError(
      'This project has no "test" script in package.json, so there is nothing to run.',
    );
  }

  const install = await run(
    "npm",
    ["install", "--include=dev", "--legacy-peer-deps", "--no-audit", "--no-fund", "--prefer-offline"],
    { cwd: args.root, timeoutMs: TEST_INSTALL_TIMEOUT_MS },
  );
  if (install.exitCode !== 0) {
    return { results: [install], changedFiles: [], deletedPaths: [] };
  }

  const test = await run(cmd.bin, cmd.args, { cwd: args.root, timeoutMs: TEST_TIMEOUT_MS });
  return { results: [install, test], changedFiles: [], deletedPaths: [] };
}
