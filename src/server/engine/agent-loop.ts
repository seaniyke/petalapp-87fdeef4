/**
 * AGENT LOOP — the one execution path for building an app.
 *
 *   inspect workspace → select next operation(s) → execute ONE bounded
 *   operation each → validate immediately → correct in the same loop →
 *   record + durable checkpoint → update ExecutionState → repeat
 *
 * There is no pre-computed batch. The plan only seeds GOALS (pages the
 * product needs). Every iteration re-inspects the actual staged workspace:
 *  - dependencies first (foundation modules pages will import),
 *  - pages the router actually references are discovered here, keyed by a
 *    canonical identity, so the same page can never be scheduled twice
 *    (e.g. "/" planned as Home.tsx while the router maps "/" → Dashboard.tsx),
 *  - finished work (real file on disk / op done) is never re-selected,
 *  - failures feed the same loop: the real diagnostic goes back to the same
 *    writer once; a cut-off answer is continued, then re-planned decomposed.
 *
 * Writes only touch the in-memory staged tree; the caller commits through
 * TurnTransaction + revision CAS after final verification. No other writer.
 */
import type { ProjectFile } from "@/server/generate.server";
import { assessCompleteness, isPlaceholderFile } from "@/server/engine/build-state";
import type { RecoveryBudget } from "@/server/engine/recovery-policy";
import type { PlannedPage } from "@/server/engine/plan";
import type { PageDecision } from "@/server/execution/complexity";
import {
  continuationInstruction,
  feedbackInstruction,
  signatureContext,
  stitchContinuation,
  validateUnitImports,
  undefinedNames,
  safeReactImportRepair,
  type UnitKind,
  type UnitRecord,
} from "@/server/engine/work-unit";
import {
  DECOMPOSED_MARKER,
  PAGE_CONCURRENCY,
  decomposedPageInstruction,
  frameIsComplete,
  mapBounded,
  missingSections,
  pageInstruction,
  projectContract,
  routerInstruction,
  sectionInstruction,
  sharedFiles,
  targetOf,
} from "@/server/engine/write";

// ---------------------------------------------------------------------------
// ExecutionState — the single authoritative execution truth for a build.
// ---------------------------------------------------------------------------

export type OpKind = "foundation" | "page" | "section" | "router";
export type OpStatus = "pending" | "running" | "done" | "failed";

export interface Operation {
  /** Canonical identity. Completed keys are never re-selected. */
  key: string;
  kind: OpKind;
  target: string;
  route?: string;
  /** Operations this one waits on (by key). */
  dependsOn: string[];
  status: OpStatus;
  attempts: number;
  errors: string[];
}

export interface ExecutionState {
  goal: string;
  /** Pages the product needs, one per canonical route. */
  requirements: PlannedPage[];
  files: ProjectFile[];
  ops: Map<string, Operation>;
  completed: string[];
  current: string[];
  iterations: number;
  calls: number;
  checkpoint: { saved: number; failed: number };
}

/** Canonical page identity. The home page has exactly one identity no matter
 *  what file name the planner or the router chose. */
export function pageKey(route: string): string {
  const r = route.replace(/\/+$/, "") || "/";
  return `page:${r.toLowerCase()}`;
}

const HOME_NAMES = /^(home|index|landing|dashboard|overview|main)$/i;

/** Router facts from the actual App file: route → page file. Deterministic. */
export function routerPages(files: ProjectFile[]): PlannedPage[] {
  const app = files.find((f) => f.path === "src/App.tsx")?.content ?? "";
  const byIdent = new Map<string, string>();
  for (const m of app.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s+["']@\/pages\/([A-Za-z][\w-]*)(?:\.tsx)?["']/g)) {
    byIdent.set(m[1]!, `src/pages/${m[2]!}.tsx`);
  }
  const out: PlannedPage[] = [];
  const seen = new Set<string>();
  // Explicit <Route path="x" element={<Comp …/>} />
  for (const m of app.matchAll(/<Route\b[^>]*?path=["']([^"']+)["'][^>]*?element=\{\s*<\s*([A-Za-z_$][\w$]*)/g)) {
    const file = byIdent.get(m[2]!);
    if (!file) continue;
    const key = pageKey(m[1]!);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ route: m[1]!, file });
  }
  // Imported pages without a parseable <Route>: derive the route from the name.
  const routed = new Set(out.map((p) => p.file));
  for (const file of byIdent.values()) {
    if (routed.has(file)) continue;
    const name = file.split("/").pop()!.replace(/\.tsx$/, "");
    const slug = name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
    const route = HOME_NAMES.test(name) && !seen.has(pageKey("/")) ? "/" : `/${slug}`;
    const key = pageKey(route);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ route, file });
    routed.add(file);
  }
  return out;
}

export function hasRealFile(files: ProjectFile[], file: string): boolean {
  const f = files.find((x) => x.path === file);
  return Boolean(f && f.content.trim().length > 0 && !isPlaceholderFile(f.content));
}

/**
 * Merge seed goals with the router's actual pages under canonical identity.
 * When both name the same route, the file that already exists (or the one
 * the router imports) wins — the other is never scheduled.
 */
export function reconcileRequirements(seed: PlannedPage[], files: ProjectFile[]): PlannedPage[] {
  const byKey = new Map<string, PlannedPage>();
  for (const p of seed) if (!byKey.has(pageKey(p.route))) byKey.set(pageKey(p.route), { ...p });
  for (const r of routerPages(files)) {
    const k = pageKey(r.route);
    const cur = byKey.get(k);
    if (!cur) {
      // A page file already claimed by another route is the same page.
      if ([...byKey.values()].some((p) => p.file === r.file)) continue;
      byKey.set(k, r);
    } else if (cur.file !== r.file && !hasRealFile(files, cur.file)) {
      // Router is the actual workspace: adopt its file for this route.
      cur.file = r.file;
    }
  }
  return [...byKey.values()];
}

export function createExecutionState(goal: string, seed: PlannedPage[], files: ProjectFile[]): ExecutionState {
  return {
    goal,
    requirements: reconcileRequirements(seed, files),
    files,
    ops: new Map(),
    completed: [],
    current: [],
    iterations: 0,
    calls: 0,
    checkpoint: { saved: 0, failed: 0 },
  };
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

export interface LoopResult {
  files: ProjectFile[];
  written: string[];
  missing: string[];
  calls: number;
  truncated: string[];
  decomposed: Array<{ file: string; reasons: string[]; sections: string[] }>;
  units: UnitRecord[];
  state: ExecutionState;
}

export interface LoopArgs {
  /** Seed goals from the product plan. Not a work queue. */
  pages: PlannedPage[];
  files: ProjectFile[];
  budget: RecoveryBudget;
  goal?: string;
  /** One bounded model call; returns the files it wrote, or null. */
  request: (instruction: string) => Promise<ProjectFile[] | null>;
  isTruncated?: (file: ProjectFile) => Promise<boolean>;
  decide?: (page: PlannedPage, truncatedBefore: boolean) => PageDecision;
  /** Durable checkpoint. Awaited before dependent work continues. */
  onFilesDone?: (files: ProjectFile[]) => void | boolean | Promise<void | boolean>;
  createFoundation?: (files: ProjectFile[]) => Promise<{ files: ProjectFile[]; created: string[] }>;
  onUnit?: (record: UnitRecord) => void;
  checkIdentifiers?: (tree: ProjectFile[], changed: string[]) => { status: string; issues: Array<{ path: string; line: number; message: string }> };
  reactIsDependency?: boolean;
}

/** Max attempts for any page op: first try + one budgeted re-plan. */
const MAX_PAGE_ATTEMPTS = 2;

export async function runAgentLoop(args: LoopArgs): Promise<LoopResult> {
  const state = createExecutionState(args.goal ?? "build", args.pages, args.files);
  const written: string[] = [];
  const truncated: string[] = [];
  const decisions = new Map<string, PageDecision>();
  const units: UnitRecord[] = [];
  let frameTried = false;
  let foundationDone = !args.createFoundation;
  let stopped = false;

  const record = (r: UnitRecord) => {
    units.push(r);
    try { args.onUnit?.(r); } catch { /* observability only */ }
  };
  const checkpoint = async (got: ProjectFile[]) => {
    if (!got.length || !args.onFilesDone) return;
    try {
      const ok = await args.onFilesDone(got);
      if (ok === false) state.checkpoint.failed += got.length; else state.checkpoint.saved += got.length;
    } catch { state.checkpoint.failed += got.length; }
  };
  const inScope = (instruction: string, path: string): boolean => {
    const want = targetOf(instruction);
    if (path === want) return true;
    if (!instruction.startsWith(DECOMPOSED_MARKER)) return false;
    const dir = /plus its section components in (src\/components\/[^\s/]+)\//.exec(instruction)?.[1];
    return Boolean(dir && path.startsWith(dir + "/") && /^[\w/-]+\.tsx$/.test(path) && !path.slice(dir.length + 1).includes("/"));
  };
  const ask = async (instruction: string): Promise<ProjectFile[]> => {
    state.calls++;
    try {
      return ((await args.request(instruction)) ?? []).filter((f) => inScope(instruction, f.path));
    } catch (e) {
      // Stop / cancellation ends the loop; nothing else is scheduled.
      if (/stop|cancel|abort/i.test(String((e as Error)?.message ?? e))) stopped = true;
      return [];
    }
  };
  const cutOff = async (f: ProjectFile): Promise<boolean> => {
    if (!args.isTruncated) return false;
    try { return await args.isTruncated(f); } catch { return false; }
  };

  /** Execute ONE bounded operation → validate → same-writer correction. */
  const execute = async (op: Operation, instruction: string, layer: number): Promise<ProjectFile[]> => {
    const started = Date.now();
    const kind: UnitKind = op.kind === "router" ? "router" : op.kind === "section" ? "section" : "page";
    const target = targetOf(instruction) ?? op.target;
    const rec: UnitRecord = { id: op.key, kind, target, layer, calls: 0, feedbackRounds: 0, continued: false, diagnostics: [], ms: 0, outcome: "ok" };
    const before = state.calls;
    const single = !instruction.startsWith(DECOMPOSED_MARKER);
    const got = await ask(instruction);
    const whole: ProjectFile[] = [];
    for (let f of got) {
      if (await cutOff(f)) {
        if (single && f.path === target) {
          const cont = (await ask(continuationInstruction(f.path, f.content))).find((x) => x.path === f.path);
          if (cont) {
            const stitched = { path: f.path, content: stitchContinuation(f.content, cont.content) };
            if (!(await cutOff(stitched))) { rec.continued = true; f = stitched; }
          }
        }
        if (!rec.continued) { truncated.push(f.path); continue; }
      }
      whole.push(f);
    }
    if (single) {
      const validate = (f: ProjectFile): string[] => [
        ...validateUnitImports(f, state.files).map((d) => d.message),
        ...(args.checkIdentifiers ? undefinedNames(f, state.files, args.checkIdentifiers).map((d) => d.message) : []),
      ];
      for (let i = 0; i < whole.length; i++) {
        if (args.checkIdentifiers) {
          const und = undefinedNames(whole[i]!, state.files, args.checkIdentifiers);
          const repaired = safeReactImportRepair(whole[i]!, und, args.reactIsDependency ?? true);
          if (repaired) { whole[i] = repaired; rec.diagnostics.push(...und.map((d) => d.message + " [auto: added React import]")); rec.outcome = "corrected"; }
        }
        const diags = validate(whole[i]!);
        if (!diags.length) continue;
        rec.diagnostics.push(...diags);
        op.errors.push(...diags);
        rec.feedbackRounds++;
        const asDiag = diags.map((message) => ({ path: whole[i]!.path, spec: "", message }));
        const fixed = (await ask(feedbackInstruction(instruction, whole[i]!, asDiag))).find((x) => x.path === whole[i]!.path);
        if (fixed && !(await cutOff(fixed))) {
          const left = validate(fixed);
          if (left.length < diags.length) { whole[i] = fixed; rec.outcome = left.length ? "failed" : "corrected"; }
          if (left.length) rec.diagnostics.push(...left.map((m) => `still failing after correction: ${m}`));
        } else rec.outcome = "failed";
      }
    }
    rec.calls = state.calls - before;
    rec.ms = Date.now() - started;
    if (!whole.length) rec.outcome = "failed";
    record(rec);
    return whole;
  };

  const apply = (got: ProjectFile[]) => {
    for (const f of got) {
      // Finished work is never rewritten; the router is the one exception.
      if (f.path !== "src/App.tsx" && hasRealFile(state.files, f.path)) continue;
      state.files = [...state.files.filter((x) => x.path !== f.path), f];
      written.push(f.path);
    }
  };

  const upsert = (key: string, init: Omit<Operation, "status" | "attempts" | "errors">): Operation => {
    let op = state.ops.get(key);
    if (!op) { op = { ...init, status: "pending", attempts: 0, errors: [] }; state.ops.set(key, op); }
    return op;
  };
  const markDone = (op: Operation) => {
    if (op.status !== "done") { op.status = "done"; state.completed.push(op.key); }
  };

  /** INSPECT: derive the next runnable operations from the actual workspace. */
  const inspect = (): { layer: number; ops: Operation[] } => {
    // Router is ground truth: newly referenced pages become goals (deduped).
    state.requirements = reconcileRequirements(state.requirements, state.files);

    if (!foundationDone) {
      return { layer: 0, ops: [upsert("foundation", { key: "foundation", kind: "foundation", target: "shared modules", dependsOn: [] })] };
    }

    const pageOps: Operation[] = [];
    for (const p of state.requirements) {
      const key = pageKey(p.route);
      const op = upsert(key, { key, kind: "page", target: p.file, route: p.route, dependsOn: ["foundation"] });
      op.target = p.file;
      if (hasRealFile(state.files, p.file)) {
        if (op.status !== "done" && op.attempts === 0) {
          record({ id: key, kind: "page", target: p.file, layer: 1, calls: 0, feedbackRounds: 0, continued: false, diagnostics: [], ms: 0, outcome: "skipped_done" });
        }
        markDone(op);
        continue;
      }
      if (op.status === "done" || op.status === "running") continue;
      if (op.attempts >= MAX_PAGE_ATTEMPTS) { op.status = "failed"; continue; }
      if (op.attempts >= 1 && !args.budget.take("missing_page", p.route)) { op.status = "failed"; continue; }
      pageOps.push(op);
    }
    if (pageOps.length) return { layer: 1, ops: pageOps };

    // Decomposed pages whose shell landed but some sections are missing.
    const sectionOps: Operation[] = [];
    for (const [pageFile, d] of decisions) {
      if (!hasRealFile(state.files, pageFile)) continue;
      for (const sf of missingSections(state.files, pageFile, d.sectionDir)) {
        const key = `section:${sf}`;
        const op = upsert(key, { key, kind: "section", target: sf, route: pageFile, dependsOn: [] });
        if (op.status !== "pending") continue;
        if (!args.budget.take("missing_page", sf)) { op.status = "failed"; continue; }
        sectionOps.push(op);
      }
    }
    if (sectionOps.length) return { layer: 1, ops: sectionOps };

    if (!frameTried) {
      const existing = state.requirements.filter((p) => hasRealFile(state.files, p.file)).map((p) => p.route);
      const needFrame = !frameIsComplete(state.files, state.requirements.length) ||
        (existing.length > 0 && !assessCompleteness({ requestedRoutes: existing, files: state.files }).complete);
      frameTried = true;
      if (needFrame && args.budget.take("missing_page", "app shell")) {
        return { layer: 2, ops: [upsert("router", { key: "router", kind: "router", target: "src/App.tsx", dependsOn: [] })] };
      }
    }
    return { layer: -1, ops: [] };
  };

  // UNDERSTAND → loop until no runnable operation remains.
  for (;;) {
    if (stopped) break;
    const next = inspect();
    if (!next.ops.length) break;
    state.iterations++;
    state.current = next.ops.map((o) => o.key);
    for (const o of next.ops) { o.status = "running"; o.attempts++; }

    if (next.layer === 0) {
      const started = Date.now();
      const op = next.ops[0]!;
      const f = await args.createFoundation!(state.files); // provider failure propagates as infrastructure
      state.files = f.files;
      for (const t of f.created) record({ id: `foundation:${t}`, kind: "foundation", target: t, layer: 0, calls: 1, feedbackRounds: 0, continued: false, diagnostics: [], ms: Date.now() - started, outcome: "ok" });
      state.calls += f.created.length;
      await checkpoint(state.files.filter((x) => f.created.includes(x.path)));
      foundationDone = true;
      markDone(op);
      continue;
    }

    // Instructions are built from the CURRENT workspace (real signatures).
    const paths = state.files.map((f) => f.path);
    const contract = [projectContract(state.files), signatureContext(state.files)].filter(Boolean).join("\n");
    const shared = sharedFiles(state.files, state.requirements);
    const results = await mapBounded(next.ops, PAGE_CONCURRENCY, async (op) => {
      if (op.kind === "router") {
        return execute(op, routerInstruction(state.requirements, paths, contract), 2);
      }
      if (op.kind === "section") {
        const page = state.requirements.find((p) => p.file === op.route)!;
        const src = state.files.find((f) => f.path === op.route)?.content ?? "";
        return execute(op, sectionInstruction(page, op.target, src, projectContract(state.files)), 1);
      }
      const page = state.requirements.find((p) => pageKey(p.route) === op.key)!;
      const d = args.decide?.(page, truncated.includes(page.file));
      if (d?.decompose) {
        decisions.set(page.file, d);
        return execute(op, decomposedPageInstruction(page, d, paths, contract, shared), 1);
      }
      return execute(op, pageInstruction(page, paths, contract, shared), 1);
    });
    // RECORD: apply through the single staged writer, then checkpoint durably.
    const landed: ProjectFile[] = [];
    results.forEach((got) => { const before = new Set(written); apply(got); landed.push(...got.filter((f) => written.includes(f.path) && !before.has(f.path) || f.path === "src/App.tsx")); });
    await checkpoint(landed);
    for (const op of next.ops) {
      const ok = op.kind === "router" ? frameIsComplete(state.files, state.requirements.length) : hasRealFile(state.files, op.target);
      if (ok) markDone(op); else op.status = op.kind === "page" ? "pending" : "failed";
    }
    state.current = [];
  }

  const decomposed: LoopResult["decomposed"] = [];
  for (const [pageFile, d] of decisions) {
    if (!hasRealFile(state.files, pageFile)) continue;
    decomposed.push({ file: pageFile, reasons: d.reasons, sections: state.files.filter((f) => f.path.startsWith(d.sectionDir + "/")).map((f) => f.path) });
  }
  const missing = state.requirements.filter((p) => !hasRealFile(state.files, p.file)).map((p) => p.route);
  return { files: state.files, written, missing, calls: state.calls, truncated, decomposed, units, state };
}
