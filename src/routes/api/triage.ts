/**
 * /api/triage — the conversational front-door for Build mode.
 *
 * Why this exists:
 *   The old Build flow forced a `write_project` / `patch_files` tool call on
 *   every turn, which meant typing "hi" or "what can you do?" jumped straight
 *   into the build pipeline (Reading → Designing → Writing → Deploying).
 *   Competitors (Lovable, Bolt, v0, Base44) always say a warm sentence or two
 *   first and only build when the user has actually described something.
 *
 * What it does:
 *   Runs a tiny, fast classifier on the latest user turn and streams back:
 *     1. SSE `reply` chunks — a warm, human reply that the chat bubble shows
 *        token-by-token while the user is still reading.
 *     2. A final SSE `intent` event with one of:
 *          - "chat"    : just smalltalk, do nothing else
 *          - "clarify" : we asked a focused follow-up question
 *          - "build"   : the reply is a 1–2 sentence acknowledgement and the
 *                        client should now kick off the real build flow.
 *
 * Cost:
 *   Uses the cheap flash model. We don't charge a credit for triage —
 *   conversational turns should feel free. The downstream build still
 *   charges as it always has.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ChatMessage, ProjectFile } from "@/server/generate.server";

type Body = {
  messages: ChatMessage[];
  currentFiles: ProjectFile[];
  customInstructions?: string;
};

export type TriageIntent = "chat" | "clarify" | "build";

export type TriageEvent =
  | { type: "reply_delta"; delta: string }
  | { type: "intent"; intent: TriageIntent }
  | { type: "error"; message: string };

const TRIAGE_SYSTEM_PROMPT = `You are Petal — a warm, intelligent product collaborator who helps non-technical people build small web apps.

You are the FIRST thing the user hears. Your job is to feel like a kind, smart human teammate who actually understands what they're trying to do.

Decide which of these THREE intents fits the user's latest message:

1. "chat" — Greetings, smalltalk, thanks, questions about Petal itself ("what can you do?", "are you AI?"), or anything that does NOT ask for a change to their app. Reply warmly in 1–3 short sentences. Do NOT propose to build anything unless they ask.

2. "clarify" — They want to build or change something but the request is too vague to do well ("make it nice", "build something cool", "help me", "i need a website"). Reply warmly in 1–2 sentences and ask ONE focused question that unblocks you. Never ask multiple questions.

3. "build" — They have described something concrete enough to start building or editing. Reply warmly in 1–2 sentences acknowledging what they want, in plain human language about THEIR product (their store, their landing page, their idea), then end with a brief "Building it now…" or similar. Do NOT list files, components, frameworks, or any technical detail.

Voice & style (always):
- Sound like a friendly senior designer who happens to be very good at building things — never robotic, never corporate, never a status line.
- Be concise. 1–3 sentences. No bullet lists, no headings, no code blocks.
- Use natural contractions ("I'll", "let's", "you're"). Never say "As an AI".
- Talk about THEIR app and THEIR users — never mention React, Tailwind, components, files, scaffolds, builds, or deploys.
- If they wrote in another language, reply in that language.

Output format — RESPOND WITH RAW JSON ONLY, no markdown fences, no prose around it:
{"intent":"chat"|"clarify"|"build","reply":"your warm reply here"}

The reply field is what the user will see streamed into the chat bubble. Make it feel human.`;

async function authorize(request: Request): Promise<string | Response> {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    return new Response("Server misconfigured", { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
  const token = auth.slice("Bearer ".length);
  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) return new Response("Unauthorized", { status: 401 });
  return data.claims.sub;
}

function sse(event: TriageEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Pull the value of a top-level string field from streaming JSON. Tolerates
 * partial / unterminated strings (so we can emit `reply` chunks before the
 * model has closed the JSON object).
 */
function partialField(buf: string, field: string): string {
  const m = buf.match(new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`));
  if (!m) return "";
  try {
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return "";
  }
}

function parseFinalIntent(buf: string): TriageIntent {
  // Try strict JSON first.
  try {
    const obj = JSON.parse(buf) as { intent?: string };
    if (obj.intent === "chat" || obj.intent === "clarify" || obj.intent === "build") {
      return obj.intent;
    }
  } catch {
    /* fall through to regex */
  }
  const m = buf.match(/"intent"\s*:\s*"(chat|clarify|build)"/);
  if (m) return m[1] as TriageIntent;
  // Default to "build" — being too cautious would silently break the user's
  // build request, while a wrong "build" classification is recoverable
  // (the downstream build prompt handles it).
  return "build";
}

export const Route = createFileRoute("/api/triage")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authResult = await authorize(request);
        if (authResult instanceof Response) return authResult;

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return new Response("AI gateway is not configured.", { status: 500 });

        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return new Response("Invalid JSON body", { status: 400 });
        }
        const messages = Array.isArray(body.messages) ? body.messages.slice(-10) : [];
        if (messages.length === 0) {
          return new Response("messages must not be empty", { status: 400 });
        }

        // Compact context: project state in one line + small file list. Triage
        // only needs to know whether the user already has an app, not its guts.
        const fileCount = Array.isArray(body.currentFiles) ? body.currentFiles.length : 0;
        const stateLine =
          fileCount === 0
            ? "Project context: the user has NOT built anything yet — this is the very first conversation."
            : `Project context: the user already has an app with ${fileCount} files (most recent message likely refers to it).`;

        const knowledge = (body.customInstructions ?? "").trim().slice(0, 2000);
        const knowledgeBlock = knowledge
          ? `\n\nProject Knowledge: """${knowledge}"""`
          : "";

        // Strip attachments from the history we send to triage — vision isn't
        // needed for classification and the data URLs would balloon the prompt.
        const chatMessages = [
          { role: "system", content: TRIAGE_SYSTEM_PROMPT + "\n\n" + stateLine + knowledgeBlock },
          ...messages.map((m) => ({
            role: m.role,
            content: typeof m.content === "string" ? m.content : "",
          })),
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
            stream: true,
            // Force a JSON object back so we can parse the intent reliably.
            response_format: { type: "json_object" },
          }),
        });

        if (!upstream.ok || !upstream.body) {
          let msg = `AI gateway error (${upstream.status})`;
          if (upstream.status === 429) msg = "Rate limit reached. Please wait a moment.";
          else if (upstream.status === 402)
            msg = "AI credits exhausted. Add credits in Settings → Workspace → Usage.";
          return new Response(msg, { status: upstream.status === 402 ? 402 : 502 });
        }

        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const reader = upstream.body!.getReader();
            const decoder = new TextDecoder();
            let buf = "";
            let json = "";
            let replyEmitted = "";

            try {
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
                  if (!payload || payload === "[DONE]") continue;
                  try {
                    const parsed = JSON.parse(payload) as {
                      choices?: Array<{ delta?: { content?: string } }>;
                    };
                    const piece = parsed.choices?.[0]?.delta?.content;
                    if (typeof piece !== "string" || piece.length === 0) continue;
                    json += piece;
                    // Stream just the new tail of the `reply` field so the chat
                    // bubble fills in token-by-token before the JSON is closed.
                    const replyNow = partialField(json, "reply");
                    if (replyNow.length > replyEmitted.length) {
                      const tail = replyNow.slice(replyEmitted.length);
                      replyEmitted = replyNow;
                      controller.enqueue(
                        encoder.encode(sse({ type: "reply_delta", delta: tail })),
                      );
                    }
                  } catch {
                    /* ignore malformed chunks */
                  }
                }
              }
              const intent = parseFinalIntent(json);
              controller.enqueue(encoder.encode(sse({ type: "intent", intent })));
            } catch (e) {
              const message = e instanceof Error ? e.message : "Triage stream failed.";
              controller.enqueue(encoder.encode(sse({ type: "error", message })));
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
          },
        });
      },
    },
  },
});
