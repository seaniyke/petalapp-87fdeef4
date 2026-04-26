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

type Body = {
  messages: ChatMessage[];
  currentFiles: ProjectFile[];
};

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
  encoder: TextEncoder
): Promise<ParsedTool> {
  const reader = upstream.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const tool: ParsedTool = { name: null, args: "" };
  let summaryEmitted = ""; // running prefix of `summary` field already streamed
  let toolAnnounced = false;

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
              const tail = decoded.slice(summaryEmitted.length);
              summaryEmitted = decoded;
              controller.enqueue(encoder.encode(sse({ type: "summary_delta", delta: tail })));
            }
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
        const systemPrompt = isInitial ? SYSTEM_PROMPT_INITIAL : SYSTEM_PROMPT_PATCH;
        const filesContext = isInitial
          ? ""
          : `\n\nCurrent project files:\n\n${currentFiles
              .map((f) => `--- ${f.path} ---\n${f.content}`)
              .join("\n\n")}`;
        const tool = isInitial ? WRITE_PROJECT_TOOL : PATCH_FILES_TOOL;

        const chatMessages = [
          { role: "system", content: systemPrompt + filesContext },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ];

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
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
              controller.enqueue(
                encoder.encode(sse({ type: "status", message: "Thinking…" }))
              );
              const collected = await relayAndCollect(upstream, controller, encoder);
              controller.enqueue(
                encoder.encode(sse({ type: "status", message: "Applying changes…" }))
              );

              if (!collected.name || !collected.args) {
                throw new Error("AI did not return a project. Try rephrasing.");
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
                nextFiles = parsed.files;
              } else {
                if (!Array.isArray(parsed.ops)) throw new Error("AI returned no ops.");
                nextFiles = applyOps(currentFiles, parsed.ops);
              }
              if (!nextFiles.some((f) => f.path === "index.html")) {
                throw new Error("Project is missing index.html.");
              }

              controller.enqueue(
                encoder.encode(sse({ type: "result", files: nextFiles, summary }))
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
