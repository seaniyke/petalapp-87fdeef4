import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  SYSTEM_PROMPT_INITIAL,
  SYSTEM_PROMPT_PATCH,
  WRITE_PROJECT_TOOL,
  PATCH_FILES_TOOL,
  applyOps,
  type ChatMessage,
  type ProjectFile,
  type FileOp,
  type StreamEvent,
} from "@/server/generate.server";
import { applyScaffoldKit, STYLES_CSS } from "@/server/scaffold-kit";
import { lookupBackendForGenerate } from "@/server/backend-connector.server";
import { validateStylesCss } from "@/server/validate-styles.server";

/** Smart routing presets, mirroring Base44's Automatic/Manual dropdown.
 *  - "fast"  : cheapest + quickest, good for trivial edits
 *  - "smart" : default — flash for small turns, pro for big refactors
 *  - "best"  : always use the strongest model
 */
type ModelPreset = "fast" | "smart" | "best";

type Body = {
  messages: ChatMessage[];
  currentFiles: ProjectFile[];
  model?: ModelPreset;
  customInstructions?: string;
  /** Required to look up the project's attached backend (BYO Supabase). */
  projectId?: string;
};

const MODEL_FAST = "google/gemini-3-flash-preview";
const MODEL_BEST = "google/gemini-2.5-pro";

/** Heuristic: when in "smart" mode, decide whether the turn deserves the Pro model. */
function pickSmartModel(latestPrompt: string, fileCount: number): string {
  const p = latestPrompt.toLowerCase();
  const heavyKeywords = [
    "refactor",
    "redesign",
    "rewrite",
    "architecture",
    "all pages",
    "every page",
    "entire app",
    "from scratch",
    "overhaul",
    "restructure",
    "migrate",
  ];
  if (heavyKeywords.some((k) => p.includes(k))) return MODEL_BEST;
  // Big projects + long prompts also benefit from the stronger model.
  if (fileCount > 12 && latestPrompt.length > 240) return MODEL_BEST;
  return MODEL_FAST;
}

function resolveModel(preset: ModelPreset, latestPrompt: string, fileCount: number): string {
  if (preset === "fast") return MODEL_FAST;
  if (preset === "best") return MODEL_BEST;
  return pickSmartModel(latestPrompt, fileCount);
}

function sse(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

async function authorize(request: Request): Promise<string | Response> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return new Response("Server misconfigured", { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401 });
  }
  const token = auth.slice("Bearer ".length);
  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    return new Response("Unauthorized", { status: 401 });
  }
  return data.claims.sub;
}

type ParsedTool = {
  name: "write_project" | "patch_files" | null;
  args: string;
};

/** Parse a streamed OpenAI-style SSE body, emit summary deltas as they arrive,
 *  accumulate the tool-call arguments string, and return the parsed final args. */
async function relayAndCollect(
  upstream: Response,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
): Promise<ParsedTool> {
  const reader = upstream.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const tool: ParsedTool = { name: null, args: "" };
  let summaryEmitted = ""; // running prefix of `summary` field already streamed
  let toolAnnounced = false;
  let designingPhaseSent = false;
  let writingPhaseSent = false;
  let lastPathCount = 0;

  // Matches a completed `"path": "<value>"` occurrence (handles escaped chars).
  const PATH_RE = /"path"\s*:\s*"((?:\\.|[^"\\])*)"/g;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      let json: unknown;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      const choice = (json as { choices?: Array<{ delta?: unknown }> })?.choices?.[0];
      const delta = (choice as { delta?: { tool_calls?: unknown[] } })?.delta;
      const toolCalls = delta?.tool_calls as
        | Array<{ function?: { name?: string; arguments?: string } }>
        | undefined;
      if (!toolCalls?.length) continue;
      for (const tc of toolCalls) {
        const name = tc.function?.name;
        if (name && !tool.name) {
          if (name === "write_project" || name === "patch_files") {
            tool.name = name;
            if (!toolAnnounced) {
              controller.enqueue(encoder.encode(sse({ type: "tool", name })));
              toolAnnounced = true;
            }
          }
        }
        const argDelta = tc.function?.arguments;
        if (typeof argDelta === "string") {
          tool.args += argDelta;
          // Try to extract a growing "summary" field and stream the new tail.
          const m = tool.args.match(/"summary"\s*:\s*"((?:\\.|[^"\\])*)/);
          if (m) {
            // Decode the partial JSON-string content so far.
            let decoded = "";
            try {
              decoded = JSON.parse(`"${m[1]}"`);
            } catch {
              decoded = summaryEmitted; // wait for more chars
            }
            if (decoded.length > summaryEmitted.length) {
              if (!designingPhaseSent) {
                controller.enqueue(encoder.encode(sse({ type: "phase", phase: "designing" })));
                designingPhaseSent = true;
              }
              const tail = decoded.slice(summaryEmitted.length);
              summaryEmitted = decoded;
              controller.enqueue(encoder.encode(sse({ type: "summary_delta", delta: tail })));
            }
          }

          // Count completed `"path": "..."` occurrences and announce file progress.
          PATH_RE.lastIndex = 0;
          let match: RegExpExecArray | null;
          let count = 0;
          let latest: string | undefined;
          while ((match = PATH_RE.exec(tool.args)) !== null) {
            count += 1;
            latest = match[1];
          }
          if (count > lastPathCount) {
            if (!writingPhaseSent) {
              controller.enqueue(encoder.encode(sse({ type: "phase", phase: "writing" })));
              writingPhaseSent = true;
            }
            lastPathCount = count;
            controller.enqueue(
              encoder.encode(sse({ type: "file_progress", written: count, latestPath: latest })),
            );
          }
        }
      }
    }
  }
  return tool;
}

export const Route = createFileRoute("/api/generate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authResult = await authorize(request);
        if (authResult instanceof Response) return authResult;

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
          return new Response("AI gateway is not configured.", { status: 500 });
        }

        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return new Response("Invalid JSON body", { status: 400 });
        }
        const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
        const currentFiles = Array.isArray(body.currentFiles) ? body.currentFiles : [];
        if (messages.length === 0) {
          return new Response("messages must not be empty", { status: 400 });
        }

        const isInitial = currentFiles.length === 0;
        const baseSystem = isInitial ? SYSTEM_PROMPT_INITIAL : SYSTEM_PROMPT_PATCH;

        // Look up the project's attached backend (BYO Supabase). When present,
        // we both inject the pre-configured client and tell the AI it exists.
        const backend = body.projectId
          ? await lookupBackendForGenerate(body.projectId)
          : null;

        const backendBlock = backend
          ? `\n\n### Backend (auth + database + storage) is connected\nThe project has a backend. Use the pre-configured client — never call createClient yourself, never import from @supabase/supabase-js directly, never hard-code URLs or keys.\n\nImports:\n- import { supabase } from "@/integrations/backend/client"\n- import { useAuth, AuthProvider } from "@/integrations/backend/auth"\n- import { uploadFile, getPublicUrl } from "@/integrations/backend/storage"\n\nWrap the app once with <AuthProvider>. Never overwrite anything under src/integrations/backend/ — those files are protected.\n\nIf you need a new table, end your summary with a fenced sql block prefixed "MIGRATION:" — do not try to run it. The user runs migrations manually.\n`
          : "";

        // Project Knowledge: small piece of context the owner attached to the
        // project ("always use a pastel palette", etc.). Prepended on every turn.
        const knowledge = (body.customInstructions ?? "").trim().slice(0, 4000);
        const knowledgeBlock = knowledge
          ? `\n\nProject Knowledge — the owner has asked you to always honor these instructions:\n"""\n${knowledge}\n"""\n`
          : "";

        const filesContext = isInitial
          ? ""
          : `\n\nCurrent project files:\n\n${currentFiles
              .map((f) => `--- ${f.path} ---\n${f.content}`)
              .join("\n\n")}`;
        const tool = isInitial ? WRITE_PROJECT_TOOL : PATCH_FILES_TOOL;

        const chatMessages = [
          { role: "system", content: baseSystem + backendBlock + knowledgeBlock + filesContext },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ];

        // Smart model routing (Phase 4). Default to "smart".
        const preset: ModelPreset = body.model ?? "smart";
        const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
        const model = resolveModel(preset, lastUser, currentFiles.length);

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: chatMessages,
            tools: [tool],
            tool_choice: { type: "function", function: { name: tool.function.name } },
            stream: true,
          }),
        });

        if (!upstream.ok || !upstream.body) {
          let msg = `AI gateway error (${upstream.status})`;
          if (upstream.status === 429) msg = "Rate limit reached. Please wait a moment.";
          else if (upstream.status === 402)
            msg = "AI credits exhausted. Add credits in Settings → Workspace → Usage.";
          else {
            try {
              const text = await upstream.text();
              console.error("AI gateway error", upstream.status, text);
            } catch {
              /* ignore */
            }
          }
          return new Response(msg, { status: upstream.status === 402 ? 402 : 502 });
        }

        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              controller.enqueue(encoder.encode(sse({ type: "phase", phase: "thinking" })));
              controller.enqueue(encoder.encode(sse({ type: "status", message: "Thinking…" })));
              const collected = await relayAndCollect(upstream, controller, encoder);
              controller.enqueue(encoder.encode(sse({ type: "phase", phase: "polishing" })));
              controller.enqueue(
                encoder.encode(sse({ type: "status", message: "Applying changes…" })),
              );

              if (!collected.name || !collected.args) {
                throw new Error("AI did not return a project. Try rephrasing.");
              }

              // INVARIANT: write_project is only allowed when the project is
              // empty (turn 1). Every subsequent turn MUST go through patch_files
              // so we keep an auditable diff history and never blow away user work.
              if (collected.name === "write_project" && !isInitial) {
                throw new Error(
                  "AI tried to rewrite the whole project. Edits must be incremental patches.",
                );
              }
              if (collected.name === "patch_files" && isInitial) {
                throw new Error(
                  "AI tried to patch an empty project. Initial generation must create files.",
                );
              }

              let parsed: { summary?: string; files?: ProjectFile[]; ops?: FileOp[] };
              try {
                parsed = JSON.parse(collected.args);
              } catch (e) {
                console.error("Failed to parse tool args", e, collected.args.slice(0, 500));
                throw new Error("AI returned invalid project data.");
              }

              const summary = parsed.summary?.trim() || "Updated the project.";
              let nextFiles: ProjectFile[];
              if (collected.name === "write_project") {
                if (!parsed.files?.length) throw new Error("AI returned no files.");
                // Inject the canonical scaffold (Tailwind v4 + shadcn-style UI kit)
                // so the AI never has to emit boilerplate it can't reliably reproduce.
                // Also inject the backend kit when a backend is attached.
                nextFiles = applyScaffoldKit(parsed.files, {
                  backend: backend ?? undefined,
                });
              } else {
                if (!Array.isArray(parsed.ops)) throw new Error("AI returned no ops.");
                // Defense-in-depth: reject patches that touch the canonical UI kit
                // or scaffold config files. The AI should never need to.
                const PROTECTED = [
                  "vite.config.ts",
                  "tsconfig.json",
                  "src/lib/utils.ts",
                ];
                const isProtectedPath = (p: string) =>
                  p.startsWith("src/components/ui/") ||
                  p.startsWith("src/components/examples/") ||
                  p.startsWith("src/integrations/backend/") ||
                  PROTECTED.includes(p);
                const violations = parsed.ops.filter((op) => isProtectedPath(op.path));
                if (violations.length) {
                  console.warn(
                    "Dropping protected-path ops:",
                    violations.map((v) => `${v.op} ${v.path}`).join(", "),
                  );
                }
                const safeOps = parsed.ops.filter((op) => !isProtectedPath(op.path));
                nextFiles = applyOps(currentFiles, safeOps);
              }
              if (!nextFiles.some((f) => f.path === "index.html")) {
                throw new Error("Project is missing index.html.");
              }

              // Last-mile guard: if the AI emitted (or patched in) a broken
              // src/styles.css, swap it for the canonical scaffold CSS so the
              // build can never be killed by a single bad character. Same
              // logic runs again in the build trigger as a safety net.
              nextFiles = nextFiles.map((f) => {
                if (f.path !== "src/styles.css") return f;
                const result = validateStylesCss(f.content);
                if (result.ok) return f;
                console.warn(
                  `[styles.css invalid] generate reason="${result.reason}" — falling back to scaffold default`
                );
                return { ...f, content: STYLES_CSS };
              });


              controller.enqueue(
                encoder.encode(sse({ type: "result", files: nextFiles, summary })),
              );
            } catch (e) {
              const message = e instanceof Error ? e.message : "Generation failed.";
              controller.enqueue(encoder.encode(sse({ type: "error", message })));
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
