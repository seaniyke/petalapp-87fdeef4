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
import { loadInstalledIntegrationsContext } from "@/server/integrations/prompt-context.server";
import { validateStylesCss } from "@/server/validate-styles.server";
import { resolvePetalImagePlaceholders } from "@/server/image-generation.server";
import { spendCredit, checkCreditBalance } from "@/server/credits.server";
import { priceBuild, BUILD_FLOOR } from "@/server/credit-pricing.server";

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
/** Vision-capable model used whenever the latest turn carries image attachments. */
const MODEL_VISION = "google/gemini-2.5-pro";

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
  /** Token usage from the gateway (final SSE chunk usually carries it). */
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
};

/** Parse a streamed OpenAI-style SSE body, emit summary deltas as they arrive,
 *  accumulate the tool-call arguments string, and return the parsed final args
 *  along with any `usage` payload the gateway emitted. */
async function relayAndCollect(
  upstream: Response,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
): Promise<ParsedTool> {
  const reader = upstream.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const tool: ParsedTool = { name: null, args: "", usage: null };
  // Running prefixes of the structured narrative fields already streamed to
  // the client. We re-extract from `tool.args` on every chunk and emit only
  // the new tail, so the client renders a clean token-by-token feel.
  let planEmitted = "";
  let summaryEmitted = "";
  let recapEmitted = "";
  let toolAnnounced = false;
  let designingPhaseSent = false;
  let writingPhaseSent = false;
  let lastPathCount = 0;

  // Matches a completed `"path": "<value>"` occurrence (handles escaped chars).
  const PATH_RE = /"path"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  // Helper: extract the partial value of a top-level string field from the
  // streaming JSON args. Returns "" until the field appears.
  const partial = (field: string): string => {
    const m = tool.args.match(new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`));
    if (!m) return "";
    try {
      return JSON.parse(`"${m[1]}"`);
    } catch {
      return "";
    }
  };

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
      // Capture token usage. The Lovable AI gateway emits a final SSE chunk
      // with `usage: { prompt_tokens, completion_tokens, total_tokens }` and
      // an empty `choices` array — that's where we read it.
      const usage = (json as { usage?: typeof tool.usage }).usage;
      if (usage && (usage.prompt_tokens || usage.completion_tokens)) {
        tool.usage = usage;
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
          // Stream the three narrative segments (plan → summary → recap)
          // as the AI produces them. Each event carries only the new tail
          // so the client can append without re-rendering the full string.
          const planNow = partial("plan");
          if (planNow.length > planEmitted.length) {
            const tail = planNow.slice(planEmitted.length);
            planEmitted = planNow;
            controller.enqueue(encoder.encode(sse({ type: "plan_delta", delta: tail })));
          }
          const summaryNow = partial("summary");
          if (summaryNow.length > summaryEmitted.length) {
            if (!designingPhaseSent) {
              controller.enqueue(encoder.encode(sse({ type: "phase", phase: "designing" })));
              designingPhaseSent = true;
            }
            const tail = summaryNow.slice(summaryEmitted.length);
            summaryEmitted = summaryNow;
            controller.enqueue(encoder.encode(sse({ type: "summary_delta", delta: tail })));
          }
          const recapNow = partial("recap");
          if (recapNow.length > recapEmitted.length) {
            const tail = recapNow.slice(recapEmitted.length);
            recapEmitted = recapNow;
            controller.enqueue(encoder.encode(sse({ type: "recap_delta", delta: tail })));
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
        const userId = authResult;

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

        // Per-message hard cap. We only enforce this on the LATEST user message
        // (the one being sent now). History messages are bounded by the
        // 20-message slice above. The cap exists so a single request can't
        // submit a megabyte of prose and either OOM the parser or run up an
        // unbounded LLM bill before we've spent the credit. Picked at 8000
        // chars (~2000 tokens) which is generous for any plausible prompt.
        const MAX_PROMPT_CHARS = 8000;
        const lastUserMsg = [...messages].reverse().find((m) => m?.role === "user");
        const lastContent = typeof lastUserMsg?.content === "string" ? lastUserMsg.content : "";
        if (lastContent.length > MAX_PROMPT_CHARS) {
          return new Response(
            JSON.stringify({
              error: `Your message is too long (${lastContent.length} chars, max ${MAX_PROMPT_CHARS}). Try splitting it into smaller asks.`,
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        // Pre-flight balance check ONLY — we no longer take a "hold". The
        // user is charged once, after the build succeeds, based on actual
        // token usage (see post-flight section below). This keeps the
        // experience honest: failed/aborted builds cost nothing.
        const balance = await checkCreditBalance({ userId, amount: BUILD_FLOOR });
        if (!balance.ok) {
          if (balance.reason === "insufficient_credits") {
            return new Response(
              JSON.stringify({
                error:
                  "You're out of credits. Add credits in Settings → Plans & Credits to keep generating.",
              }),
              { status: 402, headers: { "Content-Type": "application/json" } },
            );
          }
          return new Response("Could not verify credit balance. Try again.", { status: 500 });
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

        // Marketplace integrations (Resend, Plausible, etc.) — tells Petal
        // which helpers exist so it uses them instead of reinventing.
        const integrationsBlock = body.projectId
          ? await loadInstalledIntegrationsContext(body.projectId)
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

        // Build the chat-completion messages. The LAST user turn may carry
        // image attachments — when it does, we use OpenAI's multimodal content
        // array shape so the model actually sees the screenshot. All earlier
        // messages stay as plain strings to keep the payload small.
        const lastUserIdx = (() => {
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === "user") return i;
          }
          return -1;
        })();
        const hasVisionTurn =
          lastUserIdx >= 0 && (messages[lastUserIdx].attachments?.length ?? 0) > 0;

        const visionAddendum = hasVisionTurn
          ? "\n\nThe user attached one or more reference images with their latest message. Treat them as design references — match the layout, color palette, typography style, spacing, and overall mood as closely as the kit components allow. Describe in your summary which parts you matched and which you adapted."
          : "";

        const chatMessages = [
          { role: "system", content: baseSystem + backendBlock + integrationsBlock + knowledgeBlock + visionAddendum + filesContext },
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

        // Smart model routing (Phase 4). Default to "smart". Vision turns
        // ALWAYS go to a vision-capable model regardless of preset.
        const preset: ModelPreset = body.model ?? "smart";
        const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
        const model = hasVisionTurn
          ? MODEL_VISION
          : resolveModel(preset, lastUser, currentFiles.length);

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
          // Upstream rejected before doing any work — nothing was charged,
          // nothing to refund. Just surface a friendly error.
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

              let parsed: {
                plan?: string;
                summary?: string;
                recap?: string;
                files?: ProjectFile[];
                ops?: FileOp[];
              };
              try {
                parsed = JSON.parse(collected.args);
              } catch (e) {
                console.error("Failed to parse tool args", e, collected.args.slice(0, 500));
                throw new Error("AI returned invalid project data.");
              }

              const summary = parsed.summary?.trim() || "Updated the project.";
              const plan = parsed.plan?.trim() || undefined;
              const recap = parsed.recap?.trim() || undefined;
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

              // Phase 4: resolve `petal-image://...` placeholders into real
              // AI-generated images uploaded to the public petal-images
              // bucket. Failures fall back to picsum so the build never
              // breaks because of a flaky image call.
              try {
                const hasPlaceholders = nextFiles.some((f) =>
                  f.content.includes("petal-image://"),
                );
                if (hasPlaceholders) {
                  controller.enqueue(
                    encoder.encode(sse({ type: "status", message: "Generating images…" })),
                  );
                  const imgResult = await resolvePetalImagePlaceholders(nextFiles);
                  nextFiles = imgResult.files;
                  if (imgResult.resolved > 0) {
                    controller.enqueue(
                      encoder.encode(
                        sse({
                          type: "status",
                          message: `Generated ${imgResult.resolved} image${imgResult.resolved === 1 ? "" : "s"}.`,
                        }),
                      ),
                    );
                  }
                }
              } catch (e) {
                console.warn("[petal-image] resolver failed", e);
              }

              // Charge ONCE, after the build succeeds. Cost is computed from
              // actual token usage. If the wallet emptied during the build,
              // we still deliver the result (the user already received it)
              // and log a warning — we don't claw back work the user has.
              const priced = priceBuild(collected.usage);
              let finalCharged = 0;
              const charge = await spendCredit({
                userId,
                amount: priced.amount,
                reason: "ai_build_charge",
                projectId: body.projectId ?? null,
                metadata: {
                  route: "/api/generate",
                  prompt_tokens: priced.promptTokens,
                  completion_tokens: priced.completionTokens,
                  usage_missing: priced.usageMissing,
                  clamped: priced.clamped,
                  model,
                },
              });
              if (charge.ok) {
                finalCharged = priced.amount;
              } else {
                console.warn("[credits] post-build charge failed", charge);
              }

              controller.enqueue(
                encoder.encode(
                  sse({ type: "result", files: nextFiles, summary, creditsCharged: finalCharged }),
                ),
              );
            } catch (e) {
              const message = e instanceof Error ? e.message : "Generation failed.";
              // No credits were taken — nothing to refund. Just surface the error.
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
