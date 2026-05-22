/**
 * /api/discuss — chat without touching files.
 *
 * Same chat history + current file context as /api/generate, but the model
 * replies with plain markdown advice (no tool calls, no patches). Used by
 * "Discuss mode" in the builder so non-technical users can ask questions
 * ("can you also make it work on mobile?", "what would it take to add auth?")
 * without fear of breaking the project.
 *
 * Petal's "Discuss" mode — chat about the app without touching code.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ChatMessage, ProjectFile } from "@/server/generate.server";
import { spendCredit, checkCreditBalance } from "@/server/credits.server";
import { loadInstalledIntegrationsContext } from "@/server/integrations/prompt-context.server";
import { lookupBackendForGenerate } from "@/server/backend-connector.server";
import {
  loadInstalledCodes,
  renderSuggestionsBlock,
  suggestIntegrations,
} from "@/server/integrations/auto-suggest.server";
import { aiChatCompletions } from "@/server/ai-provider.server";
import { renderCurrentDateBlock } from "@/server/dynamic-prompts.server";
import { renderPetalCapabilitiesBlock } from "@/server/petal-capabilities.server";

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
- If something is ambiguous, ask ONE focused question instead of guessing. PAUSE and wait for the answer — do not also propose a plan in the same reply when you're asking a question.
- End with a single line like: "Reply *go* and I'll make these changes." so the user knows how to proceed.
- Never invent features that aren't possible in a static React + Vite app **or covered by an installed integration listed below**. When the user asks for something an installed integration covers (e.g. sending email, tracking analytics, taking payments), say YES and describe how you'd wire it up using that integration.
- NEVER assume the user wants light/dark mode, a theme toggle, cookie banners, language switchers, or onboarding tours. Only propose these if the user explicitly asks.

SUGGESTED-ANSWER CHIPS (mandatory whenever you ask a question):
- Whenever your reply asks the user a question OR offers a choice, append a SINGLE fenced block at the very end of your reply in this exact shape:

\`\`\`suggestions
["First suggested answer","Second suggested answer","Third (optional)"]
\`\`\`

- 2-4 short chip labels, each ≤ 40 characters, written as if the user is replying (first person where natural: "Yes, go ahead", "Skip auth for now", "Use my brand colors").
- Chips must be REAL answers to the question you asked — not generic ("Tell me more"). They're tapped to send as the user's next message.
- If you are NOT asking anything (e.g. just acknowledging "got it, building now"), DO NOT include the suggestions block.

### Petal's built-in capabilities (what this app CAN already do, no extra accounts needed)
The app you're helping with runs on **Petal**, which gives every project these native capabilities — they are part of the product, not third-party add-ons:
- **Petal Cloud** — Petal's managed backend. Includes user accounts (sign up / sign in with email + Google), a Postgres database, file storage, and serverless functions. One click to turn on inside Petal. The user does NOT install Supabase, Firebase, or any other third-party backend. If Petal Cloud is already attached, the section below will say so.
- **Petal AI Gateway** — call modern AI models (Gemini, GPT-5, etc.) directly from the user's app without bringing an API key.
- **Custom domains, publishing, SEO meta tags, analytics, email sending, payments** — all native Petal features, available as one-click integrations inside Petal.

Brand & wording rules (very important — your reply will be shown directly to a Petal customer):
- ALWAYS call the backend **"Petal Cloud"** or just **"the backend"**. NEVER use the words "Lovable", "Lovable Cloud", "Supabase", "Firebase", "Vercel", or any other vendor / platform name. Petal is its own product.
- NEVER tell the user to "install" a backend, sign up for another platform, or create an account anywhere outside Petal. The correct phrasing is "I'll turn on **Petal Cloud** for you" (or "Petal Cloud is already on for this project, so we're good to go").
- NEVER mention dashboards, project refs, service-role keys, API keys, or any internal plumbing. The user shouldn't have to leave Petal or know what's under the hood.
- For payments, email, analytics, domains, SEO, AI: phrase them as Petal capabilities ("I'll wire up Petal's payments integration", "I'll use the Petal AI Gateway"), never as third-party SDKs.`;

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

        // Provider key check is handled inside aiChatCompletions; we only verify
        // here for the friendly early-fail path used by the existing UI.
        if (!process.env.LOVABLE_API_KEY && !process.env.OPENROUTER_API_KEY) {
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

        // Pre-flight balance check ONLY — no hold. We charge the flat
        // 1 credit for discuss AFTER the AI replies successfully.
        const balance = await checkCreditBalance({ userId, amount: 1.0 });
        if (!balance.ok) {
          if (balance.reason === "insufficient_credits") {
            return new Response(
              "You're out of credits. Add credits in Settings → Plans & Credits to keep going.",
              { status: 402 },
            );
          }
          return new Response("Could not verify credit balance. Try again.", { status: 500 });
        }

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

        // Live backend status — same lookup as /api/generate. Tells Petal
        // whether Petal Cloud is already wired up for this project so it
        // doesn't say "you'll need to install a backend" when one is already
        // attached, and so it never recommends a third-party vendor by name.
        const backend = body.projectId
          ? await lookupBackendForGenerate(body.projectId)
          : null;
        const backendBlock = backend
          ? `\n\n### Petal Cloud is ON for this project\nThe backend (auth, database, file storage, serverless functions) is already wired up via **Petal Cloud**. When the user asks for sign-up, sign-in, saving data, file uploads, or anything that needs a server, say YES with confidence — no extra setup, no third-party account, no API keys. Describe the work as user-visible outcomes ("a sign-in screen on the home page", "their saved recipes show on a private dashboard"). NEVER mention Lovable, Supabase, Firebase, project refs, dashboards, or API keys.\n`
          : `\n\n### Petal Cloud is NOT yet on for this project\nThe project doesn't have a backend attached yet. If the user asks for sign-up, sign-in, saving data, file uploads, or anything that needs a server, tell them you'll **turn on Petal Cloud** for them as part of the plan — that's a one-click thing inside Petal, no third-party account needed. NEVER tell them to install Lovable, Supabase, Firebase, or any other backend, and never ask them for API keys.\n`;

        // Marketplace integrations — let Petal answer "can we send email?" with
        // a confident YES when Resend (or similar) is installed.
        const integrationsBlock = body.projectId
          ? await loadInstalledIntegrationsContext(body.projectId)
          : "";

        // Auto-suggest: if the user is asking for something a marketplace
        // integration handles (payments, email, analytics) and it's NOT yet
        // installed, recommend installing it before hand-rolling.
        const installedCodes = body.projectId
          ? await loadInstalledCodes(body.projectId)
          : new Set<string>();
        const suggestions = suggestIntegrations({ messages, installedCodes });
        const suggestionsBlock = renderSuggestionsBlock(suggestions);

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

        const dateBlock = renderCurrentDateBlock();
        const capabilitiesBlock = renderPetalCapabilitiesBlock({
          hasBackend: Boolean(backend),
        });

        const chatMessages = [
          { role: "system", content: DISCUSS_SYSTEM_PROMPT + dateBlock + capabilitiesBlock + backendBlock + integrationsBlock + suggestionsBlock + knowledgeBlock + visionAddendum + filesContext },
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

        const upstream = await aiChatCompletions({
          feature: "discuss",
          body: {
            // Vision needs a vision-capable model; otherwise stay on the fast default.
            model: hasVisionTurn ? "google/gemini-2.5-pro" : "google/gemini-3-flash-preview",
            messages: chatMessages,
            stream: false,
          },
        });

        if (!upstream.ok) {
          // Nothing was charged yet — just surface a friendly error.
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
          // Nothing was charged — just report the failure.
          return new Response("Empty reply from AI.", { status: 502 });
        }

        // Parse the trailing ```suggestions ["..","..","..]``` block (if any)
        // so the chat can render tappable answer chips below the reply.
        let cleanReply = reply;
        let chipSuggestions: string[] = [];
        const suggestionsMatch = reply.match(
          /```suggestions\s*\n([\s\S]*?)\n?```\s*$/i,
        );
        if (suggestionsMatch) {
          try {
            const parsed = JSON.parse(suggestionsMatch[1].trim());
            if (Array.isArray(parsed)) {
              chipSuggestions = parsed
                .filter((s): s is string => typeof s === "string")
                .map((s) => s.trim())
                .filter((s) => s.length > 0 && s.length <= 80)
                .slice(0, 4);
            }
          } catch {
            /* malformed JSON — drop the chips, keep the prose */
          }
          cleanReply = reply.slice(0, suggestionsMatch.index).trimEnd();
        }

        // Charge ONCE, after success. If the wallet emptied between the
        // pre-flight check and now, we still deliver the reply (the user
        // already received it) and log a warning.
        const charge = await spendCredit({
          userId,
          amount: 1.0,
          reason: "ai_discuss_charge",
          projectId: body.projectId ?? null,
          metadata: { route: "/api/discuss" },
        });
        if (!charge.ok) {
          console.warn("[credits] post-discuss charge failed", charge);
        }

        return Response.json({ reply: cleanReply, suggestions });
      },
    },
  },
});
