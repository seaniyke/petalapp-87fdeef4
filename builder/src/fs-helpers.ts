/**
 * Materialize a project's in-memory ProjectFile[] to a real directory on disk
 * so npm/vite can work with it. Each build gets its own /tmp/builds/<buildId>
 * scratch dir; we clean it up after the deploy completes (success or fail).
 */
import { mkdir, writeFile, rm } from "node:fs/promises";
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

export async function cleanupProject(buildId: string): Promise<void> {
  const dir = join(BUILDS_ROOT, buildId);
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}
