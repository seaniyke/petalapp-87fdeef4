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
import {
  aiChatCompletions,
  markLastCallFailure,
  updateLastCallUsage,
} from "@/server/ai-provider.server";
import { priceTurn, BUILD_FLOOR } from "@/server/credit-pricing.server";
import type { GatewayUsage } from "@/server/credit-pricing.server";
import {
  loadProjectMemory,
  renderMemoryBlock,
  updateProjectMemory,
} from "@/server/project-memory.server";
import { pickDesignDirection, renderDesignDirectionBlock } from "@/server/design-director.server";
import { runSelfCheck, humanizeBuildError, classifyRawError } from "@/server/self-recovery.server";
import { pickDynamicSnippets, renderCurrentDateBlock } from "@/server/dynamic-prompts.server";
import { renderPetalCapabilitiesBlock } from "@/server/petal-capabilities.server";
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
  type FileBudgetIssue,
} from "@/server/file-budget.server";
import { pickBestModel } from "@/server/smart-router.server";
import { recordAiOutcome } from "@/server/ai-outcomes.server";
import { applyContextBudget, type BudgetMessage } from "@/server/context-budget.server";
import { expandBriefIfVague } from "@/server/brief-expander.server";
import { loadLabsFlagsForRequest } from "@/server/labs-flags.server";
import { runStagedPipelineStream } from "@/server/pipeline/staged-orchestrator.server";
import { startTurn, type TurnRecorderHandle } from "@/server/turn-recorder.server";

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

const PATCH_CONTEXT_FILE_LIMIT = 24;
const PATCH_CONTEXT_CHAR_LIMIT = 70_000;
const LARGE_FILE_CONTEXT_CHAR_LIMIT = 10_000;
const RELEVANT_FILE_CONTEXT_CHAR_LIMIT = 18_000;

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

function completionBudget(args: { isInitial: boolean; phase: Phase; hasVisionTurn: boolean }): number {
  if (args.hasVisionTurn) return 8_000;
  if (args.isInitial) return 12_000;
  if (args.phase === "implement" || args.phase === "docs") return 7_000;
  return 6_500;
}

function latestUserMessage(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].content ?? "";
  }
  return "";
}

function trimMessagesForGeneration(messages: ChatMessage[]): ChatMessage[] {
  const lastUserIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return i;
    }
    return -1;
  })();
  if (lastUserIdx < 0) return messages.slice(-4);
  const latest = messages[lastUserIdx];
  const latestText = latestUserMessage([latest]).trim().toLowerCase();
  const needsPreviousContext =
    /^(yes|yeah|yep|ok|okay|sure|do it|go ahead|continue|proceed|that|this)$/i.test(latestText);
  if (!needsPreviousContext) return [latest];
  const previousContext = messages.slice(Math.max(0, lastUserIdx - 2), lastUserIdx);
  return [...previousContext, latest];
}

function trimFilesForPrompt(
  files: ProjectFile[],
  latestPrompt = "",
): { files: ProjectFile[]; omitted: number } {
  const terms = latestPrompt
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !/^(please|make|change|update|build|create|this|that|with|from|into|app)$/i.test(w))
    .slice(0, 18);
  const isPromptRelevant = (file: ProjectFile): boolean => {
    if (terms.length === 0) return false;
    const haystack = `${file.path}\n${file.content.slice(0, 24_000)}`.toLowerCase();
    return terms.some((term) => haystack.includes(term));
  };
  const rank = (path: string): number => {
    if (path === "src/App.tsx") return 0;
    if (path === "src/main.tsx") return 1;
    if (path === "src/styles.css") return 2;
    if (path.startsWith("src/pages/") || path.startsWith("src/routes/")) return 4;
    if (path.startsWith("src/components/")) return 5;
    if (path === "package.json" || path === "index.html") return 6;
    return 9;
  };
  const picked: ProjectFile[] = [];
  let used = 0;
  for (const file of [...files].sort(
    (a, b) =>
      (isPromptRelevant(a) ? 3 : rank(a.path)) - (isPromptRelevant(b) ? 3 : rank(b.path)) ||
      rank(a.path) - rank(b.path) ||
      a.path.localeCompare(b.path),
  )) {
    if (picked.length >= PATCH_CONTEXT_FILE_LIMIT) break;
    const limit = isPromptRelevant(file)
      ? RELEVANT_FILE_CONTEXT_CHAR_LIMIT
      : LARGE_FILE_CONTEXT_CHAR_LIMIT;
    const content =
      file.content.length > limit
        ? `${file.content.slice(0, limit)}\n\n/* ...trimmed for context budget... */`
        : file.content;
    const cost = file.path.length + content.length + 32;
    if (picked.length > 0 && used + cost > PATCH_CONTEXT_CHAR_LIMIT) continue;
    picked.push({ path: file.path, content });
    used += cost;
  }
  return { files: picked, omitted: Math.max(0, files.length - picked.length) };
}

function sse(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Parse a chunk of bytes from the inner SSE stream and forward each event
 * to a sink (typically: a turn recorder). Maintains a small buffer across
 * chunks because SSE events can be split across reads. Defensive: bad
 * lines are skipped, never thrown.
 */
function makeSseTap(onEvent: (type: string, payload: unknown) => void) {
  let buf = "";
  const decoder = new TextDecoder();
  return (chunk: Uint8Array) => {
    buf += decoder.decode(chunk, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const block of parts) {
      const line = block.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        const evt = JSON.parse(payload) as { type?: string } & Record<string, unknown>;
        if (typeof evt.type === "string") {
          const { type, ...rest } = evt;
          onEvent(type, rest);
        }
      } catch {
        /* skip malformed */
      }
    }
  };
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
  /** Provider stop reason from the final stream chunk, e.g. `length` / `max_tokens`. */
  finishReason: string | null;
  /** Token usage from the gateway (final SSE chunk usually carries it). */
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
};

function isTruncatedFinishReason(reason: string | null | undefined): boolean {
  return /^(length|max_tokens)$/i.test(reason ?? "");
}

/** Parse a streamed OpenAI-style SSE body, emit summary deltas as they arrive,
 *  accumulate the tool-call arguments string, and return the parsed final args
 *  along with any `usage` payload the gateway emitted. */
/**
 * Idle-timeout watchdog (ms). If the upstream stream stops producing bytes
 * for this long, we cancel the read and surface an upstream_timeout. This
 * is the real liveness check for streamed turns — wall-clock timeouts in
 * `aiChatCompletions` are just the last-resort safety net.
 */
const STREAM_IDLE_TIMEOUT_MS = 75_000;

async function relayAndCollect(
  upstream: Response,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
): Promise<ParsedTool> {
  const reader = upstream.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const tool: ParsedTool = { name: null, args: "", finishReason: null, usage: null };
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
  // Track which file paths have already had their NARRATION sentence
  // forwarded to the client. Each file emits its narration exactly once,
  // the moment the model finishes writing its `narration` string — which
  // we instruct the model to place BEFORE `content`, so users hear what
  // Petal is about to build *before* the file body streams.
  const narratedPaths = new Set<string>();

  // Matches a completed `"path": "<value>"` occurrence (handles escaped chars).
  const PATH_RE = /"path"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  // Matches a completed `"narration": "<value>"` occurrence — same closing
  // lookahead trick as content so we only fire when the string has closed.
  const NARRATION_RE = /"narration"\s*:\s*"((?:\\.|[^"\\])*)"(?=\s*[,}])/g;
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
    // Race the next chunk read against an idle-timeout. If the upstream
    // goes silent for STREAM_IDLE_TIMEOUT_MS the provider is wedged —
    // cancel the reader and throw a classifiable timeout. This replaces
    // the old behaviour of relying solely on the wall-clock ceiling,
    // which would also kill streams that were happily producing bytes.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const idle = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error("operation was aborted due to timeout (stream idle)"));
      }, STREAM_IDLE_TIMEOUT_MS);
    });
    let value: Uint8Array | undefined;
    let done = false;
    try {
      const result = await Promise.race([reader.read(), idle]);
      value = result.value;
      done = result.done;
    } catch (e) {
      try { await reader.cancel(); } catch { /* ignore */ }
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (done) break;
    buf += decoder.decode(value as Uint8Array, { stream: true });
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
      const topStopReason = (json as { stop_reason?: unknown; finish_reason?: unknown }).stop_reason ??
        (json as { finish_reason?: unknown }).finish_reason;
      if (typeof topStopReason === "string") tool.finishReason = topStopReason;
      const choice = (json as { choices?: Array<{ delta?: unknown; finish_reason?: unknown; stop_reason?: unknown }> })?.choices?.[0];
      const choiceFinishReason = choice?.finish_reason ?? choice?.stop_reason;
      if (typeof choiceFinishReason === "string") tool.finishReason = choiceFinishReason;
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

          // Emit one NARRATION event per file, the moment the model's
          // `narration` field for that file finishes streaming. We instruct
          // the model to place `narration` BEFORE `content`, so this event
          // typically fires *before* the file body even starts streaming —
          // giving the user a real, model-written sentence about what's
          // about to be built. Falls back gracefully when missing (the
          // client uses path-derived narration instead).
          NARRATION_RE.lastIndex = 0;
          let nm: RegExpExecArray | null;
          while ((nm = NARRATION_RE.exec(tool.args)) !== null) {
            const narrationEnd = nm.index;
            let text = nm[1];
            try { text = JSON.parse(`"${nm[1]}"`); } catch { /* keep raw */ }
            let owner: string | undefined;
            for (let i = pathMatches.length - 1; i >= 0; i--) {
              if (pathMatches[i].index < narrationEnd) {
                owner = pathMatches[i].path;
                break;
              }
            }
            if (!owner || narratedPaths.has(owner)) continue;
            const trimmed = String(text).trim().replace(/\s+/g, " ").slice(0, 120);
            if (!trimmed) continue;
            narratedPaths.add(owner);
            controller.enqueue(
              encoder.encode(sse({ type: "narration", path: owner, text: trimmed })),
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

/**
 * Emit a conversational AI reply WITHOUT failing the turn — used as the
 * deterministic fallback whenever generation can't safely produce edits.
 *
 * The user sees a normal Petal message with a friendly explanation and
 * suggested next step (NOT a red error card). No credits are charged
 * because no files were written / changed. Cleanly closes the SSE stream.
 *
 * Use this for:
 *   - patch_files emitted with empty ops (model said "nothing to change")
 *   - both stream + structured retry returned no usable edits
 *   - final-parse-guard couldn't repair after autofix
 *
 * Anything that's a genuine infra failure (upstream timeout, gateway 5xx,
 * provider auth) still throws and goes through the outer humanized error
 * path — those are real errors and the error card is appropriate there.
 */
function emitConversationalFallback(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  args: { summary: string; files: ProjectFile[] },
): void {
  controller.enqueue(
    encoder.encode(sse({ type: "summary_delta", delta: args.summary })),
  );
  controller.enqueue(
    encoder.encode(
      sse({
        type: "result",
        files: args.files,
        summary: args.summary,
        plan: undefined,
        recap: undefined,
        creditsCharged: 0,
      }),
    ),
  );
  controller.close();
}

function parseCollectedProject(collected: ParsedTool, isInitial: boolean): ParsedProjectPayload {
  if (isTruncatedFinishReason(collected.finishReason)) {
    throw new Error(
      `AI response was cut off before it finished (${collected.finishReason}). Retrying with a smaller structured response.`,
    );
  }
  if (!collected.name || !collected.args) {
    throw new Error(
      isInitial
        ? "AI did not return a project. Try rephrasing."
        : "AI did not return usable edits for this request.",
    );
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
    const looksCutOff = collected.args.length > 0 && !collected.args.trimEnd().endsWith("}");
    throw new Error(
      looksCutOff
        ? "AI response was cut off before the project JSON finished. Retrying with smaller files."
        : isInitial
          ? "AI returned invalid project data."
          : "AI returned invalid edit data.",
    );
  }

  if (collected.name === "write_project" && !parsed.files?.length) {
    throw new Error("AI returned no files.");
  }
  if (collected.name === "patch_files" && !Array.isArray(parsed.ops)) {
    throw new Error("AI returned no ops.");
  }

  // The model is instructed to include a `narration` string per file/op for
  // live UI commentary. We've already streamed those to the client during
  // relayAndCollect — strip them now so downstream code (writers, autofix,
  // verifier, persistence) sees the canonical FileOp / ProjectFile shape.
  if (parsed.files) {
    parsed.files = parsed.files.map((f) => ({ path: f.path, content: f.content }));
  }
  if (parsed.ops) {
    parsed.ops = parsed.ops.map((o) => {
      const { narration: _drop, ...rest } = o as FileOp & { narration?: string };
      return rest as FileOp;
    });
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
  args: { isInitial: boolean; problem: string; hasBackend?: boolean },
): T {
  const requiredTool = args.isInitial ? "write_project" : "patch_files";
  const backendHint =
    args.hasBackend === false
      ? ` This project has NO backend connected — DO NOT import from "@/integrations/backend/*" or "@supabase/supabase-js"; scaffold UI only with realistic placeholder data and tell the user in your "summary" to tap "Add backend" to wire it up.`
      : "";
  const retryBlock = `\n\nSTRUCTURED RETRY — your previous response could not be applied (${args.problem}). Retry now with a smaller, safer ${requiredTool} tool call. You MUST call ${requiredTool}; return complete JSON tool arguments only; include every required field. For edit turns, prefer exact \`replace\` ops for small changes instead of resending whole files. Keep files short and split large UI into components. If this is an initial app, build a focused MVP that works instead of a giant showcase: 4-8 app files max, no file over 140 lines, no long content blocks.${backendHint}`;
  return messages.map((m, i) =>
    i === 0 && typeof m.content === "string" ? { ...m, content: `${m.content}${retryBlock}` } : m,
  ) as T;
}

async function runFinalParseGuard(
  files: ProjectFile[],
  changedPaths: string[],
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
): Promise<{ ok: true; files: ProjectFile[] } | { ok: false; detail: string }> {
  const finalVerdict = await verifyFilesEsbuild(files, changedPaths);
  if (finalVerdict.ok) return { ok: true, files };

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
    // Don't throw — let the caller revert to the prior good files
    // and reply conversationally. A failed final-parse is NOT an
    // infra error; it just means this turn's edits weren't safe.
    return { ok: false, detail };
  }
  return { ok: true, files: repaired };
}

async function handleGenerateRequestCore(request: Request): Promise<Response> {
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
  const rawMessages = Array.isArray(body.messages) ? body.messages.slice(-20) : [];
  let messages = trimMessagesForGeneration(rawMessages);
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
  const lastContent = latestUserMessage(messages);
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
  const backend = body.projectId ? await lookupBackendForGenerate(body.projectId) : null;

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
    messages,
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
  const userJwt = reqAuth?.startsWith("Bearer ") ? reqAuth.slice("Bearer ".length) : "";
  const memoryEntries =
    body.projectId && userJwt ? await loadProjectMemory(userJwt, body.projectId) : [];
  const memoryBlock = renderMemoryBlock(memoryEntries);

  // Layer 4 — Design Director Pass.
  // On the very first build, pick a bold visual direction up-front so
  // the model doesn't fall back to the generic AI aesthetic. On
  // subsequent turns, the cached direction in project_memory is
  // honored automatically (pickDesignDirection short-circuits to it).
  // Patches skip the call entirely — the existing aesthetic wins.
  let lastUserContent = latestUserMessage(messages);

  // Brief expander — vague initial prompts ("surprise me", "build an app")
  // are the dominant cause of `no_files_emitted` failures: the main model
  // gets nothing concrete to scaffold and bails. We rewrite them into a
  // concrete brief BEFORE the main call, server-side, with a tiny cheap
  // model. Failure-tolerant: any error returns the original brief.
  if (isInitial) {
    const expansion = await expandBriefIfVague(lastUserContent);
    if (expansion.expanded) {
      lastUserContent = expansion.brief;
      // Replace the last user message in `messages` so the main model sees
      // the expanded brief, not the vague original.
      const lastIdx = (() => {
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === "user") return i;
        }
        return -1;
      })();
      if (lastIdx >= 0) {
        messages = messages.map((m, i) =>
          i === lastIdx ? { ...m, content: expansion.brief } : m,
        );
      }
    }
  }

  // Labs flags — loaded once per request so both the staged-pipeline
  // gate (initial only) and the agentic-loop gate (post-stream autofix)
  // see the same values without re-querying. Empty {} on failure.
  const labsFlags = await loadLabsFlagsForRequest(userJwt);

  // Staged pipeline (Labs). When the user has the staged_pipeline flag on,
  // initial builds run through Plan → parallel-Scaffold → Wire-up instead
  // of the monolithic write_project call. The orchestrator returns null
  // on any pre-stream failure so we can fall through to the existing
  // path with no behavior change for everyone else.
  if (isInitial && labsFlags.staged_pipeline) {
    const stagedResp = await runStagedPipelineStream({
      brief: lastUserContent,
      hasBackend: Boolean(backend),
    });
    if (stagedResp) return stagedResp;
    console.warn("[staged] orchestrator returned null — falling back to monolithic path");
  }
  const designDirection =
    isInitial && userJwt
      ? await pickDesignDirection({
          jwt: userJwt,
          projectId: body.projectId,
          brief: lastUserContent,
          memoryEntries,
        })
      : null;
  const designBlock = designDirection ? renderDesignDirectionBlock(designDirection) : "";

  // Filter out files Petal manages itself before showing the project
  // to the model. The AI never edits these (we drop ops that touch
  // them), but feeding them back as context bloats the prompt by
  // tens of KB on every patch turn — directly causing upstream
  // generation timeouts on projects that accumulated many scaffold +
  // example + backend files. We KEEP `package.json`, `index.html`,
  // `src/main.tsx`, `src/App.tsx`, and anything else app-specific.
  const isManagedScaffoldPath = (p: string): boolean =>
    p.startsWith("src/components/ui/") ||
    p.startsWith("src/components/examples/") ||
    p.startsWith("src/integrations/backend/") ||
    p === "vite.config.ts" ||
    p === "tsconfig.json" ||
    p === "src/lib/utils.ts" ||
    p === "petal-source-plugin.mjs";
  const editablePromptFiles = currentFiles.filter((f) => !isManagedScaffoldPath(f.path));
  const promptBudget = trimFilesForPrompt(editablePromptFiles, lastUserContent);
  const filesContext = isInitial
    ? ""
    : `\n\nCurrent project files (trimmed to the most relevant editable files; ${promptBudget.omitted} lower-priority files omitted for speed. Petal-managed UI kit, examples, and backend integration files are hidden — they exist in the project but you must never edit them):\n\n${promptBudget.files
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
  const hasVisionTurn = lastUserIdx >= 0 && (messages[lastUserIdx].attachments?.length ?? 0) > 0;

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
  const capabilitiesBlock = renderPetalCapabilitiesBlock({
    hasBackend: Boolean(backend),
  });

  const chatMessages = [
    {
      role: "system",
      content:
        baseSystem +
        dateBlock +
        capabilitiesBlock +
        backendBlock +
        integrationsBlock +
        suggestionsBlock +
        knowledgeBlock +
        memoryBlock +
        designBlock +
        dynamic.text +
        visionAddendum +
        filesContext,
    },
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
  const maxCompletionTokens = completionBudget({
    isInitial,
    phase: phaseTag.phase,
    hasVisionTurn,
  });
  if (hasVisionTurn) {
    model = MODEL_VISION;
    chosenBy = "vision_pin";
  } else if (preset === "smart") {
    // Phase tag overrides the keyword heuristic in smart mode.
    const phaseDefault = tier === "smart" ? MODEL_BEST : MODEL_FAST;
    chosenBy = "phase_router";
    if (tier === "cheap") {
      // Implement/docs turns are mostly code-writing. Keep them on the
      // faster model instead of letting stale HTTP-only telemetry route a
      // tiny landing-page request to a slow reasoning model that may time out
      // while streaming a long tool call.
      model = phaseDefault;
      chosenBy = "phase_router:cheap_direct";
    } else {
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
  const reasoningField = preset === "deep" ? { reasoning: { effort: "high" as const } } : {};

  // Tier 7 — context-budget pre-check. Estimate the input token cost
  // of the assembled messages and, if it exceeds the chosen model's
  // safe window, either upgrade to a larger-context model or drop
  // the oldest non-system messages until it fits. Eliminates silent
  // context-overflow failures (truncated/empty completions).
  const budget = applyContextBudget(chatMessages as BudgetMessage[], model);
  if (budget.action !== "none") {
    console.log(
      `[context-budget] action=${budget.action} est=${budget.estimatedTokens} safe=${budget.safeInputTokens} dropped=${budget.droppedCount} model=${model}${budget.modelOverride ? ` → ${budget.modelOverride}` : ""}`,
    );
    if (budget.modelOverride) {
      model = budget.modelOverride;
      chosenBy = `${chosenBy}+ctx_upgrade`;
    }
  }
  const finalMessages = budget.messages;

  const upstream = await aiChatCompletions({
    feature: "generate",
    body: {
      model,
      messages: finalMessages,
      tools: [tool],
      tool_choice: { type: "function", function: { name: tool.function.name } },
      max_tokens: maxCompletionTokens,
      stream: true,
      ...reasoningField,
    },
    // First-build scaffolds emit many files in one stream — give them the
    // 240s ceiling instead of the default 120s. Patches keep the default.
    timeoutTier: isInitial ? "stream_first_build" : "stream",
    // Propagate client-cancel: if the user closes the tab / hits Stop, the
    // SSE Response is aborted and we want the upstream provider call to
    // stop too — otherwise it runs (and bills) until the wall-clock cap.
    signal: request.signal,
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
        controller.enqueue(encoder.encode(sse({ type: "status", message: "Applying changes…" })));

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
                hasBackend: Boolean(backend),
              }),
              tools: [tool],
              tool_choice: { type: "function", function: { name: tool.function.name } },
              max_tokens: Math.max(maxCompletionTokens, isInitial ? 12_000 : 8_000),
              stream: true,
            },
            signal: request.signal,
            meta: {
              phase: phaseTag.phase,
              promptChars: lastUserContent.length,
              hadAttachments: hasVisionTurn,
              chosenBy: "structured_retry",
            },
          });
          if (!retry.ok || !retry.body) throw e;
          collected = await relayAndCollect(retry, controller, encoder);
          try {
            payload = parseCollectedProject(collected, isInitial);
          } catch (retryErr) {
            // Both attempts failed to produce usable tool output.
            //
            // Special case: initial build with `noBackendGate` active —
            // the model froze on the auth/RLS contradiction. Steer the
            // user to "Add backend" with a friendly message.
            if (isInitial && dynamic.snippets.includes("noBackendGate")) {
              emitConversationalFallback(controller, encoder, {
                files: currentFiles,
                summary:
                  "I'd love to build this, but it needs a backend to handle accounts, sign-in, and saving your data. Tap **Add backend** below this message to wire one up — it's a one-click step — and I'll pick up right where we left off and ship the full thing.",
              });
              return;
            }

            // Generic case (the one users were hitting): the model didn't
            // emit a usable patch after two passes. NOT a real error —
            // the most likely causes are an ambiguous request or the
            // model deciding the existing code already does what was
            // asked. Reply conversationally instead of throwing a red
            // error card.
            console.warn(
              "[generate] both attempts produced no usable output, falling back conversationally:",
              retryErr instanceof Error ? retryErr.message : String(retryErr),
            );
            emitConversationalFallback(controller, encoder, {
              files: currentFiles,
              summary: isInitial
                ? "I had trouble turning that into a working starter app on this pass. Could you tell me a bit more about what kind of app you're picturing — even one sentence about the main thing it should do helps me get going."
                : "I took a careful look but couldn't pin down a safe change for this one. Could you point me at the specific element or behavior you want adjusted? A quick note like 'make the header sticky' or 'change the CTA color to teal' is usually enough.",
            });
            return;
          }
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
          // Empty / missing ops on an edit turn = the model decided
          // there was nothing safe to change. Reply conversationally
          // instead of throwing a red error card. Same treatment when
          // every op the model proposed touched a protected path and
          // got filtered out below.
          if (!Array.isArray(parsed.ops) || parsed.ops.length === 0) {
            console.warn(
              `[generate] patch_files returned ${Array.isArray(parsed.ops) ? "empty" : "missing"} ops — replying conversationally`,
            );
            emitConversationalFallback(controller, encoder, {
              files: currentFiles,
              summary:
                summary && summary !== "Updated the project."
                  ? summary
                  : "I looked at this and didn't see a clear change to make. Could you point me at the specific element or behavior you want adjusted? Even a one-liner like 'make the hero headline bigger' helps me lock onto the right spot.",
            });
            return;
          }
          // Defense-in-depth: reject patches that touch the canonical UI kit
          // or scaffold config files. The AI should never need to.
          const PROTECTED = ["vite.config.ts", "tsconfig.json", "src/lib/utils.ts"];
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
          if (safeOps.length === 0) {
            // Every op was protected-path-only. Same conversational
            // fallback: nothing safe to apply, no credits charged.
            emitConversationalFallback(controller, encoder, {
              files: currentFiles,
              summary:
                "The change you asked for would touch files I keep reserved for the framework (the UI kit / build config). I can do this a different way — tell me the user-visible behavior you want and I'll wire it up in app code instead.",
            });
            return;
          }
          let patched: ProjectFile[];
          try {
            patched = applyOps(currentFiles, safeOps);
          } catch (applyErr) {
            const msg = applyErr instanceof Error ? applyErr.message : String(applyErr);
            // Workstream A: surgical-edit gate. On must_use_replace,
            // do ONE structured retry asking the model to re-emit the
            // change as `replace` ops. If that retry also fails, fall
            // through to the conversational fallback rather than throw.
            if (msg.startsWith("must_use_replace") || msg.startsWith("replace_too_large")) {
              const gateLabel = msg.startsWith("replace_too_large") ? "replace_too_large" : "must_use_replace";
              console.warn(`[generate] ${gateLabel} gate fired — retrying with chunked-replace hint`);
              controller.enqueue(
                encoder.encode(sse({ type: "status", message: "Splitting the edit into smaller, safer chunks…" })),
              );
              const retry = await aiChatCompletions({
                feature: "generate",
                body: {
                  model: MODEL_STRUCTURED_RETRY,
                  messages: addStructuredRetryInstruction(chatMessages, {
                    isInitial,
                    problem: msg,
                    hasBackend: Boolean(backend),
                  }),
                  tools: [tool],
                  tool_choice: { type: "function", function: { name: tool.function.name } },
                  max_tokens: Math.max(maxCompletionTokens, 8_000),
                  stream: true,
                },
                signal: request.signal,
                meta: {
                  phase: phaseTag.phase,
                  promptChars: lastUserContent.length,
                  hadAttachments: hasVisionTurn,
                  chosenBy: "must_use_replace_retry",
                },
              });
              if (!retry.ok || !retry.body) {
                emitConversationalFallback(controller, encoder, {
                  files: currentFiles,
                  summary:
                    "I tried to make that edit but couldn't pin it down to a safe spot in the file. Could you tell me which section or wording to change?",
                });
                return;
              }
              const retryCollected = await relayAndCollect(retry, controller, encoder);
              try {
                const retryPayload = parseCollectedProject(retryCollected, isInitial);
                if (!retryPayload.parsed.ops?.length) throw new Error("retry returned no ops");
                const retrySafeOps = retryPayload.parsed.ops.filter((op) => !isProtectedPath(op.path));
                patched = applyOps(currentFiles, retrySafeOps);
              } catch (retryErr) {
                console.warn("[generate] must_use_replace retry failed:", retryErr);
                emitConversationalFallback(controller, encoder, {
                  files: currentFiles,
                  summary:
                    "I couldn't safely apply that edit on this pass. Tell me the exact bit you want changed (e.g. 'change the hero headline to …') and I'll target it precisely.",
                });
                return;
              }
            } else {
              throw applyErr;
            }
          }
          // Heal-on-patch: re-apply the canonical scaffold to old saved
          // projects whose `src/components/ui/*`, `package.json`, or
          // backend kit files predate later kit upgrades. Without this,
          // legacy projects keep failing builds with errors like
          // "SelectTrigger is not exported by select.tsx" forever
          // because `applyScaffoldKit` was only running on initial
          // create + at build-trigger time.
          nextFiles = applyScaffoldKit(patched, {
            backend: backend ?? undefined,
          });
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
            `[styles.css invalid] generate reason="${result.reason}" — falling back to scaffold default`,
          );
          return { ...f, content: STYLES_CSS };
        });

        // Cycle 1 transitions from "writing" → "verifying". The activity
        // card uses this to keep the sub-caption alive while the verifier
        // tiers run silently for a few seconds.
        controller.enqueue(
          encoder.encode(sse({ type: "cycle_start", cycle: 1, intent: "verifying" })),
        );
        controller.enqueue(
          encoder.encode(
            sse({
              type: "cycle_progress",
              cycle: 1,
              message: "Checking the files Petal just wrote for build errors…",
            }),
          ),
        );

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
            budgetRejections.length > 0 ? "failed" : budgetWarnings.length > 0 ? "fixed" : "ok",
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
                budgetRejections.length > 0 ? "failed" : budgetWarnings.length > 0 ? "fixed" : "ok",
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

        // The legacy "Continue building" handoff machinery
        // (handoffReason / handoffDetected / continuation_handoff event)
        // has been removed along with the chip. Tiers below still report
        // pipeline outcomes via telemetry but no longer mutate any
        // handoff state.

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
        // purpose to flag the bad sections clearly in the source — the
        // user can ask Petal in a follow-up turn to reimplement them.
        if (localOut.preflightHallucinated.length > 0) {
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
          // stripping, the user may need to reimplement those sections in
          // a follow-up turn. (Legacy handoff signalling removed.)
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
        // (Legacy handoff-state population removed. `contOut.requestHandoff`
        // still drives the telemetry outcome below — that's all it's used
        // for now.)
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
        // Token usage from any user-billable agentic-loop fix cycles.
        // Cycles 3..N (only when the `agent_loop` Labs flag is on) push
        // their gateway usage here so the per-turn aggregator at the
        // bottom of the handler can fold them into the single user
        // charge. Cycle 2 (the default polish pass) stays on Petal's
        // tab — it runs for everyone whether they asked for it or not.
        const agentLoopUsages: Array<GatewayUsage | null> = [];
        if (autofixGateOpen) {
          // Cycle 2 = the polish pass. Brief intent ping so the activity
          // card narrates the gap instead of going silent for 5-10s while
          // the autofix model thinks.
          controller.enqueue(
            encoder.encode(sse({ type: "cycle_start", cycle: 2, intent: "fixing" })),
          );
          controller.enqueue(
            encoder.encode(
              sse({
                type: "cycle_progress",
                cycle: 2,
                message: `Petal noticed ${combinedAutofixIssues.length} thing${combinedAutofixIssues.length === 1 ? "" : "s"} to polish — patching now.`,
              }),
            ),
          );
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

        // Agentic loop (Labs: agent_loop). Bounded multi-cycle pass that
        // re-runs verifiers and feeds remaining issues back to the autofix
        // model up to N times. Lets a single turn legitimately spend 2-3+
        // minutes fixing its own mistakes without the user manually
        // pressing "try to fix" — same shape as Lovable's long agent turns.
        //
        // Hard limits (defensive — a runaway turn must NOT exist):
        //   - up to 3 extra cycles (cycles 3, 4, 5 in the SSE numbering)
        //   - 90s wall-clock budget across all extra cycles combined
        //   - stops the moment local + esbuild verifiers both pass
        //   - stops if a cycle makes zero file changes (model gave up)
        //
        // Billing: cycles 3..N push usage into `agentLoopUsages` and are
        // folded into the single user charge via priceTurn(). Cycle 2 (the
        // default polish pass above) is still on Petal's tab.
        if (labsFlags.agent_loop && !body.isAutoFix) {
          const AGENT_LOOP_MAX_CYCLES = 3;
          const AGENT_LOOP_WALL_MS = 90_000;
          const loopT0 = Date.now();
          const { verifyFilesLocal: lvFn } = await import("@/server/local-verifier");
          for (let cyc = 0; cyc < AGENT_LOOP_MAX_CYCLES; cyc++) {
            if (Date.now() - loopT0 > AGENT_LOOP_WALL_MS) {
              console.log("[agent-loop] wall-time exhausted, stopping");
              break;
            }
            const reverifyPaths = nextFiles.map((f) => f.path);
            const localAgain = lvFn(nextFiles, reverifyPaths);
            const esbAgain = await verifyFilesEsbuild(nextFiles, reverifyPaths);
            const rawStillBad = [
              ...localAgain.issues,
              ...esbAgain.issues.map((i) => ({
                path: i.path,
                kind: "parse" as const,
                detail: `${i.message} (line ${i.line}:${i.column})`,
              })),
            ];
            // Only loop on issues the autofix model is actually allowed
            // to act on. Soft warnings and protected scaffold paths get
            // filtered out — otherwise the model returns an empty fix
            // list and we hard-stop on cycle 3 for nothing useful.
            const FIXABLE_KINDS = new Set([
              "truncation",
              "unterminated-string",
              "braces",
              "jsx",
              "parse",
              "undefined",
              "missing-dep",
              "missing-export",
              "missing-sibling",
              "lazy-export",
            ]);
            const PROTECTED_PREFIXES = [
              "src/components/ui/",
              "src/components/examples/",
              "src/integrations/backend/",
            ];
            const PROTECTED_PATHS = new Set([
              "vite.config.ts",
              "tsconfig.json",
              "src/lib/utils.ts",
            ]);
            const isProtected = (p: string) =>
              PROTECTED_PATHS.has(p) ||
              PROTECTED_PREFIXES.some((pre) => p.startsWith(pre));
            const stillBad = rawStillBad.filter(
              (i) => FIXABLE_KINDS.has(i.kind) && !isProtected(i.path),
            );
            if (stillBad.length === 0) {
              console.log(
                `[agent-loop] converged after ${cyc} extra cycle(s) (raw=${rawStillBad.length}, fixable=0)`,
              );
              break;
            }
            const cycleNum = 3 + cyc;
            controller.enqueue(
              encoder.encode(sse({ type: "cycle_start", cycle: cycleNum, intent: "fixing" })),
            );
            controller.enqueue(
              encoder.encode(
                sse({
                  type: "cycle_progress",
                  cycle: cycleNum,
                  message: `Round ${cycleNum}: ${stillBad.length} issue${stillBad.length === 1 ? "" : "s"} remaining — refining.`,
                }),
              ),
            );
            const beforeHash = nextFiles.map((f) => f.path + ":" + f.content.length).join("|");
            try {
              const fixOut = await runPostStreamAutofix(nextFiles, stillBad);
              nextFiles = fixOut.files;
              if (fixOut.result.usage) agentLoopUsages.push(fixOut.result.usage);
              const afterHash = nextFiles.map((f) => f.path + ":" + f.content.length).join("|");
              const madeProgress = afterHash !== beforeHash;
              controller.enqueue(
                encoder.encode(
                  sse({
                    type: "cycle_end",
                    cycle: cycleNum,
                    outcome: madeProgress ? "retrying" : "hard-stop",
                  }),
                ),
              );
              if (!madeProgress) {
                console.log(`[agent-loop] cycle ${cycleNum} made no changes, stopping`);
                break;
              }
            } catch (e) {
              console.warn(`[agent-loop] cycle ${cycleNum} threw:`, e);
              controller.enqueue(
                encoder.encode(sse({ type: "cycle_end", cycle: cycleNum, outcome: "hard-stop" })),
              );
              break;
            }
          }
        }

        // Phase 4: resolve `petal-image://...` placeholders into real
        // AI-generated images uploaded to the public petal-images
        // bucket. Failures fall back to picsum so the build never
        // breaks because of a flaky image call.
        try {
          const hasPlaceholders = nextFiles.some((f) => f.content.includes("petal-image://"));
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

        const guardOut = await runFinalParseGuard(
          nextFiles,
          earlyChangedPaths,
          controller,
          encoder,
        );
        if (!guardOut.ok) {
          // Final-parse-guard couldn't repair this turn's edits. Revert
          // to the prior good files and reply conversationally — no
          // credits charged because nothing safe was written.
          console.warn(
            `[final-parse-guard] reverting turn — unrepairable: ${guardOut.detail}`,
          );
          emitConversationalFallback(controller, encoder, {
            files: currentFiles,
            summary:
              "I drafted the change but it didn't pass my final safety check, so I rolled it back to keep your app building. Want me to try a smaller version of the same change, or break it into a couple of steps?",
          });
          return;
        }
        nextFiles = guardOut.files;

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
        // Aggregate every user-billable sub-call's token usage and price
        // ONCE. Today this array holds just the main generate completion;
        // when we add user-requested fix cycles inside the agentic loop,
        // they push into `turnUsages` and the user still sees a single
        // debit at end of turn. Internal QA cycles (post-stream autofix,
        // continuation, self-check) stay on Petal's tab and are NOT
        // appended here — same convention as `body.isAutoFix`.
        const turnUsages: Array<GatewayUsage | null> = [
          collected.usage ?? null,
          ...agentLoopUsages,
        ];
        const priced = priceTurn(turnUsages);

        // Backfill the usage tokens onto the ai_call_log row that
        // `aiChatCompletions` inserted before the stream body was read.
        // Without this, every streaming generate call shows NULL tokens
        // and we can't distinguish "model returned a full project" from
        // "model returned a one-line refusal".
        void updateLastCallUsage({
          feature: "generate",
          model,
          promptTokens: collected.usage?.prompt_tokens ?? null,
          completionTokens: collected.usage?.completion_tokens ?? null,
          totalTokens: collected.usage?.total_tokens ?? null,
        });
        let finalCharged = 0;
        if (body.isAutoFix) {
          console.log(`[credits] auto-fix run — skipping charge of ${priced.amount} (would-be)`);
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

        // (Legacy `continuation_handoff` SSE emit removed along with the
        // Continue-building chip.)

        // Cycle 1 wraps cleanly. The activity card uses this to switch the
        // sub-caption back to the success line instead of leaving the last
        // verifier message on screen.
        controller.enqueue(
          encoder.encode(sse({ type: "cycle_end", cycle: 1, outcome: "clean" })),
        );

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
        const stack = e instanceof Error ? (e.stack ?? "") : "";
        // Authoritative user-cancel signal: the underlying HTTP request
        // was aborted by the client (tab closed, "Stop" button, network
        // drop). This is the ONLY trustworthy source — we never infer
        // user intent from prose like "aborted" / "cancelled", which
        // appear in many upstream-failure messages too. See
        // classifyRawError for the full rationale.
        const userCancelled = request.signal?.aborted === true;
        const kind = userCancelled ? "aborted" : classifyRawError(raw);
        // Layer 5 — humanize the raw error before showing it. No credits
        // were taken — nothing to refund. The friendly rewrite gives the
        // user a clear next step (retry, simplify, top up, …) instead
        // of a stack-trace-flavored sentence. Skip humanization on a
        // genuine user cancel — the client already knows what it did.
        const friendly = userCancelled
          ? {
              message: "You stopped Petal. Send a new message when you're ready.",
              suggestions: [] as string[],
            }
          : await humanizeBuildError({
              rawMessage: raw,
              brief: lastUserContent,
            });
        // Always log the raw server-side so we can root-cause without
        // depending on client telemetry (which only sees the humanized
        // copy). Cheap, fire-and-forget.
        console.error("[/api/generate] turn failed", {
          kind,
          raw: raw.slice(0, 500),
          stackHead: stack.slice(0, 500),
          projectId: body.projectId ?? null,
        });
        if (!userCancelled) {
          void markLastCallFailure({
            feature: "generate",
            model: typeof model === "string" ? model : null,
            status: kind === "upstream_timeout" ? 524 : 599,
            errorMessage: raw,
          });
        }
        // Persist the RAW failure directly server-side so
        // pipeline_failures.raw_message is ground truth (the client
        // path stores the humanized prose). Keyed by signature so we
        // can group repeats. Best-effort — never blocks the SSE close.
        if (!userCancelled) {
          try {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            void supabaseAdmin.from("pipeline_failures").insert({
              project_id: body.projectId ?? null,
              user_id: userId ?? null,
              surface: "generate-server",
              raw_message: raw.slice(0, 4000),
              signature: raw.slice(0, 200),
              model: typeof model === "string" ? model : null,
              stream_tail: stack.slice(0, 2000),
              extra: {
                kind,
                humanized: friendly.message.slice(0, 240),
                had_partial_assistant: false,
              },
            });
          } catch (loggingErr) {
            console.warn("[/api/generate] pipeline_failures insert failed", loggingErr);
          }
        }
        controller.enqueue(
          encoder.encode(
            sse({
              type: "error",
              message: friendly.message,
              suggestions: friendly.suggestions,
              kind,
              // Ship the raw alongside humanized copy so the client can
              // log it for telemetry but not show it to users.
              raw: raw.slice(0, 500),
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

async function handleGenerateRequest(request: Request): Promise<Response> {
  // Peek auth + projectId so we can open a `turns` row BEFORE the inner
  // pipeline starts streaming. The inner core also reads the body, so we
  // clone the request to avoid consuming it twice.
  let recorder: TurnRecorderHandle | null = null;
  const clone = request.clone();
  try {
    const peekAuth = await authorize(clone);
    if (typeof peekAuth === "string") {
      const peekBody = (await clone.json().catch(() => null)) as Body | null;
      if (peekBody?.projectId) {
        recorder = await startTurn({ projectId: peekBody.projectId, userId: peekAuth });
      }
    }
  } catch {
    // Recording is best-effort. Never block the build because of it.
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let pingTimer: ReturnType<typeof setInterval> | null = null;
      let statusTimer: ReturnType<typeof setInterval> | null = null;
      // Track when we last sent ANY bytes downstream so the status ticker
      // only chimes in during real silent gaps (verifier / autofix /
      // continuation passes), not on top of streaming model output.
      let lastByteAt = Date.now();
      // Rotating phrases keep the line feeling alive instead of looping the
      // same "Still working…" forever. The model + path narration takes
      // priority — these only fire when nothing else has spoken in 14s.
      const STATUS_ROTATION = [
        "Still working — Petal is keeping the build connected.",
        "Reviewing the pieces and checking for build errors…",
        "Almost there — verifying everything compiles before shipping.",
        "Polishing the last few details — won't be much longer.",
      ];
      let statusIdx = 0;

      const recordEvent = recorder
        ? makeSseTap((type, payload) => recorder!.record(type, payload))
        : null;
      const emit = (event: StreamEvent) => {
        const bytes = encoder.encode(sse(event));
        controller.enqueue(bytes);
        lastByteAt = Date.now();
        if (recordEvent) recordEvent(bytes);
      };

      let terminalStatus: "succeeded" | "failed" | "aborted" = "succeeded";
      let terminalError: string | null = null;

      try {
        // Announce the turn id FIRST so the client can persist it locally
        // and use it to reconnect if the tab/phone is closed mid-build.
        if (recorder) {
          emit({ type: "turn_id", turnId: recorder.turnId });
        }
        emit({ type: "phase", phase: "thinking" });
        emit({ type: "status", message: "Starting your build…" });

        // Transport keep-alive: a comment line (`:` prefix) every 8s.
        // EventSource consumers ignore comment lines entirely, so this
        // never reaches the UI — it just stops Cloudflare / proxies from
        // closing an "idle" stream during legit long verifier passes.
        pingTimer = setInterval(() => {
          if (request.signal.aborted) return;
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            /* controller may have closed mid-tick */
          }
        }, 8_000);

        // User-visible heartbeat: rotates phrasing and only fires after
        // 14s of silence so it never overwrites real model narration or
        // file events. Picks the next line in STATUS_ROTATION each tick.
        statusTimer = setInterval(() => {
          if (request.signal.aborted) return;
          if (Date.now() - lastByteAt < 14_000) return;
          emit({
            type: "status",
            message: STATUS_ROTATION[statusIdx % STATUS_ROTATION.length],
          });
          statusIdx++;
        }, 14_000);

        const response = await handleGenerateRequestCore(request);
        if (!response.ok || !response.body) {
          const raw = await response.text().catch(() => `Request failed (${response.status})`);
          terminalStatus = "failed";
          terminalError = raw.slice(0, 500);
          emit({
            type: "error",
            message: raw || "Petal couldn't start that build. Please try again.",
            kind: classifyRawError(raw),
            raw: raw.slice(0, 500),
          });
          return;
        }

        const reader = response.body.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          controller.enqueue(value);
          // Inner-stream bytes count as activity too — silences the ticker.
          lastByteAt = Date.now();
          if (recordEvent) recordEvent(value);
        }
      } catch (e) {
        const raw = e instanceof Error ? e.message : "Generation failed.";
        terminalStatus = request.signal.aborted ? "aborted" : "failed";
        terminalError = raw.slice(0, 500);
        emit({
          type: "error",
          message: "The connection dropped while Petal was building. Reconnecting and retrying is safe — no credits were charged for this failed attempt.",
          kind: classifyRawError(raw),
          raw: raw.slice(0, 500),
        });
      } finally {
        if (pingTimer) clearInterval(pingTimer);
        if (statusTimer) clearInterval(statusTimer);
        // Always emit a terminal `done` event so resumers know to stop tailing.
        try {
          emit({ type: "done", status: terminalStatus });
        } catch {
          /* controller may already be closed */
        }
        if (recorder) {
          // Fire-and-forget the finalize: we don't want to delay closing the
          // user-facing stream. The pipeline already ran to completion server-side.
          void recorder.finish(terminalStatus, { errorMessage: terminalError });
        }
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
      "X-Accel-Buffering": "no",
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
