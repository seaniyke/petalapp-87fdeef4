export const SYSTEM_PROMPT_INITIAL = `You are Petal, an AI that builds small self-contained web apps from natural language.

You ALWAYS respond by calling the "write_project" tool. Never reply with prose.

Rules for the project you generate:
- Output a SMALL, self-contained vanilla web app: HTML, CSS, and JS only.
- The entry point MUST be a file named exactly "index.html".
- Reference other files using RELATIVE paths (e.g. <link rel="stylesheet" href="styles.css">, <script src="app.js"></script>). Do NOT use absolute URLs to local files.
- Do NOT use any build tools, npm, imports, JSX, TypeScript, or external module systems. Plain ES5/ES6 browser JS only.
- It is OK to use CDN script tags (e.g. https://cdn.tailwindcss.com, https://cdn.jsdelivr.net/...) inside index.html.
- Keep total output under ~6 files and reasonably small.
- Make it look polished: tasteful typography, generous spacing, soft pastel palette, subtle motion.
- Always include a short, friendly "summary" describing what you built.`;

export const SYSTEM_PROMPT_PATCH = `You are Petal, an AI that edits small self-contained web apps based on a user's request.

You ALWAYS respond by calling the "patch_files" tool. Never reply with prose. Never call write_project.

You will be given the CURRENT files of the project. Make the smallest possible set of changes to satisfy the user's request.

Each operation is one of:
- { "op": "update", "path": "...", "content": "FULL new contents of the file" }
- { "op": "create", "path": "...", "content": "FULL contents of the new file" }
- { "op": "delete", "path": "..." }

Rules:
- DO NOT include unchanged files. Only emit operations for files you actually create, modify, or delete.
- For "update" and "create", "content" MUST be the COMPLETE file contents (not a diff, not a snippet).
- Keep "index.html" as the entry point. Do not delete it.
- Keep relative paths. No build tools, no npm, plain browser HTML/CSS/JS only. CDN <script> tags are fine.
- Always include a short, friendly "summary" describing what you changed.`;

export const WRITE_PROJECT_TOOL = {
  type: "function" as const,
  function: {
    name: "write_project",
    description: "Write the complete set of files that make up the web app.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Friendly 1-2 sentence summary of what was built.",
        },
        files: {
          type: "array",
          description: "All files in the project. Must include an index.html.",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "Relative file path, e.g. index.html" },
              content: { type: "string", description: "Full text content of the file." },
            },
            required: ["path", "content"],
            additionalProperties: false,
          },
        },
      },
      required: ["summary", "files"],
      additionalProperties: false,
    },
  },
};

export const PATCH_FILES_TOOL = {
  type: "function" as const,
  function: {
    name: "patch_files",
    description:
      "Apply a minimal set of file operations (create/update/delete) to the existing project.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Friendly 1-2 sentence summary of what was changed.",
        },
        ops: {
          type: "array",
          description: "Ordered list of file operations. Only changed files.",
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: ["create", "update", "delete"] },
              path: { type: "string", description: "Relative file path." },
              content: {
                type: "string",
                description: "Full file contents. Required for create/update, omit for delete.",
              },
            },
            required: ["op", "path"],
            additionalProperties: false,
          },
        },
      },
      required: ["summary", "ops"],
      additionalProperties: false,
    },
  },
};

export type ProjectFile = { path: string; content: string };
export type ChatMessage = { role: "user" | "assistant"; content: string };

export type FileOp =
  | { op: "create"; path: string; content: string }
  | { op: "update"; path: string; content: string }
  | { op: "delete"; path: string };

export type WriteProjectArgs = { summary: string; files: ProjectFile[] };
export type PatchFilesArgs = { summary: string; ops: FileOp[] };

/** Stream events emitted from /api/generate to the client. */
export type StreamEvent =
  | { type: "status"; message: string }
  | { type: "summary_delta"; delta: string }
  | { type: "tool"; name: "write_project" | "patch_files" }
  | { type: "result"; files: ProjectFile[]; summary: string }
  | { type: "error"; message: string };

/** Apply a list of file operations to a current set of files. */
export function applyOps(current: ProjectFile[], ops: FileOp[]): ProjectFile[] {
  const map = new Map(current.map((f) => [f.path, f.content]));
  for (const op of ops) {
    if (op.op === "delete") {
      map.delete(op.path);
    } else {
      map.set(op.path, op.content);
    }
  }
  return Array.from(map, ([path, content]) => ({ path, content }));
}
