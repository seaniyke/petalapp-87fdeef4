/**
 * Conditional read-only parallel exploration.
 *
 * Several explorers inspect an immutable snapshot of the project concurrently
 * and return bounded, structured findings. They are READ-ONLY by construction:
 * pure functions over a frozen file list — no writes, no builds, no billing,
 * no AI calls. The main executor is the only writer; it receives one
 * consolidated findings block (duplicates merged).
 *
 * Skipped for LIGHT turns and first builds (nothing to explore): the fast
 * path must not pay for discovery it does not need.
 */
import type { ProjectFile } from "@/server/generate.server";
import type { ExecutionClass } from "@/server/execution/complexity";
import { findMissingNodes } from "@/server/engine/missing-nodes";
import { sharedModules } from "@/server/engine/write";

export type ExplorerRole = "structure" | "dependency" | "data" | "design";

export interface ExplorerFinding {
  role: ExplorerRole;
  facts: string[];
}

export interface ExplorationResult {
  ran: boolean;
  skippedReason: string | null;
  roles: ExplorerRole[];
  findings: ExplorerFinding[];
  block: string;
}

const MAX_FACTS = 12;

/** Which explorers the task justifies. Empty = skip exploration entirely. */
export function explorersFor(args: { cls: ExecutionClass; isInitial: boolean; request: string; fileCount: number }): ExplorerRole[] {
  if (args.isInitial || args.fileCount === 0) return [];
  if (args.cls === "LIGHT") return [];
  const roles: ExplorerRole[] = ["structure", "dependency"];
  if (args.cls !== "STANDARD" || /data|record|table|list|crud|form|auth|login|user|api|backend/i.test(args.request)) roles.push("data");
  if (args.cls !== "STANDARD" || /design|style|layout|look|theme|colou?r|font|page|section/i.test(args.request)) roles.push("design");
  return roles;
}

const src = (files: readonly ProjectFile[]) => files.filter((f) => /\.(tsx?|jsx?)$/.test(f.path));

function structure(files: readonly ProjectFile[]): string[] {
  const pages = src(files).filter((f) => /^src\/(pages|routes)\//.test(f.path)).map((f) => f.path);
  const entry = files.find((f) => /^src\/(main|App)\.tsx$/.test(f.path))?.path;
  const routes = Array.from((files.find((f) => f.path === "src/App.tsx")?.content ?? "").matchAll(/path=["']([^"']+)["']/g)).map((m) => m[1]!);
  return [
    entry ? `entry: ${entry}` : "",
    pages.length ? `pages (${pages.length}): ${pages.slice(0, 10).join(", ")}` : "",
    routes.length ? `routes: ${routes.slice(0, 14).join(", ")}` : "",
  ].filter(Boolean);
}

function dependency(files: readonly ProjectFile[]): string[] {
  const all = files as ProjectFile[];
  const missing = findMissingNodes(all, all.map((f) => f.path));
  const shared = sharedModules(all);
  return [
    ...missing.map((n) => `MISSING shared module ${n.target} (imported by ${n.importers.map((i) => i.path).join(", ")})`),
    ...shared.slice(0, 8).map((m) => `shared ${m.path}: ${m.exports.slice(0, 8).join(", ")}`),
  ];
}

function data(files: readonly ProjectFile[]): string[] {
  const out: string[] = [];
  const types = files.find((f) => f.path === "src/types.ts" || f.path === "src/types/index.ts");
  if (types) {
    const names = Array.from(types.content.matchAll(/export\s+(?:interface|type)\s+([A-Z]\w*)/g)).map((m) => m[1]!);
    if (names.length) out.push(`entities: ${names.slice(0, 14).join(", ")}`);
  }
  if (files.some((f) => f.path.startsWith("src/integrations/supabase/"))) out.push("backend: connected database client present");
  const auth = files.find((f) => /auth/i.test(f.path) && /\.(tsx?|jsx?)$/.test(f.path));
  if (auth) out.push(`auth: ${auth.path}`);
  return out;
}

function design(files: readonly ProjectFile[]): string[] {
  const css = files.find((f) => f.path === "src/styles.css" || f.path === "src/index.css");
  const tokens = css ? Array.from(css.content.matchAll(/--([a-z-]+):/g)).map((m) => m[1]!).slice(0, 10) : [];
  const ui = files.filter((f) => f.path.startsWith("src/components/ui/")).length;
  return [tokens.length ? `design tokens: ${tokens.join(", ")}` : "", ui ? `ui kit components: ${ui}` : ""].filter(Boolean);
}

const RUN: Record<ExplorerRole, (f: readonly ProjectFile[]) => string[]> = { structure, dependency, data, design };

/** Run the justified explorers concurrently over a frozen snapshot. */
export async function exploreProject(args: {
  files: ProjectFile[];
  cls: ExecutionClass;
  isInitial: boolean;
  request: string;
}): Promise<ExplorationResult> {
  const roles = explorersFor({ cls: args.cls, isInitial: args.isInitial, request: args.request, fileCount: args.files.length });
  if (!roles.length) {
    return { ran: false, skippedReason: args.isInitial ? "first_build" : "light_task", roles, findings: [], block: "" };
  }
  const snapshot = Object.freeze(args.files.map((f) => Object.freeze({ ...f }))) as readonly ProjectFile[];
  const results = await Promise.all(roles.map(async (role) => ({ role, facts: RUN[role](snapshot) })));
  // Consolidate: one fact reported by two explorers appears once.
  const seen = new Set<string>();
  const findings = results.map((r) => ({
    role: r.role,
    facts: r.facts.filter((f) => (seen.has(f) ? false : (seen.add(f), true))).slice(0, MAX_FACTS),
  }));
  const body = findings.filter((f) => f.facts.length).map((f) => `[${f.role}]\n- ${f.facts.join("\n- ")}`).join("\n");
  return {
    ran: true,
    skippedReason: null,
    roles,
    findings,
    block: body ? `\n\n### Project exploration (read-only findings — verify before relying)\n${body}` : "",
  };
}
