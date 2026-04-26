/**
 * Sync `tsconfig.json` "paths" into `vite.config.ts` `resolve.alias`.
 *
 * Why this exists:
 *   TypeScript `compilerOptions.paths` is a TS-only construct. Vite/Rollup do
 *   NOT read it at build time (without a plugin like `vite-tsconfig-paths`).
 *   So a project can typecheck fine in the editor — and even compile in the
 *   sandbox dev server — but explode at production build time with
 *   `Rollup failed to resolve import "@/..."`.
 *
 *   The scaffold kit's canonical `vite.config.ts` already declares the `@`
 *   alias, but if anything ever drifts (a stale generation, a manual edit,
 *   the AI emitting a slimmer config, a future scaffold change) we still
 *   want builds to succeed. This module guarantees that EVERY build has
 *   one Vite alias entry per `paths` key.
 *
 * What it does:
 *   1. Parse `tsconfig.json` (lenient — supports trailing commas / comments).
 *   2. Read `compilerOptions.paths` (e.g. { "@/*": ["src/*"] }).
 *   3. Open `vite.config.ts`, find which aliases are already declared, and
 *      inject any missing ones into `resolve.alias`.
 *
 *   The injection is purposefully conservative: we never rewrite the whole
 *   config, only patch the alias map. If the file shape is unfamiliar we
 *   leave it alone (logged) — better to fail with the clear Vite error than
 *   to ship a broken config.
 *
 * Inputs/outputs are pure `ProjectFile[]` so this can run anywhere
 * (build trigger, server function, tests).
 */
import type { ProjectFile } from "./generate.server";

const TSCONFIG_PATH = "tsconfig.json";
const VITE_CONFIG_PATH = "vite.config.ts";

/** A single TS path mapping → its first target without the trailing wildcard. */
type AliasMapping = {
  /** The alias key as Vite expects it, e.g. `"@"` (no `/*`). */
  key: string;
  /** Resolved target relative to the project root, e.g. `"src"` (no `/*`). */
  target: string;
};

/** Lenient JSON parser — accepts comments and trailing commas. */
function parseJsonLoose(text: string): unknown {
  const stripped = text
    // Block comments
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // Line comments
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1")
    // Trailing commas before } or ]
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(stripped);
}

/** Extract `compilerOptions.paths` into a normalized list. */
export function readTsconfigPaths(tsconfigSource: string): AliasMapping[] {
  let parsed: unknown;
  try {
    parsed = parseJsonLoose(tsconfigSource);
  } catch (e) {
    console.warn("[sync-vite-aliases] tsconfig.json is not parseable JSON:", e);
    return [];
  }
  const paths =
    (parsed as { compilerOptions?: { paths?: Record<string, string[]> } })
      ?.compilerOptions?.paths;
  if (!paths || typeof paths !== "object") return [];

  const out: AliasMapping[] = [];
  for (const [rawKey, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets) || targets.length === 0) continue;
    // Use the FIRST target — multiple targets are a TS-only feature
    // (try-each-in-order), and Vite only supports one resolution per alias.
    const rawTarget = String(targets[0] ?? "").trim();
    if (!rawTarget) continue;

    // Strip the wildcard suffix in BOTH key and target. Vite alias matching
    // is prefix-based: aliasing `"@"` → `"src"` means `@/foo` → `src/foo`.
    const key = rawKey.replace(/\/?\*$/, "");
    const target = rawTarget.replace(/\/?\*$/, "");
    if (!key) continue;
    out.push({ key, target });
  }
  return out;
}

/** Read the alias keys already present in a vite config string. Heuristic: we
 *  look for string-literal property keys inside an `alias: { ... }` block. */
function existingViteAliasKeys(viteSource: string): Set<string> {
  const result = new Set<string>();
  const aliasMatch = viteSource.match(/alias\s*:\s*\{([\s\S]*?)\}/);
  if (!aliasMatch) return result;
  const body = aliasMatch[1];
  // Match keys like  "@": ...  or  '@/foo': ...
  const keyRegex = /["'`]([^"'`]+)["'`]\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = keyRegex.exec(body)) !== null) {
    result.add(m[1]);
  }
  return result;
}

/**
 * Build the Vite-config source needed to add `missing` aliases. We try, in
 * order:
 *   1. Inject into an existing `resolve: { alias: { ... } }` block.
 *   2. Inject a new `resolve: { alias: { ... } }` block into `defineConfig({...})`.
 *   3. Bail out (return `null`) — caller leaves the file unchanged.
 *
 * In all injection cases we also ensure `path` and `fileURLToPath` are
 * imported and that `__dirname` is defined (Vite configs are ESM, where
 * `__dirname` is not implicit).
 */
export function injectAliases(
  viteSource: string,
  missing: AliasMapping[],
): string | null {
  if (missing.length === 0) return viteSource;

  const aliasLines = missing
    .map((m) => `      ${JSON.stringify(m.key)}: path.resolve(__dirname, ${JSON.stringify(m.target)}),`)
    .join("\n");

  // Step 1: ensure the necessary imports + __dirname helper are present.
  let next = viteSource;
  if (!/from\s+["']node:path["']/.test(next) && !/from\s+["']path["']/.test(next)) {
    next = `import path from "node:path";\n` + next;
  }
  if (!/fileURLToPath/.test(next)) {
    next = `import { fileURLToPath } from "node:url";\n` + next;
  }
  if (!/const\s+__dirname\s*=/.test(next) && !/__dirname\s*=\s*path\.dirname/.test(next)) {
    // Insert after the last import line so it sits above defineConfig.
    const lines = next.split("\n");
    let lastImport = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*import\s.+from\s+["'][^"']+["'];?\s*$/.test(lines[i])) lastImport = i;
    }
    const insertAt = lastImport >= 0 ? lastImport + 1 : 0;
    lines.splice(
      insertAt,
      0,
      `const __dirname = path.dirname(fileURLToPath(import.meta.url));`,
    );
    next = lines.join("\n");
  }

  // Step 2a: there is already a `resolve: { alias: { ... } }` block — splice in.
  const aliasBlock = next.match(/(alias\s*:\s*\{)([\s\S]*?)(\n?\s*\})/);
  if (aliasBlock) {
    const before = next.slice(0, aliasBlock.index! + aliasBlock[1].length);
    const inside = aliasBlock[2];
    const after = next.slice(aliasBlock.index! + aliasBlock[1].length + aliasBlock[2].length);
    // Make sure the existing inside ends with a comma so our new lines don't
    // collide. If empty/whitespace, just drop our lines straight in.
    const trimmedInside = inside.replace(/\s+$/, "");
    const sep = trimmedInside.length === 0 || trimmedInside.endsWith(",")
      ? trimmedInside
      : trimmedInside + ",";
    return `${before}${sep}\n${aliasLines}${after}`;
  }

  // Step 2b: no alias block — try to add `resolve: { alias: {...} }` inside
  // the defineConfig({ ... }) object. We anchor on the first `{` after
  // `defineConfig(` and inject right after it.
  const defineMatch = next.match(/defineConfig\s*\(\s*\{/);
  if (defineMatch) {
    const insertPos = defineMatch.index! + defineMatch[0].length;
    const block =
      `\n  resolve: {\n    alias: {\n${aliasLines}\n    },\n  },`;
    return next.slice(0, insertPos) + block + next.slice(insertPos);
  }

  // Unknown shape — leave the file alone.
  console.warn(
    "[sync-vite-aliases] vite.config.ts has an unfamiliar shape; not injecting aliases.",
  );
  return null;
}

/**
 * Top-level entry point: returns a NEW `ProjectFile[]` with `vite.config.ts`
 * patched so every `tsconfig.json` "paths" entry has a matching Vite alias.
 *
 * Safe no-ops:
 *  - No `tsconfig.json` in the project → return input unchanged.
 *  - No `paths` in tsconfig → return input unchanged.
 *  - No `vite.config.ts` → return input unchanged (this build will fail anyway,
 *    but for a different reason; we don't manufacture a config out of thin air).
 *  - All paths already aliased → return input unchanged.
 */
export function syncViteAliasesWithTsconfig(files: ProjectFile[]): ProjectFile[] {
  const tsconfig = files.find((f) => f.path === TSCONFIG_PATH);
  const viteConfig = files.find((f) => f.path === VITE_CONFIG_PATH);
  if (!tsconfig || !viteConfig) return files;

  const desired = readTsconfigPaths(tsconfig.content);
  if (desired.length === 0) return files;

  const have = existingViteAliasKeys(viteConfig.content);
  const missing = desired.filter((m) => !have.has(m.key));
  if (missing.length === 0) return files;

  const patched = injectAliases(viteConfig.content, missing);
  if (patched == null || patched === viteConfig.content) return files;

  console.info(
    "[sync-vite-aliases] injected Vite aliases:",
    missing.map((m) => `${m.key} → ${m.target}`).join(", "),
  );

  return files.map((f) =>
    f.path === VITE_CONFIG_PATH ? { path: f.path, content: patched } : f,
  );
}
