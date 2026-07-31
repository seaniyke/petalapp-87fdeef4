/**
 * Petal agent tools — the execution surface the model can reach for.
 *
 * Design rule: anything answerable from the in-memory project tree is answered
 * *in the Worker*, with no network hop. Only `run_script` — which needs a real
 * interpreter — goes out to the builder's sandboxed `/exec`. That keeps the
 * common case (look at the tree, grep for a string, read a file) instant and
 * free, and reserves the expensive path for genuine codemods.
 *
 * Every tool is read-only except `run_script`, whose file writes come back as
 * a diff for the caller to gate — the tool layer itself never mutates the
 * caller's project array.
 */
import type { ProjectFile } from "@/server/generate.server";
import {
  runExecSession,
  isExecConfigured,
  type ExecCommandResult,
} from "@/server/exec-client.server";
import { verifyFilesLocal } from "@/server/local-verifier";
import { verifyFilesEsbuild } from "@/server/esbuild-verifier.server";

export interface ToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  /** Short human label for the builder timeline, e.g. `Searched for "hero"`. */
  label: string;
  /** Text handed back to the model as the tool message. */
  output: string;
  /** Files a codemod changed. Empty for every read-only tool. */
  changedFiles?: ProjectFile[];
  deletedPaths?: string[];
  /** Raw command results, for the expandable timeline row. */
  commands?: ExecCommandResult[];
  isError?: boolean;
}

/** Output handed to the model is capped so one tool can't eat the context. */
const MAX_TOOL_OUTPUT = 12_000;
const MAX_FILE_CHARS = 24_000;
const MAX_MATCHES = 80;

function clip(text: string, limit = MAX_TOOL_OUTPUT): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit) + `\n… [truncated, ${text.length - limit} more chars]`;
}

// ---------------------------------------------------------------------------
// Tool specs (OpenAI function-calling shape)
// ---------------------------------------------------------------------------

export const LIST_DIR_TOOL: ToolSpec = {
  type: "function",
  function: {
    name: "list_dir",
    description:
      "List files and folders under a directory of the project. Use this first when you are unsure where something lives.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: 'Directory path relative to the project root, e.g. "src/components". Use "" or "." for the root.',
        },
        depth: {
          type: "integer",
          description: "How many levels deep to list. Defaults to 1.",
        },
      },
      required: ["path"],
    },
  },
};

export const READ_FILE_TOOL: ToolSpec = {
  type: "function",
  function: {
    name: "read_file",
    description:
      "Read a file's exact current contents. Always read a file before writing a search/replace against it.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the project root." },
        start_line: { type: "integer", description: "Optional 1-indexed first line to return." },
        end_line: { type: "integer", description: "Optional 1-indexed last line to return." },
      },
      required: ["path"],
    },
  },
};

export const SEARCH_FILES_TOOL: ToolSpec = {
  type: "function",
  function: {
    name: "search_files",
    description:
      "Search the project for a string or regular expression and return matching file paths with line numbers. Use this to find where a piece of UI copy, a component, or a route is defined.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Literal text or regular expression to find." },
        regex: { type: "boolean", description: "Treat the query as a regular expression. Defaults to false." },
        glob: {
          type: "string",
          description: 'Optional path filter, e.g. "src/routes" or ".tsx". Only paths containing this substring are searched.',
        },
      },
      required: ["query"],
    },
  },
};

export const RUN_SCRIPT_TOOL: ToolSpec = {
  type: "function",
  function: {
    name: "run_script",
    description:
      "Run a short Node.js or Python script against a real copy of the project on disk. Use this for mechanical, repetitive edits across many files (renames, prop migrations, bulk class swaps) where hand-writing each edit would be error-prone. The script's working directory IS the project root. Any file it writes is applied to the project. Keep it deterministic and idempotent.",
    parameters: {
      type: "object",
      properties: {
        runtime: { type: "string", enum: ["node", "python3"], description: "Interpreter to use." },
        script: { type: "string", description: "The full script source. It is piped to the interpreter on stdin." },
        purpose: {
          type: "string",
          description: 'One short sentence for the build timeline, e.g. "Rename Button variant prop across all pages".',
        },
      },
      required: ["runtime", "script", "purpose"],
    },
  },
};

export const RUN_CHECK_TOOL: ToolSpec = {
  type: "function",
  function: {
    name: "run_check",
    description:
      "Run Petal's static verifier over the project (syntax, unresolved imports, missing named exports, blank renders). Call this after a run_script codemod to confirm nothing broke.",
    parameters: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of paths to check. Defaults to every source file.",
        },
      },
    },
  },
};

/** Read-only tools — safe for the inspector subagent. */
export const INSPECT_TOOLS: ToolSpec[] = [
  LIST_DIR_TOOL,
  READ_FILE_TOOL,
  SEARCH_FILES_TOOL,
];

/** Full surface — inspection plus codemod plus verification. */
export function allAgentTools(): ToolSpec[] {
  const tools = [...INSPECT_TOOLS, RUN_CHECK_TOOL];
  if (isExecConfigured()) tools.push(RUN_SCRIPT_TOOL);
  return tools;
}

// ---------------------------------------------------------------------------
// Implementations
// ---------------------------------------------------------------------------

function normalizeDir(p: string): string {
  const cleaned = String(p ?? "").trim().replace(/^\.?\/+/, "").replace(/\/+$/, "");
  return cleaned === "." ? "" : cleaned;
}

function listDir(files: ProjectFile[], rawPath: string, depth: number): ToolResult {
  const dir = normalizeDir(rawPath);
  const prefix = dir ? dir + "/" : "";
  const dirs = new Set<string>();
  const found: string[] = [];

  for (const f of files) {
    if (!f.path.startsWith(prefix)) continue;
    const rest = f.path.slice(prefix.length);
    const segments = rest.split("/");
    if (segments.length <= depth) {
      found.push(rest);
    } else {
      dirs.add(segments.slice(0, depth).join("/") + "/");
    }
  }

  if (found.length === 0 && dirs.size === 0) {
    return {
      label: `Listed ${dir || "project root"} (empty)`,
      output: `No files found under "${dir || "."}".`,
    };
  }

  const lines = [...[...dirs].sort(), ...found.sort()];
  return {
    label: `Listed ${dir || "project root"}`,
    output: clip(lines.join("\n")),
  };
}

function readFileTool(
  files: ProjectFile[],
  path: string,
  startLine?: number,
  endLine?: number,
): ToolResult {
  const want = normalizeDir(path);
  const file = files.find((f) => f.path === want || f.path === path);
  if (!file) {
    const near = files
      .filter((f) => f.path.toLowerCase().includes(want.split("/").pop()?.toLowerCase() ?? "\u0000"))
      .slice(0, 8)
      .map((f) => f.path);
    return {
      label: `Could not read ${path}`,
      isError: true,
      output:
        `No file at "${path}".` +
        (near.length ? `\nDid you mean one of:\n${near.join("\n")}` : ""),
    };
  }

  const lines = file.content.split("\n");
  const from = Math.max(1, startLine ?? 1);
  const to = Math.min(lines.length, endLine ?? lines.length);
  const slice = lines.slice(from - 1, to);
  const numbered = slice.map((l, i) => `${from + i}: ${l}`).join("\n");
  const ranged = startLine || endLine ? ` (lines ${from}-${to})` : "";
  return {
    label: `Read ${file.path}${ranged}`,
    output: clip(numbered, MAX_FILE_CHARS),
  };
}

function searchFiles(
  files: ProjectFile[],
  query: string,
  useRegex: boolean,
  glob?: string,
): ToolResult {
  let matcher: RegExp;
  try {
    matcher = useRegex
      ? new RegExp(query, "i")
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  } catch (err) {
    return {
      label: `Invalid search pattern`,
      isError: true,
      output: `Could not compile the pattern: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const hits: string[] = [];
  let total = 0;
  for (const f of files) {
    if (glob && !f.path.includes(glob)) continue;
    if (f.path.startsWith("node_modules/")) continue;
    const lines = f.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!matcher.test(lines[i])) continue;
      total++;
      if (hits.length < MAX_MATCHES) {
        hits.push(`${f.path}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
      }
    }
  }

  if (total === 0) {
    return {
      label: `Searched for "${query}" — no matches`,
      output: `No matches for "${query}"${glob ? ` under "${glob}"` : ""}.`,
    };
  }
  const more = total > hits.length ? `\n… ${total - hits.length} more match(es) not shown.` : "";
  return {
    label: `Searched for "${query}" — ${total} match${total === 1 ? "" : "es"}`,
    output: clip(hits.join("\n") + more),
  };
}

async function runCheck(files: ProjectFile[], paths?: string[]): Promise<ToolResult> {
  const targets =
    paths && paths.length
      ? paths
      : files.filter((f) => /\.(tsx?|jsx?)$/.test(f.path)).map((f) => f.path);

  const local = verifyFilesLocal(files, targets);
  const esbuild = await verifyFilesEsbuild(files, targets).catch(() => ({ ok: true, issues: [] }));

  const issues = [
    ...local.issues.map((i) => `${i.path}: [${i.kind}] ${i.detail}`),
    ...esbuild.issues.map(
      (i) => `${(i as { path?: string }).path ?? "?"}: ${(i as { detail?: string }).detail ?? String(i)}`,
    ),
  ];

  if (issues.length === 0) {
    return {
      label: `Checked ${targets.length} file${targets.length === 1 ? "" : "s"} — clean`,
      output: "No issues found.",
    };
  }
  return {
    label: `Checked ${targets.length} file${targets.length === 1 ? "" : "s"} — ${issues.length} issue(s)`,
    output: clip(issues.join("\n")),
  };
}

async function runScript(args: {
  projectId: string;
  files: ProjectFile[];
  runtime: "node" | "python3";
  script: string;
  purpose: string;
  signal?: AbortSignal;
}): Promise<ToolResult> {
  if (!isExecConfigured()) {
    return {
      label: "Script execution unavailable",
      isError: true,
      output: "Command execution is not configured on this deployment. Make the edits directly instead.",
    };
  }

  let session;
  try {
    session = await runExecSession({
      projectId: args.projectId,
      mode: "codemod",
      files: args.files,
      commands: [{ bin: args.runtime, args: ["-"], stdin: args.script }],
      signal: args.signal,
    });
  } catch (err) {
    return {
      label: `Script failed: ${args.purpose}`,
      isError: true,
      output: `Could not run the script: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const cmd = session.results[0];
  const failed = cmd && (cmd.exitCode !== 0 || cmd.timedOut);
  const changed = session.changedFiles ?? [];
  const deleted = session.deletedPaths ?? [];

  const parts: string[] = [];
  if (cmd?.stdout) parts.push(`stdout:\n${cmd.stdout}`);
  if (cmd?.stderr) parts.push(`stderr:\n${cmd.stderr}`);
  if (cmd?.timedOut) parts.push("The script exceeded its time budget and was killed.");
  parts.push(
    changed.length
      ? `Changed ${changed.length} file(s):\n${changed.map((f) => f.path).join("\n")}`
      : "No files were changed.",
  );
  if (deleted.length) parts.push(`Deleted ${deleted.length} file(s):\n${deleted.join("\n")}`);

  return {
    label: failed
      ? `Script failed: ${args.purpose}`
      : `Ran script — ${args.purpose} (${changed.length} file${changed.length === 1 ? "" : "s"} changed)`,
    output: clip(parts.join("\n\n")),
    changedFiles: failed ? [] : changed,
    deletedPaths: failed ? [] : deleted,
    commands: session.results,
    isError: Boolean(failed),
  };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function executeAgentTool(args: {
  call: ToolCall;
  files: ProjectFile[];
  projectId: string;
  /** Read-only callers (the inspector subagent) may not mutate anything. */
  readOnly?: boolean;
  signal?: AbortSignal;
}): Promise<ToolResult> {
  const { call, files, projectId, readOnly, signal } = args;
  const a = call.args ?? {};

  switch (call.name) {
    case "list_dir":
      return listDir(files, String(a.path ?? ""), Math.max(1, Number(a.depth ?? 1) || 1));

    case "read_file":
      return readFileTool(
        files,
        String(a.path ?? ""),
        a.start_line != null ? Number(a.start_line) : undefined,
        a.end_line != null ? Number(a.end_line) : undefined,
      );

    case "search_files":
      return searchFiles(
        files,
        String(a.query ?? ""),
        Boolean(a.regex),
        a.glob ? String(a.glob) : undefined,
      );

    case "run_check":
      return await runCheck(
        files,
        Array.isArray(a.paths) ? (a.paths as unknown[]).map(String) : undefined,
      );

    case "run_script": {
      if (readOnly) {
        return {
          label: "Script blocked",
          isError: true,
          output: "This agent is read-only and cannot modify files. Report what you found instead.",
        };
      }
      const runtime = a.runtime === "python3" ? "python3" : "node";
      const script = String(a.script ?? "");
      if (!script.trim()) {
        return { label: "Empty script", isError: true, output: "No script source was supplied." };
      }
      return await runScript({
        projectId,
        files,
        runtime,
        script,
        purpose: String(a.purpose ?? "codemod"),
        signal,
      });
    }

    default:
      return {
        label: `Unknown tool: ${call.name}`,
        isError: true,
        output: `There is no tool named "${call.name}". Available tools: ${allAgentTools()
          .map((t) => t.function.name)
          .join(", ")}.`,
      };
  }
}

/**
 * Apply a codemod's diff onto a project array, returning a new array plus the
 * set of paths that actually moved. Callers gate this — the tool layer never
 * mutates in place.
 */
export function applyToolChanges(
  files: ProjectFile[],
  changed: ProjectFile[],
  deleted: string[] = [],
): { files: ProjectFile[]; changedPaths: string[] } {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const changedPaths: string[] = [];

  for (const f of changed) {
    if (byPath.get(f.path)?.content === f.content) continue;
    byPath.set(f.path, { ...(byPath.get(f.path) ?? {}), path: f.path, content: f.content });
    changedPaths.push(f.path);
  }
  for (const p of deleted) {
    if (byPath.delete(p)) changedPaths.push(p);
  }

  return { files: [...byPath.values()], changedPaths };
}
