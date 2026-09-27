/**
 * The persistent tool-calling execution loop (Webby-style), inside Kimble's
 * safety architecture.
 *
 *   ONE model conversation
 *   → model emits one or more tool calls per response
 *   → read-only tools run concurrently, writes run one at a time
 *   → every write is validated immediately; the result IS the tool output
 *   → broader type check every N writes, fed back into the same conversation
 *   → `finish` asks the ONE readiness authority (the same verdict commit
 *     uses) about the current workspace; NOT READY evidence returns to the
 *     same conversation. The loop keeps no list of its own of what
 *     "complete" means.
 *   → valid foundations with dependents are STABLE: never wholesale
 *     replaced; targeted edits allowed, rolled back if they regress
 *     readiness.
 *
 * Pure orchestration: the model call, write validation, type check and the
 * staged-write sink (TurnTransaction + checkpoint) are injected, so the loop
 * never touches persistence, billing or the committed snapshot itself.
 * Final verification and the revision-guarded commit stay authoritative.
 */
import { classifyWorkUnit } from "./first-build-context";
import type { ProjectFile } from "@/server/generate.server";
import type { Readiness, ReadinessFinding } from "@/server/verification/readiness";
import { findingKey } from "@/server/verification/readiness";
import { buildKitExportIndex, repairKitImports, type KitExportIndex } from "./kit-import-repair";
import { AgentCircuitBreaker, BREAKER_THRESHOLDS, type BreakerThresholds } from "@/server/execution/circuit-breaker";

/* ------------------------------------------------------------------ */
/* Model interface                                                     */
/* ------------------------------------------------------------------ */

export type LoopMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCallMsg[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolCallMsg {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ModelUsage {
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
}

export interface ModelReply {
  content: string | null;
  toolCalls: ToolCallMsg[];
  usage?: ModelUsage;
  ttftMs?: number;
  finishReason?: string | null;
  model?: string;
  /** Upstream provider that served the call (OpenRouter `provider`), when known. */
  upstream?: string;
}

export type CallModel = (messages: LoopMessage[], tools: ToolSchema[], signal?: AbortSignal) => Promise<ModelReply>;

export interface ToolSchema {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export interface LoopConfig {
  maxIterations: number;
  /** Extra iterations only to make the finish gate pass. */
  finalizeIterations: number;
  /** Broader type check after this many successful writes. */
  typecheckEvery: number;
  /** Model context window (tokens) and compaction trigger ratio. */
  contextWindow: number;
  compactAt: number;
  /** Recent messages kept verbatim on compaction. */
  keepRecent: number;
  maxToolOutput: number;
  breaker: BreakerThresholds;
  /** Consecutive steps without workspace progress before one corrective signal. */
  noProgressLimit: number;
  /** Further idle steps allowed after the signal before the turn stops. */
  noProgressRecovery: number;
}

export const FULL_CONFIG: LoopConfig = {
  maxIterations: 100,
  finalizeIterations: 8,
  typecheckEvery: 3,
  contextWindow: 64_000,
  compactAt: 0.7,
  keepRecent: 12,
  maxToolOutput: 12_000,
  breaker: BREAKER_THRESHOLDS,
  noProgressLimit: 5,
  noProgressRecovery: 3,
};

/** LIGHT fast path: locate → read → edit → validate → finish. */
export const LIGHT_CONFIG: LoopConfig = { ...FULL_CONFIG, maxIterations: 6, finalizeIterations: 2, noProgressLimit: 3, noProgressRecovery: 2 };

/* ------------------------------------------------------------------ */
/* No-progress detection (deterministic, no AI)                        */
/* ------------------------------------------------------------------ */

export interface ActionRecord {
  tool: string;
  path: string | null;
  /** Stable identity of the exact call (tool + arguments). */
  key: string;
  isError: boolean;
  /** read_file of a path that does not exist. */
  miss: boolean;
  firstLine: string;
}

export function actionOf(call: ToolCallMsg, o: { output: string; isError: boolean; miss?: boolean }): ActionRecord {
  let path: string | null = null;
  try {
    const a = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
    path = typeof a.path === "string" ? normPath(a.path) : null;
  } catch {
    /* invalid JSON is its own failure */
  }
  return {
    tool: call.function.name,
    path,
    key: `${call.function.name}:${hash(call.function.arguments ?? "")}`,
    isError: o.isError,
    miss: !!o.miss,
    firstLine: o.output.split("\n")[0]!.slice(0, 160),
  };
}

export interface EvidenceSnapshot {
  hashes: Map<string, string>;
  errors: Map<string, number>;
}

export function snapshotEvidence(state: ToolLoopState, tree: Map<string, string>): EvidenceSnapshot {
  const hashes = new Map<string, string>();
  const errors = new Map<string, number>();
  for (const [p, c] of tree) hashes.set(p, hash(c));
  for (const [p, e] of state.validation) errors.set(p, e.length);
  return { hashes, errors };
}

/** A file became valid or lost errors; a new file was created valid. */
export function madeProgress(before: EvidenceSnapshot, state: ToolLoopState, tree: Map<string, string>): boolean {
  for (const [p, c] of tree) {
    const errs = (state.validation.get(p) ?? []).length;
    const had = before.errors.get(p);
    const changed = before.hashes.get(p) !== hash(c);
    if (had === undefined) {
      if (changed && errs === 0) return true;
      continue;
    }
    if (errs < had) return true;
  }
  return false;
}

/** One concise corrective signal from the recent trajectory. */
export const EXPLORATION_DRIFT_SIGNAL =
  "You have enough context to begin the current work unit. Stop exploring unrelated files and directories — the " +
  "starter-kit map already lists what exists. Create the next valid artifact now (the shared layout or the next page), " +
  "then let it validate.";

/** Area of a path for relevance: its directory (knowledge docs are one area each). */
function areaOf(p: string): string {
  if (p.startsWith("knowledge/")) return p;
  const i = p.lastIndexOf("/");
  return i > 0 ? p.slice(0, i) : "/";
}

/**
 * Deterministic drift test for one idle step. `explored` accumulates the areas
 * seen during the current idle streak. Drift = on a second-or-later idle step,
 * the agent re-lists / reads missing paths, or widens into areas it had not
 * touched earlier in the streak (not narrowing toward one work unit). Returns
 * the corrective signal, or null. No read-count threshold.
 */
export function detectExplorationDrift(explored: Set<string>, actions: ActionRecord[], idleStep: number): string | null {
  const inspect = actions.filter((a) => a.tool === "read_file" || a.tool === "list_files" || a.tool === "search");
  if (!inspect.length || actions.some((a) => a.tool === "create_file" || a.tool === "edit_file")) return null;
  const areas = inspect.map((a) => (a.tool === "list_files" ? `list:${a.path ?? ""}` : areaOf(a.path ?? "")));
  const wasted = inspect.some((a) => a.miss || (a.tool === "list_files" && a.isError));
  const widened = explored.size > 0 && areas.some((x) => !explored.has(x));
  for (const x of areas) explored.add(x);
  return idleStep >= 2 && (wasted || widened) ? EXPLORATION_DRIFT_SIGNAL : null;
}

export function diagnoseTrajectory(recent: ActionRecord[]): string {
  const misses = [...new Set(recent.filter((a) => a.miss && a.path).map((a) => a.path!))];
  const counts = new Map<string, { n: number; a: ActionRecord }>();
  for (const a of recent) {
    const c = counts.get(a.key);
    counts.set(a.key, { n: (c?.n ?? 0) + 1, a });
  }
  const repeated = [...counts.values()].filter((c) => c.n >= 2).sort((x, y) => y.n - x.n);
  const writeFails = recent.filter((a) => (a.tool === "create_file" || a.tool === "edit_file") && a.isError);
  const finishRefused = recent.filter((a) => a.tool === "finish" && a.isError).length;
  const parts = ["No progress: your recent steps changed nothing in the workspace."];
  if (misses.length) parts.push(`These files do not exist — stop reading them: ${misses.slice(0, 6).join(", ")}. Use list_files once, or create what you need.`);
  if (repeated.length) {
    const r = repeated[0]!;
    parts.push(`You repeated the same ${r.a.tool}${r.a.path ? ` on ${r.a.path}` : ""} ${r.n} times with the same result (${r.a.firstLine}). Do something different.`);
  }
  if (writeFails.length) {
    const last = writeFails[writeFails.length - 1]!;
    parts.push(`Writes keep failing validation (latest: ${last.path ?? "?"} — ${last.firstLine}). Fix exactly the reported error.`);
  }
  if (finishRefused) parts.push("finish was refused; fix the listed gaps by writing files, not by calling finish again.");
  if (parts.length === 1) parts.push("Write the next missing file now.");
  parts.push("If the next steps also change nothing, this run stops.");
  return parts.join(" ");
}

/* ------------------------------------------------------------------ */
/* Execution state                                                     */
/* ------------------------------------------------------------------ */

export type OpStatus = "pending" | "done" | "blocked" | "skipped";

export interface ToolLoopState {
  goal: string;
  /** Operation ids COMPLETED this turn (written AND validated clean). */
  completedOps: Set<string>;
  /** Paths the model has read (read-before-edit/overwrite). */
  read: Set<string>;
  /** Current validation errors per path (empty = clean). */
  validation: Map<string, string[]>;
  /** Content hash each validation result was computed for (staleness). */
  validatedHash: Map<string, string>;
  /** Last authoritative readiness verdict for the workspace. */
  readiness: Readiness | null;
  written: string[];
  writesSinceTypecheck: number;
  iteration: number;
  finished: boolean;
  stopReason: string | null;
}

export interface CallTrace {
  call: number;
  startedAt: number;
  durationMs: number;
  ttftMs: number | null;
  usage: ModelUsage | null;
  model: string | null;
  toolCalls: string[];
  toolMs: number;
  validationMs: number;
  writes: number;
  compacted: boolean;
  finishReason: string | null;
  /** Upstream provider that served this call, when reported. */
  upstream: string | null;
  /** What this step worked on (page / router / layout / shared / read …). */
  workUnit: string;
  /** Paths written by this step. */
  writtenPaths: string[];
  /** Did the workspace measurably improve (the no-progress definition)? */
  progress: boolean;
  /** Characters sent, by component: stable system, first brief, the rest of the conversation. */
  context: { system: number; brief: number; history: number };
  /** completion tokens / generation time (after first token), when measurable. */
  outputTokensPerSec: number | null;
  /** Paths read (read_file) by this step, including knowledge docs. */
  filesRead: string[];
  /** Characters of on-demand knowledge docs retrieved by this step. */
  knowledgeChars: number;
  /** read_file calls for paths that do not exist. */
  readMisses: number;
  /** Writes in this step whose file failed immediate validation. */
  validationFailures: number;
  /** Tool calls that returned an error (refusals, bad args, misses). */
  toolErrors: number;
  /** "correction" when this step rewrote a file that was failing validation. */
  recovery: "correction" | null;
  /** Model call error, when the step failed before a reply. */
  error: string | null;
  /** Starter-kit imports corrected deterministically in this step (no model call). */
  deterministicRepairs?: number;
}

/* ------------------------------------------------------------------ */
/* Args / result                                                       */
/* ------------------------------------------------------------------ */

export interface ToolLoopArgs {
  goal: string;
  /** Stable, cache-friendly system prefix (never mutated by the loop). */
  system: string;
  /** First user message: request + selective project context. */
  brief: string;
  files: ProjectFile[];
  /**
   * Read-only files that exist in the generated workspace but are owned by
   * the platform (the scaffold kit: UI primitives, blocks, router re-export).
   * Visible to read_file/list_files/search and to import validation, never
   * written, never returned in `files`. Without this the loop told the model
   * that advertised kit modules "do not exist".
   */
  reference?: ProjectFile[];
  /** Paths already written this turn; validated at loop start like any write. */
  seedPaths?: string[];
  callModel: CallModel;
  /** Per-write validation (syntax, TSX, undefined names, imports, truncation). */
  validate: (file: ProjectFile, tree: ProjectFile[]) => Promise<string[]> | string[];
  /**
   * THE readiness authority: the same source verification commit runs, over
   * the proposed workspace built from `tree`. `changed` = paths this turn
   * wrote. Required — the loop has no correctness rules of its own.
   */
  readiness: (tree: ProjectFile[], changed: string[]) => Promise<Readiness> | Readiness;
  /** Broader type check over the given paths. */
  typecheck?: (tree: ProjectFile[], paths: string[]) => Promise<string[]> | string[];
  /** Staged write sink (TurnTransaction.stage + checkpoint). false = refused. */
  onWrite?: (file: ProjectFile) => Promise<boolean> | boolean;
  /** Paths the loop must never write (managed kit, integration clients). */
  isProtected?: (path: string) => boolean;
  config?: Partial<LoopConfig>;
  light?: boolean;
  signal?: AbortSignal;
  onTrace?: (t: CallTrace) => void;
  onEvent?: (e: { kind: string; path?: string; detail?: string }) => void;
}

export interface ToolLoopResult {
  files: ProjectFile[];
  state: ToolLoopState;
  traces: CallTrace[];
  /** Why finish is (still) refused; empty when complete. */
  incomplete: string[];
  outcome: "finished" | "incomplete" | "breaker" | "cancelled" | "no_progress";
}

/* ------------------------------------------------------------------ */
/* Managed build surface (deterministic, never prompt-dependent)       */
/* ------------------------------------------------------------------ */

/**
 * Build/tool configuration owned by the platform scaffold. Matched by
 * BASENAME anywhere in the tree with at most one extra extension, so
 * tailwind.config.js cannot slip past a check written for .ts — the exact
 * hole that let a generated app ship a second, competing Tailwind setup.
 */
const MANAGED_CONFIG_STEMS = ["vite.config", "tailwind.config", "postcss.config", ".postcssrc"];

/** Exact paths the scaffold owns outright. */
const MANAGED_EXACT_FILES = new Set([
  "package.json",
  "package-lock.json",
  "bun.lockb",
  "tsconfig.json",
  "tsconfig.node.json",
  "components.json",
  "index.html",
]);

/** The two stylesheet names a Vite/Tailwind app may use; only one may exist. */
const STYLESHEET_PATHS = ["src/styles.css", "src/index.css"];

function isManagedConfigPath(path: string): boolean {
  const base = path.split("/").pop() ?? path;
  for (const stem of MANAGED_CONFIG_STEMS) {
    if (base === stem) return true;
    if (base.startsWith(`${stem}.`) && !base.slice(stem.length + 1).includes(".")) return true;
  }
  return false;
}

/**
 * Why this write must be refused, or null when it is allowed. Deterministic:
 * the design system installs tokens and fonts before the loop starts, so a
 * model-authored config or second stylesheet can only ever conflict with it.
 */
export function managedSurfaceRefusal(path: string, tree: Map<string, string>): string | null {
  if (isManagedConfigPath(path)) {
    return `Refused: ${path} is build configuration managed by Kimble. Tailwind, PostCSS and Vite are already set up — never create or edit a config file. Style with the semantic classes the stylesheet already defines.`;
  }
  if (MANAGED_EXACT_FILES.has(path)) {
    return `Refused: ${path} is managed by Kimble and cannot be written.`;
  }
  if (STYLESHEET_PATHS.includes(path)) {
    const other = STYLESHEET_PATHS.find((p) => p !== path && tree.has(p));
    if (other) {
      return `Refused: ${other} is the project stylesheet and already defines the full palette, radius scale and font families. Do not create a second stylesheet — use the semantic classes (bg-background, bg-card, bg-muted, text-foreground, bg-primary, border-border) instead.`;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Tools                                                               */
/* ------------------------------------------------------------------ */


const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[]): ToolSchema => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
});

export const TOOLS = {
  read_file: fn("read_file", "Read a file (numbered lines). Required before editing or overwriting an existing file.", {
    path: { type: "string" },
    start_line: { type: "integer" },
    end_line: { type: "integer" },
  }, ["path"]),
  list_files: fn("list_files", "List project files under a directory prefix.", { prefix: { type: "string" } }, []),
  search: fn("search", "Literal text search across project files. Returns path:line matches.", { query: { type: "string" }, prefix: { type: "string" } }, ["query"]),
  create_file: fn("create_file", "Create a new file, or fully replace an existing file you have read. Prefer edit_file for small changes. Validated immediately.", {
    path: { type: "string" },
    content: { type: "string" },
  }, ["path", "content"]),
  edit_file: fn("edit_file", "Exact search/replace in a file you have read. `search` must match exactly once (or set occurrence). Validated before it is kept; rolled back if it introduces errors.", {
    path: { type: "string" },
    search: { type: "string" },
    replace: { type: "string" },
    occurrence: { type: "integer", description: "1-based match to replace when search appears more than once" },
  }, ["path", "search", "replace"]),
  finish: fn("finish", "Declare the request complete. Runs the full deterministic verification (requested pages and routes, imports, sources) — the same check commit uses — so there is no need to search the workspace to verify first. Refused with exact findings while anything is missing or failing.", { summary: { type: "string" } }, []),
} satisfies Record<string, ToolSchema>;

export type ToolName = keyof typeof TOOLS;
const READ_ONLY = new Set<ToolName>(["read_file", "list_files", "search"]);

export function toolsFor(light: boolean): ToolSchema[] {
  const names: ToolName[] = light
    ? ["read_file", "search", "edit_file", "create_file", "finish"]
    : ["read_file", "list_files", "search", "create_file", "edit_file", "finish"];
  return names.map((n) => TOOLS[n]);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(36);
}

export function opId(kind: "create" | "edit", path: string, detail = ""): string {
  return kind === "create" ? `create:${path}` : `edit:${path}:${hash(detail)}`;
}

const normPath = (p: unknown) => String(p ?? "").trim().replace(/^\.?\/+/, "");

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]`;
}

function countOccurrences(hay: string, needle: string): number[] {
  const at: number[] = [];
  if (!needle) return at;
  let i = hay.indexOf(needle);
  while (i !== -1) { at.push(i); i = hay.indexOf(needle, i + needle.length); }
  return at;
}

/* ------------------------------------------------------------------ */
/* Workspace evidence: dependency graph + stability                    */
/* ------------------------------------------------------------------ */

const IMPORT_RX = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
const EXTS = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.js"];

function resolveImport(from: string, spec: string, files: Map<string, string>): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith(".")) {
    const dir = from.split("/").slice(0, -1);
    for (const part of spec.split("/")) {
      if (part === "." || part === "") continue;
      if (part === "..") dir.pop();
      else dir.push(part);
    }
    base = dir.join("/");
  } else return null;
  for (const e of EXTS) if (files.has(base + e)) return base + e;
  return null;
}

/** path → files that import it (actual imports in the current workspace). */
export function dependentsOf(files: Map<string, string>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [p, c] of files) {
    if (!/\.(t|j)sx?$/.test(p)) continue;
    IMPORT_RX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMPORT_RX.exec(c))) {
      const target = resolveImport(p, (m[1] ?? m[2])!, files);
      if (!target || target === p) continue;
      (out.get(target) ?? out.set(target, new Set()).get(target)!).add(p);
    }
  }
  return out;
}

/**
 * STABLE = exists, its current content validated clean, and at least one
 * other validated-clean file depends on it. Derived from the workspace each
 * time (never from the model's memory), so it survives compaction and
 * updates when files change. No filename is special.
 */
export function stableFoundations(state: ToolLoopState, files: Map<string, string>): Map<string, string[]> {
  const deps = dependentsOf(files);
  const clean = (p: string) => {
    const c = files.get(p);
    return c !== undefined && c.trim().length > 0 && state.validatedHash.get(p) === hash(c) && (state.validation.get(p) ?? []).length === 0;
  };
  const out = new Map<string, string[]>();
  for (const [p, users] of deps) {
    if (!clean(p)) continue;
    const cleanUsers = [...users].filter(clean);
    if (cleanUsers.length) out.set(p, cleanUsers.sort());
  }
  return out;
}

/**
 * Loop-local blockers only: files this turn wrote that still fail immediate
 * validation. Required work (pages, routes, imports) is decided by the
 * readiness authority from the build brief/intent — never by a model-kept
 * task list, which only restated the request.
 */
export function completionGaps(state: ToolLoopState, files: Map<string, string>): string[] {
  const gaps: string[] = [];
  for (const [path, errs] of state.validation) {
    if (errs.length && files.has(path)) gaps.push(`${path} still fails validation: ${errs[0]}`);
  }
  return gaps;
}

/** Structured NOT READY evidence for the conversation. */
export function formatNotReady(gaps: string[], findings: ReadinessFinding[]): string {
  const lines = ["NOT READY — the workspace does not pass verification (the same check that decides commit)."];
  if (findings.length) {
    lines.push("", "Verification findings:");
    for (const f of findings.slice(0, 15)) {
      lines.push(`- [${f.gate}] ${f.reason}`);
      lines.push(`  Required next operation: ${f.paths.length ? `targeted edit of ${f.paths.slice(0, 3).join(", ")}` : "create or fix the file(s) named above"}`);
    }
  }
  if (gaps.length) {
    lines.push("", "Unfinished work:");
    for (const g of gaps.slice(0, 15)) lines.push(`- ${g}`);
  }
  lines.push("", "Fix these with tools, then call finish again.");
  return lines.join("\n");
}

function estimateTokens(messages: LoopMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += typeof m.content === "string" ? m.content.length : 0;
    if (m.role === "assistant" && m.tool_calls) for (const c of m.tool_calls) chars += c.function.arguments.length;
  }
  return Math.ceil(chars / 4);
}

/** Workspace evidence the model sees (derived, never remembered). */
export function evidenceSummary(state: ToolLoopState, files: Map<string, string>): string {
  const stable = stableFoundations(state, files);
  const parts: string[] = [];
  if (stable.size) {
    parts.push(
      "STABLE foundations (valid and used by other valid files — build on them; do not replace them; if your task truly needs a change, make a targeted edit_file):\n" +
        [...stable].slice(0, 40).map(([p, users]) => `- ${p} ← used by ${users.slice(0, 4).join(", ")}${users.length > 4 ? ` +${users.length - 4}` : ""}`).join("\n"),
    );
  }
  if (state.readiness && !state.readiness.ready) {
    parts.push("Open verification findings:\n" + state.readiness.findings.slice(0, 10).map((f) => `- [${f.gate}] ${f.reason}`).join("\n"));
  }
  return parts.join("\n\n");
}

/**
 * Deterministic compaction: keep system + brief (cache-stable prefix), replace
 * the middle with a state summary, keep the last `keepRecent` messages,
 * never splitting an assistant tool-call group from its tool results.
 */
export function compact(messages: LoopMessage[], state: ToolLoopState, keepRecent: number, files?: Map<string, string>): LoopMessage[] {
  if (messages.length <= keepRecent + 3) return messages;
  let cut = messages.length - keepRecent;
  while (cut > 2 && messages[cut]?.role === "tool") cut--;
  if (cut <= 2) return messages;
  const failing = [...state.validation].filter(([, e]) => e.length).map(([p, e]) => `- ${p}: ${e[0]}`).join("\n");
  const summary = [
    "[Earlier work in this turn, compacted]",
    `Files written so far (${state.written.length}): ${[...new Set(state.written)].join(", ") || "none"}`,
    `Files read: ${[...state.read].slice(-60).join(", ") || "none"}`,
    failing ? `Files still failing validation:\n${failing}` : "",
    files ? evidenceSummary(state, files) : "",
    "Continue from here. Re-read a file before editing it if you need its current content.",
  ].filter(Boolean).join("\n");
  return [messages[0]!, messages[1]!, { role: "user", content: summary }, ...messages.slice(cut)];
}

/* ------------------------------------------------------------------ */
/* The loop                                                            */
/* ------------------------------------------------------------------ */

export function createToolLoopState(goal: string): ToolLoopState {
  return {
    goal,
    completedOps: new Set(),
    read: new Set(),
    validation: new Map(),
    validatedHash: new Map(),
    readiness: null,
    written: [],
    writesSinceTypecheck: 0,
    iteration: 0,
    finished: false,
    stopReason: null,
  };
}

export async function runToolLoop(args: ToolLoopArgs): Promise<ToolLoopResult> {
  const cfg: LoopConfig = { ...(args.light ? LIGHT_CONFIG : FULL_CONFIG), ...args.config };
  const tools = toolsFor(!!args.light);
  const allowed = new Set(tools.map((t) => t.function.name));
  const tree = new Map(args.files.map((f) => [f.path, f.content]));
  const state = createToolLoopState(args.goal);
  const breaker = new AgentCircuitBreaker(cfg.breaker);
  const traces: CallTrace[] = [];
  const emit = args.onEvent ?? (() => {});
  const treeFiles = (): ProjectFile[] => [...tree].map(([path, content]) => ({ path, content }));
  const ref = new Map((args.reference ?? []).map((f) => [f.path, f.content]));
  /** Workspace view for reads and validation: authored files over the kit. */
  const lookup = (p: string): string | undefined => tree.get(p) ?? ref.get(p);
  const visiblePaths = (): string[] => [...new Set([...ref.keys(), ...tree.keys()])];
  /** Authoritative kit export map (shipped reference files not shadowed by authored ones). */
  let kitIndex: KitExportIndex | null = null;
  let kitIndexSig = "";
  let stepRepairs = 0;
  const repairImports = (path: string, content: string): { content: string; note: string } => {
    if (!ref.size || !/\.(t|j)sx?$/.test(path)) return { content, note: "" };
    const sig = [...ref.keys()].filter((p) => tree.has(p)).join("|");
    if (!kitIndex || sig !== kitIndexSig) {
      kitIndex = buildKitExportIndex([...ref].map(([p, c]) => ({ path: p, content: c })), (p) => tree.has(p));
      kitIndexSig = sig;
    }
    const r = repairKitImports(content, kitIndex);
    if (!r) return { content, note: "" };
    stepRepairs += r.repairs.length;
    for (const x of r.repairs) emit({ kind: "kit_import_repaired", path, detail: `${x.symbol}: ${x.from} → ${x.to}` });
    return { content: r.content, note: `\nKimble corrected starter-kit import(s): ${r.repairs.map((x) => `${x.symbol} is exported by ${x.to}, not ${x.from}`).join("; ")}.` };
  };

  let messages: LoopMessage[] = [
    { role: "system", content: args.system },
    { role: "user", content: args.brief },
  ];

  let validationMs = 0;
  /** list_files prefix → workspace signature when it was last listed. */
  const listed = new Map<string, string>();

  const record = (path: string, content: string, errs: string[]) => {
    state.validation.set(path, errs);
    state.validatedHash.set(path, hash(content));
  };
  const checkReadiness = async (t: Map<string, string>): Promise<Readiness> => {
    const v0 = Date.now();
    try {
      const files = [...t].map(([path, content]) => ({ path, content }));
      const changed = [...new Set(state.written)].filter((p) => t.has(p));
      return await args.readiness(files, changed);
    } catch (e) {
      return { ready: false, findings: [{ gate: "source", reason: `verification could not run: ${e instanceof Error ? e.message : String(e)}`, paths: [] }] };
    } finally {
      validationMs += Date.now() - v0;
    }
  };
  /**
   * Refresh operation evidence from the workspace: any file whose content
   * changed since it was validated, and every file that imports a changed
   * file, is re-validated. Catches external changes and broken dependents.
   */
  const dirty = new Set<string>();
  const refreshEvidence = async () => {
    const deps = dependentsOf(tree);
    const todo = new Set<string>();
    for (const p of dirty) for (const u of deps.get(p) ?? []) todo.add(u);
    dirty.clear();
    for (const p of new Set(state.written)) {
      const c = tree.get(p);
      if (c === undefined) continue;
      if (state.validatedHash.get(p) !== hash(c)) {
        todo.add(p);
        for (const u of deps.get(p) ?? []) todo.add(u);
      }
    }
    for (const p of todo) {
      const c = tree.get(p);
      if (c !== undefined) record(p, c, await validate(p, c));
    }
  };
  /**
   * Readiness of the CURRENT workspace, computed once per distinct tree. The
   * verdict is pushed to the model after every write step, so it never has
   * to re-read files to check what Kimble has already verified; finish reuses
   * the same verdict when nothing changed since.
   */
  let readinessSig = "";
  const treeSig = () => [...tree].map(([p, c]) => `${p}:${hash(c)}`).sort().join("|");
  const readinessNow = async (): Promise<Readiness> => {
    const sig = treeSig();
    if (state.readiness && sig === readinessSig) return state.readiness;
    state.readiness = await checkReadiness(tree);
    readinessSig = sig;
    return state.readiness;
  };
  /** Finish gate: loop-local gaps + the ONE readiness authority. */
  const finishGate = async (): Promise<string | null> => {
    await refreshEvidence();
    const gaps = completionGaps(state, tree);
    const r = await readinessNow();
    if (!gaps.length && r.ready) return null;
    return formatNotReady(gaps, r.findings);
  };

  const validate = async (path: string, content: string): Promise<string[]> => {
    const t0 = Date.now();
    try {
      const next = [...[...ref].filter(([p]) => !tree.has(p)).map(([p, c]) => ({ path: p, content: c })), ...treeFiles().filter((f) => f.path !== path)];
      next.push({ path, content });
      return await args.validate({ path, content }, next);
    } catch (e) {
      return [`validation unavailable: ${e instanceof Error ? e.message : String(e)}`];
    } finally {
      validationMs += Date.now() - t0;
    }
  };

  // Files written earlier this turn (e.g. the first response) cross the SAME
  // validation boundary as tool writes: failures enter state and the brief,
  // so finish stays refused until they are fixed.
  if (args.seedPaths?.length) {
    const failing: string[] = [];
    for (const p of args.seedPaths) {
      const c = tree.get(p);
      if (c === undefined) continue;
      const errs = await validate(p, c);
      record(p, c, errs);
      state.written.push(p);
      if (errs.length) failing.push(`${p}:\n${errs.slice(0, 6).map((e) => `- ${e}`).join("\n")}`);
    }
    const evidence = evidenceSummary(state, tree);
    if (failing.length || evidence) {
      messages[1] = {
        role: "user",
        content: [args.brief, failing.length ? `These already-written files FAIL validation — read and fix them:\n${failing.join("\n")}` : "", evidence].filter(Boolean).join("\n\n"),
      };
    }
  }

  const persist = async (path: string, content: string): Promise<boolean> => {
    if (args.onWrite) {
      const ok = await args.onWrite({ path, content });
      if (!ok) return false;
    }
    tree.set(path, content);
    dirty.add(path);
    state.written.push(path);
    state.writesSinceTypecheck++;
    return true;
  };

  const fail = (tool: string, path: string | null, message: string, category: "syntax_error" | "tool_error" | "type_error" | "scope_violation" = "tool_error") => {
    const o = breaker.recordFailure({ category, tool, path, message });
    return o.guidance ? `${message}\n\nGuidance: ${o.guidance}` : message;
  };

  const report = (path: string, errs: string[]) =>
    errs.length
      ? `Written, but ${path} FAILS validation (fix it before finish):\n${errs.slice(0, 8).map((e) => `- ${e}`).join("\n")}`
      : `OK: ${path} written and validated.`;

  async function exec(call: ToolCallMsg): Promise<{ output: string; isError: boolean; miss?: boolean }> {
    const name = call.function.name as ToolName;
    if (!allowed.has(name)) return { output: fail(name, null, `Unknown or unavailable tool: ${name}`), isError: true };
    let a: Record<string, unknown>;
    try {
      a = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      return { output: fail(name, null, `Invalid JSON arguments for ${name}. If the content was long, it may have been cut off — write smaller files or use edit_file.`), isError: true };
    }
    const path = normPath(a.path);

    switch (name) {
      case "read_file": {
        const c = lookup(path);
        if (c === undefined) {
          const base = path.split("/").pop() ?? "";
          const near = visiblePaths().filter((p) => base && p.endsWith(base)).slice(0, 5);
          return { output: `File not found: ${path}${near.length ? `\nDid you mean: ${near.join(", ")}` : ""}`, isError: true, miss: true };
        }
        state.read.add(path);
        const lines = c.split("\n");
        const s = Math.max(1, Number(a.start_line) || 1);
        const e = Math.min(lines.length, Number(a.end_line) || lines.length);
        return { output: clip(lines.slice(s - 1, e).map((l, i) => `${s + i}: ${l}`).join("\n"), cfg.maxToolOutput), isError: false };
      }
      case "list_files": {
        const prefix = normPath(a.prefix);
        // Re-listing the same directory with no workspace change in between
        // tells the model nothing new; say so instead of repeating it.
        const sig = `${tree.size}:${state.written.length}`;
        if (listed.get(prefix) === sig) {
          return { output: `Unchanged since you listed "${prefix || "/"}" earlier — nothing new. Use that listing and the starter-kit map; start the current work unit.`, isError: true };
        }
        listed.set(prefix, sig);
        const list = visiblePaths().filter((p) => p.startsWith(prefix)).sort();
        return { output: clip(list.join("\n") || "(no files)", cfg.maxToolOutput), isError: false };
      }
      case "search": {
        const q = String(a.query ?? "");
        if (!q) return { output: "Empty query.", isError: true };
        const prefix = normPath(a.prefix);
        const hits: string[] = [];
        for (const p of visiblePaths()) {
          if (!p.startsWith(prefix)) continue;
          const c = lookup(p)!;
          const lines = c.split("\n");
          for (let i = 0; i < lines.length && hits.length < 80; i++) if (lines[i]!.includes(q)) hits.push(`${p}:${i + 1}: ${lines[i]!.trim().slice(0, 160)}`);
        }
        return { output: hits.join("\n") || "No matches.", isError: false };
      }
      case "create_file": {
        if (!path) return { output: fail(name, null, "create_file needs a path."), isError: true };
        const managed = managedSurfaceRefusal(path, tree);
        if (managed) return { output: fail(name, path, managed, "scope_violation"), isError: true };
        if (args.isProtected?.(path) || (ref.has(path) && !tree.has(path))) return { output: fail(name, path, `${path} is managed by Kimble and cannot be written.`, "scope_violation"), isError: true };
        const fixed = repairImports(path, String(a.content ?? ""));
        const content = fixed.content;
        if (!content.trim()) return { output: fail(name, path, `Refused: empty content for ${path}.`), isError: true };
        const existing = tree.get(path);
        if (existing !== undefined && existing === content) return { output: `No change: ${path} already has this content.`, isError: false };
        if (existing !== undefined && existing.trim() && !state.read.has(path) && !state.written.includes(path)) {
          return { output: fail(name, path, `Refused: ${path} exists. read_file it first, then use edit_file (or create_file to replace it fully).`), isError: true };
        }
        if (existing !== undefined && existing.trim()) {
          const users = stableFoundations(state, tree).get(path);
          if (users) {
            return {
              output: fail(name, path, `Refused: ${path} is a STABLE foundation (valid, used by ${users.slice(0, 5).join(", ")}). Do not replace it. If your current task genuinely needs it to change, make the smallest targeted edit_file.`, "scope_violation"),
              isError: true,
            };
          }
        }
        const errs = await validate(path, content);
        if (!(await persist(path, content))) return { output: fail(name, path, `Refused by the write gate: ${path}.`, "scope_violation"), isError: true };
        state.read.add(path);
        record(path, content, errs);
        if (!errs.length) state.completedOps.add(opId("create", path));
        emit({ kind: errs.length ? "write_failed_validation" : "write_ok", path, detail: errs[0] });
        if (errs.length) {
          breaker.recordFailure({ category: "syntax_error", tool: name, path, message: errs[0]! });
          return { output: report(path, errs) + fixed.note, isError: true };
        }
        breaker.recordProgress("file_written", path);
        return { output: report(path, errs) + fixed.note, isError: false };
      }
      case "edit_file": {
        const current = tree.get(path);
        if (current === undefined) return { output: fail(name, path, `File not found: ${path}. Use create_file for new files.`), isError: true };
        const managedEdit = managedSurfaceRefusal(path, tree);
        if (managedEdit) return { output: fail(name, path, managedEdit, "scope_violation"), isError: true };
        if (args.isProtected?.(path) || (ref.has(path) && !tree.has(path))) return { output: fail(name, path, `${path} is managed by Kimble and cannot be edited.`, "scope_violation"), isError: true };
        if (!state.read.has(path)) return { output: fail(name, path, `Read ${path} with read_file before editing it.`), isError: true };
        const search = String(a.search ?? "");
        const replace = String(a.replace ?? "");
        if (!search) return { output: fail(name, path, "edit_file needs a non-empty search string."), isError: true };
        if (search === replace) return { output: "No change: search and replace are identical.", isError: false };
        const id = opId("edit", path, `${search}\u0000${replace}`);
        if (state.completedOps.has(id)) return { output: `Already applied this exact edit to ${path}.`, isError: false };
        const at = countOccurrences(current, search);
        if (at.length === 0) return { output: fail(name, path, `search text not found in ${path}. Re-read the file and copy the exact text.`), isError: true };
        const occ = Number(a.occurrence) || 0;
        if (at.length > 1 && !(occ >= 1 && occ <= at.length)) {
          return { output: fail(name, path, `search text matches ${at.length} places in ${path}. Add surrounding lines to make it unique, or pass occurrence (1-${at.length}).`), isError: true };
        }
        const pos = at[at.length > 1 ? occ - 1 : 0]!;
        const edited = repairImports(path, current.slice(0, pos) + replace + current.slice(pos + search.length));
        const next = edited.content;
        // Deletion protection: an edit may not silently drop most of a file.
        if (current.length > 400 && next.trim().length < current.trim().length * 0.5 && replace.length < search.length * 0.5) {
          return { output: fail(name, path, `Refused: this edit would remove more than half of ${path}. Use create_file to replace the file deliberately.`), isError: true };
        }
        const before = state.validation.get(path) ?? [];
        const errs = await validate(path, next);
        const introduced = errs.filter((e) => !before.includes(e));
        if (introduced.length) {
          // Rollback: the staged tree keeps the previous content.
          return { output: fail(name, path, `Edit rolled back — it introduced errors in ${path}:\n${introduced.slice(0, 6).map((e) => `- ${e}`).join("\n")}`, "syntax_error"), isError: true };
        }
        // Targeted change to a STABLE foundation: permitted, but it must not
        // regress workspace readiness (same authority as finish/commit).
        const users = stableFoundations(state, tree).get(path);
        if (users) {
          const before = state.readiness ?? (await checkReadiness(tree));
          const trial = new Map(tree);
          trial.set(path, next);
          const after = await checkReadiness(trial);
          const had = new Set(before.findings.map(findingKey));
          const regressions = after.findings.filter((f) => !had.has(findingKey(f)));
          if (regressions.length) {
            return {
              output: fail(name, path, `Edit rolled back — ${path} is a stable foundation used by ${users.slice(0, 5).join(", ")}, and this change breaks verification:\n${regressions.slice(0, 6).map((f) => `- [${f.gate}] ${f.reason}`).join("\n")}`, "scope_violation"),
              isError: true,
            };
          }
          state.readiness = after;
        }
        if (!(await persist(path, next))) return { output: fail(name, path, `Refused by the write gate: ${path}.`, "scope_violation"), isError: true };
        record(path, next, errs);
        if (!errs.length) state.completedOps.add(id);
        breaker.recordProgress(errs.length < before.length ? "file_repaired" : "file_written", path);
        emit({ kind: "edit_ok", path });
        return { output: (errs.length ? report(path, errs) : `OK: edited ${path} and validated.`) + edited.note, isError: false };
      }
      case "finish": {
        const notReady = await finishGate();
        if (notReady) return { output: `finish refused.\n${notReady}`, isError: true };
        state.finished = true;
        return { output: "Finished.", isError: false };
      }
    }
  }

  const incompleteNow = () => [
    ...completionGaps(state, tree),
    ...(state.readiness && !state.readiness.ready ? state.readiness.findings.map((f) => `[${f.gate}] ${f.reason}`) : []),
  ];

  const hardCeiling = cfg.maxIterations + cfg.finalizeIterations;
  let finalizing = false;
  // No-progress protection: progress is a real workspace change — a file
  // that became (or was created) valid, or lost errors. Reads, plans,
  // refused finishes and status events never count.
  let idle = 0;
  let corrected = false;
  const recent: ActionRecord[] = [];
  /** Areas (directories) inspected during the current idle streak. */
  const explored = new Set<string>();
  let driftSignalled = false;

  while (state.iteration < hardCeiling) {
    if (args.signal?.aborted) {
      state.stopReason = "cancelled";
      return { files: treeFiles(), state, traces, incomplete: incompleteNow(), outcome: "cancelled" };
    }
    if (!finalizing && state.iteration >= cfg.maxIterations) {
      finalizing = true;
      messages.push({ role: "user", content: "Iteration budget reached. Stop adding features. Only fix what blocks finish, then call finish." });
    }

    let compacted = false;
    if (estimateTokens(messages) > cfg.contextWindow * cfg.compactAt) {
      messages = compact(messages, state, cfg.keepRecent, tree);
      compacted = true;
    }

    state.iteration++;
    const startedAt = Date.now();
    const sentChars = messages.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : 0) + ("tool_calls" in m && m.tool_calls ? JSON.stringify(m.tool_calls).length : 0), 0);
    let reply: ModelReply;
    try {
      reply = await args.callModel(messages, tools, args.signal);
    } catch (e) {
      // A failed model call is still an observable step.
      const failed: CallTrace = {
        call: state.iteration, startedAt, durationMs: Date.now() - startedAt, ttftMs: null, usage: null, model: null,
        toolCalls: [], toolMs: 0, validationMs: 0, writes: 0, compacted, finishReason: null, upstream: null,
        workUnit: "none", writtenPaths: [], progress: false,
        context: { system: args.system.length, brief: args.brief.length, history: Math.max(0, sentChars - args.system.length - args.brief.length) },
        outputTokensPerSec: null, filesRead: [], knowledgeChars: 0, readMisses: 0, validationFailures: 0, toolErrors: 0,
        recovery: null, error: e instanceof Error ? e.message : String(e),
      };
      traces.push(failed);
      try { args.onTrace?.(failed); } catch { /* telemetry never breaks the loop */ }
      throw e;
    }
    const durationMs = Date.now() - startedAt;
    messages.push({ role: "assistant", content: reply.content ?? null, ...(reply.toolCalls.length ? { tool_calls: reply.toolCalls } : {}) });

    const t0 = Date.now();
    validationMs = 0;
    const writesBefore = state.written.length;
    const before = snapshotEvidence(state, tree);
    const actions: ActionRecord[] = [];
    stepRepairs = 0;

    if (reply.toolCalls.length === 0) {
      // Implicit finish (Webby: no tool calls = done) still passes the gate.
      const notReady = await finishGate();
      if (!notReady) state.finished = true;
      else messages.push({ role: "user", content: `You stopped, but:\n${notReady}` });
    } else {
      // Consecutive read-only calls run concurrently; writes one at a time, in order.
      const results: Array<{ id: string; output: string }> = [];
      let i = 0;
      while (i < reply.toolCalls.length) {
        const c = reply.toolCalls[i]!;
        if (READ_ONLY.has(c.function.name as ToolName)) {
          let j = i;
          while (j < reply.toolCalls.length && READ_ONLY.has(reply.toolCalls[j]!.function.name as ToolName)) j++;
          const batch = reply.toolCalls.slice(i, j);
          const outs = await Promise.all(batch.map(exec));
          outs.forEach((o, k) => {
            results.push({ id: batch[k]!.id, output: o.output });
            actions.push(actionOf(batch[k]!, o));
          });
          i = j;
        } else {
          const o = await exec(c);
          results.push({ id: c.id, output: o.output });
          actions.push(actionOf(c, o));
          i++;
        }
      }
      for (const r of results) messages.push({ role: "tool", tool_call_id: r.id, content: clip(r.output, cfg.maxToolOutput) });

      // Files written in one response are validated in order, so an early
      // file importing a later one fails at its own write. Re-check once the
      // whole response has landed and say which are now valid.
      if (dirty.size) {
        await refreshEvidence();
        const healed = [...before.errors].filter(([p, n]) => n > 0 && (state.validation.get(p) ?? []).length === 0 && tree.has(p)).map(([p]) => p);
        const healedNew = [...new Set(state.written.slice(writesBefore))].filter((p) => !before.errors.has(p) && (state.validation.get(p) ?? []).length === 0);
        const nowValid = [...new Set([...healed, ...healedNew])].filter((p) => actions.some((a) => a.path === p && a.isError));
        if (nowValid.length) messages.push({ role: "user", content: `Now valid after the rest of this response landed: ${nowValid.join(", ")}.` });
      }

      // Workspace verdict after every write step: the same readiness authority
      // finish and commit use. Everything it does not list is verified, so the
      // model never spends a turn re-reading files to check its own work.
      const stepWrote = state.written.length > writesBefore;
      if (stepWrote && !reply.toolCalls.some((c) => c.function.name === "finish") && completionGaps(state, tree).length === 0) {
        const r = await readinessNow();
        messages.push({
          role: "user",
          content: r.ready
            ? "Kimble verification (the exact checks finish and the save run) passes for the whole workspace: every file, import, export and required route is verified. Do not re-read files to check them. Call finish now unless the brief still asks for something not yet built."
            : `Kimble verification of the whole workspace (the exact checks finish runs) — still open:\n${r.findings.slice(0, 8).map((f) => `- [${f.gate}] ${f.reason}`).join("\n")}\nEverything not listed is already verified; do not re-read files to check it. Continue with the open items.`,
        });
      }

      // Periodic broader type check, fed back into the same conversation.
      if (args.typecheck && state.writesSinceTypecheck >= cfg.typecheckEvery) {
        state.writesSinceTypecheck = 0;
        const v0 = Date.now();
        const errs = await Promise.resolve(args.typecheck(treeFiles(), [...new Set(state.written)])).catch((e) => [`type check unavailable: ${String(e)}`]);
        validationMs += Date.now() - v0;
        if (errs.length) {
          breaker.recordFailure({ category: "type_error", tool: "typecheck", path: null, message: errs[0]! });
          messages.push({ role: "user", content: `Type check after recent writes found errors:\n${errs.slice(0, 15).map((e) => `- ${e}`).join("\n")}` });
        }
      }
    }

    const writtenPaths = [...new Set(state.written.slice(writesBefore))];
    const progress = madeProgress(before, state, tree);
    const outTokens = reply.usage?.completionTokens ?? 0;
    const genMs = durationMs - (reply.ttftMs ?? 0);
    const filesRead = actions.filter((a) => a.tool === "read_file" && a.path && !a.miss).map((a) => a.path!);
    const trace: CallTrace = {
      upstream: reply.upstream ?? null,
      workUnit: classifyWorkUnit(reply.toolCalls.map((c) => c.function.name), writtenPaths),
      writtenPaths,
      progress,
      context: { system: args.system.length, brief: args.brief.length, history: Math.max(0, sentChars - args.system.length - args.brief.length) },
      outputTokensPerSec: outTokens > 0 && genMs > 0 ? Math.round((outTokens / genMs) * 10_000) / 10 : null,
      call: state.iteration,
      startedAt,
      durationMs,
      ttftMs: reply.ttftMs ?? null,
      usage: reply.usage ?? null,
      model: reply.model ?? null,
      toolCalls: reply.toolCalls.map((c) => c.function.name),
      toolMs: Date.now() - t0,
      validationMs,
      writes: state.written.length - writesBefore,
      compacted,
      finishReason: reply.finishReason ?? null,
      filesRead,
      knowledgeChars: filesRead.filter((p) => p.startsWith("knowledge/")).reduce((n, p) => n + (ref.get(p)?.length ?? 0), 0),
      readMisses: actions.filter((a) => a.miss).length,
      validationFailures: writtenPaths.filter((p) => (state.validation.get(p) ?? []).length > 0).length,
      toolErrors: actions.filter((a) => a.isError).length,
      recovery: writtenPaths.some((p) => (before.errors.get(p) ?? 0) > 0) ? "correction" : null,
      error: null,
      deterministicRepairs: stepRepairs,
    };
    traces.push(trace);
    try { args.onTrace?.(trace); } catch { /* telemetry never breaks the loop */ }

    if (!state.finished) {
      recent.push(...actions);
      if (recent.length > 40) recent.splice(0, recent.length - 40);
      if (progress) {
        idle = 0;
        corrected = false;
        explored.clear();
        driftSignalled = false;
      } else {
        // Exploratory drift: an idle streak that keeps widening into new
        // areas (or re-lists / misses) instead of narrowing to a work unit.
        // Separate from — and earlier than — the no-progress stop, which is unchanged.
        const drift = detectExplorationDrift(explored, actions, idle + 1);
        if (drift && !driftSignalled) {
          driftSignalled = true;
          emit({ kind: "exploration_drift", detail: drift });
          messages.push({ role: "user", content: drift });
        }
      }
      if (progress) {
        /* reset above */
      } else if (++idle >= cfg.noProgressLimit + (corrected ? cfg.noProgressRecovery : 0)) {
        if (!corrected) {
          corrected = true;
          const signal = diagnoseTrajectory(recent);
          emit({ kind: "no_progress", detail: signal });
          messages.push({ role: "user", content: signal });
        } else {
          state.stopReason = `no progress in ${idle} consecutive steps`;
          emit({ kind: "no_progress_stop", detail: state.stopReason });
          return { files: treeFiles(), state, traces, incomplete: incompleteNow(), outcome: "no_progress" };
        }
      }
    }

    if (state.finished) {
      breaker.complete();
      return { files: treeFiles(), state, traces, incomplete: [], outcome: "finished" };
    }
    if (breaker.tripped) {
      state.stopReason = breaker.reason()?.detail ?? "circuit breaker";
      return { files: treeFiles(), state, traces, incomplete: incompleteNow(), outcome: "breaker" };
    }
  }

  state.stopReason = "iteration budget exhausted";
  return { files: treeFiles(), state, traces, incomplete: incompleteNow(), outcome: "incomplete" };
}
