/**
 * Discovers every folder under ./packages via a Vite glob (bundled as raw
 * text, so it works in the Worker with no filesystem). Adding a design system
 * is adding a folder — no code change.
 */
import { parseDesignSystemPackage, type DesignSystemPackage, type PackageLoadResult } from "./loader";

const RAW = import.meta.glob("./packages/**/*", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

function groupByFolder(raw: Record<string, string>): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const [key, content] of Object.entries(raw)) {
    const m = /^\.\/packages\/([^/]+)\/(.+)$/.exec(key);
    if (!m) continue;
    const files = out.get(m[1]!) ?? {};
    files[m[2]!] = content;
    out.set(m[1]!, files);
  }
  return out;
}

let cache: Map<string, PackageLoadResult> | null = null;

export function loadAllDesignSystems(raw: Record<string, string> = RAW): Map<string, PackageLoadResult> {
  if (raw === RAW && cache) return cache;
  const result = new Map<string, PackageLoadResult>();
  for (const [folder, files] of groupByFolder(raw)) {
    const r = parseDesignSystemPackage(files, folder);
    if (!r.ok) console.warn(`[design-systems] ${folder} rejected: ${r.errors.join("; ")}`);
    result.set(folder, r);
  }
  if (raw === RAW) cache = result;
  return result;
}

/** Resolve a valid package by slug, or null. */
export function getDesignSystem(slug: string | null | undefined): DesignSystemPackage | null {
  if (!slug) return null;
  const r = loadAllDesignSystems().get(slug);
  return r && r.ok ? r.pkg : null;
}

/** Valid, customer-facing packages (internal ones excluded unless asked). */
export function listDesignSystems(opts: { includeInternal?: boolean } = {}): DesignSystemPackage[] {
  return [...loadAllDesignSystems().values()]
    .filter((r): r is { ok: true; pkg: DesignSystemPackage } => r.ok)
    .map((r) => r.pkg)
    .filter((p) => opts.includeInternal || !p.meta.internal);
}
