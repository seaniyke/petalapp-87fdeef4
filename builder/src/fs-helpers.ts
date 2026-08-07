/**
 * Materialize a project's in-memory ProjectFile[] to a real directory on disk
 * so npm/vite can work with it. Each build gets its own /tmp/builds/<buildId>
 * scratch dir; we clean it up after the deploy completes (success or fail).
 */
import { mkdir, readFile, readdir, writeFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { healSyntax } from "./syntax-heal.js";

export type ProjectFile = { path: string; content: string };

const BUILDS_ROOT = process.env.BUILDS_ROOT ?? "/app/builds";

/** Reject paths that try to escape the build root. */
function safeJoin(root: string, p: string): string {
  // Strip leading slash, normalize, then resolve and confirm it stays under root.
  const cleaned = p.replace(/^\/+/, "").replace(/\\/g, "/");
  if (cleaned.includes("..")) {
    throw new Error(`Refusing path with .. segment: ${p}`);
  }
  const full = resolve(root, cleaned);
  if (!full.startsWith(resolve(root) + "/") && full !== resolve(root)) {
    throw new Error(`Path escapes build root: ${p}`);
  }
  return full;
}

export async function materializeProject(
  buildId: string,
  files: ProjectFile[]
): Promise<string> {
  const dir = join(BUILDS_ROOT, buildId);
  await mkdir(dir, { recursive: true });
  // Pre-flight syntax heal on the exact bytes esbuild will parse. One
  // malformed import kills the whole build, so this runs unconditionally
  // regardless of what the app server already repaired.
  const healed = healSyntax(files);
  if (healed.notes.length > 0) {
    console.warn(`[pre-flight-heal] build=${buildId}: ${healed.notes.join("; ")}`);
  }
  for (const f of healed.files) {
    const full = safeJoin(dir, f.path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, f.content, "utf8");
  }
  return dir;
}

/**
 * Re-heal source files from disk immediately before the compiler runs.
 *
 * This deliberately duplicates the incoming-payload pre-flight above: later
 * builder steps may write or modify files, and Vite compiles the filesystem —
 * not the original ProjectFile array. Keeping this boundary in the builder
 * means malformed markdown/import/JSX syntax cannot bypass healing through a
 * retry, queued payload, or future materialization change.
 */
export async function healMaterializedProject(root: string): Promise<string[]> {
  const sourcePaths: string[] = [];

  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (/\.(tsx?|jsx?|mts|cts)$/i.test(entry.name)) {
        sourcePaths.push(full);
      }
    }
  };

  await walk(root);
  const files = await Promise.all(
    sourcePaths.map(async (full) => ({
      path: full.slice(resolve(root).length + 1).replace(/\\/g, "/"),
      content: await readFile(full, "utf8"),
    })),
  );
  const healed = healSyntax(files);

  await Promise.all(
    healed.files.map(async (file, index) => {
      if (file.content === files[index]?.content) return;
      await writeFile(safeJoin(root, file.path), file.content, "utf8");
    }),
  );

  return healed.notes;
}

export async function cleanupProject(buildId: string): Promise<void> {
  const dir = join(BUILDS_ROOT, buildId);
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

/* ------------------------------------------------------------------------ *
 * Petal v3 — Phase D: warm per-project workspaces.
 *
 * Cold builds pay for `npm install` on every single turn: a fresh /app/builds
 * /<buildId> directory has no node_modules and no vite cache, so a one-line
 * copy edit costs the same wall-clock as a first build. That is the single
 * biggest contributor to "why is Petal slow" and it is pure waste — the
 * dependency set almost never changes between consecutive turns on the same
 * project.
 *
 * A warm workspace is a per-PROJECT directory that survives between builds.
 * Source files are re-synced every turn (added, overwritten, and — critically
 * — DELETED when they disappear from the payload, or a removed file would keep
 * compiling forever). `node_modules`, the lockfile and vite's cache are left
 * alone, so npm can hit its own "already satisfied" fast path.
 *
 * Safety properties, in order of importance:
 *   1. Source state is exact. After sync, the workspace contains the payload's
 *      files and nothing else. Stale files cannot survive a turn.
 *   2. One build per project at a time, enforced by an in-process lock, so two
 *      turns can never interleave writes into the same directory.
 *   3. Warmth is an optimization, never a correctness dependency. Any sync
 *      error nukes the workspace and falls back to a cold build.
 * ------------------------------------------------------------------------ */

const WORKSPACES_ROOT = process.env.WORKSPACES_ROOT ?? "/app/workspaces";
/** Directories that make a workspace warm and must survive a re-sync. */
const PRESERVED = new Set(["node_modules", ".git", "dist", ".vite", "node_modules/.vite"]);
/** Files that belong to the installed dependency state, not to the payload. */
const PRESERVED_FILES = new Set(["package-lock.json", "npm-shrinkwrap.json", "yarn.lock"]);
/** Cap on retained workspaces; oldest are evicted so disk cannot grow forever. */
const MAX_WORKSPACES = Number(process.env.MAX_WORKSPACES ?? 24);

const projectLocks = new Map<string, Promise<unknown>>();

function workspaceId(projectId: string): string {
  return projectId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
}

/** Serialize all work for one project. Returns fn's result. */
export function withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = projectLocks.get(projectId) ?? Promise.resolve();
  // `.then(fn, fn)` on purpose: a previous build failing must not deadlock the
  // next one. The stored tail is always a settled-swallowing promise so the
  // chain can never reject into an unhandled rejection.
  const next = prev.then(fn, fn);
  const tail = next.catch(() => {});
  projectLocks.set(projectId, tail);
  void tail.then(() => {
    if (projectLocks.get(projectId) === tail) projectLocks.delete(projectId);
  });
  return next;
}

/** Every source-ish file currently on disk, relative to root. */
async function listWorkspaceFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (PRESERVED.has(entry.name) || PRESERVED.has(rel)) continue;
      if (entry.isDirectory()) {
        await walk(join(dir, entry.name), rel);
      } else if (!PRESERVED_FILES.has(rel)) {
        out.push(rel);
      }
    }
  };
  await walk(root, "");
  return out;
}

export interface WorkspaceHandle {
  dir: string;
  /** True when node_modules was already present, so npm can take its fast path. */
  warm: boolean;
  /** Files removed from disk because they left the payload. */
  pruned: string[];
}

/**
 * Sync a project's payload into its warm workspace, creating it if needed.
 * Falls back to a cold directory (identical layout, empty) if anything about
 * the existing workspace looks wrong.
 */
export async function materializeWorkspace(
  projectId: string,
  files: ProjectFile[]
): Promise<WorkspaceHandle> {
  const dir = join(WORKSPACES_ROOT, workspaceId(projectId));
  let warm = false;
  let existing: string[] = [];

  try {
    await mkdir(dir, { recursive: true });
    existing = await listWorkspaceFiles(dir);
    warm = await readdir(join(dir, "node_modules"))
      .then((e) => e.length > 0)
      .catch(() => false);
  } catch {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    await mkdir(dir, { recursive: true });
    existing = [];
    warm = false;
  }

  const healed = healSyntax(files);
  if (healed.notes.length > 0) {
    console.warn(`[pre-flight-heal] project=${projectId}: ${healed.notes.join("; ")}`);
  }

  const incoming = new Set(healed.files.map((f) => f.path.replace(/^\/+/, "")));

  // 1. Prune anything that left the payload. A file the user deleted must not
  //    keep compiling just because a previous turn wrote it here.
  const pruned: string[] = [];
  for (const rel of existing) {
    if (incoming.has(rel)) continue;
    await rm(safeJoin(dir, rel), { force: true }).catch(() => {});
    pruned.push(rel);
  }

  // 2. Write the payload. Unchanged bytes are skipped so vite's mtime-based
  //    cache stays valid for files the turn never touched.
  for (const f of healed.files) {
    const full = safeJoin(dir, f.path);
    const prior = await readFile(full, "utf8").catch(() => null);
    if (prior === f.content) continue;
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, f.content, "utf8");
  }

  return { dir, warm, pruned };
}

/**
 * Post-build housekeeping. Keeps node_modules (the whole point) and drops the
 * build output, then evicts the least recently used workspaces over the cap.
 */
export async function releaseWorkspace(projectId: string): Promise<void> {
  const dir = join(WORKSPACES_ROOT, workspaceId(projectId));
  await rm(join(dir, "dist"), { recursive: true, force: true }).catch(() => {});
  await evictOldWorkspaces().catch(() => {});
}

async function evictOldWorkspaces(): Promise<void> {
  const entries = await readdir(WORKSPACES_ROOT, { withFileTypes: true }).catch(() => []);
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  if (dirs.length <= MAX_WORKSPACES) return;

  const { stat } = await import("node:fs/promises");
  const withTimes = await Promise.all(
    dirs.map(async (name) => ({
      name,
      mtime: await stat(join(WORKSPACES_ROOT, name))
        .then((s) => s.mtimeMs)
        .catch(() => 0),
    }))
  );
  withTimes.sort((a, b) => a.mtime - b.mtime);
  for (const victim of withTimes.slice(0, withTimes.length - MAX_WORKSPACES)) {
    await rm(join(WORKSPACES_ROOT, victim.name), { recursive: true, force: true }).catch(() => {});
  }
}
