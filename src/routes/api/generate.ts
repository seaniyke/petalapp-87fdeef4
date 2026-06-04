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
import { getBuildTarget } from "@/lib/build-targets";
import { inferWebSubtype, getWebSubtypeAddendum } from "@/lib/web-subtype";

import { lookupBackendForGenerate } from "@/server/backend-connector.server";
import { loadInstalledIntegrationsContext } from "@/server/integrations/prompt-context.server";
import {
  loadInstalledCodes,
  renderSuggestionsBlock,
  suggestIntegrations,
} from "@/server/integrations/auto-suggest.server";
import {
  resolveIntegration,
  renderResolvedIntegrationsBlock,
} from "@/server/integrations/doc-resolver.server";
import { resolveFromUserPaste } from "@/server/integrations/user-paste-resolver.server";
import { detectIntegrationRequests } from "@/lib/integration-request-intent";
import { validateStylesCss } from "@/server/validate-styles.server";
import { verifyFileLocal } from "@/server/local-verifier";
import { resolvePetalImagePlaceholders } from "@/server/image-generation.server";
import { spendCredit, checkCreditBalance } from "@/server/credits.server";
import { checkGenerateRateLimit, rateLimitResponse } from "@/server/rate-limit.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
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
import {
  parsePreservationRules,
  renderPreservationBlock,
  makeProtectedGlobMatcher,
} from "@/server/preservation-rules";
import { pickDesignDirection, renderDesignDirectionBlock } from "@/server/design-director.server";
import { runSelfCheck, humanizeBuildError, classifyRawError } from "@/server/self-recovery.server";
import { recordModelOutcome } from "@/server/model-kill-switch.server";
import { pickDynamicSnippets, renderCurrentDateBlock, renderSchemaBlock } from "@/server/dynamic-prompts.server";
import { renderLearningBlock } from "@/server/learning-injector.server";
import { detectHighStakesIntent } from "@/lib/high-stakes-intent";
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
import { stripTypeOnlyValueImports } from "@/server/strip-type-only-value-imports.server";
import {
  loadProjectBlueprint,
  makeBuildBlueprint,
  renderBuildBlueprintBlock,
  saveProjectBlueprint,
} from "@/server/build-blueprint.server";
import { findGenerationQualityIssues } from "@/server/generation-quality-gate.server";
import { verifyFilesEsbuild } from "@/server/esbuild-verifier.server";
import { injectPreviewGuard } from "@/server/preview-guard.server";
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
import { ensureRenderableShell } from "@/server/renderable-shell.server";
import { runAllRepairs } from "@/server/repair-all.server";
import { decideBackendGate, renderBackendGateBlock } from "@/server/two-phase-gate.server";
import { startTurn, type TurnRecorderHandle } from "@/server/turn-recorder.server";
import {
  proposeChangePlan,
  savePlan,
  loadAndConsumePlan,
  buildAllowedPathSet,
  renderApprovedPlanBlock,
  type PlanProposal,
} from "@/server/plan-mode";

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
  /** Plan Mode v1 — when true, run the cheap planning model first, emit
   *  `plan_proposed`, persist the plan, and end the stream. */
  planFirst?: boolean;
  /** Plan Mode v1 — when set, treat this as the "approval resume". The
   *  plan is loaded, its file list (intersected with `allowedPaths`) is
   *  used as a hard scope cap inside the protected-path filter. */
  approvedPlanId?: string;
  /** Plan Mode v1 — user's edited subset of plan paths to allow. If
   *  omitted, the entire plan's file list is allowed. */
  allowedPaths?: string[];
};

const PATCH_CONTEXT_FILE_LIMIT = 24;
const PATCH_CONTEXT_CHAR_LIMIT = 70_000;
const MULTI_EDIT_CONTEXT_FILE_LIMIT = 48;
const MULTI_EDIT_CONTEXT_CHAR_LIMIT = 150_000;
const LARGE_FILE_CONTEXT_CHAR_LIMIT = 10_000;
const RELEVANT_FILE_CONTEXT_CHAR_LIMIT = 18_000;

function isManagedScaffoldPath(path: string): boolean {
  return (
    path.startsWith("src/components/ui/") ||
    path.startsWith("src/components/examples/") ||
    path.startsWith("src/components/blocks/") ||
    path.startsWith("src/components/mobile/") ||
    path.startsWith("src/integrations/backend/") ||
    path === "vite.config.ts" ||
    path === "tsconfig.json" ||
    path === "src/lib/utils.ts" ||
    path === "petal-source-plugin.mjs"
  );
}

const MODEL_FAST = "google/gemini-3-flash-preview";
const MODEL_BEST = "google/gemini-2.5-pro";
// Phase-aware reasoning candidates. Added to the smart-router pool so
// the telemetry-driven picker (`pickBestModel`) can promote whichever
// model is winning on success_rate / cost / latency for a given
// (feature, phase). They fall back to the Gemini defaults when no
// telemetry exists yet, and the phase_router cheap-direct path still
// short-circuits to MODEL_FAST for trivial turns.
const MODEL_REASONING = "openai/gpt-5.4";
const MODEL_CLAUDE = "anthropic/claude-sonnet-4.5";
/** Escalation model used when the primary returned prose / no tool call.
 *  This must be a model that is known-good on the Lovable AI gateway for
 *  streamed tool calls. GPT-5 was returning HTTP 400 in production retry
 *  telemetry, which meant the retry never actually ran and `no_edit_emitted`
 *  leaked to users. */
const MODEL_STRUCTURED_RETRY = "google/gemini-3-flash-preview";
const MODEL_STRUCTURED_RETRY_BACKUP = "google/gemini-2.5-pro";
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

function completionBudget(args: {
  isInitial: boolean;
  phase: Phase;
  hasVisionTurn: boolean;
  multiEditIntent: boolean;
}): number {
  if (args.hasVisionTurn) return 8_000;
  if (args.isInitial) return 12_000;
  if (args.multiEditIntent) return 12_000;
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
    /^(yes|yeah|yep|ok|okay|sure|do it|do all|do all of (?:it|them|these)|do both|all of (?:it|them|these)|both|everything|ship it|go ahead|continue|proceed|that|this)$/i.test(latestText);
  if (!needsPreviousContext) return [latest];
  const previousContext = messages.slice(Math.max(0, lastUserIdx - 2), lastUserIdx);
  return [...previousContext, latest];
}

function detectMultiEditIntent(prompt: string): boolean {
  const p = prompt.toLowerCase();
  const explicitMulti =
    /\b(multiple|several|many|batch|coordinated|across|throughout|site[-\s]?wide|app[-\s]?wide|whole app|entire app|all pages|every page|multi[-\s]?(?:file|edit|step|task|thing|part))\b/i.test(p) ||
    /\b(do|handle|work on|change|update|fix|implement)\s+(?:all|both|these|them)\b/i.test(p);
  const enumeratedItems = (prompt.match(/(?:^|\n|;|,)\s*(?:\d+[.)]|[-*])\s+\S/g) ?? []).length;
  const connectorCount = (p.match(/\b(?:and|also|plus|then|as well as|along with)\b/g) ?? []).length;
  return explicitMulti || enumeratedItems >= 2 || connectorCount >= 3;
}

function trimFilesForPrompt(
  files: ProjectFile[],
  latestPrompt = "",
): { files: ProjectFile[]; omitted: number } {
  const multiEditIntent = detectMultiEditIntent(latestPrompt);
  const fileLimit = multiEditIntent ? MULTI_EDIT_CONTEXT_FILE_LIMIT : PATCH_CONTEXT_FILE_LIMIT;
  const charLimit = multiEditIntent ? MULTI_EDIT_CONTEXT_CHAR_LIMIT : PATCH_CONTEXT_CHAR_LIMIT;
  const terms = latestPrompt
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !/^(please|make|change|update|build|create|this|that|with|from|into|app)$/i.test(w))
    .slice(0, multiEditIntent ? 36 : 18);
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
    if (picked.length >= fileLimit) break;
    const limit = isPromptRelevant(file)
      ? RELEVANT_FILE_CONTEXT_CHAR_LIMIT
      : LARGE_FILE_CONTEXT_CHAR_LIMIT;
    const content =
      file.content.length > limit
        ? `${file.content.slice(0, limit)}\n\n/* ...trimmed for context budget... */`
        : file.content;
    const cost = file.path.length + content.length + 32;
    if (picked.length > 0 && used + cost > charLimit) continue;
    picked.push({ path: file.path, content });
    used += cost;
  }
  return { files: picked, omitted: Math.max(0, files.length - picked.length) };
}

function compactManifest(files: ProjectFile[]): string {
  const rows = files
    .filter((f) => !isManagedScaffoldPath(f.path))
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((f) => `- ${f.path} (${f.content.split("\n").length} lines)`);
  return rows.length ? rows.join("\n") : "- No editable app files found.";
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
  /** Plain assistant text when the provider ignored tool_choice. */
  text: string;
  /** Provider stop reason from the final stream chunk, e.g. `length` / `max_tokens`. */
  finishReason: string | null;
  /** Token usage from the gateway (final SSE chunk usually carries it). */
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    /** OpenAI/Anthropic via OpenRouter normalize cached prefix tokens here. */
    prompt_tokens_details?: { cached_tokens?: number };
    /** Anthropic raw via OpenRouter exposes these directly. */
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  } | null;
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
  const tool: ParsedTool = { name: null, args: "", text: "", finishReason: null, usage: null };
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
      const delta = (choice as { delta?: { content?: string; tool_calls?: unknown[] } })?.delta;
      if (typeof delta?.content === "string") tool.text += delta.content;
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

            // Decode once — used for BOTH the streaming-preview payload
            // (Phase 4 #12) and the structural validator below.
            let decoded = "";
            try {
              decoded = JSON.parse(`"${cm[1]}"`);
            } catch {
              decoded = cm[1]
                .replace(/\\n/g, "\n")
                .replace(/\\r/g, "\r")
                .replace(/\\t/g, "\t")
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, "\\");
            }

            // Cap inline payload at 256KB to keep SSE frames sane. Larger
            // files just omit `content` — the client falls back to the
            // final `result` event for those.
            const STREAM_CONTENT_CAP = 256 * 1024;
            const includeContent = decoded.length > 0 && decoded.length <= STREAM_CONTENT_CAP;

            controller.enqueue(
              encoder.encode(
                sse({
                  type: "file_complete",
                  path: owner,
                  bytes: contentBytes,
                  index: completedCount,
                  ...(includeContent ? { content: decoded } : {}),
                }),
              ),
            );

            // Plan #2 — per-file validate-then-continue (live signal).
            try {
              const issues = verifyFileLocal(owner, decoded);
              const ok = issues.length === 0;
              const errors = ok
                ? undefined
                : issues.slice(0, 4).map((i) => `${i.kind}: ${i.detail}`);
              controller.enqueue(
                encoder.encode(
                  sse({
                    type: "file_validated",
                    path: owner,
                    ok,
                    errors,
                  }),
                ),
              );
            } catch {
              /* validation is best-effort; never break the stream */
            }
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

type ToolRecoveryPayload = ParsedProjectPayload & {
  collected: ParsedTool;
  usedRecovery: boolean;
};

function assistantTextFromCollected(collected: ParsedTool): string {
  return [collected.text, collected.name ?? "", collected.args ?? ""].join("\n").trim();
}

function isMissingToolOutputError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /AI did not return (?:a project|usable edits)|AI tried to (?:rewrite|patch)/i.test(msg);
}

async function structuredRetryCompletion(args: {
  messages: Array<{ role: string; content: unknown }>;
  isInitial: boolean;
  problem: string;
  hasBackend: boolean;
  tool: typeof WRITE_PROJECT_TOOL | typeof PATCH_FILES_TOOL;
  maxTokens: number;
  signal: AbortSignal;
  meta: {
    phase: Phase;
    promptChars: number;
    hadAttachments: boolean;
    chosenBy: string;
    projectId?: string | null;
    userId?: string | null;
  };
}): Promise<Response> {
  const bodyBase = {
    messages: addStructuredRetryInstruction(args.messages, {
      isInitial: args.isInitial,
      problem: args.problem,
      hasBackend: args.hasBackend,
    }),
    tools: [args.tool],
    tool_choice: { type: "function", function: { name: args.tool.function.name } },
    max_tokens: args.maxTokens,
    stream: true,
  };

  const timeoutTier = args.isInitial ? "stream_first_build" : "stream";
  const primary = await aiChatCompletions({
    feature: "generate",
    body: { ...bodyBase, model: MODEL_STRUCTURED_RETRY },
    timeoutTier,
    signal: args.signal,
    meta: args.meta,
  });
  if (primary.ok && primary.body) return primary;

  let detail = "";
  try {
    detail = (await primary.text()).slice(0, 500);
  } catch {
    /* ignore */
  }
  console.warn(
    `[generate] structured retry failed HTTP ${primary.status}; retrying backup model`,
    detail,
  );

  return aiChatCompletions({
    feature: "generate",
    body: { ...bodyBase, model: MODEL_STRUCTURED_RETRY_BACKUP },
    timeoutTier,
    signal: args.signal,
    meta: { ...args.meta, chosenBy: `${args.meta.chosenBy}_backup` },
  });
}

async function recoverMissingToolOutput(args: {
  chatMessages: Array<{ role: string; content: unknown }>;
  collected: ParsedTool;
  isInitial: boolean;
  tool: typeof WRITE_PROJECT_TOOL | typeof PATCH_FILES_TOOL;
  model: string;
  phaseTag: { phase: Phase };
  lastUserContent: string;
  hasVisionTurn: boolean;
  backend: unknown;
  signal: AbortSignal;
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
  projectId?: string | null;
  userId?: string | null;
}): Promise<ToolRecoveryPayload | null> {
  const assistantText = assistantTextFromCollected(args.collected);
  if (!assistantText) return null;

  args.controller.enqueue(
    args.encoder.encode(sse({ type: "status", message: "Converting the draft into safe edits…" })),
  );
  const requiredTool = args.isInitial ? "write_project" : "patch_files";
  const recoveryMessages = [
    ...args.chatMessages,
    {
      role: "assistant",
      content: assistantText.slice(0, 12_000),
    },
    {
      role: "user",
      content:
        `Convert your previous response into a ${requiredTool} tool call now. ` +
        `Do not add prose. Preserve the user's requested scope, but emit only valid tool JSON.`,
    },
  ];
  const recovery = await structuredRetryCompletion({
    messages: recoveryMessages,
    isInitial: args.isInitial,
    problem: "previous response contained prose instead of the required tool call",
    hasBackend: Boolean(args.backend),
    tool: args.tool,
    maxTokens: args.isInitial ? 12_000 : 10_000,
    signal: args.signal,
    meta: {
      phase: args.phaseTag.phase,
      promptChars: args.lastUserContent.length,
      hadAttachments: args.hasVisionTurn,
      chosenBy: "tool_recovery",
      projectId: args.projectId ?? null,
      userId: args.userId ?? null,
    },
  });
  if (!recovery.ok || !recovery.body) return null;

  const recoveredCollected = await relayAndCollect(recovery, args.controller, args.encoder);
  const parsed = parseCollectedProject(recoveredCollected, args.isInitial);
  return { ...parsed, collected: recoveredCollected, usedRecovery: true };
}

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
  args: { summary: string; files: ProjectFile[]; suggestions?: string[] },
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
        noFileChanges: true,
        ...(args.suggestions && args.suggestions.length > 0
          ? { suggestions: args.suggestions }
          : {}),
      }),
    ),
  );
}

// Question-first guard removed. Whether a turn is a question is decided
// upstream by /api/triage — the SINGLE source of truth for asking. By the
// time generate runs, the turn is unambiguously a build/edit/fix, so we
// never second-guess the model's summary here. If the model still asks
// something rhetorical in its summary, that ships alongside the build.


/**
 * Target-shape validator. Returns null when the generated file set
 * matches what the chosen build target should produce, or a friendly
 * one-paragraph error message describing what went wrong.
 *
 * The point of this guard is to STOP the generator from quietly shipping
 * a web app when the user asked for a Chrome extension, a backend, or a
 * mobile app. Each target has a few unambiguous "this file MUST exist"
 * checks. If they fail, we revert the turn and ask the user to retry —
 * far better than dropping a generic React landing page into a Chrome
 * extension preview frame.
 */
function validateTargetShape(
  files: ProjectFile[],
  targetId: string,
): string | null {
  const paths = new Set(files.map((f) => f.path));
  const has = (p: string) => paths.has(p);
  const hasAny = (pred: (p: string) => boolean) => files.some((f) => pred(f.path));

  if (targetId === "extension") {
    if (!has("manifest.json") && !has("public/manifest.json") && !has("src/manifest.json")) {
      return "I started building this as a Chrome extension but didn't ship a manifest.json, so I rolled it back instead of handing you a regular web app. Send your prompt again with the word 'Chrome extension' near the top and I'll scaffold the popup, background worker, and manifest properly.";
    }
    return null;
  }

  if (targetId === "backend") {
    if (!hasAny((p) => p.startsWith("src/routes/api/")) && !hasAny((p) => p.includes(".server."))) {
      return "I started building this as a backend / API but didn't ship any server routes, so I rolled it back. Re-send the prompt and tell me which endpoints you want (e.g. 'POST /invoices, GET /invoices/:id') and I'll wire them up.";
    }
    return null;
  }

  if (targetId === "mobile" || targetId === "ios" || targetId === "android") {
    const hasExpo = hasAny((p) => p === "app.json") || hasAny((p) => p.startsWith("app/")) || hasAny((p) => p.startsWith("mobile/"));
    const hasRNImport = files.some((f) => /from\s+["']react-native["']/.test(f.content) || /from\s+["']expo-/.test(f.content));
    if (!hasExpo && !hasRNImport) {
      return "I started building this as a mobile app (Expo / React Native) but the output came back as a web app, so I rolled it back. Re-send the prompt with 'mobile app' or 'iOS/Android app' so I lock onto the native scaffold.";
    }
    return null;
  }

  if (targetId === "web-mobile") {
    const hasWeb = has("src/App.tsx") || has("src/main.tsx") || hasAny((p) => p.startsWith("src/pages/"));
    const hasMobile = hasAny((p) => p.startsWith("mobile/")) || hasAny((p) => p === "mobile/app.json");
    if (!hasWeb || !hasMobile) {
      return "I started building this as a web + mobile project but only shipped one side, so I rolled it back. Re-send the prompt and confirm you want both clients sharing a backend, and I'll scaffold `src/` for web and `mobile/` for the Expo app together.";
    }
    return null;
  }

  // web (default): no extra shape checks — the renderable-shell guard
  // already covers the "no real App.tsx" case for this target.
  return null;
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
  const chunkHint = args.problem.startsWith("replace_too_large")
    ? " Split the change into MULTIPLE small \`replace\` ops, each with a \`search\` snippet under ~160 lines / 8 KB. Target one logical region per op."
    : args.problem.startsWith("destructive_shrink")
      ? " You returned a much shorter file than the original — that destroys the user's app. DO NOT resend the file as a stub. Use \`replace\` ops that change only the specific lines that need to change, and preserve everything else."
      : "";
  const retryBlock = `\n\nSTRUCTURED RETRY — your previous response could not be applied (${args.problem}). Retry now with a smaller, safer ${requiredTool} tool call. You MUST call ${requiredTool}; return complete JSON tool arguments only; include every required field. For edit turns, prefer exact \`replace\` ops for small changes instead of resending whole files.${chunkHint} Keep files short and split large UI into components. If this is an initial app, build a focused MVP that works instead of a giant showcase: 4-8 app files max, no file over 140 lines, no long content blocks.${backendHint}`;
  return messages.map((m, i) =>
    i === 0 && typeof m.content === "string" ? { ...m, content: `${m.content}${retryBlock}` } : m,
  ) as T;
}

function deterministicHeroBackgroundFallback(args: {
  currentFiles: ProjectFile[];
  latestUserContent: string;
}): ParsedProjectPayload | null {
  const prompt = args.latestUserContent.toLowerCase();
  const asksForHeroBackground =
    /\b(hero|header|top|landing|homepage|home page)\b/i.test(prompt) &&
    /\b(background|backdrop|banner|cover|image|photo|picture)\b/i.test(prompt);
  if (!asksForHeroBackground) return null;

  const target =
    args.currentFiles.find((f) => f.path === "src/pages/Home.tsx") ??
    args.currentFiles.find((f) => f.path === "src/routes/index.tsx") ??
    args.currentFiles.find((f) => f.path === "src/App.tsx") ??
    args.currentFiles.find(
      (f) =>
        !isManagedScaffoldPath(f.path) &&
        /\.(tsx|jsx)$/.test(f.path) &&
        /hero|HeroSection|<h1|homepage|landing/i.test(f.content),
    );
  if (!target || target.content.includes("petal-image://")) return null;

  const imagePrompt = /construct|contractor|building|crane|site|commercial/i.test(prompt)
    ? "construction-site-cranes-steel-beams-workers-golden-hour"
    : "professional-business-hero-background-photography";

  const containerMatch = target.content.match(
    /<Container\s+className="([^"]*(?:pt-16|pt-20|pt-24|pt-32|py-16|py-20|py-24|py-32)[^"]*)">/,
  );
  if (!containerMatch) return null;
  const search = containerMatch[0];
  if (target.content.indexOf(search) !== target.content.lastIndexOf(search)) return null;

  const replace = `<section className="relative isolate overflow-hidden bg-background text-foreground">
      <img
        src="petal-image://${imagePrompt}"
        alt="Construction project site"
        className="absolute inset-0 -z-20 h-full w-full object-cover"
      />
      <div className="absolute inset-0 -z-10 bg-background/70" />
      <Container className="${containerMatch[1]} min-h-[70vh] flex flex-col items-center justify-center text-center">`;

  const closeContainer = "    </Container>\n  );";
  if (!target.content.includes(closeContainer)) return null;

  return {
    parsed: {
      plan: "I’ll add a construction-themed hero background while keeping the homepage structure intact.",
      summary: "I added a construction-related image backdrop to the hero and layered the existing hero content over it.",
      ops: [
        { op: "replace", path: target.path, search, replace },
        { op: "replace", path: target.path, search: closeContainer, replace: "      </Container>\n    </section>\n  );" },
      ],
      recap: `- \`${target.path}\` — added a generated hero background image with a readable overlay`,
    },
    summary: "I added a construction-related image backdrop to the hero and layered the existing hero content over it.",
    plan: "I’ll add a construction-themed hero background while keeping the homepage structure intact.",
    recap: `- \`${target.path}\` — added a generated hero background image with a readable overlay`,
  };
}

function deterministicPatchFallback(args: {
  currentFiles: ProjectFile[];
  latestUserContent: string;
}): ParsedProjectPayload | null {
  const heroBackground = deterministicHeroBackgroundFallback(args);
  if (heroBackground) return heroBackground;

  const prompt = args.latestUserContent.toLowerCase();
  const isLandingExpansion =
    /\b(add|more|expand|extra|new|additional|content|contents|section|sections)\b/i.test(prompt) &&
    /\b(landing|home\s?page|homepage|main page|front page|page)\b/i.test(prompt);
  if (!isLandingExpansion) return null;

  const target =
    args.currentFiles.find((f) => f.path === "src/pages/Home.tsx") ??
    args.currentFiles.find((f) => f.path === "src/routes/index.tsx") ??
    args.currentFiles.find((f) => f.path === "src/App.tsx");
  if (!target || target.content.includes("LandingProofSection")) return null;

  const callBlock = `      <LandingProofSection />\n      <LandingProcessSection />\n      <LandingProjectSection />\n`;
  const callAnchor = target.content.includes("      <CtaSection />")
    ? "      <CtaSection />\n"
    : target.content.includes("      <CTASection />")
      ? "      <CTASection />\n"
      : null;
  const callsOp = callAnchor
    ? {
        op: "replace" as const,
        path: target.path,
        search: callAnchor,
        replace: `${callBlock}${callAnchor}`,
      }
    : null;

  const trimmed = target.content.trimEnd();
  const appendAnchor = trimmed.slice(Math.max(0, trimmed.length - 600));
  if (!callsOp || !appendAnchor || target.content.indexOf(appendAnchor) !== target.content.lastIndexOf(appendAnchor)) return null;

  const sections = `\n\nfunction LandingProofSection() {\n  const proofPoints = [\n    { label: "Years in operation", value: "18+" },\n    { label: "Completed projects", value: "240+" },\n    { label: "Safety rating", value: "A+" },\n  ];\n\n  return (\n    <section className="bg-muted/40 py-16">\n      <div className="mx-auto max-w-6xl px-4">\n        <div className="grid gap-6 md:grid-cols-3">\n          {proofPoints.map((item) => (\n            <div key={item.label} className="rounded-xl border border-border bg-card p-6 text-center shadow-sm">\n              <div className="text-4xl font-bold text-primary">{item.value}</div>\n              <p className="mt-2 text-sm text-muted-foreground">{item.label}</p>\n            </div>\n          ))}\n        </div>\n      </div>\n    </section>\n  );\n}\n\nfunction LandingProcessSection() {\n  const steps = [\n    "Site review and project planning",\n    "Clear estimates and build timeline",\n    "Dedicated crew management",\n    "Final inspection and handover",\n  ];\n\n  return (\n    <section className="py-16">\n      <div className="mx-auto max-w-6xl px-4">\n        <div className="max-w-2xl">\n          <p className="text-sm font-semibold uppercase tracking-wide text-primary">How we work</p>\n          <h2 className="mt-3 text-3xl font-bold md:text-5xl">A smoother path from quote to completion</h2>\n        </div>\n        <div className="mt-10 grid gap-4 md:grid-cols-4">\n          {steps.map((step, index) => (\n            <div key={step} className="rounded-xl border border-border bg-card p-5">\n              <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground">\n                {index + 1}\n              </div>\n              <p className="font-medium">{step}</p>\n            </div>\n          ))}\n        </div>\n      </div>\n    </section>\n  );\n}\n\nfunction LandingProjectSection() {\n  const projects = [\n    "Commercial renovations",\n    "Industrial facilities",\n    "Residential developments",\n  ];\n\n  return (\n    <section className="py-16">\n      <div className="mx-auto max-w-6xl px-4">\n        <div className="rounded-2xl border border-border bg-card p-8 md:p-10">\n          <div className="grid gap-8 md:grid-cols-[1.1fr_1fr] md:items-center">\n            <div>\n              <p className="text-sm font-semibold uppercase tracking-wide text-primary">Project range</p>\n              <h2 className="mt-3 text-3xl font-bold md:text-5xl">Built for complex jobs and clear communication</h2>\n              <p className="mt-4 text-muted-foreground">From early planning to the final walkthrough, the team keeps owners, architects, and site leads aligned.</p>\n            </div>\n            <div className="grid gap-3">\n              {projects.map((project) => (\n                <div key={project} className="rounded-lg bg-muted px-4 py-3 font-medium">{project}</div>\n              ))}\n            </div>\n          </div>\n        </div>\n      </div>\n    </section>\n  );`;

  return {
    parsed: {
      plan: "I’ll add richer landing-page sections so the homepage feels more complete while keeping the existing design intact.",
      summary: "I added more homepage content with proof points, a working process section, and a project range block.",
      ops: [
        callsOp,
        {
          op: "replace" as const,
          path: target.path,
          search: appendAnchor,
          replace: `${appendAnchor}${sections}`,
        },
      ],
      recap: `- \`${target.path}\` — added additional landing-page sections before the final call-to-action`,
    },
    summary: "I added more homepage content with proof points, a working process section, and a project range block.",
    plan: "I’ll add richer landing-page sections so the homepage feels more complete while keeping the existing design intact.",
    recap: `- \`${target.path}\` — added additional landing-page sections before the final call-to-action`,
  };
}

function isRetryablePatchApplyError(message: string): boolean {
  return (
    message.startsWith("must_use_replace") ||
    message.startsWith("replace_too_large") ||
    message.startsWith("destructive_shrink") ||
    /AI replace snippet (?:did not match|matched more than once)/i.test(message) ||
    /AI tried to replace text in missing file/i.test(message) ||
    /AI returned an empty search snippet/i.test(message) ||
    /AI returned an incomplete placeholder patch/i.test(message)
  );
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

  // P0-4: app-level abuse protection. Runs BEFORE the credit floor check
  // so rate-limited requests never charge the wallet.
  const rl = checkGenerateRateLimit(userId);
  if (!rl.ok) return rateLimitResponse(rl);

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

  // ===========================================================================
  // Plan Mode v1 — propose-only short-circuit.
  // When `planFirst` is true and there is no `approvedPlanId` yet, we run the
  // cheap planning model, persist the plan, emit `plan_proposed`, and end the
  // stream. The composer renders the plan as an approval card; the user picks
  // files (or accepts all) and POSTs back with `approvedPlanId` to resume.
  // ===========================================================================
  if (body.planFirst && !body.approvedPlanId) {
    if (!body.projectId) {
      return new Response(
        JSON.stringify({ error: "Plan mode requires a saved project. Save and try again." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    const planEncoder = new TextEncoder();
    const planStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const plan = await proposeChangePlan({
            userPrompt: lastContent,
            history: messages,
            currentFiles,
            signal: request.signal,
          });
          const planId = await savePlan({
            projectId: body.projectId!,
            userId,
            payload: plan,
          });
          controller.enqueue(
            planEncoder.encode(
              sse({
                type: "plan_proposed",
                planId,
                summary: plan.summary,
                risk: plan.risk,
                files: plan.files,
              }),
            ),
          );
        } catch (e) {
          const raw = e instanceof Error ? e.message : "Planning failed.";
          console.error("[/api/generate] plan_proposal failed", raw);
          controller.enqueue(
            planEncoder.encode(
              sse({
                type: "error",
                message:
                  "Petal couldn't draft a plan for that request. Try sending again without Plan first.",
                kind: classifyRawError(raw),
                raw: raw.slice(0, 240),
              }),
            ),
          );
        } finally {
          controller.close();
        }
      },
    });
    return new Response(planStream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  // Plan Mode v1 — approval resume. Load the plan and compute the scope cap.
  // Errors here become a friendly inline error; the user can retry without
  // plan mode if their plan expired.
  let approvedPlan: PlanProposal | null = null;
  let allowedPathSet: Set<string> | null = null;
  if (body.approvedPlanId) {
    try {
      const loaded = await loadAndConsumePlan({
        planId: body.approvedPlanId,
        userId,
      });
      approvedPlan = loaded.payload;
      allowedPathSet = buildAllowedPathSet(loaded.allowedPathsCanonical, body.allowedPaths);
      if (allowedPathSet.size === 0) {
        return new Response(
          JSON.stringify({
            error:
              "All files were unchecked from the plan, so there's nothing to do. Re-send your message and approve at least one file.",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : "plan_load_failed";
      const friendly =
        raw === "plan_expired"
          ? "That plan has expired. Re-send your message to draft a new one."
          : raw === "plan_already_approved" || raw === "plan_already_cancelled"
          ? "That plan was already used. Re-send your message to draft a fresh one."
          : "Couldn't load that plan. Re-send your message to draft a new one.";
      return new Response(JSON.stringify({ error: friendly }), {
        status: 410,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

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

  // Build-target chip (Google AI Studio-style: "Build an Android app", etc.).
  // Selection is sent as `x-petal-target` header by the client. When present
  // and not the default web target, prepend a hard constraint block so the
  // model scaffolds the right stack.
  const buildTargetId = request.headers.get("x-petal-target") ?? "web";
  const buildTarget = getBuildTarget(buildTargetId);

  // Sub-type routing for the catch-all `web` target. Without this a
  // "landing page for X" and a "CRM for Y" both get the same generic web
  // prompt and the model picks an app-shell vs marketing layout at random.
  // Only consulted on initial generation — subsequent turns inherit the
  // shape already in `currentFiles`.
  let webSubtypeBlock = "";
  let detectedWebSubtype: "marketing" | "app" | "fullstack" | undefined;
  if (buildTarget.id === "web" && isInitial) {
    detectedWebSubtype = inferWebSubtype(lastContent);
    webSubtypeBlock = `\n\n${getWebSubtypeAddendum(detectedWebSubtype)}\n`;
    console.log(`[web-subtype] project=${body.projectId ?? "n/a"} detected="${detectedWebSubtype}"`);
  }

  const buildTargetBlock = buildTarget.systemPromptAddendum
    ? `\n\n### Build target (HARD CONSTRAINT)\n${buildTarget.systemPromptAddendum}\n${webSubtypeBlock}`
    : webSubtypeBlock;

  // Design + craft bar (applies to EVERY target). Petal apps must look
  // hand-designed, not template-y. Keep this short and specific — the
  // model is much better at executing concrete rules than vibes.
  const designQualityBlock = `\n\n### Design & craft (HARD CONSTRAINT — applies to every UI you generate)
Petal apps must feel hand-crafted, not AI-generic. Hold yourself to an Awwwards bar.

Typography
- Pair a distinctive display font with a refined body font (Google Fonts is fine). NEVER default to Inter+Poppins or Inter alone. Examples that work: Space Grotesk + DM Sans, Instrument Serif + Work Sans, Bricolage Grotesque + Inter Tight, Fraunces + Geist, General Sans + Söhne-ish.
- Set type scale with intent: large editorial display sizes for hero, tight tracking on display, generous leading on body.

Color & surfaces
- Define semantic tokens in \`src/styles.css\` using \`oklch()\`. NEVER hard-code colors (\`text-white\`, \`bg-[#xxx]\`) in components — always go through tokens (\`bg-background\`, \`text-foreground\`, \`bg-primary\`, etc.).
- Add at least one gradient token (\`--gradient-primary\`) and one shadow token (\`--shadow-elegant\`) and USE them on hero / CTA / cards.
- Both light and dark mode must be tuned — no auto-inverted afterthought.

Layout & space
- Asymmetric, intentional whitespace. No "stacked card on white" defaults. Use a real grid (12-col, bento, split, masonry) chosen for the content.
- Hero section must have a strong focal point: oversized type, an image with depth, or a single bold visual. Not three centered lines + a button.

Motion
- Use \`framer-motion\` for entry transitions, hover micro-interactions, and one signature hero animation. Stagger lists. Animate on scroll for marketing surfaces.
- Respect \`prefers-reduced-motion\`.

Iconography & components
- Icons: \`lucide-react\` only, sized consistently per surface (16/20/24).
- Build on shadcn/ui primitives but customize variants (\`buttonVariants\` etc.) — don't ship default-looking buttons. Add a \`premium\` / \`hero\` variant when the page calls for it.

Imagery
- For hero/feature/empty-state images use \`generate_image\` to produce custom art that matches the palette — never generic stock-y placeholders or solid blocks. Always set proper alt text.

Forbidden defaults
- Purple-gradient-on-white SaaS look, three equal feature cards centered under "Why us", emoji-as-icon for serious products, untouched shadcn button on a hero CTA, "lorem ipsum" anywhere shipped.
`;




  // Look up the project's attached backend (BYO Supabase). When present,
  // we both inject the pre-configured client and tell the AI it exists.
  const backend = body.projectId ? await lookupBackendForGenerate(body.projectId) : null;

  const backendBlock = backend
    ? `\n\n### Backend (auth + database + storage) is connected\nThe project has a backend. Use the pre-configured client — never call createClient yourself, never import from @supabase/supabase-js directly, never hard-code URLs or keys.\n\nImports:\n- import { supabase } from "@/integrations/backend/client"\n- import { useAuth, AuthProvider } from "@/integrations/backend/auth"\n- import { uploadFile, getPublicUrl } from "@/integrations/backend/storage"\n\nWrap the app once with <AuthProvider>. Never overwrite anything under src/integrations/backend/ — those files are protected.\n\nIf you need a new table, end your summary with a fenced sql block prefixed "MIGRATION:" — do not try to run it. The user runs migrations manually.\n`
    : "";

  // Live schema injection: best-effort, soft-fails, cached. Lists existing
  // tables + key columns so the model reuses real tables instead of
  // hallucinating ones, and so column names in queries match reality.
  const schemaBlock = await renderSchemaBlock({ backend, projectId: body.projectId });

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

  // Layer E — Universal Integration Resolver. When the user mentions a
  // third-party service that ISN'T in our managed marketplace, fetch a
  // compact prompt-ready brief (curated > npm > AI fallback) and inject it
  // as ground truth so the LLM doesn't hallucinate SDK signatures from
  // training-data memory. Bounded to 3 services per turn for prompt cost.
  const lastUserForResolver =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const resolverText =
    typeof lastUserForResolver === "string" ? lastUserForResolver : "";
  const requestedIntegrations = detectIntegrationRequests(resolverText, 3);
  // Layer J — User-paste resolver runs FIRST so anything the user pasted
  // (docs URL, cURL, code snippet) becomes the authoritative brief and
  // suppresses the curated/npm/AI fallback for the same service.
  const [userPasteBriefs, namedBriefs] = await Promise.all([
    resolveFromUserPaste(resolverText).catch(() => []),
    Promise.all(
      requestedIntegrations
        .filter((r) => !installedCodes.has(r.key))
        .map((r) => resolveIntegration(r.name).catch(() => null)),
    ),
  ]);
  const pastedKeys = new Set(
    userPasteBriefs.map((b) => b.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "")),
  );
  const resolvedBriefs = [
    ...userPasteBriefs,
    ...namedBriefs.filter(
      (b): b is NonNullable<typeof b> =>
        b !== null &&
        !pastedKeys.has(b.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "")),
    ),
  ];
  const resolvedBlock = renderResolvedIntegrationsBlock(resolvedBriefs);

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

  // PETAL.md / .petalrc — user-authored preservation rules. Optional.
  // Adds protected globs to the patch filter and injects free-text rules
  // into the system prompt for both initial and patch turns.
  const preservation = parsePreservationRules(currentFiles);
  const preservationBlock = renderPreservationBlock(preservation);
  const matchesUserProtectedGlob = makeProtectedGlobMatcher(preservation.protectedGlobs);

  // Layer 4 — Design Director Pass.
  // On the very first build, pick a bold visual direction up-front so
  // the model doesn't fall back to the generic AI aesthetic. On
  // subsequent turns, the cached direction in project_memory is
  // honored automatically (pickDesignDirection short-circuits to it).
  // Patches skip the call entirely — the existing aesthetic wins.
  let lastUserContent = latestUserMessage(messages);
  const multiEditPromptContext = messages
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n");
  const multiEditIntent = !isInitial && detectMultiEditIntent(multiEditPromptContext);

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

  // Two-phase gate (smart variant). On the user's very first turn, if their
  // prompt implies a backend (auth/db/payments/etc.) AND they didn't
  // explicitly ask for full-stack, build the FRONTEND ONLY this turn and
  // propose backend additions via suggestion chips on the assistant message.
  // The chips render as the standard required-answer card; the next turn
  // ships the backend.
  const backendGate = decideBackendGate({
    isInitial,
    hasBackendConnected: Boolean(backend),
    userPrompt: lastUserContent,
  });
  const backendGateBlock = backendGate.gated ? renderBackendGateBlock() : "";
  // Plan #4 — opt-in AST patch grammar. Computed after labsFlags is loaded
  // (see assignment below); placeholder declared here so staticPrefixText
  // composition reads naturally.
  if (backendGate.gated) {
    console.log(`[two-phase-gate] activated: ${backendGate.reason}`);
  }

  // Labs flags — loaded once per request so both the staged-pipeline
  // gate (initial only) and the agentic-loop gate (post-stream autofix)
  // see the same values without re-querying. Empty {} on failure.
  const labsFlags = await loadLabsFlagsForRequest(userJwt);

  // Plan #4 — opt-in AST patch grammar. Only documented to the model when
  // the `ast_patches` labs flag is on for this user. Off by default.
  const astPatchBlock = labsFlags.ast_patches
    ? `\n\n## Optional: ast-patch ops (labs)\nFor narrow, surgical edits on existing JS/TS files you MAY emit an\n` +
      `"ast-patch" op instead of "replace" when:\n` +
      `- swapping the body of an exported const/function/class by name\n` +
      `- adding or removing a single import\n` +
      `- swapping a JSX subtree you previously tagged with data-petal-block="ID"\n\n` +
      `Shape:\n` +
      `{ "op": "ast-patch", "path": "src/.../foo.tsx", "patches": [\n` +
      `  { "kind": "replace-export", "name": "MyHero", "body": "export const MyHero = () => ( ... );" },\n` +
      `  { "kind": "replace-function", "name": "format", "body": "function format(x){ return ... }" },\n` +
      `  { "kind": "add-import", "specifier": "useState", "from": "react" },\n` +
      `  { "kind": "add-import", "specifier": "Button", "from": "@/components/ui/button", "default": false },\n` +
      `  { "kind": "remove-import", "from": "@/old/path" },\n` +
      `  { "kind": "replace-jsx-block", "blockId": "hero-cta", "jsx": "<div data-petal-block=\\"hero-cta\\">…</div>" }\n` +
      `] }\n\n` +
      `When in doubt use "replace" — ast-patch is a power tool, not a default. ` +
      `keep-existing-expander and replace/update remain the fallback.\n`
    : "";

  // Compute the design direction up-front so BOTH the staged pipeline and
  // the monolithic path see the same brief. Previously this lived below
  // the staged branch and the staged path got a generic plan with no
  // committed aesthetic — the root cause of "every Petal app looks the
  // same / sidebar + dashboard for a feed prompt".
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

  // Staged pipeline (Labs). When the user has the staged_pipeline flag on,
  // initial builds run through Plan → parallel-Scaffold → Wire-up instead
  // of the monolithic write_project call. The orchestrator returns null
  // on any pre-stream failure so we can fall through to the existing
  // path with no behavior change for everyone else.
  if (isInitial && labsFlags.staged_pipeline) {
    // Compute the app-shape block here too (the monolithic path computes
    // it again ~100 lines below; cheap pure function, OK to call twice).
    let stagedAppShape: import("@/lib/app-shape-classifier").AppShape | undefined;
    let stagedAppShapeBlock = "";
    try {
      const { classifyAppShape, renderShapeBlock } = await import("@/lib/app-shape-classifier");
      stagedAppShape = classifyAppShape(lastUserContent);
      stagedAppShapeBlock = renderShapeBlock(stagedAppShape);
    } catch {
      /* classifier failure must never block the build */
    }
    const stagedResp = await runStagedPipelineStream({
      brief: lastUserContent,
      hasBackend: Boolean(backend),
      context: {
        appShape: stagedAppShape,
        appShapeBlock: stagedAppShapeBlock,
        designDirection,
        designDirectionBlock: designBlock,
      },
    });
    if (stagedResp) return stagedResp;
    console.warn("[staged] orchestrator returned null — falling back to monolithic path");
  }
  const persistedBlueprint = !isInitial ? await loadProjectBlueprint(body.projectId) : null;
  const blueprintBlock = renderBuildBlueprintBlock(persistedBlueprint);

  // Filter out files Petal manages itself before showing the project to the
  // model. The AI never edits these (we drop ops that touch them), but feeding
  // them back as context bloats patch turns and makes targeted edits harder.
  const editablePromptFiles = currentFiles.filter((f) => !isManagedScaffoldPath(f.path));
  const promptBudget = trimFilesForPrompt(editablePromptFiles, multiEditPromptContext || lastUserContent);
  const filesContext = isInitial
    ? ""
    : `\n\nEditable app file manifest (all app-owned files Petal may target):\n${compactManifest(currentFiles)}\n\nCurrent project files (trimmed to the most relevant editable files; ${promptBudget.omitted} lower-priority files omitted for speed. Petal-managed UI kit, reusable block library, mobile primitives, examples, and backend integration files are hidden — they exist in the project but you must never edit them):\n\n${promptBudget.files
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
  const learningBlock = await renderLearningBlock();
  const capabilitiesBlock = renderPetalCapabilitiesBlock({
    hasBackend: Boolean(backend),
  });
  const multiEditBlock = multiEditIntent
    ? `\n\n### Multi-edit turn\nThe latest request contains multiple coordinated asks. Treat this as one complete batch: decompose it internally, preserve dependencies across files, emit every required create/update/replace/delete op in one patch, and do not ask the user to split the work unless the asks conflict, are unsafe, or require missing infrastructure. Use small precise ops, especially when touching multiple regions of the same file.\n`
    : "";

  // Project archetype: match the latest user turn against the 18-archetype
  // registry (covers ~92% of what people build on AI app builders). When a
  // known archetype fires, splice in the build instruction + saved roadmap
  // (landing sections + deferred features + providers). When NONE matches,
  // call a one-shot cheap-model fallback to invent the roadmap so EVERY
  // first turn ends with "here's what's queued next, pick one."
  // Treat every domain as a real live product — no "demo" banners.
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  const lastUserText = typeof lastUserMsg?.content === "string" ? lastUserMsg.content : "";
  const hs = detectHighStakesIntent(lastUserText);
  let hsRoadmap: import("@/lib/high-stakes-intent").HighStakesRoadmap | null = null;
  let highStakesBlock = "";
  try {
    const arc = await import("@/lib/project-archetype");
    const match = arc.detectArchetype(lastUserText);
    if (match.detected && match.archetype) {
      const a = match.archetype;
      highStakesBlock =
        "\n\n### Project archetype\n" +
        arc.archetypeBuildInstruction(a) +
        "\n\n" +
        arc.archetypeRoadmapBlock(a);
      if (a.highStakes) {
        hsRoadmap = {
          productLabel: a.productLabel,
          landingSections: [...a.landingSections],
          futureFeatures: [...a.futureFeatures],
          providersToWireLater: [...a.providersToWireLater],
        };
      }
    }
    // No fallback LLM call here — keep turn 1 latency low; the universal
    // landing-page rules in baseSystem already cover unknown prompts.
  } catch {
    /* never block the build on archetype lookup failure */
  }


  // App Composer (Step 5): collapse archetype + template + kit blocks +
  // examples into ONE structured blueprint. Replaces the legacy archetype-
  // only block. Falls back silently if no confident match.
  let archetypeBlock = "";
  try {
    const { buildBlueprintFor, renderBlueprintBlock } = await import("@/server/app-composer.server");
    const composed = buildBlueprintFor(lastUserText, { hasBackend: Boolean(backend) });
    if (composed) {
      // Marketing subtype gate: strip auth/account routes from any matched
      // template before they hit the prompt. Otherwise the model gets
      // contradictory instructions — the subtype addendum says "no auth
      // shells" while the blueprint lists `/auth/sign-in` as a route to
      // scaffold, and it either ships auth on a landing page or freezes.
      if (detectedWebSubtype === "marketing") {
        composed.blueprint.routes = composed.blueprint.routes.filter(
          (r) => !r.startsWith("/auth") && r !== "/account" && r !== "/dashboard",
        );
        archetypeBlock = renderBlueprintBlock(composed.blueprint);
      } else {
        archetypeBlock = composed.promptBlock;
      }
    }
  } catch {
    // Never block a build on composer failure.
  }

  // Layer I — App-shape classifier. Predicts surfaces (landing/auth/dashboard/
  // admin/webhooks/kyc) and likely integrations from the free-form prompt so
  // the model scaffolds full apps instead of stopping at one dashboard page.
  let appShapeBlock = "";
  try {
    const { classifyAppShape, renderShapeBlock } = await import(
      "@/lib/app-shape-classifier"
    );
    appShapeBlock = renderShapeBlock(classifyAppShape(lastUserText));
  } catch {
    // Never block a build on classifier failure.
  }

  // Layer K — Mobile generation guidance. Only fires when the user wants a
  // real native app (App Store / Play Store, push, signed binary, etc.).
  // Teaches the model to use Capacitor plugins instead of web-only APIs and
  // to lay things out mobile-first with safe-area + bottom nav.
  let mobileBlock = "";
  try {
    const { renderMobileGuidanceBlock } = await import(
      "@/server/integrations/mobile-guidance.server"
    );
    mobileBlock = renderMobileGuidanceBlock(lastUserText);
  } catch {
    // Never block a build on guidance failure.
  }

  // Layer M — Game generation guidance. Fires when the user asks Petal to
  // build a game. Picks the right library (Phaser / three.js / plain React)
  // by genre, scaffolds the React+Phaser bridge, and adds a leaderboard
  // schema when the prompt mentions scores or multiplayer.
  let gameBlock = "";
  try {
    const { renderGameGuidanceBlock } = await import(
      "@/server/integrations/game-guidance.server"
    );
    gameBlock = renderGameGuidanceBlock(lastUserText);
  } catch {
    // Never block a build on guidance failure.
  }


  // ---------------------------------------------------------------------------
  // Prompt caching: split the system message into a STABLE PREFIX and a
  // DYNAMIC SUFFIX. The prefix is byte-for-byte identical across consecutive
  // turns in a session — that's what lets OpenAI/Anthropic/Gemini serve it
  // from cache (Anthropic gets an explicit `cache_control` marker; OpenAI
  // and Gemini auto-cache stable prefixes ≥1024 tokens). The suffix carries
  // anything that legitimately changes per turn: current files, the date,
  // keyword-triggered snippets, plan results, vision addendum, etc.
  // Rule: NEVER move per-turn content into the prefix. Drift kills cache hits.
  // ---------------------------------------------------------------------------
  const staticPrefixText =
    baseSystem +
    buildTargetBlock +
    designQualityBlock +
    capabilitiesBlock +
    multiEditBlock +
    backendBlock +
    schemaBlock +
    integrationsBlock +
    knowledgeBlock +
    memoryBlock +
    preservationBlock +
    designBlock +
    blueprintBlock +
    appShapeBlock +
    mobileBlock +
    gameBlock +
    archetypeBlock;

  const dynamicSuffixText =
    dateBlock +
    suggestionsBlock +
    resolvedBlock +
    (approvedPlan ? renderApprovedPlanBlock(approvedPlan) : "") +
    dynamic.text +
    learningBlock +
    highStakesBlock +
    visionAddendum +
    backendGateBlock +
    astPatchBlock +
    filesContext;

  // Short stable hash of the prefix — logged with each call so we can see at
  // a glance whether the prefix is drifting (which would kill cache hits).
  // Tiny FNV-1a is enough; this is for ops, not security.
  const staticPrefixHash = (() => {
    let h = 0x811c9dc5;
    for (let i = 0; i < staticPrefixText.length; i++) {
      h ^= staticPrefixText.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  })();

  const chatMessages = [
    {
      // STATIC PREFIX. Content uses the array shape so we can attach
      // Anthropic-style `cache_control: { type: "ephemeral" }`. Gemini /
      // OpenAI via OpenRouter ignore the marker safely and rely on
      // automatic prefix-cache matching — which works because the text
      // above is stable across turns.
      role: "system",
      content: [
        {
          type: "text",
          text: staticPrefixText,
          cache_control: { type: "ephemeral" as const },
        },
      ],
    },
    {
      // DYNAMIC SUFFIX. Everything below the cache boundary.
      role: "system",
      content: dynamicSuffixText,
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

  console.log(
    `[prompt-cache] prefix_chars=${staticPrefixText.length} prefix_hash=${staticPrefixHash} suffix_chars=${dynamicSuffixText.length} files=${isInitial ? 0 : (promptBudget.files?.length ?? 0)}`,
  );

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
    multiEditIntent,
  });
  if (hasVisionTurn) {
    model = MODEL_VISION;
    chosenBy = "vision_pin";
  } else if (multiEditIntent) {
    model = MODEL_BEST;
    chosenBy = "multi_edit_pin";
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
          candidates: [MODEL_FAST, MODEL_BEST, MODEL_REASONING, MODEL_CLAUDE],
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
      projectId: body.projectId ?? null,
      userId,
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
        controller.enqueue(encoder.encode(sse({ type: "status", message: "Reading your request and choosing the safest edit path…" })));
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
          const firstCollected = collected;
          const retry = await structuredRetryCompletion({
            messages: finalMessages,
            isInitial,
            problem: e instanceof Error ? e.message : "invalid structured response",
            hasBackend: Boolean(backend),
            tool,
            maxTokens: Math.max(maxCompletionTokens, isInitial ? 12_000 : 8_000),
            signal: request.signal,
            meta: {
              phase: phaseTag.phase,
              promptChars: lastUserContent.length,
              hadAttachments: hasVisionTurn,
              chosenBy: "structured_retry",
              projectId: body.projectId ?? null,
              userId,
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

            const recovered = isMissingToolOutputError(retryErr)
              ? await recoverMissingToolOutput({
                  chatMessages: finalMessages,
                  collected: assistantTextFromCollected(collected) ? collected : firstCollected,
                  isInitial,
                  tool,
                  model,
                  phaseTag,
                  lastUserContent,
                  hasVisionTurn,
                  backend,
                  signal: request.signal,
                  controller,
                  encoder,
                  projectId: body.projectId ?? null,
                  userId,
                }).catch((recoveryErr) => {
                  console.warn(
                    "[generate] tool recovery failed:",
                    recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr),
                  );
                  return null;
                })
              : null;
            if (recovered) {
              payload = recovered;
              collected = recovered.collected;
            } else {

            const deterministic = !isInitial
              ? deterministicPatchFallback({ currentFiles, latestUserContent: lastUserContent })
              : null;
            if (deterministic) {
              controller.enqueue(
                encoder.encode(sse({ type: "status", message: "Applying a safe targeted edit path…" })),
              );
              payload = deterministic;
              collected = {
                name: "patch_files",
                args: JSON.stringify(deterministic.parsed),
                text: "",
                finishReason: null,
                usage: collected.usage,
              };
            } else {

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
          }
        }

        let { parsed, summary, plan, recap } = payload;

        // (Question-first guard removed — see comment near the top of this
        // file. Triage is the single decision point for "is this a question?";
        // generate just builds.)


        let nextFiles: ProjectFile[];
        if (collected.name === "write_project") {
          if (!parsed.files?.length) throw new Error("AI returned no files.");
          // Inject the canonical scaffold (Tailwind v4 + shadcn-style UI kit)
          // so the AI never has to emit boilerplate it can't reliably reproduce.
          // Also inject the backend kit when a backend is attached.
          nextFiles = applyScaffoldKit(parsed.files, {
            backend: backend ?? undefined,
          });
          // NOTE: Previously we called scaffoldRouteStubs() here to emit
          // TanStack `src/routes/*.tsx` files for routes the model didn't
          // ship. That was wrong for this scaffold: the generated app
          // runtime is Vite + react-router-dom via `src/main.tsx → <App />`,
          // so TanStack route files NEVER render — they were inert dead
          // weight that bloated context and made follow-up edits confusing.
          // The model is now solely responsible for emitting pages under
          // `src/pages/*` and wiring them in App.tsx (the system prompt
          // already requires this). No stub injection.
        } else {
          // Empty / missing ops on an edit turn = the model decided

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
            p.startsWith("src/components/blocks/") ||
            p.startsWith("src/components/mobile/") ||
            p.startsWith("src/integrations/backend/") ||
            PROTECTED.includes(p) ||
            matchesUserProtectedGlob(p) ||
            // Plan Mode v1 — when a plan was approved, ANY file outside its
            // allow-list is treated as protected and dropped.
            (allowedPathSet !== null && !allowedPathSet.has(p));
          const violations = parsed.ops.filter((op) => isProtectedPath(op.path));
          if (violations.length) {
            console.warn(
              "Dropping protected-path ops:",
              violations.map((v) => `${v.op} ${v.path}`).join(", "),
            );
            // Surface plan-scope violations distinctly so the UI can label them.
            if (allowedPathSet) {
              const planDropped = violations
                .filter((v) => !allowedPathSet!.has(v.path))
                .map((v) => v.path);
              if (planDropped.length) {
                controller.enqueue(
                  encoder.encode(
                    sse({ type: "plan_scope_violation", droppedPaths: Array.from(new Set(planDropped)) }),
                  ),
                );
              }
            }
          }
          let safeOps = parsed.ops.filter((op) => !isProtectedPath(op.path));
          // Plan #4 — strip ast-patch ops if the labs flag isn't on. The
          // model isn't supposed to emit them in that case (we don't add
          // the grammar to the prompt), but be defensive: better to ignore
          // than to apply an unauthorized op kind.
          if (!labsFlags.ast_patches) {
            const astCount = safeOps.filter((op) => op.op === "ast-patch").length;
            if (astCount > 0) {
              console.warn(`[ast-patches] dropped ${astCount} unauthorized ast-patch op(s)`);
              safeOps = safeOps.filter((op) => op.op !== "ast-patch");
            }
          }
          if (safeOps.length === 0) {
            const userGlobsHit = violations.some((v) => matchesUserProtectedGlob(v.path));
            const planScopeHit =
              allowedPathSet !== null &&
              violations.some((v) => !allowedPathSet!.has(v.path));
            emitConversationalFallback(controller, encoder, {
              files: currentFiles,
              summary: planScopeHit
                ? "The change you asked for would touch files outside the plan you approved. Re-send the message and approve the new files in the plan card, or send without Plan first to let me pick the scope."
                : userGlobsHit
                ? "The change you asked for would touch files you've marked as protected in PETAL.md. Update PETAL.md to allow them, or rephrase the request to target other files."
                : "The change you asked for would touch files I keep reserved for the framework (the UI kit / build config). I can do this a different way — tell me the user-visible behavior you want and I'll wire it up in app code instead.",
            });
            return;
          }
          // Pre-apply diff summary — informational only (apply still proceeds).
          // Lets the client render a "what's about to change" card so users
          // see scope before the file writes stream in.
          try {
            const prevByPath = new Map(currentFiles.map((f) => [f.path, f.content]));
            const seen = new Set<string>();
            const changes = safeOps
              .map((op) => {
                if (seen.has(op.path)) return null;
                seen.add(op.path);
                const prev = prevByPath.get(op.path) ?? "";
                let nextSnippet = "";
                if (op.op === "replace") nextSnippet = (op as { replace?: string }).replace ?? "";
                else if (op.op === "create" || op.op === "update")
                  nextSnippet = (op as { content?: string }).content ?? "";
                const prevLines = prev ? prev.split("\n").length : 0;
                const nextLines = op.op === "delete" ? 0 : nextSnippet.split("\n").length;
                return {
                  path: op.path,
                  // Surface ast-patch as "replace" in the preview card —
                  // it's a narrow in-place edit semantically.
                  op: (op.op === "ast-patch" ? "replace" : op.op) as
                    | "create" | "update" | "replace" | "delete",
                  addedLines: op.op === "delete" ? 0 : Math.max(0, nextLines - (op.op === "replace" ? (op as { search?: string }).search?.split("\n").length ?? 0 : prevLines)),
                  removedLines: op.op === "create" ? 0 : op.op === "replace" ? (op as { search?: string }).search?.split("\n").length ?? 0 : prevLines,
                };
              })
              .filter((x): x is NonNullable<typeof x> => x !== null);
            controller.enqueue(
              encoder.encode(sse({ type: "patch_preview", changes, totalFiles: changes.length })),
            );
          } catch {
            /* preview is best-effort; never block apply */
          }
          let patched: ProjectFile[] | null = null;
          try {
            patched = applyOps(currentFiles, safeOps);
          } catch (applyErr) {
            const msg = applyErr instanceof Error ? applyErr.message : String(applyErr);
            // Surgical edit recovery. Run a bounded retry loop for every
            // apply-time patch problem the model can realistically correct:
            // oversized replace, whole-file echo, stale search snippets,
            // ambiguous snippets, missing target files, or placeholder patches.
            if (isRetryablePatchApplyError(msg)) {
              let retryProblem = msg;
              let applied = false;
              for (let attempt = 1; attempt <= 3; attempt++) {
                const gateLabel = retryProblem.startsWith("replace_too_large") ? "replace_too_large" : "must_use_replace";
                console.warn(`[generate] patch apply failed (${gateLabel}) — targeted retry ${attempt}/3`);
                controller.enqueue(
                  encoder.encode(sse({ type: "status", message: attempt === 1 ? "Retargeting the edit against the current files…" : `Trying a narrower edit pass (${attempt}/3)…` })),
                );
                const retry = await structuredRetryCompletion({
                  messages: finalMessages,
                  isInitial,
                  problem: retryProblem,
                  hasBackend: Boolean(backend),
                  tool,
                  maxTokens: Math.max(maxCompletionTokens, 8_000),
                  signal: request.signal,
                  meta: {
                    phase: phaseTag.phase,
                    promptChars: lastUserContent.length,
                    hadAttachments: hasVisionTurn,
                    chosenBy: `${gateLabel}_retry_${attempt}`,
                    projectId: body.projectId ?? null,
                    userId,
                  },
                });
                if (!retry.ok || !retry.body) break;
                const retryCollected = await relayAndCollect(retry, controller, encoder);
                try {
                  const retryPayload = parseCollectedProject(retryCollected, isInitial);
                  if (!retryPayload.parsed.ops?.length) throw new Error("retry returned no ops");
                  const retrySafeOps = retryPayload.parsed.ops.filter((op) => !isProtectedPath(op.path));
                  patched = applyOps(currentFiles, retrySafeOps);
                  collected = retryCollected;
                  parsed = retryPayload.parsed;
                  summary = retryPayload.summary;
                  plan = retryPayload.plan;
                  recap = retryPayload.recap;
                  applied = true;
                  break;
                } catch (retryErr) {
                  retryProblem = retryErr instanceof Error ? retryErr.message : String(retryErr);
                  console.warn(`[generate] chunked retry ${attempt}/3 failed:`, retryProblem);
                  if (!isRetryablePatchApplyError(retryProblem)) break;
                }
              }
              if (!applied) {
                emitConversationalFallback(controller, encoder, {
                  files: currentFiles,
                  summary: body.isAutoFix
                    ? "Reverted to the last working version — the automatic repair couldn't be applied safely."
                    : "I wasn't able to apply that change on this pass. Could you rephrase what you'd like adjusted, or point me at the specific section?",
                });
                return;
              }
            } else {
              throw applyErr;
            }
          }
          if (!patched) throw new Error("Patch did not produce files.");

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

        // Single composition point for all deterministic file-graph
        // repairs (extension normalizer → shadcn imports → array safety →
        // local import resolver → bare import resolver). Runs BEFORE the
        // shell guard / build trigger so Rollup never sees an unresolved
        // import. See src/server/repair-all.server.ts.
        {
          const repaired = runAllRepairs(nextFiles);
          if (repaired.notes.length > 0) {
            for (const n of repaired.notes) console.info("[repair-all]", n);
            nextFiles = repaired.files;
          }
        }

        const shellGuard = ensureRenderableShell(nextFiles, detectedWebSubtype);
        // ROOT-CAUSE GATE: if the model failed to emit a real src/App.tsx,
        // we used to silently inject a "Your app is being prepared"
        // placeholder and ship it as a successful build. That's the bug
        // class behind every "Petal built a blank app" report — a placeholder
        // screen shipped as a finished product. Treat it as a turn failure
        // instead: revert files, never charge credits, and ask the user to
        // retry with a more concrete prompt. index.html + main.tsx repairs
        // are still safe to keep (they only restore the mount point).
        if (shellGuard.fixed.includes("src/App.tsx") && collected.name === "write_project") {
          console.warn("[renderable-shell] model emitted empty/placeholder App.tsx — failing turn");
          emitConversationalFallback(controller, encoder, {
            files: currentFiles,
            summary:
              "I drafted the files but the home screen came back empty, so I rolled it back instead of shipping a placeholder. Could you send your prompt again with a bit more detail about what the first screen should show? Even one sentence like 'a hero with the headline X and a Get Started button' is enough.",
          });
          return;
        }
        nextFiles = shellGuard.files;
        if (shellGuard.fixed.length > 0) {
          console.warn("[renderable-shell] repaired", shellGuard.fixed.join(", "));
          controller.enqueue(
            encoder.encode(sse({ type: "status", message: "Restored the app shell so the preview can render." })),
          );
        }

        const healedImports = stripTypeOnlyValueImports(nextFiles);
        nextFiles = healedImports.files;
        if (healedImports.stripped.length > 0) {
          console.warn(
            `[local-import-heal] healed ${healedImports.stripped.length} invalid value import(s):`,
            healedImports.stripped.map((s) => `${s.file}: { ${s.names.join(", ")} } from "${s.spec}"`).join(" | "),
          );
        }

        // Target-shape validation. For non-default targets, the generated
        // file set MUST match the target's expected shape, or we're about
        // to ship a web app dressed as something else. Fail conversationally
        // so the user can retry instead of shipping a wrong-category build.
        if (collected.name === "write_project") {
          const targetIssue = validateTargetShape(nextFiles, buildTarget.id);
          if (targetIssue) {
            console.warn(`[target-shape] ${buildTarget.id} build failed validation: ${targetIssue}`);
            emitConversationalFallback(controller, encoder, {
              files: currentFiles,
              summary: targetIssue,
            });
            return;
          }
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

        // Tier 2.451 — actually add the real-but-missing packages to
        // package.json. Without this, the AI's bare import (e.g. `import x
        // from "nanoid"`) survives but `npm install` never fetches the
        // package, so the build fails with "Failed to resolve import" the
        // moment Vite tries to bundle it. Force the version to "*" so npm
        // grabs whatever's latest — same safety we apply to AI-emitted deps.
        if (localOut.realButMissing.length > 0) {
          const pkgFile = nextFiles.find((f) => f.path === "package.json");
          if (pkgFile) {
            try {
              const pkg = JSON.parse(pkgFile.content) as {
                dependencies?: Record<string, string>;
              };
              const deps = pkg.dependencies ?? {};
              let added = 0;
              for (const root of localOut.realButMissing) {
                if (!deps[root]) {
                  deps[root] = "*";
                  added += 1;
                }
              }
              if (added > 0) {
                pkg.dependencies = deps;
                pkgFile.content = JSON.stringify(pkg, null, 2) + "\n";
                console.log(
                  `[npm-preflight] added ${added} real-but-missing dep(s) to package.json:`,
                  localOut.realButMissing.join(", "),
                );
              }
            } catch (e) {
              console.warn("[npm-preflight] could not patch package.json:", e);
            }
          }
        }

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

        const generationQualityIssues = findGenerationQualityIssues(nextFiles, detectedWebSubtype);
        if (generationQualityIssues.length > 0) {
          console.warn(
            `[generation-quality] ${generationQualityIssues.length} issue(s):`,
            generationQualityIssues.map((i) => `${i.path}: ${i.detail}`).join("; "),
          );
        }

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
          generationQualityIssues.length > 0 ||
          renderRiskIssues.length > 0 ||
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
          // Render-risk issues open the gate: compile-clean code can still
          // white-screen at runtime (for example undefined.includes()).
          // RLS sanity remains advisory only.
          ...generationQualityIssues,
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
        // P0-D: the bounded agent loop now runs for every user (the labs
        // flag was the kill switch during early testing). All safety limits
        // below remain — 3 cycles max, 90s wall budget, converges the
        // moment local+esbuild verifiers pass, hard-stops on zero progress.
        // Still suppressed for user-initiated "try to fix" turns
        // (`isAutoFix`) so we never recurse into another loop.
        if (!body.isAutoFix) {

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

        // Final runtime guard: every generated app gets a tiny public script
        // that surfaces render crashes or truly blank roots inside the preview
        // iframe. This must run late so post-stream repairs/images cannot drop it.
        const previewGuard = injectPreviewGuard(nextFiles);
        nextFiles = previewGuard.files;
        if (previewGuard.injected) {
          controller.enqueue(
            encoder.encode(sse({ type: "status", message: "Added preview crash protection." })),
          );
        }

        await saveProjectBlueprint(
          body.projectId,
          makeBuildBlueprint({
            projectType: detectedWebSubtype ?? "app",
            prompt: lastUserContent,
            files: nextFiles,
            designDirection,
            hasBackend: Boolean(backend),
            highStakes: hs.detected && hs.domain && hsRoadmap ? { domain: hs.domain, roadmap: hsRoadmap } : null,
          }),
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
        // Pull cached-prefix tokens out of whichever shape the upstream used.
        // OpenAI / Anthropic via OpenRouter: usage.prompt_tokens_details.cached_tokens.
        // Anthropic raw: usage.cache_read_input_tokens.
        const cachedPromptTokens =
          collected.usage?.prompt_tokens_details?.cached_tokens ??
          collected.usage?.cache_read_input_tokens ??
          null;
        void updateLastCallUsage({
          feature: "generate",
          model,
          promptTokens: collected.usage?.prompt_tokens ?? null,
          completionTokens: collected.usage?.completion_tokens ?? null,
          totalTokens: collected.usage?.total_tokens ?? null,
          cachedPromptTokens,
          staticPrefixChars: staticPrefixText.length,
          staticPrefixHash,
          filesSent: isInitial ? 0 : (promptBudget.files?.length ?? 0),
        });
        if (collected.usage?.prompt_tokens) {
          const hitPct =
            cachedPromptTokens && collected.usage.prompt_tokens
              ? ((cachedPromptTokens / collected.usage.prompt_tokens) * 100).toFixed(1)
              : "0.0";
          console.log(
            `[prompt-cache] result prompt=${collected.usage.prompt_tokens} cached=${cachedPromptTokens ?? 0} hit=${hitPct}% model=${model}`,
          );
        }
        let finalCharged = 0;
        if (body.isAutoFix) {
          console.log(`[credits] auto-fix run — skipping charge of ${priced.amount} (would-be)`);
        } else {
          const tryCharge = async (amount: number) =>
            spendCredit({
              userId,
              amount,
              reason: "ai_build_charge",
              projectId: body.projectId ?? null,
              metadata: {
                route: "/api/generate",
                prompt_tokens: priced.promptTokens,
                completion_tokens: priced.completionTokens,
                usage_missing: priced.usageMissing,
                clamped: priced.clamped,
                model,
                priced_amount: priced.amount,
                charged_amount: amount,
              },
            });
          let charge = await tryCharge(priced.amount);
          if (!charge.ok && charge.reason === "insufficient_credits") {
            // User passed the pre-flight floor but doesn't have enough for the
            // full bill. Drain the remaining wallet instead of letting the
            // build go through for free.
            try {
              const { data: wallet } = await supabaseAdmin
                .from("user_wallets")
                .select("monthly_credits_remaining, topup_credits_remaining")
                .eq("user_id", userId)
                .maybeSingle();
              const remaining =
                Number(wallet?.monthly_credits_remaining ?? 0) +
                Number(wallet?.topup_credits_remaining ?? 0);
              const drainAmount = Math.max(0, Math.min(priced.amount, Math.floor(remaining * 100) / 100));
              if (drainAmount > 0) {
                charge = await tryCharge(drainAmount);
                if (charge.ok) finalCharged = drainAmount;
              }
            } catch (e) {
              console.warn("[credits] drain fallback failed", (e as Error).message);
            }
            if (!charge.ok) {
              console.warn("[credits] post-build charge failed", charge);
            }
          } else if (charge.ok) {
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

        // P0-A: Server-side file persistence. Historically the client wrote
        // `project_files` after receiving the `result` SSE event. If the SSE
        // connection dropped, the tab closed, or the user navigated away
        // between `result` and the client write, the entire generation was
        // lost. Write authoritatively from the server here, BEFORE the
        // result event, so the work is durable even if delivery to the
        // client fails. Client still updates its local file map from the
        // SSE payload for instant preview without an extra round-trip.
        if (body.projectId && nextFiles.length > 0) {
          try {
            const cleanFiles = (() => {
              const byPath = new Map<string, { path: string; content: string }>();
              for (const f of nextFiles) {
                const p = f.path.trim();
                if (!p) continue;
                byPath.set(p, { path: p, content: f.content ?? "" });
              }
              return Array.from(byPath.values());
            })();
            const { error: persistErr } = await supabaseAdmin.rpc(
              "replace_project_files",
              { _project_id: body.projectId, _files: cleanFiles } as never,
            );
            if (persistErr) {
              console.error(
                "[persistence] server-side replace_project_files failed",
                { projectId: body.projectId, error: persistErr.message },
              );
            }
          } catch (e) {
            console.error(
              "[persistence] server-side file write threw",
              (e as Error).message,
            );
          }
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
              persisted: Boolean(body.projectId && nextFiles.length > 0),
              ...(backendGate.gated && backendGate.suggestions.length > 0
                ? { suggestions: backendGate.suggestions }
                : {}),
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

        // Kill-switch: this turn produced a usable edit on the primary
        // model — record a success sample so a transient blip doesn't
        // trip the cool-off.
        recordModelOutcome(typeof model === "string" ? model : null, true);

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
          // Kill-switch: feed the hard-fail outcome so a model with a
          // sustained >5% no-edit / generation-incomplete rate auto-rotates
          // out of the primary slot on subsequent turns.
          if (kind === "no_edit_emitted" || kind === "generation_incomplete" || kind === "truncated_response") {
            recordModelOutcome(typeof model === "string" ? model : null, false);
          }
          await markLastCallFailure({
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
        // ROOT-CAUSE GUARD: never let a "no usable edits" failure surface
        // as a red error card. By the time we reach this outer catch, every
        // in-pipeline recovery path (structured retry → tool recovery →
        // deterministic patch → conversational fallback) has already been
        // tried. If something still managed to throw `no_edit_emitted` out
        // here (rare leaked path, future regression, unanticipated throw
        // site), degrade gracefully to a normal Petal reply instead of
        // showing the user "AI did not return usable edits". No credits
        // were charged, files are unchanged — the right UX is a friendly
        // ask-for-clarification message, not a failure card.
        if (!userCancelled && kind === "no_edit_emitted") {
          console.warn(
            "[/api/generate] no_edit_emitted leaked to outer catch — degrading to conversational reply",
            { raw: raw.slice(0, 240) },
          );
          emitConversationalFallback(controller, encoder, {
            files: currentFiles,
            summary:
              "I took a careful look but couldn't pin down a safe change for this one. Could you point me at the specific element or behavior you want adjusted? A short note like 'make the header sticky' or 'change the CTA color to teal' is usually enough for me to land it precisely.",
          });
        } else {
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
        }

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
        emit({ type: "status", message: "Opening the project and preparing the edit…" });

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
