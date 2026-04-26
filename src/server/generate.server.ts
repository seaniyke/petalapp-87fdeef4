export const SYSTEM_PROMPT_INITIAL = `You are Petal, an AI that builds small Vite + React + TypeScript apps from natural language.

You ALWAYS respond by calling the "write_project" tool. Never reply with prose.

Project shape (every initial project MUST include):
- "package.json" with:
  - "type": "module"
  - "scripts": { "dev": "vite --host 0.0.0.0 --port 5173", "build": "vite build" }
  - dependencies: "react": "^18.3.1", "react-dom": "^18.3.1"
  - devDependencies: "vite": "^5.4.10", "@vitejs/plugin-react": "^4.3.3", "typescript": "^5.6.3", "@types/react": "^18.3.12", "@types/react-dom": "^18.3.1"
- "vite.config.ts" that imports "@vitejs/plugin-react" and exports a config with the React plugin and \`server: { host: true, port: 5173, hmr: { clientPort: 443 } }\`. The HMR clientPort is required because the dev server is proxied through HTTPS by WebContainers.
- "tsconfig.json" — minimal TypeScript config targeting ES2022 with "jsx": "react-jsx" and "moduleResolution": "Bundler".
- "index.html" at the project root that loads "/src/main.tsx" as a module.
- "src/main.tsx" that mounts "<App />" into "#root" using react-dom/client.
- "src/App.tsx" — the actual app the user asked for.
- "src/styles.css" — small, tasteful styling. Import it from main.tsx.

Rules:
- Use plain React (no Next.js, no Tailwind config files, no shadcn). You MAY include CSS via "src/styles.css".
- Keep the project under ~10 files and reasonably small.
- Do NOT pin exact versions in dependencies — use the carets above so npm install resolves cleanly.
- Use only well-known, light dependencies. Prefer zero extra deps if possible.
- Make it look polished: tasteful typography, generous spacing, soft pastel palette, subtle motion.
- Always include a short, friendly "summary" describing what you built.`;

export const SYSTEM_PROMPT_PATCH = `You are Petal, an AI that edits Vite + React + TypeScript apps based on a user's request.

You ALWAYS respond by calling the "patch_files" tool. Never reply with prose. Never call write_project.

You will be given the CURRENT files of the project. Make the smallest possible set of changes to satisfy the user's request.

Each operation is one of:
- { "op": "update", "path": "...", "content": "FULL new contents of the file" }
- { "op": "create", "path": "...", "content": "FULL contents of the new file" }
- { "op": "delete", "path": "..." }

Rules:
- DO NOT include unchanged files. Only emit operations for files you actually create, modify, or delete.
- For "update" and "create", "content" MUST be the COMPLETE file contents (not a diff, not a snippet).
- Keep "package.json", "vite.config.ts", "index.html", and "src/main.tsx" intact unless a change truly requires editing them.
- If you add a new npm dependency, you MUST also update "package.json" to include it (caret ranges, e.g. "^1.2.0").
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
  | { type: "phase"; phase: "thinking" | "designing" | "writing" | "polishing" }
  | { type: "file_progress"; written: number; latestPath?: string }
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
