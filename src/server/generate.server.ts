export const SYSTEM_PROMPT = `You are Petal, an AI that builds small self-contained web apps from natural language.

You ALWAYS respond by calling the "write_project" tool. Never reply with prose.

Rules for the project you generate:
- Output a SMALL, self-contained vanilla web app: HTML, CSS, and JS only.
- The entry point MUST be a file named exactly "index.html".
- Reference other files using RELATIVE paths (e.g. <link rel="stylesheet" href="styles.css">, <script src="app.js"></script>). Do NOT use absolute URLs to local files.
- Do NOT use any build tools, npm, imports, JSX, TypeScript, or external module systems. Plain ES5/ES6 browser JS only.
- It is OK to use CDN script tags (e.g. https://cdn.tailwindcss.com, https://cdn.jsdelivr.net/...) inside index.html.
- Keep total output under ~6 files and reasonably small.
- Make it look polished: tasteful typography, generous spacing, soft pastel palette, subtle motion.
- Always include a short, friendly "summary" describing what you built or changed.

When the user asks for a CHANGE on an existing project, you will receive the current files. RETURN THE FULL UPDATED PROJECT (all files, including unchanged ones). Do not return diffs.`;

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
          description: "Friendly 1-2 sentence summary of what was built or changed.",
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

export type ProjectFile = { path: string; content: string };
export type GenerateResult = { summary: string; files: ProjectFile[] };
export type ChatMessage = { role: "user" | "assistant"; content: string };
