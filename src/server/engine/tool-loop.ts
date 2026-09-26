/**
 * The persistent tool-calling execution loop (Webby-style), inside Kimble's
 * safety architecture.
 *
 *   ONE model conversation
 *   → model emits one or more tool calls per response
 *   → read-only tools run concurrently, writes run one at a time
 *   → every write is validated immediately; the result IS the tool output
 *   → broader type check every N writes, fed back into the same conversation
 *   → `finish` is refused until workspace state is actually complete
 *
 * Pure orchestration: the model call, write validation, type check and the
 * staged-write sink (TurnTransaction + checkpoint) are injected, so the loop
 * never touches persistence, billing or the committed snapshot itself.
 * Final verification and the revision-guarded commit stay authoritative.
 */
import type { ProjectFile } from "@/server/generate.server";
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
};

/** LIGHT fast path: locate → read → edit → validate → finish. */
export const LIGHT_CONFIG: LoopConfig = { ...FULL_CONFIG, maxIterations: 6, finalizeIterations: 2 };

/* ------------------------------------------------------------------ */
/* Execution state                                                     */
/* ------------------------------------------------------------------ */

export type OpStatus = "pending" | "done" | "blocked" | "skipped";

export interface Requirement {
  /** Deterministic id, e.g. `page:/patients` or `file:src/lib/api.ts`. */
  id: string;
  file: string;
  route?: string;
}

export interface Task {
  id: string;
  title: string;
  status: OpStatus;
  files: string[];
}

export interface ToolLoopState {
  goal: string;
  requirements: Requirement[];
  tasks: Map<string, Task>;
  /** Operation ids applied this turn (`create:path`, `edit:path:<hash>`). */
  completedOps: Set<string>;
  /** Paths the model has read (read-before-edit/overwrite). */
  read: Set<string>;
  /** Current validation errors per path (empty = clean). */
  validation: Map<string, string[]>;
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
  /** Paths already written this turn; validated at loop start like any write. */
  seedPaths?: string[];
  requirements?: Requirement[];
  callModel: CallModel;
  /** Per-write validation (syntax, TSX, undefined names, imports, truncation). */
  validate: (file: ProjectFile, tree: ProjectFile[]) => Promise<string[]> | string[];
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
  outcome: "finished" | "incomplete" | "breaker" | "cancelled";
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
  plan_tasks: fn("plan_tasks", "Declare or update the task list for this request. Tasks with status pending block finish.", {
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          status: { type: "string", enum: ["pending", "done", "skipped"] },
          files: { type: "array", items: { type: "string" } },
        },
        required: ["id", "status"],
      },
    },
  }, ["tasks"]),
  finish: fn("finish", "Declare the request complete. Refused while required files/routes are missing, files fail validation, or tasks are pending.", { summary: { type: "string" } }, []),
} satisfies Record<string, ToolSchema>;

export type ToolName = keyof typeof TOOLS;
const READ_ONLY = new Set<ToolName>(["read_file", "list_files", "search"]);

export function toolsFor(light: boolean): ToolSchema[] {
  const names: ToolName[] = light
    ? ["read_file", "search", "edit_file", "create_file", "finish"]
    : ["read_file", "list_files", "search", "create_file", "edit_file", "plan_tasks", "finish"];
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

/** Route → file references in a router file (`import X from "@/pages/X"` + `<Route element={<X/>}>`). */
export function routerReferences(files: Map<string, string>): string[] {
  const app = files.get("src/App.tsx");
  if (!app) return [];
  const out: string[] = [];
  const rx = /import\s+[\w$]+\s+from\s+["']@\/(pages\/[\w/.-]+)["']|lazy\(\s*\(\)\s*=>\s*import\(\s*["']@\/(pages\/[\w/.-]+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(app))) {
    const rel = (m[1] ?? m[2])!.replace(/\.(tsx?|jsx?)$/, "");
    out.push(`src/${rel}`);
  }
  return [...new Set(out)];
}

function resolves(files: Map<string, string>, base: string): boolean {
  return [".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"].some((ext) => (files.get(base + ext) ?? "").trim().length > 0);
}

/** Why the workspace is not complete. Empty = finish allowed. */
export function completionGaps(state: ToolLoopState, files: Map<string, string>): string[] {
  const gaps: string[] = [];
  for (const r of state.requirements) {
    if (!(files.get(r.file) ?? "").trim()) gaps.push(`required file missing: ${r.file}${r.route ? ` (route ${r.route})` : ""}`);
  }
  for (const base of routerReferences(files)) {
    if (!resolves(files, base)) gaps.push(`router imports a file that does not exist: ${base}`);
  }
  for (const [path, errs] of state.validation) {
    if (errs.length && files.has(path)) gaps.push(`${path} still fails validation: ${errs[0]}`);
  }
  for (const t of state.tasks.values()) {
    if (t.status === "pending" || t.status === "blocked") gaps.push(`task not done: ${t.id}${t.title ? ` — ${t.title}` : ""}`);
  }
  return gaps;
}

function estimateTokens(messages: LoopMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += typeof m.content === "string" ? m.content.length : 0;
    if (m.role === "assistant" && m.tool_calls) for (const c of m.tool_calls) chars += c.function.arguments.length;
  }
  return Math.ceil(chars / 4);
}

/**
 * Deterministic compaction: keep system + brief (cache-stable prefix), replace
 * the middle with a state summary, keep the last `keepRecent` messages,
 * never splitting an assistant tool-call group from its tool results.
 */
export function compact(messages: LoopMessage[], state: ToolLoopState, keepRecent: number): LoopMessage[] {
  if (messages.length <= keepRecent + 3) return messages;
  let cut = messages.length - keepRecent;
  while (cut > 2 && messages[cut]?.role === "tool") cut--;
  if (cut <= 2) return messages;
  const tasks = [...state.tasks.values()].map((t) => `- [${t.status}] ${t.id}${t.title ? `: ${t.title}` : ""}`).join("\n");
  const failing = [...state.validation].filter(([, e]) => e.length).map(([p, e]) => `- ${p}: ${e[0]}`).join("\n");
  const summary = [
    "[Earlier work in this turn, compacted]",
    `Files written so far (${state.written.length}): ${[...new Set(state.written)].join(", ") || "none"}`,
    `Files read: ${[...state.read].slice(-60).join(", ") || "none"}`,
    tasks ? `Tasks:\n${tasks}` : "",
    failing ? `Files still failing validation:\n${failing}` : "",
    "Continue from here. Re-read a file before editing it if you need its current content.",
  ].filter(Boolean).join("\n");
  return [messages[0]!, messages[1]!, { role: "user", content: summary }, ...messages.slice(cut)];
}

/* ------------------------------------------------------------------ */
/* The loop                                                            */
/* ------------------------------------------------------------------ */

export function createToolLoopState(goal: string, requirements: Requirement[] = []): ToolLoopState {
  return {
    goal,
    requirements,
    tasks: new Map(),
    completedOps: new Set(),
    read: new Set(),
    validation: new Map(),
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
  const state = createToolLoopState(args.goal, args.requirements ?? []);
  const breaker = new AgentCircuitBreaker(cfg.breaker);
  const traces: CallTrace[] = [];
  const emit = args.onEvent ?? (() => {});
  const treeFiles = (): ProjectFile[] => [...tree].map(([path, content]) => ({ path, content }));

  let messages: LoopMessage[] = [
    { role: "system", content: args.system },
    { role: "user", content: args.brief },
  ];

  let validationMs = 0;

  const validate = async (path: string, content: string): Promise<string[]> => {
    const t0 = Date.now();
    try {
      const next = treeFiles().filter((f) => f.path !== path);
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
      state.validation.set(p, errs);
      state.written.push(p);
      if (errs.length) failing.push(`${p}:\n${errs.slice(0, 6).map((e) => `- ${e}`).join("\n")}`);
    }
    if (failing.length) {
      messages[1] = { role: "user", content: `${args.brief}\n\nThese already-written files FAIL validation — read and fix them:\n${failing.join("\n")}` };
    }
  }

  const persist = async (path: string, content: string): Promise<boolean> => {
    if (args.onWrite) {
      const ok = await args.onWrite({ path, content });
      if (!ok) return false;
    }
    tree.set(path, content);
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

  async function exec(call: ToolCallMsg): Promise<{ output: string; isError: boolean }> {
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
        const c = tree.get(path);
        if (c === undefined) {
          const base = path.split("/").pop() ?? "";
          const near = [...tree.keys()].filter((p) => base && p.endsWith(base)).slice(0, 5);
          return { output: `File not found: ${path}${near.length ? `\nDid you mean: ${near.join(", ")}` : ""}`, isError: true };
        }
        state.read.add(path);
        const lines = c.split("\n");
        const s = Math.max(1, Number(a.start_line) || 1);
        const e = Math.min(lines.length, Number(a.end_line) || lines.length);
        return { output: clip(lines.slice(s - 1, e).map((l, i) => `${s + i}: ${l}`).join("\n"), cfg.maxToolOutput), isError: false };
      }
      case "list_files": {
        const prefix = normPath(a.prefix);
        const list = [...tree.keys()].filter((p) => p.startsWith(prefix)).sort();
        return { output: clip(list.join("\n") || "(no files)", cfg.maxToolOutput), isError: false };
      }
      case "search": {
        const q = String(a.query ?? "");
        if (!q) return { output: "Empty query.", isError: true };
        const prefix = normPath(a.prefix);
        const hits: string[] = [];
        for (const [p, c] of tree) {
          if (!p.startsWith(prefix)) continue;
          const lines = c.split("\n");
          for (let i = 0; i < lines.length && hits.length < 80; i++) if (lines[i]!.includes(q)) hits.push(`${p}:${i + 1}: ${lines[i]!.trim().slice(0, 160)}`);
        }
        return { output: hits.join("\n") || "No matches.", isError: false };
      }
      case "create_file": {
        if (!path) return { output: fail(name, null, "create_file needs a path."), isError: true };
        if (args.isProtected?.(path)) return { output: fail(name, path, `${path} is managed by Kimble and cannot be written.`, "scope_violation"), isError: true };
        const content = String(a.content ?? "");
        if (!content.trim()) return { output: fail(name, path, `Refused: empty content for ${path}.`), isError: true };
        const existing = tree.get(path);
        if (existing !== undefined && existing === content) return { output: `No change: ${path} already has this content.`, isError: false };
        if (existing !== undefined && existing.trim() && !state.read.has(path) && !state.written.includes(path)) {
          return { output: fail(name, path, `Refused: ${path} exists. read_file it first, then use edit_file (or create_file to replace it fully).`), isError: true };
        }
        const errs = await validate(path, content);
        if (!(await persist(path, content))) return { output: fail(name, path, `Refused by the write gate: ${path}.`, "scope_violation"), isError: true };
        state.read.add(path);
        state.completedOps.add(opId("create", path));
        state.validation.set(path, errs);
        emit({ kind: errs.length ? "write_failed_validation" : "write_ok", path, detail: errs[0] });
        if (errs.length) {
          breaker.recordFailure({ category: "syntax_error", tool: name, path, message: errs[0]! });
          return { output: report(path, errs), isError: true };
        }
        breaker.recordProgress("file_written", path);
        return { output: report(path, errs), isError: false };
      }
      case "edit_file": {
        const current = tree.get(path);
        if (current === undefined) return { output: fail(name, path, `File not found: ${path}. Use create_file for new files.`), isError: true };
        if (args.isProtected?.(path)) return { output: fail(name, path, `${path} is managed by Kimble and cannot be edited.`, "scope_violation"), isError: true };
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
        const next = current.slice(0, pos) + replace + current.slice(pos + search.length);
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
        if (!(await persist(path, next))) return { output: fail(name, path, `Refused by the write gate: ${path}.`, "scope_violation"), isError: true };
        state.completedOps.add(id);
        state.validation.set(path, errs);
        breaker.recordProgress(errs.length < before.length ? "file_repaired" : "file_written", path);
        emit({ kind: "edit_ok", path });
        return { output: errs.length ? report(path, errs) : `OK: edited ${path} and validated.`, isError: false };
      }
      case "plan_tasks": {
        const list = Array.isArray(a.tasks) ? (a.tasks as Array<Record<string, unknown>>) : [];
        for (const t of list) {
          const id = String(t.id ?? "").trim();
          if (!id) continue;
          const prev = state.tasks.get(id);
          const status = (["pending", "done", "skipped"].includes(String(t.status)) ? t.status : "pending") as OpStatus;
          state.tasks.set(id, {
            id,
            title: String(t.title ?? prev?.title ?? ""),
            status,
            files: Array.isArray(t.files) ? (t.files as unknown[]).map(normPath) : prev?.files ?? [],
          });
        }
        const lines = [...state.tasks.values()].map((t) => `[${t.status}] ${t.id}`);
        return { output: `Tasks (${state.tasks.size}):\n${lines.join("\n")}`, isError: false };
      }
      case "finish": {
        // Task marked done while its files fail → demote to pending.
        for (const t of state.tasks.values()) {
          if (t.status === "done" && t.files.some((f) => !(tree.get(f) ?? "").trim() || (state.validation.get(f) ?? []).length)) t.status = "pending";
        }
        const gaps = completionGaps(state, tree);
        if (gaps.length) return { output: `finish refused — the workspace is not complete:\n${gaps.slice(0, 20).map((g) => `- ${g}`).join("\n")}`, isError: true };
        state.finished = true;
        return { output: "Finished.", isError: false };
      }
    }
  }

  const hardCeiling = cfg.maxIterations + cfg.finalizeIterations;
  let finalizing = false;

  while (state.iteration < hardCeiling) {
    if (args.signal?.aborted) {
      state.stopReason = "cancelled";
      return { files: treeFiles(), state, traces, incomplete: completionGaps(state, tree), outcome: "cancelled" };
    }
    if (!finalizing && state.iteration >= cfg.maxIterations) {
      finalizing = true;
      messages.push({ role: "user", content: "Iteration budget reached. Stop adding features. Only fix what blocks finish, then call finish." });
    }

    let compacted = false;
    if (estimateTokens(messages) > cfg.contextWindow * cfg.compactAt) {
      messages = compact(messages, state, cfg.keepRecent);
      compacted = true;
    }

    state.iteration++;
    const startedAt = Date.now();
    const reply = await args.callModel(messages, tools, args.signal);
    const durationMs = Date.now() - startedAt;
    messages.push({ role: "assistant", content: reply.content ?? null, ...(reply.toolCalls.length ? { tool_calls: reply.toolCalls } : {}) });

    const t0 = Date.now();
    validationMs = 0;
    const writesBefore = state.written.length;

    if (reply.toolCalls.length === 0) {
      // Implicit finish (Webby: no tool calls = done) still passes the gate.
      const gaps = completionGaps(state, tree);
      if (!gaps.length) state.finished = true;
      else messages.push({ role: "user", content: `You stopped, but the workspace is not complete:\n${gaps.slice(0, 20).map((g) => `- ${g}`).join("\n")}\nContinue with tools.` });
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
          outs.forEach((o, k) => results.push({ id: batch[k]!.id, output: o.output }));
          i = j;
        } else {
          const o = await exec(c);
          results.push({ id: c.id, output: o.output });
          i++;
        }
      }
      for (const r of results) messages.push({ role: "tool", tool_call_id: r.id, content: clip(r.output, cfg.maxToolOutput) });

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

    const trace: CallTrace = {
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
    };
    traces.push(trace);
    args.onTrace?.(trace);

    if (state.finished) {
      breaker.complete();
      return { files: treeFiles(), state, traces, incomplete: [], outcome: "finished" };
    }
    if (breaker.tripped) {
      state.stopReason = breaker.reason()?.detail ?? "circuit breaker";
      return { files: treeFiles(), state, traces, incomplete: completionGaps(state, tree), outcome: "breaker" };
    }
  }

  state.stopReason = "iteration budget exhausted";
  return { files: treeFiles(), state, traces, incomplete: completionGaps(state, tree), outcome: "incomplete" };
}
