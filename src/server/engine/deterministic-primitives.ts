/**
 * Deterministic recovery for a VERY small allowlist of genuinely generic
 * primitives. Anything not on this list — including project-specific hooks
 * such as `usePageMeta` — is never stubbed: a missing business dependency is
 * a real requirement to implement, not a compiler error to silence.
 *
 * A primitive is only provided when every name the importers ask for is one
 * it really exports. Every result still passes the normal source/build gates.
 */
import type { ProjectFile } from "@/server/generate.server";
import { resolveSpecifier } from "@/server/engine/structural-deps";

interface Primitive {
  /** Canonical path (without extension variants). */
  path: string;
  exports: string[];
  content: string;
}

export const DETERMINISTIC_PRIMITIVES: readonly Primitive[] = [
  {
    path: "src/lib/utils.ts",
    exports: ["cn"],
    content: `import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`,
  },
  {
    path: "src/hooks/use-mobile.tsx",
    exports: ["useIsMobile"],
    content: `import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);
  React.useEffect(() => {
    const mql = window.matchMedia(\`(max-width: \${MOBILE_BREAKPOINT - 1}px)\`);
    const onChange = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return !!isMobile;
}
`,
  },
];

const STRIP_EXT = /\.(tsx?|jsx?)$/;
const NAMED_IMPORT = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;

function primitiveFor(target: string): Primitive | null {
  const bare = target.replace(STRIP_EXT, "");
  return DETERMINISTIC_PRIMITIVES.find((p) => p.path.replace(STRIP_EXT, "") === bare) ?? null;
}

/** Candidate target path for an unresolved specifier (no file exists yet). */
function targetFor(from: string, spec: string): string | null {
  if (spec.startsWith("@/")) return `src/${spec.slice(2)}`;
  if (!spec.startsWith(".")) return null;
  const parts = from.split("/").slice(0, -1);
  for (const seg of spec.split("/")) {
    if (seg === "." || !seg) continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

export interface PrimitiveRecovery {
  files: ProjectFile[];
  added: string[];
  /** Missing modules that were NOT stubbed because they are not allowlisted primitives. */
  unresolved: string[];
}

export function recoverMissingPrimitives(files: ProjectFile[]): PrimitiveRecovery {
  const paths = new Set(files.map((f) => f.path));
  const wanted = new Map<string, Set<string>>(); // primitive path → names asked for
  const unresolved = new Set<string>();
  for (const f of files) {
    if (!/\.(tsx?|jsx?)$/.test(f.path)) continue;
    NAMED_IMPORT.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = NAMED_IMPORT.exec(f.content))) {
      const spec = m[2];
      if (!(spec.startsWith("@/") || spec.startsWith("."))) continue;
      if (resolveSpecifier(f.path, spec, paths)) continue;
      const target = targetFor(f.path, spec);
      if (!target) continue;
      const prim = primitiveFor(target);
      if (!prim) {
        unresolved.add(target);
        continue;
      }
      const names = m[1]
        .split(",")
        .map((s) => s.replace(/^\s*type\s+/, "").split(/\s+as\s+/)[0].trim())
        .filter(Boolean);
      if (!wanted.has(prim.path)) wanted.set(prim.path, new Set());
      for (const n of names) wanted.get(prim.path)!.add(n);
    }
  }
  const added: string[] = [];
  const out = [...files];
  for (const [path, names] of wanted) {
    const prim = DETERMINISTIC_PRIMITIVES.find((p) => p.path === path)!;
    // Asked for something the primitive doesn't export → not generic; don't fake it.
    if ([...names].some((n) => !prim.exports.includes(n))) {
      unresolved.add(path.replace(STRIP_EXT, ""));
      continue;
    }
    out.push({ path: prim.path, content: prim.content });
    added.push(prim.path);
  }
  return { files: out, added, unresolved: [...unresolved] };
}
