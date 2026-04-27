/**
 * /api/discuss — chat without touching files.
 *
 * Same chat history + current file context as /api/generate, but the model
 * replies with plain markdown advice (no tool calls, no patches). Used by
 * "Discuss mode" in the builder so non-technical users can ask questions
 * ("can you also make it work on mobile?", "what would it take to add auth?")
 * without fear of breaking the project.
 *
 * Mirrors Base44's Discuss and Lovable's Plan mode.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ChatMessage, ProjectFile } from "@/server/generate.server";
import { spendCredit, refundCredit } from "@/server/credits.server";

type Body = {
  messages: ChatMessage[];
  currentFiles: ProjectFile[];
  customInstructions?: string;
  projectId?: string;
};

const DISCUSS_SYSTEM_PROMPT = `You are Petal, a friendly product collaborator helping the user think through changes to their small web app.

You are in DISCUSS mode. You will NOT write or change any files in this turn. Your job is to listen, ask any clarifying questions you need, and propose a clear plan in plain language the user can approve.

Rules:
- Keep replies short and warm. Use simple language; assume the user is non-technical.
- Use markdown: short paragraphs, small bullet lists, **bold** for key ideas. No code blocks unless absolutely necessary.
- When proposing changes, describe them as user-visible outcomes ("a sign-in button on the home page") not as file paths or code.
- If something is ambiguous, ask one focused question instead of guessing.
- End with a single line like: "Reply *go* and I'll make these changes." so the user knows how to proceed.
- Never invent features that aren't possible in a static React + Vite app.`;

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

export const Route = createFileRoute("/api/discuss")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authResult = await authorize(request);
        if (authResult instanceof Response) return authResult;
        const userId = authResult;

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return new Response("AI gateway is not configured.", { status: 500 });

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

        // Charge 1 credit for discuss messages. Refund on any downstream failure.
        const charge = await spendCredit({
          userId,
          amount: 1.0,
          reason: "ai_discuss",
          projectId: body.projectId ?? null,
          metadata: { route: "/api/discuss" },
        });
        if (!charge.ok) {
          if (charge.reason === "insufficient_credits") {
            return new Response(
              "You're out of credits. Add credits in Settings → Plans & Credits to keep going.",
              { status: 402 },
            );
          }
          return new Response("Could not verify credit balance. Try again.", { status: 500 });
        }
        const discussLedgerId = charge.ledgerId;
        const refundDiscuss = (note: string) =>
          refundCredit({
            userId,
            ledgerId: discussLedgerId,
            reason: "ai_discuss_refund",
            metadata: { route: "/api/discuss", failure: note },
          });

        // Compact file context: just the path list + first ~30 lines of each file,
        // capped to ~12KB. Discuss mode rarely needs full source.
        const filesContext = currentFiles.length
          ? `\n\nThe project currently has these files:\n${currentFiles
              .map((f) => `- ${f.path}`)
              .join("\n")}\n\nA glance at the main files:\n\n${currentFiles
              .slice(0, 8)
              .map(
                (f) =>
                  `--- ${f.path} ---\n${f.content.split("\n").slice(0, 30).join("\n")}`,
              )
              .join("\n\n")
              .slice(0, 12000)}`
          : "\n\nThe project has no files yet — the user is still describing the idea.";

        const knowledge = (body.customInstructions ?? "").trim().slice(0, 4000);
        const knowledgeBlock = knowledge
          ? `\n\nProject Knowledge — the owner has asked you to always honor these instructions:\n"""\n${knowledge}\n"""\n`
          : "";

        // If the latest user turn carries image attachments, send it as a
        // multimodal content array so Petal can actually look at the screenshot.
        const lastUserIdx = (() => {
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === "user") return i;
          }
          return -1;
        })();
        const hasVisionTurn =
          lastUserIdx >= 0 && (messages[lastUserIdx].attachments?.length ?? 0) > 0;

        const visionAddendum = hasVisionTurn
          ? "\n\nThe user attached one or more reference images with their latest message. Look at them and describe what you see, then propose how to translate it into changes for their app."
          : "";

        const chatMessages = [
          { role: "system", content: DISCUSS_SYSTEM_PROMPT + knowledgeBlock + visionAddendum + filesContext },
          ...messages.map((m, i) => {
            if (i === lastUserIdx && hasVisionTurn) {
              return {
                role: m.role,
                content: [
                  { type: "text", text: m.content },
                  ...(m.attachments ?? []).map((a) => ({
                    type: "image_url" as const,
                    image_url: { url: a.dataUrl },
                  })),
                ],
              };
            }
            return { role: m.role, content: m.content };
          }),
        ];

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            // Vision needs a vision-capable model; otherwise stay on the fast default.
            model: hasVisionTurn ? "google/gemini-2.5-pro" : "google/gemini-3-flash-preview",
            messages: chatMessages,
            stream: false,
          }),
        });

        if (!upstream.ok) {
          await refundDiscuss(`upstream_${upstream.status}`);
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

        const json = (await upstream.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const reply = json.choices?.[0]?.message?.content?.trim() ?? "";
        if (!reply) {
          await refundDiscuss("empty_reply");
          return new Response("Empty reply from AI.", { status: 502 });
        }
        return Response.json({ reply });
      },
    },
  },
});
