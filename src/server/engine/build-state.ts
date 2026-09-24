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

/** What actually exists for each requested page — never collapse
 *  "not written" and "written but not linked" into one state. */
export function describeIncomplete(args: {
  requestedRoutes: string[];
  missingRoutes: string[];
  files: ProjectFile[];
  fileFor: (route: string) => string;
}): { created: string[]; notCreated: string[]; unlinked: string[]; shellMissing: boolean } {
  const real = new Set(
    args.files.filter((f) => f.content.trim().length > 0 && !isPlaceholderFile(f.content)).map((f) => f.path),
  );
  const missing = new Set(args.missingRoutes);
  const created: string[] = [];
  const notCreated: string[] = [];
  const unlinked: string[] = [];
  for (const r of args.requestedRoutes) {
    if (!real.has(args.fileFor(r))) notCreated.push(r);
    else {
      created.push(r);
      if (missing.has(r)) unlinked.push(r);
    }
  }
  return { created, notCreated, unlinked, shellMissing: missing.has("app shell") };
}

function list(routes: string[]): string {
  const n = routes.map(label);
  return n.length <= 1 ? n[0] ?? "" : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

/** Honest user-facing note for an incomplete build, from actual state. */
export function incompleteBuildMessage(
  missing: string[],
  state?: { created: string[]; notCreated: string[]; unlinked: string[]; shellMissing: boolean },
): string {
  if (!state) return legacyIncompleteMessage(missing);
  const parts: string[] = [];
  if (state.created.length) parts.push(`${list(state.created)} ${state.created.length === 1 ? "was" : "were"} created`);
  const blocked: string[] = [];
  if (state.notCreated.length) blocked.push(`${list(state.notCreated)} couldn't be completed`);
  if (state.shellMissing) blocked.push("the shared site layout couldn't be completed");
  else if (state.unlinked.length) blocked.push(`${list(state.unlinked)} ${state.unlinked.length === 1 ? "isn't" : "aren't"} linked into the site yet`);
  return (
    `\n\nThis build couldn't be completed. ` +
    (parts.length ? `${parts.join("; ")}, but ` : "") +
    `${blocked.join(" and ")}, so I haven't built or published it. ` +
    `Everything that was created is saved — ask me to finish it and I'll write only what's missing.`
  );
}

function legacyIncompleteMessage(missing: string[]): string {

  const names = missing.map(label);
  const list =
    names.length <= 1 ? names[0] ?? "part of it" : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return (
    `\n\nThis build isn't finished: ${list} ${missing.length === 1 ? "wasn't" : "weren't"} created, ` +
    `so I haven't built or published it. Everything else I made is saved — ` +
    `ask me to add ${missing.length === 1 ? "it" : "them"} and I'll write only what's missing.`
  );
}

/** Before build + browser check + publish have passed, the model's summary
 *  may describe what was written but never claim the site is live/ready. */
export function neutraliseSuccessClaims(text: string): string {
  return text
    .replace(/\b(is|are)\s+(now\s+)?(live|published|up and running|ready to (use|go|share))\b/gi, "$1 written — building your preview now")
    .replace(/\byour (site|website|app) is ready\b/gi, "your $1's pages are written — building your preview now");
}
