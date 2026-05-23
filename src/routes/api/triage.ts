/**
 * /api/triage — the conversational front-door for Build mode.
 *
 * Why this exists:
 *   The old Build flow forced a `write_project` / `patch_files` tool call on
 *   every turn, which meant typing "hi" or "what can you do?" jumped straight
 *   into the build pipeline. Competitors (Lovable, Bolt, v0, Base44) always
 *   say a warm sentence or two first and only build when the user has actually
 *   described something. Petal does both — and now also extracts a STRUCTURED
 *   read of the user's intent so downstream stages can adapt.
 *
 * What it returns:
 *   1. SSE `reply_delta` events streaming the warm reply token-by-token so the
 *      chat bubble fills in within ~200ms of pressing Enter.
 *   2. A final SSE `meta` event with the structured intent record:
 *        {
 *          mode: "chat" | "clarify" | "build" | "edit" | "fix" | "explain" | "redesign",
 *          confidence: 0..1,
 *          language: ISO-ish lang tag the user wrote in,
 *          audience_level: "non_technical" | "mixed" | "technical",
 *          scope: "tiny" | "small" | "medium" | "large",
 *          brief: one-line restatement of what they want,
 *          unknowns: the (max 3) most important missing facts,
 *          suggestions: 0–4 short clickable answers the UI can render as chips,
 *        }
 *   3. A final SSE `intent` event ("chat" | "clarify" | "build") for backward
 *      compatibility with the existing builder send() path. `edit`/`fix`/
 *      `redesign` all collapse to "build" here — they take the build pipeline.
 *      `explain` collapses to "chat".
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
import { loadProjectMemoryBlock } from "@/server/project-memory.server";
import { aiChatCompletions } from "@/server/ai-provider.server";
import { detectHighStakesIntent, highStakesClarifyInstruction } from "@/lib/high-stakes-intent";

type Body = {
  messages: ChatMessage[];
  currentFiles: ProjectFile[];
  customInstructions?: string;
  /** Optional — when present, project memory is loaded and injected into the prompt. */
  projectId?: string;
};

/** Coarse intent kept for the builder's existing branching. */
export type TriageIntent = "chat" | "clarify" | "build";

/** Fine-grained mode the model picks; collapses to TriageIntent for routing. */
export type TriageMode =
  | "chat"
  | "clarify"
  | "build"
  | "edit"
  | "fix"
  | "explain"
  | "redesign";

export type TriageMeta = {
  mode: TriageMode;
  confidence: number;
  language: string;
  audience_level: "non_technical" | "mixed" | "technical";
  scope: "tiny" | "small" | "medium" | "large";
  brief: string;
  unknowns: string[];
  suggestions: string[];
};

export type TriageEvent =
  | { type: "reply_delta"; delta: string }
  | { type: "meta"; meta: TriageMeta }
  | { type: "intent"; intent: TriageIntent }
  | { type: "error"; message: string };

const TRIAGE_SYSTEM_PROMPT = `You are Petal — a warm, intelligent product collaborator who helps people (mostly non-technical) build small web apps.

You are the FIRST and ONLY thing in this stack that decides "should Petal ask the user a question or just do the work?" Downstream stages (discuss, build) trust your decision and will never ask on their own. So be smart about it.

DEFAULT POSTURE: Petal acts. Other systems (Lovable, Bolt, v0, Base44) ship on a sensible assumption rather than interrogating the user — Petal does the same. If you can pick a tasteful default, pick it and proceed. The user can always correct you in their next message.

You ALWAYS respond by calling the "triage" tool. Never reply in plain text.

How to fill the tool fields:

- mode: pick the single best fit
    "chat"      → greetings, smalltalk, thanks, "what can you do?", anything that does NOT request a change to their app.
    "clarify"   → LAST RESORT. Only use this when (a) two reasonable interpretations of the request would produce visibly different products, AND (b) no tasteful default exists, AND (c) guessing wrong would waste a real build (not just a copy tweak). Otherwise pick build/edit/fix/redesign and proceed with an assumption.
    "build"     → they want a NEW app or a NEW major feature added to an existing app.
    "edit"      → they want a small, surgical change to what already exists ("change the button to blue", "make the title bigger").
    "fix"       → something is broken or wrong and they want it corrected ("the form doesn't submit", "this looks weird on mobile").
    "redesign"  → they want a substantial visual overhaul of an existing app ("make it feel premium", "redo the homepage").
    "explain"   → they want you to describe what's there, how it works, or what's possible — no changes.

- confidence: 0..1, how sure you are about \`mode\` and \`brief\`. LOW CONFIDENCE IS NOT A REASON TO CLARIFY. Pick the most likely intent, state your assumption in \`reply\` ("I'll assume X — tell me if you'd rather Y"), and proceed. Only escalate to "clarify" when confidence is below ~0.25 AND a wrong guess would waste a real build.

- language: short tag for the language they wrote in. Use "en" for standard English, "pidgin" for West African pidgin / broken English, "fr" for French, "es" for Spanish, "pt" for Portuguese, etc. Detect from the actual message — never assume English.

- audience_level: "non_technical" by default. Use "technical" only if they reference code, frameworks, APIs, or other engineer-speak. "mixed" if unclear.

- scope: how big is this turn?
    "tiny"   → 1–2 lines change, copy tweak, single style change.
    "small"  → one component or section.
    "medium" → multi-component feature, new page.
    "large" → a whole new app, or a sweeping redesign.
  For "chat" / "explain" / "clarify", set scope to "tiny".

- brief: one short sentence in plain English restating what the user wants in terms of THEIR product. No file paths, no frameworks. e.g. "A one-page site for the user's barber shop with hours, photos, and a WhatsApp booking button." For non-build modes this can be a short summary of what they said.

- unknowns: at most 3 short bullet strings, each naming ONE missing fact whose answer would meaningfully change what you build. Empty array if nothing important is missing. NEVER include "what color?", "which font?", "what tone?", "what copy?", "what layout?" — pick a tasteful default for those instead of asking.

- suggestions: 0–4 SHORT clickable answers (1–4 words each) the UI can render as chips for the user to tap. Use them to:
    • offer focused choices ONLY when mode = "clarify" (e.g. ["My barber shop", "A side project", "A client", "Other"])
    • propose obvious next moves when mode = "chat" or "explain" (e.g. ["Show me an example", "Build something for me"])
    • leave EMPTY ([]) when mode = "build"/"edit"/"fix"/"redesign" — you're already going to do the work, no chips needed.
  When mode = "clarify", suggestions MUST be non-empty (2–4 chips). Each chip MUST read as something the user themselves would naturally type back. Never write chips from Petal's voice.

- reply: the warm message that streams into the chat bubble. Rules for reply:
    • 1–3 short sentences. No bullet lists, no headings, no code blocks.
    • Sound like a friendly senior designer who happens to be very good at building things.
    • Use natural contractions. Never say "As an AI". Never reference React, Tailwind, components, files, scaffolds, builds, or deploys.
    • Reply in the SAME language/register the user wrote in (mirror pidgin with pidgin, French with French).
    • For mode = "build"/"edit"/"fix"/"redesign": acknowledge in plain words what they want and end with a brief "Building it now…" / "On it…" / equivalent in their language. NEVER include a question mark in this mode.
    • For mode = "clarify": ask ONE focused question — the chips will provide quick answers. Never ask two questions.
    • For mode = "chat"/"explain": just be warm and helpful. Do not propose to build unless asked. Do not end with a question.

Always be honest. If you genuinely can't tell what they want, say so kindly and use clarify + suggestions — but treat that as the rare exception, not the norm.`;

const TRIAGE_TOOL = {
  type: "function" as const,
  function: {
    name: "triage",
    description:
      "Classify the user's latest turn and produce a warm, human reply. Always call this exactly once per turn.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: {
          type: "string",
          enum: ["chat", "clarify", "build", "edit", "fix", "explain", "redesign"],
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        language: { type: "string" },
        audience_level: {
          type: "string",
          enum: ["non_technical", "mixed", "technical"],
        },
        scope: { type: "string", enum: ["tiny", "small", "medium", "large"] },
        brief: { type: "string" },
        unknowns: {
          type: "array",
          items: { type: "string" },
          maxItems: 3,
        },
        suggestions: {
          type: "array",
          items: { type: "string" },
          maxItems: 4,
        },
        reply: { type: "string" },
      },
      required: [
        "mode",
        "confidence",
        "language",
        "audience_level",
        "scope",
        "brief",
        "unknowns",
        "suggestions",
        "reply",
      ],
    },
  },
};

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

/** Pull the value of a named string ARGUMENT from a streaming tool-call
 *  arguments JSON. Tolerates partial / unterminated strings so we can emit
 *  reply chunks before the JSON object closes. */
function partialField(buf: string, field: string): string {
  const m = buf.match(new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`));
  if (!m) return "";
  try {
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return "";
  }
}

/** Collapse the fine-grained mode to the coarse intent the builder branches on. */
function modeToIntent(mode: TriageMode): TriageIntent {
  if (mode === "chat" || mode === "explain") return "chat";
  if (mode === "clarify") return "clarify";
  return "build"; // build / edit / fix / redesign all run the build pipeline
}

/**
 * Deterministic "bare question" sniffer. Catches messages like
 *   "Why is the preview blank?"
 *   "Is this the deployed URL?"
 *   "What does this button do?"
 * where the user is asking ABOUT existing state, not asking us to change it.
 *
 * If matched, we bias triage toward `clarify`/`explain` so the build
 * pipeline doesn't run on a guess. The model can still override with high
 * confidence (≥0.8) — e.g. if it's clearly "fix it" phrased as a question.
 */
function looksLikeBareQuestion(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  if (!/\?\s*$/.test(t)) return false;
  // Imperative / fix-it cues short-circuit: this is a real instruction.
  if (
    /\b(?:fix|repair|change|update|make|add|build|create|remove|delete|rename|replace|redesign|refactor|implement|wire|hook up|install|set up|enable|disable|move|rewrite)\b/i.test(
      t,
    )
  ) {
    return false;
  }
  // Leading question word.
  return /^(?:why|what|how|where|when|which|who|is|are|was|were|do|does|did|can|could|should|would|will|may|might|have|has|had)\b/i.test(
    t,
  );
}

function safeMeta(args: unknown): TriageMeta {
  // Defensive parse — the gateway can occasionally drop fields.
  const obj = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const mode = (typeof obj.mode === "string" ? obj.mode : "build") as TriageMode;
  const allowedModes = new Set<TriageMode>([
    "chat",
    "clarify",
    "build",
    "edit",
    "fix",
    "explain",
    "redesign",
  ]);
  return {
    mode: allowedModes.has(mode) ? mode : "build",
    confidence:
      typeof obj.confidence === "number" && obj.confidence >= 0 && obj.confidence <= 1
        ? obj.confidence
        : 0.6,
    language: typeof obj.language === "string" && obj.language.length > 0 ? obj.language : "en",
    audience_level:
      obj.audience_level === "technical" || obj.audience_level === "mixed"
        ? obj.audience_level
        : "non_technical",
    scope:
      obj.scope === "tiny" || obj.scope === "small" || obj.scope === "medium" || obj.scope === "large"
        ? obj.scope
        : "small",
    brief: typeof obj.brief === "string" ? obj.brief.slice(0, 400) : "",
    unknowns: Array.isArray(obj.unknowns)
      ? (obj.unknowns as unknown[]).filter((s): s is string => typeof s === "string").slice(0, 3)
      : [],
    suggestions: Array.isArray(obj.suggestions)
      ? (obj.suggestions as unknown[])
          .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          .map((s) => s.trim().slice(0, 60))
          .slice(0, 4)
      : [],
  };
}

export const Route = createFileRoute("/api/triage")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authResult = await authorize(request);
        if (authResult instanceof Response) return authResult;

        if (!process.env.LOVABLE_API_KEY && !process.env.OPENROUTER_API_KEY) {
          return new Response("AI gateway is not configured.", { status: 500 });
        }

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

        // Compact context: project state in one line. Triage only needs to know
        // whether the user already has an app, not its guts.
        const fileCount = Array.isArray(body.currentFiles) ? body.currentFiles.length : 0;
        const stateLine =
          fileCount === 0
            ? "Project context: the user has NOT built anything yet — this is the very first conversation."
            : `Project context: the user already has an app with ${fileCount} files. Most messages will be edits/fixes to it, not new builds.`;

        const knowledge = (body.customInstructions ?? "").trim().slice(0, 2000);
        const knowledgeBlock = knowledge ? `\n\nProject Knowledge: """${knowledge}"""` : "";

        // Project Memory — durable facts learned across previous turns. Read
        // with the user's JWT so RLS enforces ownership. Empty string when
        // there's no projectId yet (very first turn) or no memory recorded.
        let memoryBlock = "";
        if (body.projectId) {
          const auth = request.headers.get("authorization");
          const jwt = auth?.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
          if (jwt) {
            memoryBlock = await loadProjectMemoryBlock(jwt, body.projectId);
          }
        }

        // Strip attachments — vision isn't needed for classification and the
        // base64 payloads would balloon the prompt.
        // High-stakes domain guard: if the latest user turn mentions a
        // crypto wallet, online bank, brokerage, etc., force a clarify so
        // we don't ship a demo the user mistakes for the real thing.
        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        const lastUserText = typeof lastUser?.content === "string" ? lastUser.content : "";
        const highStakes = detectHighStakesIntent(lastUserText);
        const highStakesBlock =
          highStakes.detected && highStakes.domain
            ? "\n\n" + highStakesClarifyInstruction(highStakes.domain)
            : "";

        const chatMessages = [
          {
            role: "system",
            content:
              TRIAGE_SYSTEM_PROMPT +
              "\n\n" +
              stateLine +
              knowledgeBlock +
              memoryBlock +
              highStakesBlock,
          },
          ...messages.map((m) => ({
            role: m.role,
            content: typeof m.content === "string" ? m.content : "",
          })),
        ];

        const upstream = await aiChatCompletions({
          feature: "triage",
          body: {
            model: "google/gemini-3-flash-preview",
            messages: chatMessages,
            stream: true,
            tools: [TRIAGE_TOOL],
            tool_choice: { type: "function", function: { name: "triage" } },
          },
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
            let argsBuf = ""; // accumulating tool-call arguments JSON
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
                      choices?: Array<{
                        delta?: {
                          content?: string;
                          tool_calls?: Array<{
                            function?: { arguments?: string };
                          }>;
                        };
                      }>;
                    };
                    const delta = parsed.choices?.[0]?.delta;
                    // Tool-call argument deltas: this is where the model
                    // streams the JSON for our `triage` tool.
                    const toolPiece = delta?.tool_calls?.[0]?.function?.arguments;
                    if (typeof toolPiece === "string" && toolPiece.length > 0) {
                      argsBuf += toolPiece;
                      const replyNow = partialField(argsBuf, "reply");
                      if (replyNow.length > replyEmitted.length) {
                        const tail = replyNow.slice(replyEmitted.length);
                        replyEmitted = replyNow;
                        controller.enqueue(
                          encoder.encode(sse({ type: "reply_delta", delta: tail })),
                        );
                      }
                    }
                    // Some providers also send free-form text. Treat it as
                    // additional reply tokens so we never lose them.
                    const textPiece = delta?.content;
                    if (typeof textPiece === "string" && textPiece.length > 0 && !argsBuf) {
                      replyEmitted += textPiece;
                      controller.enqueue(
                        encoder.encode(sse({ type: "reply_delta", delta: textPiece })),
                      );
                    }
                  } catch {
                    /* ignore malformed chunks */
                  }
                }
              }

              // Final parse of the tool-call arguments. If parsing fails we
              // fall back to defaults — better to build than to silently
              // drop a real request.
              let parsedArgs: unknown = null;
              try {
                parsedArgs = JSON.parse(argsBuf);
              } catch {
                /* fall back below */
              }
              const meta = safeMeta(parsedArgs);
              if (!meta.brief && replyEmitted) meta.brief = replyEmitted.slice(0, 200);

              // Deterministic bias: a bare question about existing state
              // ("why is the preview blank?", "is this the URL?") should be
              // ANSWERED, not asked-back-at. Downgrade to "explain" so Petal
              // gives an answer instead of opening a clarify loop. Only the
              // model can override with high confidence (≥0.8).
              if (
                (meta.mode === "build" ||
                  meta.mode === "fix" ||
                  meta.mode === "edit" ||
                  meta.mode === "redesign") &&
                meta.confidence < 0.8 &&
                looksLikeBareQuestion(lastUserText)
              ) {
                console.warn(
                  `[triage] downgrading "${meta.mode}" → "explain" (bare question, conf=${meta.confidence})`,
                );
                meta.mode = "explain";
              }

              controller.enqueue(encoder.encode(sse({ type: "meta", meta })));
              controller.enqueue(
                encoder.encode(sse({ type: "intent", intent: modeToIntent(meta.mode) })),
              );
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
