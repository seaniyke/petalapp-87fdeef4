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
