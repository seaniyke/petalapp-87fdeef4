/**
 * Petal v3 — Phase C: the scaffold owns structure.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Before v3, "which files may the model write?" was answered in three
 * different places with three slightly different lists: an inline predicate in
 * the generate route, a `PROTECTED_PREFIXES` constant inside the pre-emit
 * gate, and an implicit assumption in half a dozen repair passes. Drift
 * between those lists is how a model-authored `vite.config.ts` reaches disk
 * and how a verifier blocks a turn on a file the model was never allowed to
 * fix.
 *
 * This module is the single source of truth. Two questions, two answers:
 *
 *   isScaffoldOwnedPath(p)  — may the MODEL write this file? (write allowlist)
 *   isVerifierExempt(p)     — may a verifier BLOCK a turn on this file?
 *
 * The second is a superset of the first: everything Petal owns is also
 * something the model cannot be asked to repair, plus generated integration
 * code that is correct-by-construction and occasionally trips a heuristic.
 *
 * Adding a path here retires repair passes. That is the point: `main.tsx`,
 * `index.html` and the router bootstrap are Petal's, so a model mistake in
 * them is impossible rather than repairable.
 */

import { KIT_FILES } from "./scaffold-kit";
import { BACKEND_KIT_BLOCK_FILES_3 } from "./scaffold-kit-blocks-3";
import { BACKEND_EXAMPLES_PACK } from "./examples-pack";

/**
 * Directory prefixes Petal owns outright. ONLY directories whose entire
 * contents are generated per project by Petal belong here (the backend
 * client is regenerated from the connected backend's URL/key, so its file
 * set is not static).
 *
 * Shared component directories (`src/components/blocks/`, `ui/`, ...) are
 * deliberately NOT prefixes: a directory is a location, not an owner. The
 * starter-kit files inside them are owned via the kit manifest below; a new
 * file the model authors next to them is project code and must stay visible
 * to readiness verification. (A blanket `src/components/blocks/` prefix hid a
 * freshly written `bakery-contact-band.tsx` from the verifier, which then
 * reported its importers as broken.)
 */
export const SCAFFOLD_OWNED_PREFIXES = ["src/integrations/backend/"] as const;

let kitManifest: Set<string> | null = null;
/**
 * The authoritative set of starter-kit file paths Petal ships and
 * overwrites: every `overwrite` entry of KIT_FILES plus the static
 * backend-only kit packs. Built lazily from the same arrays applyScaffoldKit
 * writes, so ownership can never drift from what is actually shipped.
 */
export function scaffoldKitManifest(): ReadonlySet<string> {
  if (!kitManifest) {
    kitManifest = new Set<string>([
      ...KIT_FILES.filter((k) => k.overwrite).map((k) => k.path),
      ...BACKEND_KIT_BLOCK_FILES_3.map((k) => k.path),
      ...BACKEND_EXAMPLES_PACK.map((k) => k.path),
    ]);
  }
  return kitManifest;
}

/**
 * Exact files Petal owns.
 *
 * `package.json` is here deliberately: dependency changes belong to the bare
 * import resolver, which reads the real registry and writes a real resolved
 * version. A hand-patched version string is an `npm install` failure no amount
 * of source repair can recover from.
 */
export const SCAFFOLD_OWNED_PATHS = new Set([
  "vite.config.ts",
  "tsconfig.json",
  "petal-source-plugin.mjs",
  "src/lib/utils.ts",
  "src/lib/a11y.ts",
  "src/lib/confetti.ts",
  "src/lib/query-client.ts",
  "src/lib/stores/example-store.ts",
  "src/lib/view-transitions.ts",
  "src/hooks/use-axe.ts",
  "src/hooks/use-horizontal-scroll.ts",
  "src/hooks/use-query-state.ts",
  "src/hooks/use-scroll-scene.ts",
  "package.json",
  // Webby parity: the project contract is read-only. The model reads it to
  // learn the real directory layout, UI kit and icon set; rewriting it would
  // let a hallucinated structure become "authoritative".
  "template.json",
]);

/**
 * Structural files Petal writes deterministically but that still arrive on
 * some legacy paths as model ops. These are absorbed rather than refused:
 * `index.html` goes through the document-head merge, `src/main.tsx` through
 * the renderable-shell restorer. Listed separately so callers can tell
 * "absorb this" apart from "refuse this".
 */
export const SCAFFOLD_ABSORBED_PATHS = new Set(["index.html", "src/main.tsx"]);

/** Extra prefixes that are exempt from verifier blocking but not from writes. */
const VERIFIER_EXEMPT_PREFIXES = ["src/integrations/"] as const;

/**
 * `src/hooks/use-axe.ts` and `src/hooks/use-axe.tsx` are the same kit file.
 * Matching on the literal string let the `.tsx` spelling slip past ownership
 * entirely: the scaffold rewrote it with the canonical (smaller) version and
 * the scope guard then told the user "a file shrank by more than half" about
 * a file they never wrote. Compare TS/TSX-insensitively.
 */
function ownershipVariants(path: string): string[] {
  if (path.endsWith(".tsx")) return [path, `${path.slice(0, -4)}.ts`];
  if (path.endsWith(".ts")) return [path, `${path}x`];
  return [path];
}

/** May the model write this path? `false` means the op is refused/reworked. */
export function isScaffoldOwnedPath(path: string): boolean {
  const kit = scaffoldKitManifest();
  if (ownershipVariants(path).some((p) => SCAFFOLD_OWNED_PATHS.has(p) || kit.has(p))) return true;
  return SCAFFOLD_OWNED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** Is this path absorbed by a deterministic writer instead of refused? */
export function isScaffoldAbsorbedPath(path: string): boolean {
  return ownershipVariants(path).some((p) => SCAFFOLD_ABSORBED_PATHS.has(p));
}

/**
 * May a verifier hold the turn hostage over this path? A diagnostic on a
 * Petal-owned file is either our bug or a false positive — never something a
 * model repair round can resolve, so blocking on it just burns budget.
 */
export function isVerifierExempt(path: string): boolean {
  if (isScaffoldOwnedPath(path)) return true;
  if (isScaffoldAbsorbedPath(path)) return true;
  return VERIFIER_EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** One plain sentence explaining an ownership refusal, for the model/user. */
export function scaffoldOwnershipReason(path: string): string {
  if (path === "package.json") {
    return "package.json is managed by Petal's dependency resolver — add the import and the package is installed with a real resolved version";
  }
  if (path === "vite.config.ts" || path === "tsconfig.json") {
    return `${path} is build configuration owned by the Petal scaffold`;
  }
  if (path === "template.json") {
    return "template.json describes the scaffold you are building into — read it, never write it";
  }
  if (path === "src/lib/utils.ts") {
    return "src/lib/utils.ts is part of the UI kit contract";
  }
  if (path.startsWith("src/components/ui/")) {
    return "src/components/ui/* is the pre-installed UI kit — compose with it from app code instead of editing it";
  }
  if (path.startsWith("src/integrations/backend/")) {
    return "src/integrations/backend/* is generated backend client code";
  }
  return `${path} is owned by the Petal scaffold`;
}

/**
 * The project-authored subset of a tree: everything except scaffold-owned or
 * absorbed files (package.json passes as dependency intent — the scaffold
 * merger rewrites it). Ownership is per file, so a file the model authored
 * inside a shared kit directory stays in the project graph and remains
 * visible to readiness verification.
 */
export function projectAuthoredFiles<T extends { path: string }>(files: readonly T[]): T[] {
  return files.filter(
    (file) => file.path === "package.json" || (!isScaffoldOwnedPath(file.path) && !isScaffoldAbsorbedPath(file.path)),
  );
}
