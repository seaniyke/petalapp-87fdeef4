/**
 * Deterministic starter-kit import repair.
 *
 * Only for imports whose SOURCE is a shipped starter-kit module and whose
 * symbol is exported by exactly one other starter-kit module. Everything is
 * derived from the kit files themselves (the authoritative export map) — no
 * fuzzy matching, no renames, no application modules. When a repair cannot
 * be proven from the manifest the import is left untouched and the normal
 * validation error reaches the writer.
 */
import type { ProjectFile } from "@/server/scaffold-kit";

export interface KitImportRepair {
  symbol: string;
  from: string;
  to: string;
}

const SOURCE_RX = /\.(tsx?|jsx?)$/;

/** Every exported name of a module (values and types). */
export function moduleExports(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]!);
  for (const m of src.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}/g)) {
    for (const part of m[1]!.split(",")) {
      const n = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()!.trim();
      if (n && n !== "default") out.add(n);
    }
  }
  return out;
}

/** "src/components/motion/slide-up.tsx" → "@/components/motion/slide-up"; index files → their directory. */
function specOf(path: string): string {
  return `@/${path.slice(4).replace(SOURCE_RX, "").replace(/\/index$/, "")}`;
}

export interface KitExportIndex {
  /** kit spec → its exports */
  modules: Map<string, Set<string>>;
  /** symbol → non-barrel kit specs that export it */
  owners: Map<string, string[]>;
}

/**
 * Build the index from the kit files that are actually visible (authored
 * files at the same path override the kit and are excluded — the model owns
 * them, so nothing about them is "known").
 */
export function buildKitExportIndex(kit: ProjectFile[], authored?: (path: string) => boolean): KitExportIndex {
  const modules = new Map<string, Set<string>>();
  const owners = new Map<string, string[]>();
  for (const f of kit) {
    if (!f.path.startsWith("src/") || !SOURCE_RX.test(f.path)) continue;
    if (authored?.(f.path)) continue;
    const spec = specOf(f.path);
    const names = moduleExports(f.content);
    modules.set(spec, names);
    if (/\/index\.(tsx?|jsx?)$/.test(f.path)) continue; // barrels re-export; never a canonical owner
    for (const n of names) (owners.get(n) ?? owners.set(n, []).get(n)!).push(spec);
  }
  return { modules, owners };
}

const IMPORT_STMT = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+(["'])(@\/[^"']+)\3;?/g;

/**
 * Move named imports of known kit symbols from the wrong kit module to the
 * one kit module that exports them. Returns null when nothing changed.
 */
export function repairKitImports(content: string, index: KitExportIndex): { content: string; repairs: KitImportRepair[] } | null {
  const repairs: KitImportRepair[] = [];
  const next = content.replace(IMPORT_STMT, (stmt, typeKw: string | undefined, body: string, q: string, spec: string) => {
    const exported = index.modules.get(spec);
    if (!exported) return stmt; // not a kit module → never touched
    const keep: string[] = [];
    const moved = new Map<string, string[]>();
    for (const raw of body.split(",")) {
      const part = raw.trim();
      if (!part) continue;
      const imported = part.replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim();
      if (exported.has(imported)) { keep.push(part); continue; }
      const owners = index.owners.get(imported) ?? [];
      if (owners.length !== 1) { keep.push(part); continue; } // unknown or ambiguous → real error
      const to = owners[0]!;
      (moved.get(to) ?? moved.set(to, []).get(to)!).push(part);
      repairs.push({ symbol: imported, from: spec, to });
    }
    if (!moved.size) return stmt;
    const t = typeKw ? "type " : "";
    const lines: string[] = [];
    if (keep.length) lines.push(`import ${t}{ ${keep.join(", ")} } from ${q}${spec}${q};`);
    for (const [to, parts] of moved) lines.push(`import ${t}{ ${parts.join(", ")} } from ${q}${to}${q};`);
    return lines.join("\n");
  });
  return repairs.length ? { content: next, repairs } : null;
}
