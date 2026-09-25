/**
 * THE verification pipeline. One ordered list of gates, one final status.
 *
 *   WRITE → SYNTAX → DEPENDENCIES → ROUTES/COMPLETENESS → BUILD → BROWSER → FINAL
 *
 * Rules:
 *  - Every gate returns PASS | FAIL | UNAVAILABLE | WARNING | UNKNOWN.
 *  - UNAVAILABLE/UNKNOWN never become FAIL and never trigger repair.
 *  - READY only when every REQUIRED gate for the project type is PASS.
 *  - A FAIL produces a failure record naming the gate, the reason and the
 *    smallest set of files to repair (capped). No AI here.
 */
import type { ProjectFile } from "@/server/generate.server";
import type { Verdict } from "@/server/execution/verdict";
import { toVerdict } from "@/server/execution/verdict";
import { buildAppMap } from "@/server/engine/app-map";
import { assessCompleteness, isUnfinishedPage } from "@/server/engine/build-state";
import { frameIsComplete } from "@/server/engine/write";
export { isUnfinishedPage };

export type GateId = "syntax" | "dependencies" | "routes" | "build" | "browser";
export const GATE_ORDER: GateId[] = ["syntax", "dependencies", "routes", "build", "browser"];

export interface GateResult {
  gate: GateId;
  verdict: Verdict;
  reasons: string[];
  /** Files a repair may touch for this gate (FAIL only). */
  paths: string[];
}

export type FinalStatus = "READY" | "FAILED" | "UNVERIFIED" | "IN_PROGRESS";

export interface VerificationRecord {
  status: FinalStatus;
  gates: GateResult[];
  failedGate: GateId | null;
  reason: string | null;
  repairTargets: string[];
}

export const MAX_REPAIR_TARGETS = 3;

const gate = (g: GateId, verdict: Verdict, reasons: string[] = [], paths: string[] = []): GateResult => ({
  gate: g,
  verdict,
  reasons,
  paths,
});

/* ------------------------------ syntax ------------------------------ */

/** Wrap the authoritative esbuild verdict. Heuristic scanners are advisory. */
export function syntaxGate(esbuild: { status: string; issues?: Array<{ path: string; detail?: string; message?: string; line?: number }> } | null): GateResult {
  if (!esbuild) return gate("syntax", "UNKNOWN", ["syntax check did not run"]);
  const v = esbuild.status === "not_checked" ? "PASS" : toVerdict(esbuild.status);
  const issues = esbuild.issues ?? [];
  if (v === "FAIL") {
    return gate("syntax", "FAIL", issues.slice(0, 6).map((i) => `${i.path}${i.line ? `:${i.line}` : ""}: ${i.message ?? i.detail ?? "syntax error"}`), uniq(issues.map((i) => i.path)));
  }
  if (v === "UNAVAILABLE") return gate("syntax", "UNAVAILABLE", ["syntax checker unavailable — code kept as written"]);
  return gate("syntax", v);
}

/* --------------------------- dependencies --------------------------- */

const KIT_PROVIDED = /^(react|react-dom|react\/jsx-runtime|lucide-react|clsx|tailwind-merge|class-variance-authority)$/;

function resolveLocal(from: string, spec: string, paths: Set<string>): boolean {
  let base: string;
  if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
  else {
    const dir = from.split("/").slice(0, -1);
    for (const part of spec.split("/")) {
      if (part === "." || part === "") continue;
      if (part === "..") dir.pop();
      else dir.push(part);
    }
    base = dir.join("/");
  }
  return ["", ".tsx", ".ts", ".jsx", ".js", ".css", "/index.tsx", "/index.ts", "/index.js"].some((e) => paths.has(base + e));
}

function pkgName(spec: string): string {
  return spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!;
}

/**
 * Broken local imports are defects (FAIL, repair the importing file).
 * A bare package missing from package.json is a WARNING: the deterministic
 * dependency resolver adds it at build time, so it is not a code defect.
 */
export function dependencyGate(files: ProjectFile[]): GateResult {
  const paths = new Set(files.map((f) => f.path));
  let declared = new Set<string>();
  const pkg = files.find((f) => f.path === "package.json");
  if (!pkg) return gate("dependencies", "UNKNOWN", ["no package.json"]);
  try {
    const j = JSON.parse(pkg.content) as { dependencies?: object; devDependencies?: object };
    declared = new Set([...Object.keys(j.dependencies ?? {}), ...Object.keys(j.devDependencies ?? {})]);
  } catch {
    return gate("dependencies", "FAIL", ["package.json is not valid JSON"], ["package.json"]);
  }
  const broken: string[] = [];
  const brokenPaths: string[] = [];
  const undeclared = new Set<string>();
  const re = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g;
  for (const f of files) {
    if (!/\.(t|j)sx?$/.test(f.path) || !f.path.startsWith("src/")) continue;
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(f.content))) {
      const spec = m[1]!;
      if (spec.startsWith(".") || spec.startsWith("@/")) {
        if (!resolveLocal(f.path, spec, paths)) {
          broken.push(`${f.path} imports "${spec}", which does not exist`);
          brokenPaths.push(f.path);
        }
      } else if (!spec.startsWith("node:") && !/^(https?:|virtual:|~)/.test(spec)) {
        const name = pkgName(spec);
        if (!declared.has(name) && !KIT_PROVIDED.test(name)) undeclared.add(name);
      }
    }
  }
  if (broken.length) return gate("dependencies", "FAIL", broken.slice(0, 8), uniq(brokenPaths));
  if (undeclared.size) return gate("dependencies", "WARNING", [`packages added at build time: ${[...undeclared].slice(0, 8).join(", ")}`]);
  return gate("dependencies", "PASS");
}

/* ------------------------ routes / completeness ------------------------ */

export function routesGate(files: ProjectFile[], requestedRoutes: string[], opts: { requireShell?: boolean } = {}): GateResult {
  const reasons: string[] = [];
  const bad: string[] = [];
  // First builds must ship the shared frame (routed App with nav + footer).
  // Previously a separate post-commit check in /api/generate; now one gate.
  if (opts.requireShell && !frameIsComplete(files, requestedRoutes.length)) {
    reasons.push("app shell is missing or incomplete (src/App.tsx needs routes, navigation and footer)");
    bad.push("src/App.tsx");
  }
  const completeness = assessCompleteness({ requestedRoutes, files });
  if (!completeness.complete) {
    reasons.push(`missing requested: ${completeness.missingRoutes.join(", ")}`);
  }
  const map = buildAppMap(files);
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  for (const r of map.routes) {
    if (!r.file) {
      // A <Route> element naming a component the router never imported.
      const src = map.routerFile ? byPath.get(map.routerFile) ?? "" : "";
      const declaredInline = new RegExp(`(function|const)\\s+${r.component}\\b`).test(src);
      if (!declaredInline) {
        reasons.push(`route ${r.path} renders ${r.component}, which is not imported`);
        if (map.routerFile) bad.push(map.routerFile);
      }
      continue;
    }
    const content = byPath.get(r.file) ?? "";
    if (isUnfinishedPage(content)) {
      reasons.push(`route ${r.path} is an unfinished placeholder page`);
      bad.push(r.file);
    }
  }
  if (reasons.length) return gate("routes", "FAIL", reasons, uniq(bad));
  const defined = new Set(map.routes.map((r) => r.path));
  const deadLinks = map.navLinks.filter((l) => defined.size > 0 && !defined.has(l) && !/[:$*]/.test(l));
  if (deadLinks.length) return gate("routes", "WARNING", [`navigation links without a page: ${deadLinks.join(", ")}`]);
  return gate("routes", "PASS");
}

/* --------------------------- build / browser --------------------------- */

export function buildGate(state: "succeeded" | "failed" | "pending" | "unavailable" | null, error?: string): GateResult {
  if (state === "succeeded") return gate("build", "PASS");
  if (state === "failed") return gate("build", "FAIL", [error?.slice(0, 300) ?? "build failed"]);
  if (state === "unavailable") return gate("build", "UNAVAILABLE", ["build service unavailable"]);
  return gate("build", "UNKNOWN", ["build has not finished"]);
}

/** Browser gate: the DEPLOYED app, from the live check / readiness verdict. */
export function browserGate(readiness: { verdict: "ready" | "not_ready" | "unverified"; reasons: string[] } | null): GateResult {
  if (!readiness) return gate("browser", "UNKNOWN", ["live app not checked yet"]);
  if (readiness.verdict === "ready") return gate("browser", "PASS");
  if (readiness.verdict === "not_ready") return gate("browser", "FAIL", readiness.reasons.slice(0, 6));
  return gate("browser", "UNAVAILABLE", readiness.reasons.slice(0, 6));
}

/* ------------------------------ final ------------------------------ */

export type ProjectKind = "web" | "mobile" | "api";

export function requiredGates(kind: ProjectKind): GateId[] {
  if (kind === "mobile") return ["syntax", "dependencies", "routes", "build"];
  if (kind === "api") return ["syntax", "dependencies", "build"];
  return GATE_ORDER;
}

/**
 * Derive the ONE final status. First FAIL (in pipeline order) wins and is
 * recorded; then any required gate that is not PASS/WARNING keeps the
 * project UNVERIFIED (never READY, never repaired).
 */
export function finalizeVerification(results: GateResult[], kind: ProjectKind = "web"): VerificationRecord {
  const ordered = GATE_ORDER.map((g) => results.find((r) => r.gate === g)).filter(Boolean) as GateResult[];
  const failed = ordered.find((r) => r.verdict === "FAIL");
  if (failed) {
    return {
      status: "FAILED",
      gates: ordered,
      failedGate: failed.gate,
      reason: failed.reasons[0] ?? `${failed.gate} failed`,
      repairTargets: failed.paths.slice(0, MAX_REPAIR_TARGETS),
    };
  }
  const required = requiredGates(kind);
  const pending = required.find((g) => {
    const r = ordered.find((x) => x.gate === g);
    return !r || (r.verdict !== "PASS" && r.verdict !== "WARNING");
  });
  if (pending) {
    const r = ordered.find((x) => x.gate === pending);
    const inProgress = !r || (r.verdict === "UNKNOWN" && (pending === "build" || pending === "browser"));
    return {
      status: inProgress ? "IN_PROGRESS" : "UNVERIFIED",
      gates: ordered,
      failedGate: null,
      reason: r?.reasons[0] ?? `${pending} has not run`,
      repairTargets: [],
    };
  }
  return { status: "READY", gates: ordered, failedGate: null, reason: null, repairTargets: [] };
}

/** Pre-build gates for a generation turn (syntax, dependencies, routes). */
export function runSourceGates(args: {
  files: ProjectFile[];
  requestedRoutes: string[];
  esbuild: { status: string; issues?: Array<{ path: string; detail?: string; message?: string; line?: number }> } | null;
  requireShell?: boolean;
}): GateResult[] {
  return [
    syntaxGate(args.esbuild),
    dependencyGate(args.files),
    routesGate(args.files, args.requestedRoutes, { requireShell: args.requireShell }),
  ];
}

/* --------------------------- cleanup guard --------------------------- */

/**
 * Automated cleanup may only change the files it was allowed to touch.
 * Anything else is reverted to its pre-cleanup bytes; the caller must then
 * re-run the source gates on the result.
 */
export function guardCleanup(
  before: ProjectFile[],
  after: ProjectFile[],
  allowed: Iterable<string>,
): { files: ProjectFile[]; reverted: string[] } {
  const ok = new Set(allowed);
  const prev = new Map(before.map((f) => [f.path, f.content]));
  const reverted: string[] = [];
  const out: ProjectFile[] = [];
  const seen = new Set<string>();
  for (const f of after) {
    seen.add(f.path);
    const was = prev.get(f.path);
    if (was !== undefined && was !== f.content && !ok.has(f.path)) {
      reverted.push(f.path);
      out.push({ ...f, content: was });
    } else if (was === undefined && !ok.has(f.path)) {
      reverted.push(f.path);
    } else out.push(f);
  }
  for (const f of before) {
    if (!seen.has(f.path) && !ok.has(f.path)) {
      reverted.push(f.path);
      out.push(f);
    }
  }
  return { files: out, reverted };
}

function uniq(a: string[]): string[] {
  return Array.from(new Set(a));
}
