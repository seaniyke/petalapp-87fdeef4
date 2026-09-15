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
  runInstallSession,
  runTestSession,
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

export const INSTALL_PACKAGES_TOOL: ToolSpec = {
  type: "function",
  function: {
    name: "install_packages",
    description:
      "Install one or more npm packages into the project on a real checkout, updating package.json (and the lockfile). Use this instead of hand-editing package.json when the change needs a dependency the project does not have yet. Only plain registry packages are accepted — no URLs, git specs or flags.",
    parameters: {
      type: "object",
      properties: {
        packages: {
          type: "array",
          items: { type: "string" },
          description: 'Package specs, e.g. ["zod", "date-fns@^3"]. Max 12.',
        },
        dev: {
          type: "boolean",
          description: "Install as devDependencies. Defaults to false.",
        },
        purpose: {
          type: "string",
          description: 'One short sentence for the build timeline, e.g. "Add date-fns for the schedule view".',
        },
      },
      required: ["packages", "purpose"],
    },
  },
};

export const RUN_TESTS_TOOL: ToolSpec = {
  type: "function",
  function: {
    name: "run_tests",
    description:
      "Run the project's OWN test suite (its package.json `test` script) on a real checkout, after installing its dependencies. Use this only when the project actually has tests and your change could plausibly break them. It is slow — never call it speculatively.",
    parameters: {
      type: "object",
      properties: {
        purpose: {
          type: "string",
          description: 'One short sentence for the build timeline, e.g. "Confirm the cart tests still pass".',
        },
      },
      required: ["purpose"],
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
  if (isExecConfigured()) {
    tools.push(RUN_SCRIPT_TOOL, INSTALL_PACKAGES_TOOL, RUN_TESTS_TOOL);
  }
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
    // Scaffold-owned files (index.html, styles.css, the UI kit) are merged in
    // later in the pipeline, so they are legitimately absent here. Saying only
    // "no file" made the model treat a healthy project as broken and stall.
    const kitOwned = isScaffoldOwnedPath(want) || isScaffoldAbsorbedPath(want);
    return {
      label: `Could not read ${path}`,
      isError: true,
      output: kitOwned
        ? `"${path}" is supplied by the project scaffold and is added automatically after your turn. ` +
          `It is not missing and you must not author it. Continue with the app's own source files.`
        : `No file at "${path}".` +
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

/** Mirror of the builder's spec validation so bad input never costs a round trip. */
const PACKAGE_SPEC =
  /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(@[a-z0-9][a-z0-9.^~*+><=|\- ]*)?$/i;
const MAX_PACKAGES = 12;

async function installPackages(args: {
  projectId: string;
  files: ProjectFile[];
  packages: unknown;
  dev: boolean;
  purpose: string;
  signal?: AbortSignal;
}): Promise<ToolResult> {
  if (!isExecConfigured()) {
    return {
      label: "Package install unavailable",
      isError: true,
      output:
        "Package installation is not configured on this deployment. Add the dependency to package.json by hand instead, pinning a known-good version.",
    };
  }

  const raw = Array.isArray(args.packages) ? args.packages.map(String) : [];
  const specs = raw.map((p) => p.trim()).filter(Boolean);
  if (specs.length === 0) {
    return { label: "No packages given", isError: true, output: "No package names were supplied." };
  }
  if (specs.length > MAX_PACKAGES) {
    return {
      label: "Too many packages",
      isError: true,
      output: `At most ${MAX_PACKAGES} packages can be installed in one call.`,
    };
  }
  const bad = specs.filter((s) => !PACKAGE_SPEC.test(s));
  if (bad.length) {
    return {
      label: "Rejected package spec",
      isError: true,
      output: `These are not plain registry package specs and were rejected: ${bad.join(", ")}. Use "name" or "name@range" only.`,
    };
  }

  let session;
  try {
    session = await runInstallSession({
      projectId: args.projectId,
      files: args.files,
      packages: specs,
      dev: args.dev,
      signal: args.signal,
    });
  } catch (err) {
    return {
      label: `Install failed: ${specs.join(", ")}`,
      isError: true,
      output: `Could not install: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const cmd = session.results[0];
  const failed = !cmd || cmd.exitCode !== 0 || cmd.timedOut;
  if (failed) {
    return {
      label: `Install failed: ${specs.join(", ")}`,
      isError: true,
      output: clip(
        [
          `npm install exited ${cmd?.exitCode ?? "null"}${cmd?.timedOut ? " (timed out)" : ""}.`,
          cmd?.stderr ? `stderr:\n${cmd.stderr}` : "",
          cmd?.stdout ? `stdout:\n${cmd.stdout}` : "",
          "Do not retry the same spec. Pick a different package or version, or write the code without it.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      ),
    };
  }

  // The lockfile is persisted but never shown to the model — it is enormous
  // and there is nothing useful in it for the next decision.
  const changed = session.changedFiles ?? [];
  const pkg = changed.find((f) => f.path === "package.json");
  const summary = [
    `Installed ${specs.join(", ")}${args.dev ? " (dev)" : ""}.`,
    changed.length
      ? `Updated: ${changed.map((f) => f.path).join(", ")}`
      : "package.json already listed these — no change.",
    pkg ? `\npackage.json dependencies are now:\n${dependencyDigest(pkg.content)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    label: `Installed ${specs.join(", ")}`,
    output: clip(summary),
    changedFiles: changed,
    commands: session.results,
  };
}

function dependencyDigest(pkgJson: string): string {
  try {
    const parsed = JSON.parse(pkgJson) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const lines = [
      ...Object.entries(parsed.dependencies ?? {}).map(([k, v]) => `${k}@${v}`),
      ...Object.entries(parsed.devDependencies ?? {}).map(([k, v]) => `${k}@${v} (dev)`),
    ];
    return lines.join("\n");
  } catch {
    return "(could not parse package.json)";
  }
}

async function runTests(args: {
  projectId: string;
  files: ProjectFile[];
  purpose: string;
  signal?: AbortSignal;
}): Promise<ToolResult> {
  if (!isExecConfigured()) {
    return {
      label: "Test run unavailable",
      isError: true,
      output: "Running the project's tests is not configured on this deployment. Use run_check instead.",
    };
  }

  const pkg = args.files.find((f) => f.path === "package.json");
  if (!pkg || !/"test"\s*:/.test(pkg.content)) {
    return {
      label: "No test script",
      isError: true,
      output:
        'This project has no "test" script in package.json, so there is no suite to run. Use run_check for static verification.',
    };
  }

  let session;
  try {
    session = await runTestSession({
      projectId: args.projectId,
      files: args.files,
      signal: args.signal,
    });
  } catch (err) {
    return {
      label: `Tests could not run: ${args.purpose}`,
      isError: true,
      output: `Could not run the suite: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const test = session.results[session.results.length - 1];
  const install = session.results.length > 1 ? session.results[0] : null;
  if (install && install.exitCode !== 0) {
    return {
      label: "Tests could not run — install failed",
      isError: true,
      output: clip(`npm install failed before the suite could run.\n\n${install.stderr || install.stdout}`),
    };
  }

  const passed = test && test.exitCode === 0 && !test.timedOut;
  // Test runners put the useful part on both streams depending on the tool;
  // the tail is where the failure summary lives.
  const tail = (text: string) => text.split("\n").slice(-60).join("\n");
  return {
    label: passed ? `Tests passed — ${args.purpose}` : `Tests failed — ${args.purpose}`,
    isError: !passed,
    output: clip(
      [
        passed
          ? "The project's test suite passed."
          : `The suite exited ${test?.exitCode ?? "null"}${test?.timedOut ? " (timed out)" : ""}.`,
        test?.stdout ? `stdout (tail):\n${tail(test.stdout)}` : "",
        test?.stderr ? `stderr (tail):\n${tail(test.stderr)}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    ),
    commands: session.results,
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

    case "install_packages": {
      if (readOnly) {
        return {
          label: "Install blocked",
          isError: true,
          output: "This agent is read-only and cannot install packages. Report what you found instead.",
        };
      }
      return await installPackages({
        projectId,
        files,
        packages: a.packages,
        dev: Boolean(a.dev),
        purpose: String(a.purpose ?? "install packages"),
        signal,
      });
    }

    case "run_tests":
      return await runTests({
        projectId,
        files,
        purpose: String(a.purpose ?? "run the test suite"),
        signal,
      });

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
