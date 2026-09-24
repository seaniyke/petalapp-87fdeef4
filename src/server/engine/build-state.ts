/**
 * THE authoritative build state. Success is a deterministic consequence of
 * these fields — never of an AI self-check.
 *
 *   requested → planned → generated → validated → repaired
 *     → complete/incomplete → build verified → browser verified → published
 *
 * The generation turn owns the first six; the build/publish stages own the
 * rest (see project build rows). A generation turn may only report success
 * when `complete` is true.
 */
import type { ProjectFile } from "@/server/generate.server";
import { assessRouteCoverage } from "@/server/chunked-generation.server";
import { extractRequestedPages, pageNameToRoute } from "@/server/requested-scope";

export interface BuildState {
  requestedRoutes: string[];
  plannedRoutes: string[];
  generatedPaths: string[];
  repairedPaths: string[];
  rejectedPaths: string[];
  missingRoutes: string[];
  complete: boolean;
}

/** Requested scope, decided by application code from the user's words. */
export function requestedRoutesFor(prompt: string, plannedRoutes: string[]): string[] {
  const explicit = extractRequestedPages(prompt).map(pageNameToRoute);
  const routes = explicit.length ? explicit : plannedRoutes;
  return Array.from(new Set(routes.filter(Boolean)));
}

function routerSourceOf(files: ProjectFile[]): string {
  return files
    .filter((f) => /^src\/(App|main|router)\.(t|j)sx?$/i.test(f.path) || /^src\/routes\//i.test(f.path))
    .map((f) => f.content)
    .join("\n");
}

/** A placeholder written by deterministic cleanup (e.g. the import resolver
 *  stubbing a missing import) is NOT a delivered page. In the last smoke run
 *  the "Home" that passed the check was exactly such a stub. */
export function isPlaceholderFile(content: string): boolean {
  return /Auto-generated stub by (Petal|Kimble) import-resolver/.test(content);
}

/** Deterministic completeness check against the FINAL file set. */
export function assessCompleteness(args: {
  requestedRoutes: string[];
  files: ProjectFile[];
}): { complete: boolean; missingRoutes: string[] } {
  if (args.requestedRoutes.length === 0) return { complete: true, missingRoutes: [] };
  const real = args.files.filter((f) => !isPlaceholderFile(f.content));
  const a = assessRouteCoverage({
    expectedRoutes: args.requestedRoutes,
    files: real,
    routerSource: routerSourceOf(real),
    requireAppShell: true,
  });
  const missingRoutes = a.remainingSteps
    .map((s) => /"([^"]+)" page/.exec(s)?.[1] ?? (/src\/App/.test(s) ? "app shell" : null))
    .filter((x): x is string => !!x);
  return { complete: missingRoutes.length === 0, missingRoutes };
}

function label(route: string): string {
  if (route === "/") return "Home";
  if (route === "app shell") return "the app's main layout";
  const s = route.replace(/^\//, "").replace(/[-_]/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Honest user-facing note for an incomplete build. */
export function incompleteBuildMessage(missing: string[]): string {
  const names = missing.map(label);
  const list =
    names.length <= 1 ? names[0] ?? "part of it" : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return (
    `\n\nThis build isn't finished: ${list} ${missing.length === 1 ? "wasn't" : "weren't"} created, ` +
    `so I haven't built or published it. Everything else I made is saved — ` +
    `ask me to add ${missing.length === 1 ? "it" : "them"} and I'll write only what's missing.`
  );
}
