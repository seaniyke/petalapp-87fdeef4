/**
 * Auto-derived kit manifest.
 *
 * Instead of hand-curating which primitives the model "knows about" inside
 * dynamic-prompts.server.ts (and forgetting to update it whenever a new
 * component lands in scaffold-kit.ts), we INTROSPECT the kit at request
 * time. We parse `KIT_FILES` for `export const Foo` / `export function Bar`
 * declarations under `src/components/ui/*` and produce a compact line per
 * file showing the import path and exported symbols.
 *
 * Cost: ~5ms once per Worker isolate (memoized after first call).
 *
 * Why this matters: every new primitive becomes visible to Petal the
 * MOMENT it ships, no prompt edit required. Closes the "Petal doesn't
 * know about <NewThing>" gap that bites us every time the kit grows.
 */
import { KIT_FILES } from "./scaffold-kit";

const EXPORT_RE =
  /export\s+(?:const|function|class|interface|type)\s+([A-Z][A-Za-z0-9_]*)/g;

interface ManifestEntry {
  /** Import specifier, e.g. "@/components/ui/button" */
  importPath: string;
  /** Exported PascalCase symbols (components, helpers, types) */
  exports: string[];
}

let cached: string | null = null;

/**
 * Parse one source blob and return the PascalCase exports. We dedupe
 * because `forwardRef` patterns sometimes re-export the same name twice.
 */
function extractExports(source: string): string[] {
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  EXPORT_RE.lastIndex = 0;
  while ((m = EXPORT_RE.exec(source))) {
    seen.add(m[1]);
  }
  return Array.from(seen).sort();
}

/**
 * Render the kit manifest as a compact prompt block. Listed alphabetically
 * by file so diffs across versions stay readable in logs.
 */
export function renderKitManifestBlock(): string {
  if (cached) return cached;

  const entries: ManifestEntry[] = [];
  for (const f of KIT_FILES) {
    if (!f.path.startsWith("src/components/ui/")) continue;
    if (!/\.(tsx?|jsx?)$/.test(f.path)) continue;
    const exports = extractExports(f.content);
    if (exports.length === 0) continue;
    const importPath = f.path
      .replace(/^src\//, "@/")
      .replace(/\.(tsx?|jsx?)$/, "");
    entries.push({ importPath, exports });
  }

  entries.sort((a, b) => a.importPath.localeCompare(b.importPath));

  const lines = entries.map(
    (e) => `- ${e.importPath} → ${e.exports.join(", ")}`,
  );

  cached = `\n\n[Kit manifest — auto-derived from the scaffold; these are the ONLY @/components/ui/* modules that exist]
Every entry below ships in every project. Import from the exact path shown. Do NOT invent new @/components/ui/* paths — if a primitive isn't listed, it doesn't exist.

${lines.join("\n")}

Helpers: cn() from "@/lib/utils". Icons: lucide-react. NEVER emoji as functional icons.`;

  return cached;
}

/**
 * Test/debug helper — return the structured manifest without prompt
 * formatting. Used by unit tests to assert new primitives get picked up.
 */
export function getKitManifest(): ManifestEntry[] {
  const out: ManifestEntry[] = [];
  for (const f of KIT_FILES) {
    if (!f.path.startsWith("src/components/ui/")) continue;
    if (!/\.(tsx?|jsx?)$/.test(f.path)) continue;
    const exports = extractExports(f.content);
    if (exports.length === 0) continue;
    out.push({
      importPath: f.path.replace(/^src\//, "@/").replace(/\.(tsx?|jsx?)$/, ""),
      exports,
    });
  }
  return out;
}
