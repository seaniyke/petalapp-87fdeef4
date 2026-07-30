/**
 * Deterministic repairs for generated build configuration.
 *
 * Build config is scaffold-managed, so the model is intentionally prevented
 * from editing it. That protection must not leave a project stranded when a
 * legacy/corrupted config references a Node helper without importing it.
 */
import type { ProjectFile } from "./generate.server";

export interface BuildConfigRepairResult {
  files: ProjectFile[];
  notes: string[];
}

const BUILD_CONFIG = /(^|\/)(vite|vitest|tailwind|postcss|eslint)\.config\.[cm]?[jt]s$/;

function hasPathBinding(source: string): boolean {
  return (
    /import\s+(?:\*\s+as\s+)?path\s+from\s+["'](?:node:)?path["']/.test(source) ||
    /(?:const|let|var)\s+path\s*=\s*require\(["'](?:node:)?path["']\)/.test(source)
  );
}

function hasFileUrlToPathBinding(source: string): boolean {
  return (
    /import\s*\{[^}]*\bfileURLToPath\b[^}]*\}\s*from\s*["'](?:node:)?url["']/.test(source) ||
    /(?:const|let|var)\s*\{[^}]*\bfileURLToPath\b[^}]*\}\s*=\s*require\(["'](?:node:)?url["']\)/.test(source)
  );
}

export function repairBuildConfigImports(files: ProjectFile[]): BuildConfigRepairResult {
  const notes: string[] = [];
  const repaired = files.map((file) => {
    if (!BUILD_CONFIG.test(file.path)) return file;

    const imports: string[] = [];
    if (/\bpath\s*\./.test(file.content) && !hasPathBinding(file.content)) {
      imports.push('import * as path from "node:path";');
      notes.push(`build-config: restored node:path import in ${file.path}`);
    }
    if (/\bfileURLToPath\s*\(/.test(file.content) && !hasFileUrlToPathBinding(file.content)) {
      imports.push('import { fileURLToPath } from "node:url";');
      notes.push(`build-config: restored fileURLToPath import in ${file.path}`);
    }
    if (imports.length === 0) return file;

    const shebang = file.content.match(/^#![^\n]*\n/);
    const insertAt = shebang?.[0].length ?? 0;
    const content =
      file.content.slice(0, insertAt) +
      imports.join("\n") +
      "\n" +
      file.content.slice(insertAt);
    return { ...file, content };
  });

  return { files: repaired, notes };
}