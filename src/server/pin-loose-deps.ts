/**
 * Replace loose package versions ("*", "latest", "", "x") with Kimble's tested
 * pin, across the WHOLE package.json at the shipping boundary. A loose pin
 * resolves to whatever npm has today, so an upstream release can break an app
 * nobody touched (framer-motion "*" → a version whose dependency wasn't
 * published yet → npm install ETARGET).
 */
import { KNOWN_PACKAGES } from "@/server/known-packages";

type F = { path: string; content: string };
const LOOSE = new Set(["*", "latest", "", "x"]);

export function pinLooseDeps<T extends F>(files: T[]): T[] {
  return files.map((f) => {
    if (f.path !== "package.json") return f;
    let pkg: Record<string, unknown>;
    try {
      pkg = JSON.parse(f.content);
    } catch {
      return f;
    }
    let changed = false;
    for (const key of ["dependencies", "devDependencies"]) {
      const deps = pkg[key] as Record<string, string> | undefined;
      if (!deps || typeof deps !== "object") continue;
      for (const [name, ver] of Object.entries(deps)) {
        const pin = KNOWN_PACKAGES[name];
        if (pin && typeof ver === "string" && LOOSE.has(ver.trim())) {
          deps[name] = pin;
          changed = true;
        }
      }
    }
    return changed ? { ...f, content: JSON.stringify(pkg, null, 2) + "\n" } : f;
  });
}
