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
import {
  loadInstalledCodes,
  renderSuggestionsBlock,
  suggestIntegrations,
} from "@/server/integrations/auto-suggest.server";
import { validateStylesCss } from "@/server/validate-styles.server";
import { resolvePetalImagePlaceholders } from "@/server/image-generation.server";
import { spendCredit, checkCreditBalance } from "@/server/credits.server";
import { aiChatCompletions } from "@/server/ai-provider.server";
import { priceBuild, BUILD_FLOOR } from "@/server/credit-pricing.server";
import {
  loadProjectMemory,
  renderMemoryBlock,
  updateProjectMemory,
} from "@/server/project-memory.server";
import {
  pickDesignDirection,
  renderDesignDirectionBlock,
} from "@/server/design-director.server";
import { runSelfCheck, humanizeBuildError } from "@/server/self-recovery.server";
import { pickDynamicSnippets, renderCurrentDateBlock } from "@/server/dynamic-prompts.server";
import { autofixFiles } from "@/server/stream-autofixer";
import { runPostStreamAutofix } from "@/server/post-stream-autofix.server";
import { fallbackEstimate } from "@/server/preflight-estimate.server";
import { classifyPhase, modelTierForPhase, type Phase } from "@/server/phase-classifier.server";
// Tier 3 model verifier removed: it duplicated the deterministic local
// verifier and its recovery pass was unconditionally skipped by the
// Phase D one-round autofix cap, so it only added latency + tokens.
import { runLocalVerifyTier } from "@/server/pipeline/tier-local-verify";
import { runContinuationTier } from "@/server/pipeline/tier-continuation";
import { runEsbuildTier } from "@/server/pipeline/tier-esbuild";
import { runRenderRiskTier } from "@/server/pipeline/tier-render-risk";
import { runRlsSanityTier } from "@/server/pipeline/tier-rls-sanity";
import { TurnRecorder } from "@/server/pipeline-telemetry.server";
import { stripHallucinatedImports } from "@/server/strip-hallucinated-imports.server";
import { verifyFilesEsbuild } from "@/server/esbuild-verifier.server";
import {
  checkFileBudgets,
  enforceFileBudgets,
  buildHandoffPrompt,
  type FileBudgetIssue,
} from "@/server/file-budget.server";
import { pickBestModel } from "@/server/smart-router.server";
import { recordAiOutcome } from "@/server/ai-outcomes.server";

/** Smart routing presets, mirroring Base44's Automatic/Manual dropdown.
 *  - "fast"  : cheapest + quickest, good for trivial edits
 *  - "smart" : default — flash for small turns, pro for big refactors
 *  - "best"  : always use the strongest model
 *  - "deep"  : strongest model + extended reasoning ("think harder"). Slower
 *              and more expensive — for hard refactors / multi-file features.
 */
type ModelPreset = "fast" | "smart" | "best" | "deep";

type Body = {
  messages: ChatMessage[];
  currentFiles: ProjectFile[];
  model?: ModelPreset;
  customInstructions?: string;
  /** Required to look up the project's attached backend (BYO Supabase). */
  projectId?: string;
  /** When true, this run is a free internal auto-fix triggered by Petal
   *  itself after a failed build. Skip credit charging — the user did not
   *  ask for this turn, Petal is fixing its own mistake. */
  isAutoFix?: boolean;
};

const MODEL_FAST = "google/gemini-3-flash-preview";
const MODEL_BEST = "google/gemini-2.5-pro";
/** Escalation model used when the primary returned prose / no tool call.
 *  Different family from MODEL_BEST on purpose — retrying on the same model
 *  that just refused to call the tool reproduces the refusal (telemetry:
 *  Gemini 2.5 Pro is the model most prone to prose-only completions on
 *  long implement turns). GPT-5 has the strongest tool-call discipline. */
const MODEL_STRUCTURED_RETRY = "openai/gpt-5";
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
  if (preset === "deep") return MODEL_BEST;
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
  // Track which file paths we've already announced as "complete" so each
  // fires exactly once even though we re-scan the cumulative buffer.
  const completedPaths = new Set<string>();
  let completedCount = 0;

  // Matches a completed `"path": "<value>"` occurrence (handles escaped chars).
  const PATH_RE = /"path"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  // Matches a completed `"content": "<value>"` occurrence — the trailing
  // lookahead `[,}]` guarantees the JSON string actually closed (not just
  // a `\"` mid-stream). We pair each match with the most recent path that
  // precedes it in the buffer to know which file just finished streaming.
  const CONTENT_RE = /"content"\s*:\s*"((?:\\.|[^"\\])*)"(?=\s*[,}])/g;
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
          const pathMatches: { path: string; index: number }[] = [];
          let match: RegExpExecArray | null;
          while ((match = PATH_RE.exec(tool.args)) !== null) {
            pathMatches.push({ path: match[1], index: match.index });
          }
          const count = pathMatches.length;
          const latest = pathMatches[pathMatches.length - 1]?.path;
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

          // Emit `file_complete` for each file whose `"content": "…"` string
          // has fully closed in the buffer. This is the v0-style perceived
          // latency win: the client can flip a file's status to "done" the
          // instant it finishes streaming, instead of waiting for the whole
          // tool call to land. Pair each closed content with the most recent
          // path declared before it.
          CONTENT_RE.lastIndex = 0;
          let cm: RegExpExecArray | null;
          while ((cm = CONTENT_RE.exec(tool.args)) !== null) {
            const contentEnd = cm.index;
            const contentBytes = cm[1].length;
            // Find the closest preceding path.
            let owner: string | undefined;
            for (let i = pathMatches.length - 1; i >= 0; i--) {
              if (pathMatches[i].index < contentEnd) {
                owner = pathMatches[i].path;
                break;
              }
            }
            if (!owner || completedPaths.has(owner)) continue;
            completedPaths.add(owner);
            completedCount += 1;
            controller.enqueue(
              encoder.encode(
                sse({
                  type: "file_complete",
                  path: owner,
                  bytes: contentBytes,
                  index: completedCount,
                }),
              ),
            );
          }
        }
      }
    }
  }
  return tool;
}

type ParsedProjectPayload = {
  parsed: {
    plan?: string;
    summary?: string;
    recap?: string;
    files?: ProjectFile[];
    ops?: FileOp[];
  };
  summary: string;
  plan?: string;
  recap?: string;
};

function parseCollectedProject(collected: ParsedTool, isInitial: boolean): ParsedProjectPayload {
  if (!collected.name || !collected.args) {
    throw new Error("AI did not return a project. Try rephrasing.");
  }
  if (collected.name === "write_project" && !isInitial) {
    throw new Error("AI tried to rewrite the whole project. Edits must be incremental patches.");
  }
  if (collected.name === "patch_files" && isInitial) {
    throw new Error("AI tried to patch an empty project. Initial generation must create files.");
  }

  let parsed: ParsedProjectPayload["parsed"];
  try {
    parsed = JSON.parse(collected.args) as ParsedProjectPayload["parsed"];
  } catch (e) {
    console.error("Failed to parse tool args", e, collected.args.slice(0, 500));
    throw new Error("AI returned invalid project data.");
  }

  if (collected.name === "write_project" && !parsed.files?.length) {
    throw new Error("AI returned no files.");
  }
  if (collected.name === "patch_files" && !Array.isArray(parsed.ops)) {
    throw new Error("AI returned no ops.");
  }

  return {
    parsed,
    summary: parsed.summary?.trim() || "Updated the project.",
    plan: parsed.plan?.trim() || undefined,
    recap: parsed.recap?.trim() || undefined,
  };
}

function addStructuredRetryInstruction<T extends Array<{ role: string; content: unknown }>>(
  messages: T,
  args: { isInitial: boolean; problem: string },
): T {
  const requiredTool = args.isInitial ? "write_project" : "patch_files";
  const retryBlock = `\n\nSTRUCTURED RETRY — your previous response could not be applied (${args.problem}). Retry now with a smaller, safer ${requiredTool} tool call. You MUST call ${requiredTool}; return complete JSON tool arguments only; include every required field; keep files short and split large UI into components.`;
  return messages.map((m, i) =>
    i === 0 && typeof m.content === "string"
      ? { ...m, content: `${m.content}${retryBlock}` }
      : m,
  ) as T;
}

async function runFinalParseGuard(
  files: ProjectFile[],
  changedPaths: string[],
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
): Promise<ProjectFile[]> {
  const finalVerdict = await verifyFilesEsbuild(files, changedPaths);
  if (finalVerdict.ok) return files;

  console.warn(
    `[final-parse-guard] ${finalVerdict.issues.length} issue(s) after autofix:`,
    finalVerdict.issues.map((i) => `${i.path}:${i.line}:${i.column} ${i.message}`).join("; "),
  );
  controller.enqueue(
    encoder.encode(sse({ type: "status", message: "Repairing one last syntax issue…" })),
  );

  const fixOut = await runPostStreamAutofix(
    files,
    finalVerdict.issues.map((i) => ({
      path: i.path,
      kind: "parse",
      detail: `${i.message} (line ${i.line}:${i.column})`,
    })),
  );
  const repaired = fixOut.files;
  const repairedVerdict = await verifyFilesEsbuild(repaired, changedPaths);
  if (!repairedVerdict.ok) {
    const detail = repairedVerdict.issues
      .slice(0, 3)
      .map((i) => `${i.path}:${i.line}:${i.column} ${i.message}`)
      .join("; ");
    throw new Error(`Final syntax check failed after repair: ${detail}`);
  }
  return repaired;
}

async function handleGenerateRequest(request: Request): Promise<Response> {
  const authResult = await authorize(request);
  if (authResult instanceof Response) return authResult;
  const userId = authResult;

        // Provider key check is handled inside aiChatCompletions; we only verify
        // here so we can surface the existing friendly 500 if no provider is set.
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

        // Auto-suggest: when the user asks for a capability we already have a
        // marketplace integration for (and it isn't installed yet), inject a
        // short prompt block so Petal recommends installing it instead of
        // hand-rolling the SDK.
        const installedCodes = body.projectId
          ? await loadInstalledCodes(body.projectId)
          : new Set<string>();
        const integrationSuggestions = suggestIntegrations({
          messages: body.messages ?? [],
          installedCodes,
        });
        const suggestionsBlock = renderSuggestionsBlock(integrationSuggestions);

        // Project Knowledge: small piece of context the owner attached to the
        // project ("always use a pastel palette", etc.). Prepended on every turn.
        const knowledge = (body.customInstructions ?? "").trim().slice(0, 4000);
        const knowledgeBlock = knowledge
          ? `\n\nProject Knowledge — the owner has asked you to always honor these instructions:\n"""\n${knowledge}\n"""\n`
          : "";

        // Project Memory — durable facts learned across previous turns. Loaded
        // with the user's JWT so RLS enforces ownership. Empty when there's
        // no memory yet, so new projects pay no prompt-size cost.
        const reqAuth = request.headers.get("authorization");
        const userJwt = reqAuth?.startsWith("Bearer ")
          ? reqAuth.slice("Bearer ".length)
          : "";
        const memoryEntries =
          body.projectId && userJwt
            ? await loadProjectMemory(userJwt, body.projectId)
            : [];
        const memoryBlock = renderMemoryBlock(memoryEntries);

        // Layer 4 — Design Director Pass.
        // On the very first build, pick a bold visual direction up-front so
        // the model doesn't fall back to the generic AI aesthetic. On
        // subsequent turns, the cached direction in project_memory is
        // honored automatically (pickDesignDirection short-circuits to it).
        // Patches skip the call entirely — the existing aesthetic wins.
        const lastUserContent = (() => {
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === "user") {
              const c = messages[i].content;
              return typeof c === "string" ? c : "";
            }
          }
          return "";
        })();
        const designDirection =
          isInitial && userJwt
            ? await pickDesignDirection({
                jwt: userJwt,
                projectId: body.projectId,
                brief: lastUserContent,
                memoryEntries,
              })
            : null;
        const designBlock = designDirection
          ? renderDesignDirectionBlock(designDirection)
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

        // Tier 2 — dynamic system-prompt snippets. Append reinforcement
        // blocks for topics the user mentioned (charts, forms, auth, etc.)
        // — raises success rate without bloating every prompt.
        const dynamic = pickDynamicSnippets({
          messages,
          hasBackend: Boolean(backend),
        });

        const dateBlock = renderCurrentDateBlock();

        const chatMessages = [
          { role: "system", content: baseSystem + dateBlock + backendBlock + integrationsBlock + suggestionsBlock + knowledgeBlock + memoryBlock + designBlock + dynamic.text + visionAddendum + filesContext },
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

        // Tier 3 — phase classifier. Tags the turn (implement/debug/refactor/
        // plan/docs) so we can route mechanical work to a cheap model and
        // hard reasoning to the strong one. Regex-only when unambiguous;
        // sub-50ms AI fallback otherwise.
        const phaseTag = await classifyPhase(lastUserContent);
        const tier = modelTierForPhase(phaseTag.phase);

        // Smart model routing (Phase 4). Default to "smart". Vision turns
        // ALWAYS go to a vision-capable model regardless of preset.
        const preset: ModelPreset = body.model ?? "smart";
        const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
        let model: string;
        let chosenBy: string = "preset";
        if (hasVisionTurn) {
          model = MODEL_VISION;
          chosenBy = "vision_pin";
        } else if (preset === "smart") {
          // Phase tag overrides the keyword heuristic in smart mode.
          const phaseDefault = tier === "smart" ? MODEL_BEST : MODEL_FAST;
          chosenBy = "phase_router";
          // Tier 4 — telemetry-driven router. Picks the historically
          // best-performing model from the candidate set for this
          // (feature, phase). Falls back to the phase default when
          // disabled or when no candidate has enough samples yet.
          try {
            const pick = await pickBestModel({
              feature: "generate",
              phase: phaseTag.phase,
              candidates: [MODEL_FAST, MODEL_BEST],
              defaultModel: phaseDefault,
            });
            model = pick.model;
            // Make telemetry honest: distinguish "smart router actively
            // chose this" from "smart router had no data and fell back to
            // the phase default".
            if (pick.reason === "best_score" || pick.reason === "exploration") {
              chosenBy = `smart_router:${pick.reason}`;
            } else if (pick.reason === "no_data") {
              chosenBy = "phase_router:no_router_data";
            }
            if (pick.stat) {
              console.log(
                `[smart-router] reason=${pick.reason} model=${pick.model} score=${pick.stat.score.toFixed(4)} succ=${(pick.stat.successRate * 100).toFixed(1)}% calls=${pick.stat.calls}`,
              );
            } else {
              console.log(`[smart-router] reason=${pick.reason} model=${pick.model} (no stat)`);
            }
          } catch (e) {
            console.warn("[smart-router] pick failed:", e);
            model = phaseDefault;
          }
        } else {
          model = resolveModel(preset, lastUser, currentFiles.length);
          if (preset === "deep") chosenBy = "deep_think";
        }
        console.log(
          `[phase-router] phase=${phaseTag.phase} (${phaseTag.confidence}/${phaseTag.source}) tier=${tier} chosenBy=${chosenBy} → ${model}`,
        );

        // "deep" preset enables extended reasoning on the gateway. Models
        // that don't support `reasoning` simply ignore the field, so this
        // is safe to send unconditionally for deep turns.
        const reasoningField =
          preset === "deep" ? { reasoning: { effort: "high" as const } } : {};

        const upstream = await aiChatCompletions({
          feature: "generate",
          body: {
            model,
            messages: chatMessages,
            tools: [tool],
            tool_choice: { type: "function", function: { name: tool.function.name } },
            stream: true,
            ...reasoningField,
          },
          meta: {
            phase: phaseTag.phase,
            promptChars: lastUserContent.length,
            hadAttachments: hasVisionTurn,
            chosenBy,
          },
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
            // Phase 6 — per-tier telemetry. One row per tier per turn,
            // flushed at end-of-turn (success OR failure path) in a single
            // insert. Fire-and-forget; never blocks or throws.
            const recorder = new TurnRecorder({
              turnId: crypto.randomUUID(),
              projectId: body.projectId ?? null,
              messageId: null,
              model,
            });
            try {
              controller.enqueue(encoder.encode(sse({ type: "phase", phase: "thinking" })));
              controller.enqueue(encoder.encode(sse({ type: "status", message: "Thinking…" })));
              if (designDirection) {
                controller.enqueue(
                  encoder.encode(
                    sse({
                      type: "design_vibe",
                      vibe: designDirection.vibe,
                      rationale: designDirection.rationale,
                    }),
                  ),
                );
                controller.enqueue(
                  encoder.encode(
                    sse({
                      type: "status",
                      message: `Design direction: ${designDirection.vibe} — ${designDirection.rationale}`,
                    }),
                  ),
                );
              }
              let collected = await relayAndCollect(upstream, controller, encoder);
              controller.enqueue(encoder.encode(sse({ type: "phase", phase: "polishing" })));
              controller.enqueue(
                encoder.encode(sse({ type: "status", message: "Applying changes…" })),
              );

              let payload: ParsedProjectPayload;
              try {
                payload = parseCollectedProject(collected, isInitial);
              } catch (e) {
                controller.enqueue(
                  encoder.encode(sse({ type: "status", message: "Retrying the response safely…" })),
                );
                const retry = await aiChatCompletions({
                  feature: "generate",
                  body: {
                    model: MODEL_STRUCTURED_RETRY,
                    messages: addStructuredRetryInstruction(chatMessages, {
                      isInitial,
                      problem: e instanceof Error ? e.message : "invalid structured response",
                    }),
                    tools: [tool],
                    tool_choice: { type: "function", function: { name: tool.function.name } },
                    stream: true,
                  },
                  meta: {
                    phase: phaseTag.phase,
                    promptChars: lastUserContent.length,
                    hadAttachments: hasVisionTurn,
                    chosenBy: "structured_retry",
                  },
                });
                if (!retry.ok || !retry.body) throw e;
                collected = await relayAndCollect(retry, controller, encoder);
                payload = parseCollectedProject(collected, isInitial);
              }

              const { parsed, summary, plan, recap } = payload;
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

              // Tier 2.4 — server-side file budget gate. Reject any file
              // that blew past the hard ceiling (> 280 lines or > 10 KB)
              // and revert it to its prior content. Files in the soft band
              // (181-280 lines) get warned and flow into the autofix issue
              // list as `oversize` so the polish pass tries a split.
              //
              // This is the CAUSAL fix for stream truncation: the model
              // can't ship a 400-line file by accident any more.
              const priorByPathBudget = new Map(currentFiles.map((f) => [f.path, f.content]));
              const budgetChangedPaths = nextFiles
                .filter((f) => priorByPathBudget.get(f.path) !== f.content)
                .map((f) => f.path);
              const budgetVerdict = checkFileBudgets(nextFiles, budgetChangedPaths);
              const budgetRejections: FileBudgetIssue[] = budgetVerdict.rejections;
              if (budgetRejections.length > 0) {
                console.warn(
                  `[file-budget] reverting ${budgetRejections.length} oversize file(s):`,
                  budgetRejections
                    .map((r) => `${r.path} (${r.lines}L/${(r.bytes / 1024).toFixed(1)}KB)`)
                    .join(", "),
                );
                nextFiles = enforceFileBudgets(nextFiles, currentFiles, budgetRejections);
              }
              const budgetWarnings = budgetVerdict.warnings;
              if (budgetWarnings.length > 0) {
                console.log(
                  `[file-budget] ${budgetWarnings.length} oversize warning(s):`,
                  budgetWarnings.map((w) => `${w.path} (${w.lines}L)`).join(", "),
                );
              }
              const budgetIssueCount = budgetRejections.length + budgetWarnings.length;
              recorder.record({
                tier: "file_budget",
                outcome:
                  budgetRejections.length > 0
                    ? "failed"
                    : budgetWarnings.length > 0
                      ? "fixed"
                      : "ok",
                duration_ms: 0,
                issue_count: budgetIssueCount,
                details: {
                  rejections: budgetRejections.length,
                  warnings: budgetWarnings.length,
                  changed_paths: budgetChangedPaths.length,
                },
              });
              controller.enqueue(
                encoder.encode(
                  sse({
                    type: "timeline",
                    step: "file_budget",
                    outcome:
                      budgetRejections.length > 0
                        ? "failed"
                        : budgetWarnings.length > 0
                          ? "fixed"
                          : "ok",
                    message:
                      budgetRejections.length > 0
                        ? `Reverted ${budgetRejections.length} oversized file${budgetRejections.length === 1 ? "" : "s"} — continuing in next message`
                        : budgetWarnings.length > 0
                          ? `Flagged ${budgetWarnings.length} large file${budgetWarnings.length === 1 ? "" : "s"} — repairing`
                          : `All ${budgetChangedPaths.length} file${budgetChangedPaths.length === 1 ? "" : "s"} within size budget`,
                    count: budgetIssueCount,
                    ts: Date.now(),
                  }),
                ),
              );

              // Track Layer-B handoff triggers as the pipeline runs. Emitted
              // as a single `continuation_handoff` event right before `result`.
              let handoffReason:
                | "oversize_files"
                | "incomplete_turn"
                | "large_changeset"
                | "unrecoverable_turn"
                | null = budgetRejections.length > 0 ? "oversize_files" : null;
              // Detected detail attached to the handoff event so the chip can
              // tell the user *what* tripped the stop (hallucinated packages,
              // truncated files). Populated as the relevant tiers run.
              const handoffDetected: {
                hallucinatedPackages?: string[];
                truncatedPaths?: string[];
              } = {};
              // Heuristic: an unusually large changeset is itself a truncation
              // risk. Encourage stopping at a clean boundary even when nothing
              // technically failed.
              if (!handoffReason && budgetChangedPaths.length >= 8) {
                handoffReason = "large_changeset";
              }

              // Tier 2 — stream-time autofixer (regex pass, <10ms total).
              // Repairs known footguns BEFORE the build/image steps run.
              const autofixT0 = Date.now();
              const autofixOut = autofixFiles(nextFiles);
              nextFiles = autofixOut.files;
              if (autofixOut.report.fixedCount > 0) {
                console.log(
                  `[autofix] ${autofixOut.report.fixedCount} fix(es):`,
                  autofixOut.report.notes.join("; "),
                );
                controller.enqueue(
                  encoder.encode(
                    sse({
                      type: "status",
                      message: `Auto-corrected ${autofixOut.report.fixedCount} small issue${autofixOut.report.fixedCount === 1 ? "" : "s"}.`,
                    }),
                  ),
                );
              }
              recorder.record({
                tier: "stream_autofix",
                outcome: autofixOut.report.fixedCount > 0 ? "fixed" : "ok",
                duration_ms: Date.now() - autofixT0,
                issue_count: autofixOut.report.fixedCount,
                details: { notes: autofixOut.report.notes.slice(0, 8) },
              });
              controller.enqueue(
                encoder.encode(
                  sse({
                    type: "timeline",
                    step: "stream_autofix",
                    outcome: autofixOut.report.fixedCount > 0 ? "fixed" : "ok",
                    message:
                      autofixOut.report.fixedCount > 0
                        ? `Auto-corrected ${autofixOut.report.fixedCount} small issue${autofixOut.report.fixedCount === 1 ? "" : "s"}`
                        : "Quick safety scan — clean",
                    count: autofixOut.report.fixedCount,
                    ts: Date.now(),
                  }),
                ),
              );

              // Tier 2.5 + 2.45 — local verifier and npm pre-flight
              // (extracted to src/server/pipeline/tier-local-verify.ts).
              const localT0 = Date.now();
              const localOut = await runLocalVerifyTier({
                nextFiles,
                currentFiles,
                toolName: collected.name,
                parsedOps: parsed.ops,
              });
              const localVerdict = localOut.verdict;
              const earlyChangedPaths = localOut.earlyChangedPaths;
              for (const ev of localOut.emit) {
                controller.enqueue(encoder.encode(sse(ev)));
              }
              recorder.record({
                tier: "local_verify",
                outcome: localVerdict.ok ? "ok" : "failed",
                duration_ms: Date.now() - localT0,
                issue_count: localVerdict.issues.length,
                details: {
                  preflight_dropped: localOut.preflightDropped,
                  preflight_hallucinated: localOut.preflightHallucinated,
                  changed_paths: earlyChangedPaths.length,
                  issue_kinds: localVerdict.issues.reduce<Record<string, number>>(
                    (acc, i) => ((acc[i.kind] = (acc[i.kind] ?? 0) + 1), acc),
                    {},
                  ),
                },
              });

              // Tier 2.46 — deterministic strip of npm-confirmed-hallucinated
              // imports. We do this BEFORE continuation/esbuild so the parse
              // tier doesn't trip on identifiers that point at packages the
              // installer can never resolve. The replaced code is ugly on
              // purpose; the Continue-building chip nudges the user to ask
              // Petal to reimplement those sections cleanly.
              if (localOut.preflightHallucinated.length > 0) {
                handoffDetected.hallucinatedPackages = [
                  ...localOut.preflightHallucinated,
                ];
                const stripT0 = Date.now();
                const stripOut = stripHallucinatedImports(
                  nextFiles,
                  localOut.preflightHallucinated,
                  earlyChangedPaths,
                );
                recorder.record({
                  tier: "hallu_strip",
                  outcome: stripOut.filesChanged > 0 ? "fixed" : "skipped",
                  duration_ms: Date.now() - stripT0,
                  issue_count: stripOut.importsRemoved,
                  details: {
                    files_changed: stripOut.filesChanged,
                    hallucinated: localOut.preflightHallucinated,
                  },
                });
                if (stripOut.filesChanged > 0) {
                  nextFiles = stripOut.files;
                  console.log(
                    `[hallu-strip] ${stripOut.filesChanged} file(s), ${stripOut.importsRemoved} import(s):`,
                    stripOut.notes.join("; "),
                  );
                  controller.enqueue(
                    encoder.encode(
                      sse({
                        type: "status",
                        message: `Removed ${stripOut.importsRemoved} unknown package import${stripOut.importsRemoved === 1 ? "" : "s"} so the build can ship.`,
                      }),
                    ),
                  );
                }
                // Hallucinations are unrecoverable for THIS turn — even after
                // stripping, the user needs to reimplement those sections.
                // Surface the handoff so they get a clear next step.
                if (!handoffReason || handoffReason === "large_changeset") {
                  handoffReason = "unrecoverable_turn";
                }
              }

              // Tier 2.6 — TRUE truncation recovery. If the local verifier
              // flagged any file as truncated mid-stream, ask the SAME model
              // to emit only the missing tail bytes.
              // (extracted to src/server/pipeline/tier-continuation.ts).
              const contT0 = Date.now();
              const contOut = await runContinuationTier({
                files: nextFiles,
                verdict: localVerdict,
                model,
              });
              nextFiles = contOut.files;
              if (contOut.requestHandoff) {
                // Capture which files we couldn't recover for the chip.
                const truncated = Array.from(
                  new Set(
                    localVerdict.issues
                      .filter((i) =>
                        ["truncation", "unterminated-string", "braces"].includes(i.kind),
                      )
                      .map((i) => i.path),
                  ),
                );
                if (truncated.length) handoffDetected.truncatedPaths = truncated;
                if (!handoffReason) {
                  handoffReason = handoffDetected.hallucinatedPackages?.length
                    ? "unrecoverable_turn"
                    : "incomplete_turn";
                } else if (
                  handoffReason === "large_changeset" &&
                  handoffDetected.hallucinatedPackages?.length
                ) {
                  handoffReason = "unrecoverable_turn";
                }
              }
              for (const ev of contOut.emit) {
                controller.enqueue(encoder.encode(sse(ev)));
              }
              recorder.record({
                tier: "continuation",
                outcome: contOut.requestHandoff
                  ? "failed"
                  : contOut.files !== nextFiles
                    ? "fixed"
                    : "skipped",
                duration_ms: Date.now() - contT0,
                issue_count: contOut.requestHandoff ? 1 : 0,
                details: { handoff_requested: contOut.requestHandoff },
              });

              // Tier 2.7 — esbuild parse pass
              // (extracted to src/server/pipeline/tier-esbuild.ts).
              const esbuildT0 = Date.now();
              const esbuildOut = await runEsbuildTier({
                files: nextFiles,
                earlyChangedPaths,
              });
              const esbuildVerdict = esbuildOut.verdict;
              for (const ev of esbuildOut.emit) {
                controller.enqueue(encoder.encode(sse(ev)));
              }
              recorder.record({
                tier: "esbuild",
                outcome: esbuildVerdict.ok ? "ok" : "failed",
                duration_ms: Date.now() - esbuildT0,
                issue_count: esbuildVerdict.issues.length,
                details: {
                  parse_errors: esbuildVerdict.issues.slice(0, 5).map((i) => ({
                    path: i.path,
                    line: i.line,
                  })),
                },
              });

              // Tier 2.8 — render-risk linter (Phase 5).
              // Soft-warn only: feeds findings into combinedAutofixIssues so
              // the post-stream autofix model fixes them when the gate is
              // already open for other reasons. Does NOT independently open
              // the gate — false positives must never wedge a clean turn.
              const renderRiskT0 = Date.now();
              const renderRiskOut = runRenderRiskTier({
                files: nextFiles,
                earlyChangedPaths,
              });
              const renderRiskIssues = renderRiskOut.issues;
              for (const ev of renderRiskOut.emit) {
                controller.enqueue(encoder.encode(sse(ev)));
              }
              recorder.record({
                tier: "render_risk",
                outcome: renderRiskIssues.length > 0 ? "warned" : "ok",
                duration_ms: Date.now() - renderRiskT0,
                issue_count: renderRiskIssues.length,
                details: {
                  rule_kinds: renderRiskIssues.reduce<Record<string, number>>(
                    (acc, i) => ((acc[i.kind] = (acc[i.kind] ?? 0) + 1), acc),
                    {},
                  ),
                },
              });

              // Tier 2.9 — RLS sanity linter (Phase 5b).
              // Soft-warn only: cross-references supabase.from() calls in
              // changed code against migrations to catch missing tables,
              // missing RLS, or missing policies. Feeds into the autofix
              // queue but never independently opens the gate — false
              // positives must never wedge a clean turn.
              const rlsSanityT0 = Date.now();
              const rlsSanityOut = runRlsSanityTier({
                files: nextFiles,
                earlyChangedPaths,
              });
              const rlsSanityIssues = rlsSanityOut.issues;
              for (const ev of rlsSanityOut.emit) {
                controller.enqueue(encoder.encode(sse(ev)));
              }
              recorder.record({
                tier: "rls_sanity",
                outcome: rlsSanityIssues.length > 0 ? "warned" : "ok",
                duration_ms: Date.now() - rlsSanityT0,
                issue_count: rlsSanityIssues.length,
                details: {
                  rule_kinds: rlsSanityIssues.reduce<Record<string, number>>(
                    (acc, i) => ((acc[i.kind] = (acc[i.kind] ?? 0) + 1), acc),
                    {},
                  ),
                },
              });

              // Tier 2 — post-stream autofix model. Tiny gemini-flash-lite
              // pass that ONLY fixes obvious build-breakers.
              //
              // Tightened gate (post-audit): we only spend a model call when
              // the deterministic local verifier flagged something OR the
              // regex autofixer caught ≥2 things. The old "any 6+ file turn
              // or any feature/refactor" trigger fired on ~half of turns and
              // returned an empty fix list almost every time — pure latency
              // tax. Local verifier is the source of truth.
              //
              // The legacy Tier 3 model verifier was removed: it duplicated
              // the local verifier's checks and its recovery pass was always
              // skipped by the Phase D one-round cap. One autofix call max
              // per turn is now structural, not just runtime-enforced.
              const autofixGateOpen =
                !localVerdict.ok ||
                !esbuildVerdict.ok ||
                budgetWarnings.length > 0 ||
                autofixOut.report.fixedCount >= 2;
              const combinedAutofixIssues = [
                ...localVerdict.issues,
                ...esbuildVerdict.issues.map((i) => ({
                  path: i.path,
                  kind: "parse" as const,
                  detail: `${i.message} (line ${i.line}:${i.column})`,
                })),
                ...budgetWarnings.map((w) => ({
                  path: w.path,
                  kind: "oversize" as const,
                  detail: w.detail,
                })),
                // Render-risk + RLS-sanity issues come along for the ride
                // when the gate is already open; they don't open it on
                // their own.
                ...renderRiskIssues,
                ...rlsSanityIssues,
              ];
              if (autofixGateOpen) {
                const fixT0 = Date.now();
                try {
                  const fixOut = await runPostStreamAutofix(nextFiles, combinedAutofixIssues);
                  nextFiles = fixOut.files;
                  if (fixOut.result.fixedFiles > 0) {
                    console.log(
                      `[post-stream-autofix] fixed ${fixOut.result.fixedFiles}:`,
                      fixOut.result.notes.join("; "),
                    );
                    controller.enqueue(
                      encoder.encode(
                        sse({
                          type: "status",
                          message: `Polished ${fixOut.result.fixedFiles} file${fixOut.result.fixedFiles === 1 ? "" : "s"} for safety.`,
                        }),
                      ),
                    );
                  }
                  recorder.record({
                    tier: "post_stream_autofix",
                    outcome: fixOut.result.fixedFiles > 0 ? "fixed" : "ok",
                    duration_ms: Date.now() - fixT0,
                    issue_count: fixOut.result.fixedFiles,
                    details: { gate_open: true, input_issues: combinedAutofixIssues.length },
                  });
                  controller.enqueue(
                    encoder.encode(
                      sse({
                        type: "timeline",
                        step: "post_stream_autofix",
                        outcome: fixOut.result.fixedFiles > 0 ? "fixed" : "ok",
                        message:
                          fixOut.result.fixedFiles > 0
                            ? `Repaired ${fixOut.result.fixedFiles} file${fixOut.result.fixedFiles === 1 ? "" : "s"}`
                            : "Autofix pass — nothing to repair",
                        count: fixOut.result.fixedFiles,
                        ts: Date.now(),
                      }),
                    ),
                  );
                } catch (e) {
                  console.warn("[post-stream-autofix] rejected:", e);
                  recorder.record({
                    tier: "post_stream_autofix",
                    outcome: "failed",
                    duration_ms: Date.now() - fixT0,
                    issue_count: 0,
                    details: {
                      gate_open: true,
                      error: e instanceof Error ? e.message : String(e),
                    },
                  });
                  controller.enqueue(
                    encoder.encode(
                      sse({
                        type: "timeline",
                        step: "post_stream_autofix",
                        outcome: "failed",
                        message: "Autofix pass errored — continuing with current files",
                        ts: Date.now(),
                      }),
                    ),
                  );
                }
              } else {
                recorder.record({
                  tier: "post_stream_autofix",
                  outcome: "skipped",
                  duration_ms: 0,
                  issue_count: 0,
                  details: { gate_open: false },
                });
                controller.enqueue(
                  encoder.encode(
                    sse({
                      type: "timeline",
                      step: "post_stream_autofix",
                      outcome: "skipped",
                      message: "Autofix skipped — files look healthy",
                      ts: Date.now(),
                    }),
                  ),
                );
              }

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
                  controller.enqueue(
                    encoder.encode(
                      sse({
                        type: "timeline",
                        step: "image_resolve",
                        outcome: imgResult.resolved > 0 ? "fixed" : "ok",
                        message:
                          imgResult.resolved > 0
                            ? `Generated ${imgResult.resolved} image${imgResult.resolved === 1 ? "" : "s"}`
                            : "Image placeholders resolved",
                        count: imgResult.resolved,
                        ts: Date.now(),
                      }),
                    ),
                  );
                }
              } catch (e) {
                console.warn("[petal-image] resolver failed", e);
                controller.enqueue(
                  encoder.encode(
                    sse({
                      type: "timeline",
                      step: "image_resolve",
                      outcome: "failed",
                      message: "Image generation failed — using fallback images",
                      ts: Date.now(),
                    }),
                  ),
                );
              }

              nextFiles = await runFinalParseGuard(
                nextFiles,
                earlyChangedPaths,
                controller,
                encoder,
              );

              // Charge ONCE, after the build succeeds. Cost is computed from
              // the MAIN generate call's token usage only — `collected.usage`
              // covers the patch_files / write_project completion, not the
              // side calls (design-director, self-check, humanize-error).
              // Those run on Petal's tab so users never get surprise-charged
              // for our internal QA passes. Do NOT add their usage here.
              //
              // AUTO-FIX runs are also on Petal's tab — the user did not ask
              // for this turn, Petal is fixing its own broken build. We log
              // the would-be amount for analytics but never debit the user.
              const priced = priceBuild(collected.usage);
              let finalCharged = 0;
              if (body.isAutoFix) {
                console.log(
                  `[credits] auto-fix run — skipping charge of ${priced.amount} (would-be)`,
                );
              } else {
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
              }

              // Layer-B "Continue building" handoff. Emitted at most once
              // per turn, AFTER all repair tiers, BEFORE the result event so
              // the client can attach it to this assistant message.
              if (handoffReason) {
                const hasDetected =
                  (handoffDetected.hallucinatedPackages?.length ?? 0) > 0 ||
                  (handoffDetected.truncatedPaths?.length ?? 0) > 0;
                const { message: handoffMessage, suggestedPrompt } = buildHandoffPrompt(
                  handoffReason,
                  budgetRejections,
                  hasDetected ? handoffDetected : undefined,
                );
                controller.enqueue(
                  encoder.encode(
                    sse({
                      type: "continuation_handoff",
                      reason: handoffReason,
                      message: handoffMessage,
                      suggestedPrompt,
                      ...(hasDetected ? { detected: handoffDetected } : {}),
                    }),
                  ),
                );
              }

              controller.enqueue(
                encoder.encode(
                  sse({
                    type: "result",
                    files: nextFiles,
                    summary,
                    plan,
                    recap,
                    creditsCharged: finalCharged,
                  }),
                ),
              );

              // Phase B — record outcome telemetry. Pairs this generation
              // with its local-verifier verdict + autofix count so the smart
              // router can learn which models ship working code. Best-effort.
              void recordAiOutcome({
                feature: "generate",
                provider: "lovable",
                model,
                projectId: body.projectId ?? null,
                localVerifierPass: localVerdict.ok,
                localVerifierErrors: localVerdict.issues.map((i) => ({
                  path: i.path,
                  kind: i.kind,
                  detail: i.detail,
                })),
                autofixCount: autofixOut.report.fixedCount,
                buildStatus: "ready",
                filesWritten: nextFiles.length,
              });

              // Layer 5 — Self-check. Awaited (not fire-and-forget) so the
              // verdict reaches the client BEFORE the stream closes. Bounded
              // to a single fast model call; on any failure we emit nothing
              // and the user just sees their normal result.
              try {
                const verdict = await runSelfCheck({
                  brief: lastUserContent,
                  assistantSummary: summary,
                  filePaths: nextFiles.map((f) => f.path),
                });
                if (verdict) {
                  controller.enqueue(
                    encoder.encode(
                      sse({
                        type: "self_check",
                        score: verdict.score,
                        verdict: verdict.verdict,
                        gaps: verdict.gaps,
                        suggestions: verdict.suggestions,
                      }),
                    ),
                  );
                }
              } catch (e) {
                console.warn("[self-check] rejected:", e);
              }

              // Memory writer — fire-and-forget. Distills the user's latest
              // turn (+ Petal's summary) into durable facts saved to
              // project_memory. Failures are logged inside; never block the
              // user's reply or fail the build.
              if (body.projectId && userJwt) {
                void updateProjectMemory({
                  jwt: userJwt,
                  projectId: body.projectId,
                  userMessage: lastUserContent,
                  assistantSummary: summary,
                }).catch((e) => console.warn("[project-memory] writer rejected:", e));
              }
            } catch (e) {
              const raw = e instanceof Error ? e.message : "Generation failed.";
              // Layer 5 — humanize the raw error before showing it. No credits
              // were taken — nothing to refund. The friendly rewrite gives the
              // user a clear next step (retry, simplify, top up, …) instead
              // of a stack-trace-flavored sentence.
              const friendly = await humanizeBuildError({
                rawMessage: raw,
                brief: lastUserContent,
              });
              controller.enqueue(
                encoder.encode(
                  sse({
                    type: "error",
                    message: friendly.message,
                    suggestions: friendly.suggestions,
                  }),
                ),
              );

              // Phase B — record the failed outcome so the smart router
              // sees this model produced a broken build for this turn.
              void recordAiOutcome({
                feature: "generate",
                provider: "lovable",
                model: typeof model === "string" ? model : null,
                projectId: body.projectId ?? null,
                localVerifierPass: false,
                localVerifierErrors: [{ path: "<pipeline>", kind: "exception", detail: raw }],
                autofixCount: 0,
                buildStatus: "failed",
                filesWritten: 0,
              });
            } finally {
              // Phase 6 — flush per-tier telemetry in a single insert.
              // Idempotent and never throws; safe in finally.
              void recorder.flush();
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
}

export const Route = createFileRoute("/api/generate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await handleGenerateRequest(request);
        } catch (handlerErr) {
          // Catch-all so the worker NEVER returns an empty response (status 0
          // in CF logs, "Something went wrong" in the UI). Guards every awaited
          // setup step before the stream starts (auth lookup, project memory
          // load, design director, classifier, smart router, upstream fetch).
          console.error("[/api/generate] unhandled error", handlerErr);
          const message =
            handlerErr instanceof Error ? handlerErr.message : "Unexpected server error";
          return new Response(
            JSON.stringify({
              error:
                "Petal hit an unexpected error before starting your build. No credits were charged. Please try again.",
              detail: message,
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
