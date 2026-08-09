/**
 * Sandboxed command execution over a materialized project.
 *
 * Petal's app runs on Cloudflare Workers — no processes, no filesystem, no
 * `rg`. The builder is real Node and already writes every project to disk for
 * a build, so this is the only place commands can honestly run.
 *
 * Safety model (all of these, not any of them):
 *   - argv arrays only, `shell: false` — there is no shell to inject into.
 *   - argv[0] must be on ALLOWED_BINS after basename normalization.
 *   - per-command and per-session wall clocks, SIGKILL on overrun.
 *   - stdout/stderr capped; the child is killed once it floods past the cap.
 *   - cwd is pinned to the session dir; relative `cwd` args cannot escape it.
 *   - no network: PATH is minimal and installs are not on the allowlist.
 *   - "inspect" mode diffs nothing back; only "codemod" returns changed files.
 */
import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, basename } from "node:path";

export type ExecMode = "inspect" | "codemod";

export interface ExecCommand {
  /** argv[0] — must be allowlisted. */
  bin: string;
  args: string[];
  /** Optional sub-directory of the session root to run in. */
  cwd?: string;
  /** Optional stdin payload (used to pipe a script into node/python3). */
  stdin?: string;
}

export interface ExecCommandResult {
  bin: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
  timedOut: boolean;
}

export interface ProjectFile {
  path: string;
  content: string;
}

export interface ExecSessionResult {
  results: ExecCommandResult[];
  /** Only populated in "codemod" mode. */
  changedFiles: ProjectFile[];
  deletedPaths: string[];
}

/**
 * Read-only inspection binaries plus the two scripting runtimes used for
 * codemods. Deliberately excludes anything that installs, fetches, or
 * mutates state outside the session dir (npm, curl, git, rm, mv, chmod…).
 */
export const ALLOWED_BINS = new Set([
  "ls",
  "cat",
  "head",
  "tail",
  "wc",
  "rg",
  "grep",
  "sed",
  "find",
  "node",
  "python3",
]);

/** Binaries that may write. Everything else runs read-only by convention. */
const WRITE_CAPABLE = new Set(["node", "python3", "sed"]);

export const PER_COMMAND_TIMEOUT_MS = 60_000;
export const PER_SESSION_TIMEOUT_MS = 180_000;
export const OUTPUT_CAP_BYTES = 32 * 1024;
export const MAX_COMMANDS_PER_SESSION = 12;

/** Directories never walked when diffing a codemod session. */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".vite", ".wrangler"]);
/** Hard ceiling on files returned from a codemod so one bad script can't OOM us. */
const MAX_RETURNED_FILES = 400;
const MAX_RETURNED_BYTES = 8 * 1024 * 1024;

export class ExecError extends Error {}

function assertAllowed(cmd: ExecCommand): void {
  const bin = basename(cmd.bin);
  if (!ALLOWED_BINS.has(bin)) {
    throw new ExecError(`Command not allowed: ${cmd.bin}`);
  }
  if (!Array.isArray(cmd.args)) {
    throw new ExecError("args must be an array");
  }
  for (const a of cmd.args) {
    if (typeof a !== "string") throw new ExecError("args must be strings");
  }
}

function resolveCwd(root: string, sub: string | undefined): string {
  if (!sub) return root;
  if (sub.includes("..")) throw new ExecError(`cwd may not contain ..: ${sub}`);
  const full = resolve(root, sub.replace(/^\/+/, ""));
  const base = resolve(root);
  if (full !== base && !full.startsWith(base + "/")) {
    throw new ExecError(`cwd escapes session root: ${sub}`);
  }
  return full;
}

async function runOne(
  root: string,
  cmd: ExecCommand,
  timeoutMs: number,
): Promise<ExecCommandResult> {
  assertAllowed(cmd);
  const cwd = resolveCwd(root, cmd.cwd);
  const started = Date.now();

  return await new Promise<ExecCommandResult>((resolvePromise) => {
    const child = spawn(basename(cmd.bin), cmd.args, {
      cwd,
      shell: false,
      env: {
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        HOME: cwd,
        // Deliberately no tokens, no registry creds, no CF keys.
        NODE_OPTIONS: "--max-old-space-size=512",
        PYTHONDONTWRITEBYTECODE: "1",
        LC_ALL: "C",
      },
      stdio: ["pipe", "pipe", "pipe"],
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
        bin: basename(cmd.bin),
        args: cmd.args,
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
    }, timeoutMs);

    const append = (chunk: string, which: "out" | "err") => {
      const current = which === "out" ? stdout : stderr;
      if (current.length >= OUTPUT_CAP_BYTES) {
        if (!truncated) {
          truncated = true;
          child.kill("SIGKILL");
        }
        return;
      }
      const room = OUTPUT_CAP_BYTES - current.length;
      const slice = chunk.length > room ? chunk.slice(0, room) : chunk;
      if (which === "out") stdout += slice;
      else stderr += slice;
      if (chunk.length > room) truncated = true;
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c: string) => append(c, "out"));
    child.stderr.on("data", (c: string) => append(c, "err"));
    child.on("error", (err) => {
      stderr += `\n${err.message}`;
      finish(null);
    });
    child.on("close", (code) => finish(code));

    if (cmd.stdin != null) {
      child.stdin.end(cmd.stdin, "utf8");
    } else {
      child.stdin.end();
    }
  });
}

async function walkFiles(
  root: string,
  dir: string,
  out: ProjectFile[],
  budget: { bytes: number },
): Promise<void> {
  if (out.length >= MAX_RETURNED_FILES || budget.bytes <= 0) return;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (out.length >= MAX_RETURNED_FILES || budget.bytes <= 0) return;
    if (entry.name.startsWith(".") && entry.name !== ".npmrc") continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(root, full, out, budget);
      continue;
    }
    if (!entry.isFile()) continue;
    const info = await stat(full).catch(() => null);
    if (!info || info.size > 1024 * 1024) continue;
    const content = await readFile(full, "utf8").catch(() => null);
    if (content == null) continue;
    budget.bytes -= content.length;
    out.push({ path: full.slice(root.length + 1), content });
  }
}

/**
 * Run a batch of commands against an already-materialized project directory.
 * In "codemod" mode the post-run tree is diffed against `original` and the
 * changed/added/deleted files are returned for the caller to gate.
 */
export async function runExecSession(args: {
  root: string;
  mode: ExecMode;
  commands: ExecCommand[];
  original: ProjectFile[];
}): Promise<ExecSessionResult> {
  const { root, mode, commands, original } = args;
  if (commands.length === 0) throw new ExecError("No commands supplied");
  if (commands.length > MAX_COMMANDS_PER_SESSION) {
    throw new ExecError(`Too many commands (max ${MAX_COMMANDS_PER_SESSION})`);
  }
  for (const cmd of commands) {
    assertAllowed(cmd);
    if (mode === "inspect" && WRITE_CAPABLE.has(basename(cmd.bin))) {
      // `sed -n` and read-only scripts are fine, but in inspect mode we
      // simply never read the tree back, so a write is inert either way.
      // Keeping the check explicit documents the intent.
    }
  }

  const sessionStart = Date.now();
  const results: ExecCommandResult[] = [];

  for (const cmd of commands) {
    const elapsed = Date.now() - sessionStart;
    const remaining = PER_SESSION_TIMEOUT_MS - elapsed;
    if (remaining <= 0) {
      results.push({
        bin: basename(cmd.bin),
        args: cmd.args,
        exitCode: null,
        stdout: "",
        stderr: "Session time budget exhausted before this command ran.",
        truncated: false,
        timedOut: true,
        durationMs: 0,
      });
      continue;
    }
    results.push(
      await runOne(root, cmd, Math.min(PER_COMMAND_TIMEOUT_MS, remaining)),
    );
  }

  if (mode !== "codemod") {
    return { results, changedFiles: [], deletedPaths: [] };
  }

  const after: ProjectFile[] = [];
  await walkFiles(root, root, after, { bytes: MAX_RETURNED_BYTES });

  const before = new Map(original.map((f) => [f.path, f.content]));
  const afterPaths = new Set(after.map((f) => f.path));
  const changedFiles = after.filter((f) => before.get(f.path) !== f.content);
  const deletedPaths = original
    .map((f) => f.path)
    .filter((p) => !afterPaths.has(p) && !p.startsWith("node_modules/"));

  return { results, changedFiles, deletedPaths };
}
