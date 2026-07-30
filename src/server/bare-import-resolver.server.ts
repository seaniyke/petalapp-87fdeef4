/**
 * Deterministic bare-import repair.
 *
 * Failure mode this fixes (the #1 remaining Rollup hard-fail after the
 * local import-resolver landed):
 *   The model writes `import { motion } from "framer-motion"` but the
 *   scaffold's package.json never lists framer-motion. Rollup bails with
 *   `Could not resolve "framer-motion" from "src/sections/Hero.tsx"`.
 *
 * Strategy, in order, per bare import:
 *   1. **Exact alias rewrite** — `import "lucide"` → `import "lucide-react"`.
 *   2. **react-icons → lucide-react** — rewrites the package AND maps the
 *      named imports (`FaTwitter` → `Twitter`).
 *   3. **lucide icon validation** — for `from "lucide-react"`, validate every
 *      named import against the common-icon set; unknown names get nudged
 *      via Levenshtein to the closest known name, or fall back to the safe
 *      default (`Square`). Lucide's bundle is regenerated regularly and
 *      renames icons across minor versions — this is a real source of
 *      "X is not exported by lucide-react" runtime errors.
 *   4. **Auto-install from known registry** — if the package is in
 *      `KNOWN_PACKAGES`, add it to `package.json` `dependencies` with a
 *      pinned range, so `bun install` resolves it.
 *   5. **Strip + comment** — anything we don't know stays out of the build
 *      to avoid a hard failure. The whole import line is replaced with a
 *      `// removed:` comment; any usages downstream are NOT removed (that
 *      would mangle the file). Most of those usages will go through the
 *      runtime-contract pass in Phase 9; until then they render as a clean
 *      "X is not defined" error in dev only.
 *
 * Pure ProjectFile[] → ProjectFile[] — no I/O, no model calls.
 */

import type { ProjectFile } from "./generate.server";
import {
  COMMON_LUCIDE_ICONS,
  KNOWN_PACKAGES,
  PACKAGE_ALIASES,
  REACT_ICONS_TO_LUCIDE,
  SAFE_ICON_FALLBACK,
  nearestIcon,
} from "./known-packages";

const SCANNABLE = /\.(tsx?|jsx?)$/;

// Captures `import { a, b as c } from "spec"` and `import D, { a } from "spec"`
// and `import "spec"`. We work on the matched substring; the regex is
// anchored to a line start (with optional leading whitespace) to avoid
// chewing inside comments or strings.
const IMPORT_RE =
  /(^|\n)([ \t]*)import\s+(?:type\s+)?(?:([\w*${}\s,]+)\s+from\s+)?["']([^"']+)["']\s*;?/g;

export interface BareImportRepairResult {
  files: ProjectFile[];
  /** Packages we added to package.json. */
  addedDeps: Record<string, string>;
  /** (file, original spec → new spec) rewrites. */
  rewrites: Array<{ path: string; from: string; to: string }>;
  /** Icon-name nudges inside `lucide-react` import lists. */
  iconFixes: Array<{ path: string; from: string; to: string }>;
  /** Import lines we couldn't repair and removed. */
  stripped: Array<{ path: string; spec: string }>;
}

/** Same canonical builtins as Node + the Vite alias prefix. We never touch these. */
/** Node.js built-in modules — always resolvable, never npm packages. */
const NODE_BUILTINS = new Set([
  "assert", "buffer", "child_process", "cluster", "console", "constants", "crypto",
  "dgram", "dns", "domain", "events", "fs", "http", "http2", "https", "inspector",
  "module", "net", "os", "path", "perf_hooks", "process", "punycode", "querystring",
  "readline", "repl", "stream", "string_decoder", "timers", "tls", "trace_events",
  "tty", "url", "util", "v8", "vm", "worker_threads", "zlib",
]);

function isBareSpecifier(spec: string): boolean {
  if (spec.startsWith(".")) return false;
  if (spec.startsWith("@/")) return false;
  if (spec.startsWith("/")) return false;
  if (spec.startsWith("http://") || spec.startsWith("https://")) return false;
  if (spec.startsWith("data:") || spec.startsWith("virtual:")) return false;
  // Node built-ins (`node:path`, `path`, `node:url/…`) are provided by the
  // runtime. Stripping them corrupts build configs (`path is not defined`).
  if (spec.startsWith("node:")) return false;
  if (NODE_BUILTINS.has(spec.split("/")[0])) return false;
  return true;
}


/** Split a bare specifier into package name and subpath: "date-fns/format" → ["date-fns", "format"]. */
function splitPackage(spec: string): { pkg: string; subpath: string } {
  if (spec.startsWith("@")) {
    const parts = spec.split("/");
    const pkg = parts.slice(0, 2).join("/");
    const subpath = parts.slice(2).join("/");
    return { pkg, subpath };
  }
  const idx = spec.indexOf("/");
  if (idx === -1) return { pkg: spec, subpath: "" };
  return { pkg: spec.slice(0, idx), subpath: spec.slice(idx + 1) };
}

/** Pull the named-imports list out of `import { a, b as c, default as d } from "x"`. */
function parseNamedImports(importChunk: string): string[] {
  const m = importChunk.match(/\{([^}]+)\}/);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
    .filter(Boolean);
}

/** Replace one bare specifier in an import statement with another. */
function rewriteSpec(line: string, oldSpec: string, newSpec: string): string {
  const escaped = oldSpec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return line.replace(new RegExp(`(["'])${escaped}\\1`), `"${newSpec}"`);
}

/** Replace `FaTwitter` etc. with the mapped lucide name across an import + the file body. */
function rewriteReactIconsUsage(
  fileContent: string,
  originalNames: string[],
): { content: string; replaced: Map<string, string> } {
  const replaced = new Map<string, string>();
  let out = fileContent;
  for (const name of originalNames) {
    const mapped = REACT_ICONS_TO_LUCIDE[name];
    const target = mapped ?? SAFE_ICON_FALLBACK;
    replaced.set(name, target);
    if (name === target) continue;
    // Word-boundary swap so we don't mangle substrings.
    out = out.replace(new RegExp(`\\b${name}\\b`, "g"), target);
  }
  return { content: out, replaced };
}

/** Rewrite icon names that aren't in COMMON_LUCIDE_ICONS to the nearest match. */
function repairLucideIcons(
  fileContent: string,
  importedNames: string[],
): { content: string; fixes: Array<{ from: string; to: string }> } {
  const fixes: Array<{ from: string; to: string }> = [];
  let out = fileContent;
  for (const name of importedNames) {
    if (COMMON_LUCIDE_ICONS.has(name)) continue;
    const nearest = nearestIcon(name) ?? SAFE_ICON_FALLBACK;
    if (nearest === name) continue;
    fixes.push({ from: name, to: nearest });
    out = out.replace(new RegExp(`\\b${name}\\b`, "g"), nearest);
  }
  return { content: out, fixes };
}

/** Strip an import line by replacing it with an inline comment. */
function commentOutImport(content: string, line: string, reason: string): string {
  const safe = line.trim().replace(/\n/g, " ");
  return content.replace(line, `\n// [petal] removed unresolved import — ${reason}: ${safe}\n`);
}

/** Returns the deps object from a parsed package.json, creating it if missing. */
function getDeps(pkg: Record<string, unknown>): Record<string, string> {
  if (!pkg.dependencies || typeof pkg.dependencies !== "object") {
    pkg.dependencies = {};
  }
  return pkg.dependencies as Record<string, string>;
}

export function repairBareImports(files: ProjectFile[]): BareImportRepairResult {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const result: BareImportRepairResult = {
    files,
    addedDeps: {},
    rewrites: [],
    iconFixes: [],
    stripped: [],
  };

  // Parse package.json once. If missing, we still scan + record addedDeps —
  // the caller can decide whether to inject a new package.json.
  let pkgJson: Record<string, unknown> | null = null;
  const pkgContent = byPath.get("package.json");
  if (pkgContent) {
    try {
      pkgJson = JSON.parse(pkgContent);
    } catch {
      pkgJson = null;
    }
  }
  const existingDeps = new Set<string>([
    ...Object.keys((pkgJson?.dependencies as Record<string, string>) ?? {}),
    ...Object.keys((pkgJson?.devDependencies as Record<string, string>) ?? {}),
  ]);

  for (const file of files) {
    if (!SCANNABLE.test(file.path)) continue;
    let src = byPath.get(file.path) ?? file.content;

    // Collect imports first; we mutate `src` in a second pass so we don't
    // confuse `replace` with positions that shift mid-iteration.
    interface ImportHit {
      full: string;
      importChunk: string | undefined;
      spec: string;
    }
    const hits: ImportHit[] = [];
    src.replace(IMPORT_RE, (full, _lead, _indent, importChunk, spec) => {
      hits.push({ full, importChunk, spec });
      return full;
    });

    for (const { full, importChunk, spec } of hits) {
      if (!isBareSpecifier(spec)) continue;

      // 1. Exact alias rewrite (e.g. "lucide" → "lucide-react").
      const aliased = PACKAGE_ALIASES[spec];
      if (aliased) {
        const newLine = rewriteSpec(full, spec, aliased);
        src = src.replace(full, newLine);
        result.rewrites.push({ path: file.path, from: spec, to: aliased });
      }

      // Recompute spec for downstream steps.
      const effectiveSpec = aliased ?? spec;
      const { pkg } = splitPackage(effectiveSpec);

      // 2. react-icons → lucide-react named-import remap. Triggered when
      //    the original import was a react-icons subpath; we rewrote the
      //    package above, but the named imports are still FaTwitter etc.
      const fromReactIcons = spec.startsWith("react-icons/");
      if (fromReactIcons && pkg === "lucide-react" && importChunk) {
        const names = parseNamedImports(importChunk);
        const { content: nextSrc, replaced } = rewriteReactIconsUsage(src, names);
        src = nextSrc;
        // Rebuild the import list inside the (now-rewritten) line.
        const newNames = names.map((n) => replaced.get(n) ?? n);
        const dedupedNames = Array.from(new Set(newNames));
        const importedLine = src.match(
          new RegExp(`import\\s+\\{[^}]+\\}\\s+from\\s+["']${pkg}["']\\s*;?`),
        );
        if (importedLine) {
          src = src.replace(
            importedLine[0],
            `import { ${dedupedNames.join(", ")} } from "${pkg}";`,
          );
        }
        for (const [from, to] of replaced) {
          if (from !== to) result.iconFixes.push({ path: file.path, from, to });
        }
      }

      // 3. lucide-react icon validation. Catches "Sparkle" vs "Sparkles",
      //    deprecated names, and the model's hallucinated icon variants.
      if (pkg === "lucide-react" && importChunk && !fromReactIcons) {
        const names = parseNamedImports(importChunk);
        const { content: nextSrc, fixes } = repairLucideIcons(src, names);
        src = nextSrc;
        if (fixes.length) {
          for (const fix of fixes) {
            result.iconFixes.push({ path: file.path, from: fix.from, to: fix.to });
          }
          // Rewrite the import list to reflect the corrected names.
          const corrected = names.map((n) => {
            const fix = fixes.find((f) => f.from === n);
            return fix ? fix.to : n;
          });
          const dedupedCorrected = Array.from(new Set(corrected));
          const importedLine = src.match(
            new RegExp(`import\\s+\\{[^}]+\\}\\s+from\\s+["']lucide-react["']\\s*;?`),
          );
          if (importedLine) {
            src = src.replace(
              importedLine[0],
              `import { ${dedupedCorrected.join(", ")} } from "lucide-react";`,
            );
          }
        }
      }

      // 4. Auto-install from registry, or 5. strip-and-comment.
      const pinned = KNOWN_PACKAGES[pkg];
      if (existingDeps.has(pkg)) {
        // If the existing pin is loose ("*", "latest") or doesn't match our
        // curated pin, REWRITE it. This is the safety net for cases like
        // @react-three/fiber@"*" resolving to v9 (React 19 only) and
        // breaking npm install on React-18 Expo scaffolds.
        if (pinned && pkgJson) {
          const deps = getDeps(pkgJson);
          const current = deps[pkg];
          if (current && current !== pinned && (current === "*" || current === "latest" || /^\^?0\.0\.0/.test(current))) {
            deps[pkg] = pinned;
            result.addedDeps[pkg] = pinned;
          }
        }
        continue;
      }
      if (pinned) {
        result.addedDeps[pkg] = pinned;
        existingDeps.add(pkg);
        continue;
      }

      // Unknown package — strip the import line so Rollup doesn't bail.
      // Usages of the identifiers in the file body will throw at runtime
      // (caught by the runtime-contract pass later), but the BUILD will
      // succeed and the user can iterate. This is intentionally a hard
      // failure mode on the UI side rather than a silent build failure.
      // We only do this on the LATEST `src` snapshot so prior rewrites
      // (alias, icon fixes) stick.
      const currentLine = src.includes(full)
        ? full
        : src.match(
            new RegExp(
              `\\n?[ \\t]*import[^\\n]*["']${effectiveSpec.replace(/[.*+?^${}()|[\\]]/g, "\\$&")}["'][^\\n]*\\n`,
            ),
          )?.[0];
      if (currentLine) {
        src = commentOutImport(src, currentLine, `package "${pkg}" is not in Petal's allow-list`);
        result.stripped.push({ path: file.path, spec });
      }
    }

    byPath.set(file.path, src);
  }

  // Inject the new deps into package.json.
  if (Object.keys(result.addedDeps).length > 0) {
    if (!pkgJson) pkgJson = { name: "petal-app", private: true, type: "module" };
    const deps = getDeps(pkgJson);
    for (const [k, v] of Object.entries(result.addedDeps)) {
      if (!deps[k]) deps[k] = v;
    }
    byPath.set("package.json", JSON.stringify(pkgJson, null, 2) + "\n");
  }

  result.files = Array.from(byPath, ([path, content]) => ({ path, content }));
  return result;
}
