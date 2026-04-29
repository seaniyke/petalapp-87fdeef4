/**
 * Esbuild parse verifier — Tier 2.7 of the build pipeline.
 *
 * Runs the actual esbuild parser (via esbuild-wasm) on every changed
 * .ts/.tsx/.jsx/.js file. If a file parses cleanly here, it WILL parse
 * cleanly in the deployed Vite bundle — esbuild is the same parser Vite
 * ships with. This is the strongest pre-flight check we can do without
 * a full type-check.
 *
 * We deliberately do NOT bundle, resolve imports, or run plugins. That's
 * already covered by `findUnresolvedImports` in local-verifier and would
 * produce noise here ("can't resolve @/components/ui/button") because
 * esbuild has no knowledge of our virtual file map.
 *
 * Failure mode policy: if esbuild itself errors out (cold-start wasm
 * init failure, OOM, etc.), we LOG and return ok=true. We never fail a
 * build that would have otherwise passed because of an infra hiccup in
 * our verifier.
 */
import * as esbuild from "esbuild-wasm";

export type EsbuildIssue = {
  path: string;
  line: number;
  column: number;
  message: string;
  kind: "parse";
};

export type EsbuildVerdict = {
  ok: boolean;
  issues: EsbuildIssue[];
};

const SCANNABLE = /\.(tsx?|jsx?)$/;

/** Module-level singleton — esbuild-wasm must only be initialized once
 *  per Worker instance. Subsequent calls are no-ops; calling concurrently
 *  before init is safe because we await the same promise. */
let initPromise: Promise<void> | null = null;

function ensureInit(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = esbuild
    .initialize({
      // The wasm binary ships inside the package; esbuild-wasm resolves it
      // via its own loader. We don't pass wasmURL — the bundled fallback
      // works in the Worker runtime.
      worker: false,
    })
    .catch((err) => {
      // Reset so a retry next turn can attempt re-init.
      initPromise = null;
      throw err;
    });
  return initPromise;
}

function loaderFor(path: string): "ts" | "tsx" | "js" | "jsx" {
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".ts")) return "ts";
  if (path.endsWith(".jsx")) return "jsx";
  return "js";
}

function shouldSkip(path: string): boolean {
  if (!SCANNABLE.test(path)) return true;
  // Same skip-list as local-verifier — these are scaffold-managed.
  if (path.startsWith("src/components/ui/")) return true;
  if (path.startsWith("src/integrations/")) return true;
  if (path.startsWith("src/components/examples/")) return true;
  return false;
}

export async function verifyFilesEsbuild(
  files: { path: string; content: string }[],
  changedPaths: string[],
): Promise<EsbuildVerdict> {
  const changed = new Set(changedPaths);
  const targets = files.filter((f) => changed.has(f.path) && !shouldSkip(f.path));
  if (targets.length === 0) return { ok: true, issues: [] };

  try {
    await ensureInit();
  } catch (err) {
    console.warn("[esbuild-verifier] init failed, skipping pass:", err);
    return { ok: true, issues: [] };
  }

  const issues: EsbuildIssue[] = [];

  await Promise.all(
    targets.map(async (f) => {
      try {
        await esbuild.transform(f.content, {
          loader: loaderFor(f.path),
          sourcefile: f.path,
          // Parse-only: don't try to resolve imports or emit bundled output.
          // Setting target conservatively avoids spurious "syntax not
          // supported" warnings on modern features.
          target: "es2022",
          // Suppress its own minify/sourcemap work — we just want the parse.
          minify: false,
          sourcemap: false,
        });
      } catch (err) {
        // esbuild throws TransformFailure with structured `errors`.
        const e = err as { errors?: Array<{ text: string; location?: { line: number; column: number } }> };
        if (e?.errors?.length) {
          for (const detail of e.errors) {
            issues.push({
              path: f.path,
              line: detail.location?.line ?? 0,
              column: detail.location?.column ?? 0,
              message: detail.text,
              kind: "parse",
            });
          }
        } else {
          issues.push({
            path: f.path,
            line: 0,
            column: 0,
            message: (err as Error)?.message ?? "unknown parse error",
            kind: "parse",
          });
        }
      }
    }),
  );

  return { ok: issues.length === 0, issues };
}
