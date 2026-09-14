import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  SYSTEM_PROMPT_INITIAL,
  SYSTEM_PROMPT_PATCH,
  WRITE_PROJECT_TOOL,
  PATCH_FILES_TOOL,
  applyOpsPartial,
  diffChangedPaths,
  type ChatMessage,
  type ProjectFile,
  type FileOp,
  type StreamEvent,
} from "@/server/generate.server";
import { reconcileDocumentHeadOps } from "@/server/document-head.server";
import {
  salvagePartialToolArgs,
  dropUnusableOps,
  dropUnusableFiles,
} from "@/server/tool-args-salvage.server";


import { detectCrossCuttingIntent, pickPinnedPaths } from "@/server/intent-targets.server";
import { resolveEditIntent } from "@/server/edit-intent.server";
import { buildSectionExpansionPatch } from "@/server/section-expansion.server";

import {
  runInspector,
  inspectorBriefingBlock,
  type InspectorReport,
} from "@/server/inspector-agent.server";
import {
  runAgentLoop,
  shouldRunAgentLoop,
  agentLoopSummaryBlock,
  type AgentLoopResult,
  type ChatMessage as AgentChatMessage,
} from "@/server/agent-loop.server";
import {
  runCritic,
  criticDisclosure,
  type CriticRejection,
} from "@/server/critic-agent.server";

import { applyScaffoldKit, applyScaffoldKitForPatch, markKitFileCustomized, STYLES_CSS } from "@/server/scaffold-kit";
import { getBuildTarget } from "@/lib/build-targets";
import { resolveBuildTarget } from "@/lib/target-inference";
import { getWebSubtypeAddendum } from "@/lib/web-subtype";

import { lookupBackendForGenerate, lookupSharedBackendForGenerate } from "@/server/backend-connector.server";
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
import { fetchGroundingPages, renderGroundingBlock, detectGroundingUrls } from "@/server/web-grounding.server";
import { extractCloneBrief, renderCloneBriefBlock, type CloneBrief } from "@/server/site-clone.server";
import { detectIntegrationRequests } from "@/lib/integration-request-intent";
import { validateStylesCss, repairStylesCss } from "@/server/validate-styles.server";
import { verifyFileLocal } from "@/server/local-verifier";
import { resolvePetalImagePlaceholders } from "@/server/image-generation.server";
import { spendCredit, checkCreditBalance } from "@/server/credits.server";
import { checkGenerateRateLimit, rateLimitResponse } from "@/server/rate-limit.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  aiChatCompletions,
  markLastCallFailure,
  updateLastCallUsage,
  hadRecentProviderPaymentFailure,
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
import { renderDesignTasteBlock, renderLandingChecklistBlock } from "@/server/design-taste.server";
import { renderAppUiBlock, renderAppScreenChecklistBlock } from "@/server/app-ui-library.server";
import { renderAppSpecBlock } from "@/server/app-spec.server";
import { MAX_USER_PROMPT_HARD_CEILING_CHARS, promptExceedsHardCeiling } from "@/lib/prompt-limits";

import { findAntiSamenessIssues } from "@/server/anti-sameness.server";
import { COPY_CONTRACT_BLOCK } from "@/server/copy-slop.server";
import { COMPOSITION_CONTRACT_BLOCK } from "@/server/composition-contract.server";
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
import {
  assessChunking,
  assessRouteCoverage,
  parseStepsFromArgs,
  runChunkedGeneration,
} from "@/server/chunked-generation.server";

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
import {
  loadProjectArchitecture,
  renderArchitectureBlock,
  saveProjectArchitecture,
} from "@/server/architecture-doc.server";

import { findGenerationQualityIssues } from "@/server/generation-quality-gate.server";
import { verifyFilesEsbuild } from "@/server/esbuild-verifier.server";
import { isScaffoldAbsorbedPath, isScaffoldOwnedPath } from "@/server/scaffold-ownership.server";
import {
  runWriteGate,
  writeGateDisclosure,
  type WriteRejection,
} from "@/server/write-gate.server";
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
import { ensureRenderableShell } from "@/server/renderable-shell.server";
import { runAllRepairs } from "@/server/repair-all.server";
import { TurnCostMeter } from "@/server/turn-cost-ceiling.server";
import { entriesFromRepairNotes, recordRepairs, signatureOf } from "@/server/repair-ledger.server";
import {
  analyzeEditScope,
  renderScopeContractBlock,
  scopeDisclosure,
} from "@/server/edit-scope-guard.server";
import { decideBackendGate, renderBackendGateBlock } from "@/server/two-phase-gate.server";
import { startTurn, type TurnRecorderHandle } from "@/server/turn-recorder.server";
import { openTurnCompletion, markStage } from "@/server/turn-completion.server";
import { persistAbandonedTurnReply } from "@/server/abandoned-turn-reply.server";
import {
  proposeChangePlan,
  savePlan,
  loadAndConsumePlan,
  buildAllowedPathSet,
  renderApprovedPlanBlock,
  shouldAutoPlan,
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
  /** When true, this run is an internal auto-fix triggered by Petal itself
   *  after a failed build. It changes prompt shaping and scaffold healing
   *  ONLY — it does NOT skip credit checks or charging. Every model call
   *  costs money, so every model call is metered. */
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
  /** Plan Mode v2 — set false to opt out of the automatic plan proposal
   *  (the composer sends this when the user picked "Just build it", or when
   *  they turned auto-plan off in settings). Defaults to true. */
  autoPlan?: boolean;
  /** Canonical restatement from triage. Supplementary context only; the
   * original user message remains authoritative for detail. */
  intentBrief?: string;
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
  crossCuttingIntent?: boolean;
  promptChars?: number;
}): number {
  // First builds must emit a complete project tool payload. Detailed briefs
  // routinely need more than the old flat 12k ceiling; retrying at the exact
  // same ceiling only reproduced the truncation. Scale conservatively with
  // brief size while keeping small requests inexpensive.
  if (args.isInitial) {
    if ((args.promptChars ?? 0) >= 700) return 20_000;
    if ((args.promptChars ?? 0) >= 350) return 16_000;
    return 14_000;
  }
  if (args.multiEditIntent || args.crossCuttingIntent) return 12_000;
  if (args.hasVisionTurn) return 8_000;
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
  pinnedPaths: string[] = [],
  // Paths resolved as the literal target of a targeted edit. These are never
  // truncated: the model has to quote their bytes verbatim in `replace` ops,
  // and a "...trimmed for context budget..." tail is exactly how a targeted
  // edit turns into a hallucinated snippet that fails to match.
  fullPaths: string[] = [],
): { files: ProjectFile[]; omitted: number } {

  const multiEditIntent = detectMultiEditIntent(latestPrompt);
  const full = new Set(fullPaths);
  const pinned = new Set([...pinnedPaths, ...fullPaths]);

  // Cross-cutting intents need a larger budget — the whole point of pinning
  // is so the model sees every page/component at once.
  const expandForPinned = pinned.size > 0;
  const fileLimit = expandForPinned
    ? Math.max(MULTI_EDIT_CONTEXT_FILE_LIMIT, pinned.size + 8)
    : multiEditIntent
      ? MULTI_EDIT_CONTEXT_FILE_LIMIT
      : PATCH_CONTEXT_FILE_LIMIT;
  const charLimit = expandForPinned
    ? Math.max(MULTI_EDIT_CONTEXT_CHAR_LIMIT * 2, MULTI_EDIT_CONTEXT_CHAR_LIMIT)
    : multiEditIntent
      ? MULTI_EDIT_CONTEXT_CHAR_LIMIT
      : PATCH_CONTEXT_CHAR_LIMIT;
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
    if (full.has(path)) return -2; // resolved edit target — first in the prompt
    if (pinned.has(path)) return -1; // pinned wins over everything

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
    if (picked.length >= fileLimit && !pinned.has(file.path)) break;
    const isPinned = pinned.has(file.path);
    const limit = full.has(file.path)
      ? Number.POSITIVE_INFINITY
      : isPinned || isPromptRelevant(file)
        ? RELEVANT_FILE_CONTEXT_CHAR_LIMIT
        : LARGE_FILE_CONTEXT_CHAR_LIMIT;

    const content =
      file.content.length > limit
        ? `${file.content.slice(0, limit)}\n\n/* ...trimmed for context budget... */`
        : file.content;
    const cost = file.path.length + content.length + 32;
    // Pinned files bypass the soft char budget — they were chosen
    // explicitly because the model NEEDS to see their bytes.
    if (!isPinned && picked.length > 0 && used + cost > charLimit) continue;
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

type EditFailureDiagnostic = {
  turnId: string;
  projectId: string | null;
  userId: string | null;
  model: string | null;
  reason: string;
  isInitial: boolean;
  toolName: "write_project" | "patch_files" | null;
  totalOps?: number;
  safeOps?: number;
  protectedOps?: Array<{ op: string; path: string }>;
  astDroppedOps?: number;
  appliedOps?: Array<{ op: string; path: string }>;
  failedOps?: Array<{ op: string; path: string; error: string }>;
  rewrittenPaths?: string[];
  changedPaths?: string[];
  affectedPaths?: string[];
  summary?: string;
};

function opDigest(op: FileOp): { op: string; path: string } {
  return { op: op.op, path: op.path };
}

function diagnosticSignature(reason: string, paths: string[] = []): string {
  const normalizedPaths = paths.slice(0, 4).join(",");
  return `edit_pipeline:${reason}:${normalizedPaths}`.slice(0, 120);
}

function recordEditFailureDiagnostic(args: EditFailureDiagnostic): void {
  const paths = args.affectedPaths ?? [
    ...(args.failedOps ?? []).map((o) => o.path),
    ...(args.appliedOps ?? []).map((o) => o.path),
    ...(args.protectedOps ?? []).map((o) => o.path),
    ...(args.changedPaths ?? []),
  ];
  const uniquePaths = Array.from(new Set(paths)).slice(0, 12);
  const raw = [
    `edit_pipeline:${args.reason}`,
    args.toolName ? `tool=${args.toolName}` : null,
    `ops=${args.safeOps ?? args.totalOps ?? 0}/${args.totalOps ?? 0}`,
    uniquePaths.length ? `paths=${uniquePaths.join(", ")}` : null,
  ].filter(Boolean).join(" ");

  void (async () => {
    try {
      const { error } = await supabaseAdmin.from("pipeline_failures").insert({
        project_id: args.projectId,
        user_id: args.userId,
        surface: "generate-edit",
        raw_message: raw.slice(0, 4000),
        signature: diagnosticSignature(args.reason, uniquePaths),
        tool_name: args.toolName,
        model: args.model,
        stream_tail: null,
        extra: {
          turn_id: args.turnId,
          reason: args.reason,
          is_initial: args.isInitial,
          total_ops: args.totalOps ?? null,
          safe_ops: args.safeOps ?? null,
          protected_ops: args.protectedOps ?? [],
          ast_dropped_ops: args.astDroppedOps ?? 0,
          applied_ops: args.appliedOps ?? [],
          failed_ops: args.failedOps ?? [],
          rewritten_paths: args.rewrittenPaths ?? [],
          changed_paths: args.changedPaths ?? [],
          affected_paths: uniquePaths,
          summary: args.summary?.slice(0, 500) ?? null,
        },
      });
      if (error) console.warn("[edit-diagnostics] insert failed", error.message);
    } catch (err) {
      console.warn("[edit-diagnostics] insert threw", err);
    }
  })();
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

async function loadEconomyMode(userId: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("economy_mode")
      .eq("id", userId)
      .maybeSingle();
    return data?.economy_mode ?? false;
  } catch (e) {
    console.warn("[generate] failed to load economy_mode", e);
    return false;
  }
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
 * for this long, we cancel the read and surface an upstream_timeout. Bumped
 * high so long deep-reasoning turns aren't killed while the model is
 * thinking between file emits — the real signal of a wedged provider is
 * "nothing for several minutes", not "nothing for 75s".
 */
const STREAM_IDLE_TIMEOUT_MS = 480_000;

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
  // Plan-first execution. The model writes `steps` before any file, so we can
  // show the user the whole checklist up front and then tick items off as the
  // files tagged with each step land. `stepsEmitted` is the count already sent
  // (the array streams element by element); `activeStep` is the 1-based item
  // currently being worked on.
  let stepsEmitted = 0;
  let activeStep = 0;

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
  // Per-file `"step": N` tag, paired with the nearest preceding path the same
  // way narration is.
  const STEP_RE = /"step"\s*:\s*(\d+)/g;
  /**
   * Pull the completed elements of the top-level `steps` array out of the
   * streaming JSON. Only strings that have actually closed are returned, so a
   * half-written step never reaches the user.
   */
  const partialSteps = (): string[] => {
    const m = tool.args.match(/"steps"\s*:\s*\[([\s\S]*?)(\]|$)/);
    if (!m) return [];
    const out: string[] = [];
    const ITEM_RE = /"((?:\\.|[^"\\])*)"(?=\s*[,\]]|\s*$)/g;
    let im: RegExpExecArray | null;
    while ((im = ITEM_RE.exec(m[1])) !== null) {
      // Without a closing bracket the final match may still be growing, so we
      // only trust items followed by a real delimiter.
      const rest = m[1].slice(ITEM_RE.lastIndex);
      if (!m[2] && !/^\s*[,\]]/.test(rest)) break;
      let text = im[1];
      try { text = JSON.parse(`"${im[1]}"`); } catch { /* keep raw */ }
      const trimmed = String(text).trim().replace(/\s+/g, " ").slice(0, 90);
      if (trimmed) out.push(trimmed);
    }
    return out.slice(0, 8);
  };
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
          // Plan-first: push the checklist the moment new items close, so the
          // user reads the whole plan before the first file arrives.
          const stepsNow = partialSteps();
          if (stepsNow.length > stepsEmitted) {
            stepsEmitted = stepsNow.length;
            controller.enqueue(encoder.encode(sse({ type: "build_steps", steps: stepsNow })));
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
          // Tick the checklist forward using each file's `step` tag. Steps
          // only ever move forward; everything before the active item is done.
          STEP_RE.lastIndex = 0;
          let sm: RegExpExecArray | null;
          let latestStep = activeStep;
          while ((sm = STEP_RE.exec(tool.args)) !== null) {
            const n = Number(sm[1]);
            if (Number.isFinite(n) && n > latestStep) latestStep = n;
          }
          if (latestStep > activeStep && stepsEmitted > 0) {
            for (let i = activeStep; i < Math.min(latestStep - 1, stepsEmitted); i++) {
              controller.enqueue(encoder.encode(sse({ type: "step_status", index: i, status: "done" })));
            }
            activeStep = Math.min(latestStep, stepsEmitted);
            controller.enqueue(
              encoder.encode(sse({ type: "step_status", index: activeStep - 1, status: "active" })),
            );
          }

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
  // Stream is over — every checklist item the model published is finished, so
  // close them out rather than leaving one stuck on "active".
  for (let i = 0; i < stepsEmitted; i++) {
    controller.enqueue(encoder.encode(sse({ type: "step_status", index: i, status: "done" })));
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
  return /AI did not return (?:a project|usable edits)|AI tried to (?:rewrite|patch)|response was cut off|AI returned (?:no (?:files|ops)|invalid (?:project|edit) data)/i.test(msg);
}

async function structuredRetryCompletion(args: {
  messages: Array<{ role: string; content: unknown }>;
  isInitial: boolean;
  problem: string;
  hasBackend: boolean;
  tool: typeof WRITE_PROJECT_TOOL | typeof PATCH_FILES_TOOL;
  maxTokens: number;
  crossCuttingIntent?: boolean;
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
      crossCuttingIntent: args.crossCuttingIntent,
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
    // No providerOverride: follow the resolved provider (DB → env → OpenRouter
    // when its key is set). Pinning "lovable" here meant a funded OpenRouter
    // account was never used and every turn died on the Lovable gateway's 402.
    lockCallerModel: true,
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
    // No providerOverride: follow the resolved provider (DB → env → OpenRouter
    // when its key is set). Pinning "lovable" here meant a funded OpenRouter
    // account was never used and every turn died on the Lovable gateway's 402.
    lockCallerModel: true,
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
  crossCuttingIntent?: boolean;
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
    maxTokens: args.isInitial ? 22_000 : 10_000,
    crossCuttingIntent: args.crossCuttingIntent,
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
/**
 * Iteration Standard #1 — emit the single terminal state of this turn.
 * Always call this immediately before the `result` event, exactly once.
 */
function emitTurnOutcome(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  args: {
    outcome: "applied" | "answered" | "blocked" | "failed";
    changedPaths: string[];
    blockedPaths?: string[];
    reason?: string;
  },
): void {
  controller.enqueue(
    encoder.encode(
      sse({
        type: "turn_outcome",
        outcome: args.outcome,
        changedPaths: args.changedPaths.slice(0, 50),
        ...(args.blockedPaths && args.blockedPaths.length
          ? { blockedPaths: Array.from(new Set(args.blockedPaths)).slice(0, 20) }
          : {}),
        ...(args.reason ? { reason: args.reason } : {}),
      }),
    ),
  );
}


function emitConversationalFallback(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  args: {
    summary: string;
    files: ProjectFile[];
    suggestions?: string[];
    /** Defaults to "answered". Pass "blocked" when edits were refused. */
    outcome?: "answered" | "blocked";
    blockedPaths?: string[];
    reason?: string;
    streamSummary?: boolean;
  },
): void {
  if (args.streamSummary !== false) {
    controller.enqueue(
      encoder.encode(sse({ type: "summary_delta", delta: args.summary })),
    );
  }
  emitTurnOutcome(controller, encoder, {
    outcome: args.outcome ?? "answered",
    changedPaths: [],
    blockedPaths: args.blockedPaths,
    reason: args.reason,
  });
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

function emitDeterministicRepair(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  args: { summary: string; files: ProjectFile[]; changedPaths?: string[] },
): void {
  controller.enqueue(encoder.encode(sse({ type: "summary_delta", delta: args.summary })));
  emitTurnOutcome(controller, encoder, {
    outcome: "applied",
    changedPaths: args.changedPaths ?? [],
  });
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
    // All-or-nothing parsing used to sink whole turns: one truncated element
    // at the tail of a big multi-part edit discarded every complete op before
    // it. Salvage the complete prefix instead — the user gets the work the
    // model actually finished, and the pipeline's follow-up/verify passes
    // handle whatever is still missing.
    const salvaged = salvagePartialToolArgs(collected.args, collected.name);
    if (salvaged) {
      console.warn(
        `[generate] salvaged ${salvaged.recovered} ${collected.name === "write_project" ? "file(s)" : "op(s)"} from a ${salvaged.truncated ? "truncated" : "malformed"} tool payload`,
      );
      parsed = salvaged.parsed as ParsedProjectPayload["parsed"];
    } else {
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
  }

  // A provider can report `length` / `max_tokens` after already closing valid
  // tool JSON, or after closing several complete ops and truncating only the
  // tail. The old early finish-reason guard rejected both cases before the
  // parser and per-op salvage above could inspect them. At this point we have
  // either parsed the complete payload or recovered its complete prefix, so it
  // is safe to continue. A genuinely unusable truncation still throws from the
  // catch above and enters the structured retry path.
  if (isTruncatedFinishReason(collected.finishReason)) {
    console.warn(
      `[generate] accepting usable ${collected.name} payload despite finish reason ${collected.finishReason}`,
    );
  }

  // A single structurally-broken entry must not fail a turn that also carries
  // good ones. Drop the unusable entries, keep the rest.
  if (Array.isArray(parsed.files)) {
    const { files, dropped } = dropUnusableFiles(
      parsed.files as unknown as Record<string, unknown>[],
    );
    if (dropped > 0) {
      console.warn(`[generate] dropped ${dropped} unusable file entr(ies)`);
      parsed.files = files as unknown as ParsedProjectPayload["parsed"]["files"];
    }
  }
  if (Array.isArray(parsed.ops)) {
    const { ops, dropped } = dropUnusableOps(parsed.ops as unknown as Record<string, unknown>[]);
    if (dropped > 0) {
      console.warn(`[generate] dropped ${dropped} unusable op(s)`);
      parsed.ops = ops as unknown as ParsedProjectPayload["parsed"]["ops"];
    }
  }

  if (collected.name === "write_project" && !parsed.files?.length) {
    throw new Error("AI returned no files.");
  }
  if (collected.name === "patch_files" && (!Array.isArray(parsed.ops) || parsed.ops.length === 0)) {
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
      // `narration` and `step` are streaming-only UI fields — they must never
      // reach the writer, verifier, or persistence layers.
      const { narration: _drop, step: _step, ...rest } = o as FileOp & {
        narration?: string;
        step?: number;
      };
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
  args: { isInitial: boolean; problem: string; hasBackend?: boolean; crossCuttingIntent?: boolean },
): T {
  const requiredTool = args.isInitial ? "write_project" : "patch_files";
  const backendHint =
    args.hasBackend === false
      ? ` This project has no backend connected. Do not import from "@/integrations/backend/*" or "@supabase/supabase-js" and do not add real auth or persistence wiring. Still complete the requested frontend with realistic inline data. Marketing navigation labels such as "Log in" and "Sign up" are valid presentation UI and must not block the build. Do not mention backend setup unless the user's latest request explicitly asks for working accounts, authentication, or persistent data.`
      : "";
  const chunkHint = args.problem.startsWith("replace_too_large")
    ? " Split the change into MULTIPLE small \`replace\` ops, each with a \`search\` snippet under ~160 lines / 8 KB. Target one logical region per op."
    : args.problem.startsWith("destructive_shrink")
      ? " You returned a much shorter file than the original — that destroys the user's app. DO NOT resend the file as a stub. Use \`replace\` ops that change only the specific lines that need to change, and preserve everything else."
      : "";
  const scopeHint = args.crossCuttingIntent
    ? " This is a broad redesign/cross-page edit with enough scope already; DO NOT ask for a smaller target. Emit real file edits that satisfy the whole requested surface."
    : "";
  const retryBlock = `\n\nSTRUCTURED RETRY — your previous response could not be applied (${args.problem}). Retry now with a smaller, safer ${requiredTool} tool call. You MUST call ${requiredTool}; return complete JSON tool arguments only; include every required field.${scopeHint} For edit turns, prefer exact \`replace\` ops for small changes instead of resending whole files.${chunkHint} Keep files short and split large UI into components. If this is an initial app, build a focused MVP that works instead of a giant showcase: 4-8 app files max, no file over 140 lines, no long content blocks.${backendHint}`;
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

  // "Add more sections to the website" and friends. Handled by a dedicated
  // module so the intent lands on any generated app shape, not just the
  // three hard-coded page paths this used to check.
  const expansion = buildSectionExpansionPatch({
    currentFiles: args.currentFiles,
    prompt: args.latestUserContent,
  });
  if (!expansion) return null;

  return {
    parsed: {
      plan: expansion.plan,
      summary: expansion.summary,
      ops: expansion.ops as ParsedProjectPayload["parsed"]["ops"],
      recap: expansion.recap,
    },
    summary: expansion.summary,
    plan: expansion.plan,
    recap: expansion.recap,
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

/**
 * Petal v3 Phase A — the closed-loop pre-emit gate.
 *
 * Was: a single-round, parse-only check. A file could parse perfectly and
 * still ship a white screen because it imported a sibling that didn't exist
 * or referenced an undeclared identifier — neither of which esbuild's parser
 * has any opinion about. Those defects only surfaced later, in the remote
 * `vite build`, long after the turn was reported complete.
 *
 * Now: every deterministic verifier we own (esbuild parse + local structural
 * verifier + render-risk linter) runs here, and blocking diagnostics are fed
 * back to the repair model for a bounded number of rounds before anything is
 * emitted. The gate keeps the best state it saw and stops the moment a round
 * stops making progress, so it can neither regress the files nor spin.
 */
async function runFinalParseGuard(
  files: ProjectFile[],
  changedPaths: string[],
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  prd?: import("@/server/prd/prd-types").Prd | null,
): Promise<{ ok: true; files: ProjectFile[] } | { ok: false; detail: string }> {
  const { runPreEmitGate, formatGateIssues } = await import("@/server/preemit-gate.server");

  const { files: gated, report } = await runPreEmitGate(files, changedPaths, {
    maxRounds: 2,
    prd,
    onRound: (round, issues) => {
      console.warn(
        `[preemit-gate] round ${round}: ${issues.length} blocking issue(s):`,
        formatGateIssues(issues),
      );
      controller.enqueue(
        encoder.encode(
          sse({
            type: "status",
            message:
              round === 1
                ? "Repairing one last syntax issue…"
                : "Still tidying up a couple of issues…",
          }),
        ),
      );
    },
    // Deterministic repairs must re-run over the model's output: a repair
    // round can reintroduce an unresolved import that the resolver already
    // knows how to pin, and re-running is cheaper than another model round.
    afterRepair: (candidate) => runAllRepairs(candidate).files,
  });

  if (report.rounds > 0) {
    console.log(`[preemit-gate] ${report.trace.join(" | ")}`);
  }

  if (!report.ok) {
    // Don't throw — let the caller revert to the prior good files and reply
    // conversationally. A failed gate is NOT an infra error; it just means
    // this turn's edits weren't safe to ship.
    return { ok: false, detail: formatGateIssues(report.issues, 3) };
  }
  return { ok: true, files: gated };
}


async function handleGenerateRequestCore(
  request: Request,
  turnId?: string,
  // Work signal — deliberately NOT `request.signal`. Closing the tab must
  // never kill an in-flight build: the caller passes a detached controller
  // that only aborts on an explicit user stop, so the pipeline runs to
  // completion server-side and the client can reattach via the turn id.
  workSignal?: AbortSignal,
): Promise<Response> {
  const abortSignal = workSignal ?? request.signal;
  // One durable identity must follow the logical turn through telemetry,
  // reconnects and billing. Creating a second id inside the stream broke the
  // database's exactly-once settlement guarantee on transport retries.
  const logicalTurnId = turnId ?? crypto.randomUUID();
  const authResult = await authorize(request);
  if (authResult instanceof Response) return authResult;
  const userId = authResult;

  const economyMode = await loadEconomyMode(userId);

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
  // `let`: the pre-emit agent loop may land a codemod, and every downstream
  // stage (apply, recovery, repairs, ledger) must diff against the post-codemod
  // state, not the state the request arrived with.
  let currentFiles = Array.isArray(body.currentFiles) ? body.currentFiles : [];
  /**
   * Iteration Standard #2 — immutable snapshot of the project as it was when
   * this turn started. The turn's terminal state is decided by byte-diffing
   * the final files against THIS, never by trusting the model's prose.
   */
  const turnBaselineFiles = currentFiles;

  /**
   * AI Generation Bible §7 — the repair phase is bounded by rounds AND by a
   * hard cost ceiling. Rounds alone don't bound spend: one repair pass over a
   * 40-file project costs more than ten over a small one. Repair is Petal's
   * cost, never the user's, so this ceiling protects margin and kills
   * pathological loops; it is never surfaced as "you ran out".
   */
  const repairMeter = new TurnCostMeter();
  if (messages.length === 0) {
    return new Response("messages must not be empty", { status: 400 });
  }

  // The active instruction is preserved in full. Older history is compacted
  // by the context-budget layer; only an exceptional memory-safety ceiling is
  // rejected here.
  const lastContent = latestUserMessage(messages);
  const intentBrief = (body.intentBrief ?? "").trim().slice(0, 600);
  if (promptExceedsHardCeiling(lastContent)) {
    return new Response(
      JSON.stringify({
        error: `This request exceeds the ${MAX_USER_PROMPT_HARD_CEILING_CHARS.toLocaleString()} character safety ceiling. Attach the source as a file or remove repeated logs.`,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Every user-initiated AI turn must have at least the build floor available,
  // including Plan-first proposals. Keep this before every early-return path
  // so an empty wallet cannot still consume planning or generation tokens.
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

  // The real bill is settled AFTER the build (token-priced), so the cheap
  // floor check above is a TOCTOU window: N parallel requests all pass it and
  // all get delivered while only the first can be paid for. One build in
  // flight per user closes that window. The lock is TTL-based so a crashed or
  // aborted turn can never lock a user out permanently.
  if (!(await acquireBuildLock(userId, body.projectId))) {
    return new Response(
      JSON.stringify({
        error:
          "You already have a build running. Wait for it to finish before starting another one.",
      }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  }


  // ===========================================================================
  // Plan Mode v1 — propose-only short-circuit.
  // When `planFirst` is true and there is no `approvedPlanId` yet, we run the
  // cheap planning model, persist the plan, emit `plan_proposed`, and end the
  // stream. The composer renders the plan as an approval card; the user picks
  // files (or accepts all) and POSTs back with `approvedPlanId` to resume.
  // ===========================================================================
  // Plan Mode v2 — a substantial change proposes its scope before touching
  // files, whether or not the user found the "Plan first" toggle. Trivial
  // edits and first builds skip straight through.
  const autoPlanWanted =
    body.autoPlan !== false &&
    !body.isAutoFix &&
    Boolean(body.projectId) &&
    shouldAutoPlan({
      prompt: lastContent,
      fileCount: currentFiles.length,
      isInitial: currentFiles.length === 0,
      isAutoFix: body.isAutoFix,
    });

  if ((body.planFirst || autoPlanWanted) && !body.approvedPlanId) {
    if (!body.projectId) {
      releaseBuildLock(userId, body.projectId);
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
            intentBrief,
            history: messages,
            currentFiles,
            signal: abortSignal,
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
                auto: !body.planFirst,
                summary: plan.summary,
                risk: plan.risk,
                files: plan.files,
              }),
            ),
          );
        } catch (e) {
          const raw = e instanceof Error ? e.message : "Planning failed.";
          console.error("[/api/generate] plan_proposal failed", raw);
          if (!body.planFirst) {
            // Auto-plan is a courtesy, not a gate: if planning fails we tell
            // the client to just run the turn rather than stranding the user.
            controller.enqueue(
              planEncoder.encode(sse({ type: "plan_skipped", reason: "planning_failed" })),
            );
          } else {
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
          }
        } finally {
          releaseBuildLock(userId, body.projectId);
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
  const isInitial = currentFiles.length === 0;
  const baseSystem = isInitial ? SYSTEM_PROMPT_INITIAL : SYSTEM_PROMPT_PATCH;

  // Build target. The composer's chip rail was removed on the premise that the
  // target would be inferred from what the user typed — but the inference was
  // never built, so `x-petal-target` (default "web") decided everything and a
  // plainly-worded "build me a Chrome extension" shipped a web app.
  // Precedence: an explicit non-web header still wins; otherwise we read the
  // prompt.
  const headerTarget = request.headers.get("x-petal-target");
  const resolvedTarget = resolveBuildTarget(headerTarget, lastContent);
  const buildTargetId = resolvedTarget.target;
  const buildTarget = getBuildTarget(buildTargetId);
  if (resolvedTarget.source === "inferred") {
    console.log(
      `[build-target] project=${body.projectId ?? "n/a"} inferred="${buildTargetId}" confidence=${resolvedTarget.confidence.toFixed(2)}`,
    );
  }


  // PRD Engine. Before anything else decides what to build, we resolve the
  // product contract for this turn: authored on the first build, amended (only
  // when the request actually changes the product's shape) on later turns.
  // The PRD is the authority — the keyword sub-type router now follows it
  // rather than guessing independently.
  let prdBlock = "";
  let prdScenarioBlock = "";
  let prdNote = "";
  let resolvedPrd: Awaited<ReturnType<typeof import("@/server/prd/prd-engine.server").resolvePrdForTurn>> | null =
    null;
  if (buildTarget.id === "web") {
    try {
      const { resolvePrdForTurn } = await import("@/server/prd/prd-engine.server");
      resolvedPrd = await resolvePrdForTurn({
        brief: lastContent,
        projectId: body.projectId,
        userId,
      });
      prdBlock = resolvedPrd.promptBlock;
      prdScenarioBlock = resolvedPrd.scenarioBlock;
      prdNote = resolvedPrd.note;
      // When the contract itself changed, Petal must say so in one sentence
      // rather than silently reshaping the product.
      if (prdNote) {
        prdBlock += `\n\n### Contract change (state this to the user in one sentence before you build)\n${prdNote}\n`;
      }
      const { recordPrdEvent } = await import("@/server/prd/prd-telemetry.server");
      recordPrdEvent({
        event: resolvedPrd.authored ? "authored" : "amended",
        projectId: body.projectId ?? null,
        prd: resolvedPrd.prd,
        amendment: resolvedPrd.amendment,
      });
      console.log(
        `[prd] project=${body.projectId ?? "n/a"} product="${resolvedPrd.prd.productName}" type=${resolvedPrd.prd.productType} authored=${resolvedPrd.authored} amendment=${resolvedPrd.amendment} surfaces=[${resolvedPrd.prd.requiredSurfaces.join(",")}]`,
      );
    } catch (e) {
      console.warn("[prd] resolution skipped:", e instanceof Error ? e.message : String(e));
    }
  }

  // Sub-type routing for the catch-all `web` target. Without this a
  // "landing page for X" and a "CRM for Y" both get the same generic web
  // prompt and the model picks an app-shell vs marketing layout at random.
  // Only consulted on initial generation — subsequent turns inherit the
  // shape already in `currentFiles`.
  let webSubtypeBlock = "";
  let detectedWebSubtype: import("@/lib/web-subtype").WebSubtype | undefined;
  if (buildTarget.id === "web" && isInitial) {
    // Defect C: reconcile the keyword rules with the predicted app shape so
    // the two classifiers can never hand the planner contradictory shapes.
    const { classifyAppShape } = await import("@/lib/app-shape-classifier");
    const { resolveWebSubtype } = await import("@/lib/web-subtype");
    const resolved = resolveWebSubtype(lastContent, classifyAppShape(lastContent));
    // The PRD wins. A single-purpose tool must not be routed to the app-shell
    // prompt just because a keyword matched — that is what shipped a dashboard
    // instead of a calculator.
    detectedWebSubtype = resolvedPrd?.subtype ?? resolved.subtype;
    webSubtypeBlock = `\n\n${getWebSubtypeAddendum(detectedWebSubtype)}\n`;
    console.log(
      `[web-subtype] project=${body.projectId ?? "n/a"} detected="${detectedWebSubtype}" keyword="${resolved.keywordSubtype}" prd="${resolvedPrd?.subtype ?? "n/a"}" reason="${resolved.reason}"`,
    );
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
  const sharedBackend =
    !backend && body.projectId ? await lookupSharedBackendForGenerate(body.projectId) : null;

  const sharedBackendBlock = sharedBackend
    ? `\n\n### Backend (Petal Cloud, shared tier) is connected\nThis project has a FREE shared backend: a real database + user accounts, no SQL and no migrations. Use the pre-configured client — never call createClient, never import @supabase/supabase-js, never write SQL or emit a MIGRATION block.\n\nImports:\n- import { db, auth } from "@/integrations/backend/client"\n- import { useAuth, AuthProvider } from "@/integrations/backend/auth"\n\nData API (collections are created on first write):\n- await db.list<T>("tasks", { mine: true, limit: 50 }) -> { records }\n- await db.create("tasks", { title, done: false })\n- await db.update("tasks", id, { done: true })\n- await db.remove("tasks", id)\nEach record is { id, collection, user_id, data, created_at, updated_at } — your fields live under \`record.data\`.\n\nAuth: auth.signUp / auth.signIn / auth.signOut, or useAuth() for { user, loading }. Wrap the app once with <AuthProvider>.\nLimits: 5,000 rows and 25 collections. Never overwrite anything under src/integrations/backend/ — protected.\n`
    : "";

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

  // Layer K — Web grounding. If the user pointed at a URL and asked to
  // clone / recreate / build from / grab copy from it, fetch the page(s)
  // and inject their text as grounding so the model writes real copy
  // instead of hallucinating. Failure-tolerant and bounded (2 URLs max,
  // 6s timeout each) — never blocks a turn.
  const groundingPages = await fetchGroundingPages(resolverText).catch(() => []);
  // Clone-from-URL: the text alone never made the result LOOK like the source.
  // Read the same page's design system (palette, type, radius, section order)
  // so "build me a site like X" inherits X's visual language instead of a
  // generic template. Same bounded, failure-tolerant contract as grounding.
  const cloneBriefs = (
    await Promise.all(
      detectGroundingUrls(resolverText).map((u) =>
        extractCloneBrief(u).catch(() => null),
      ),
    )
  ).filter((b): b is CloneBrief => b !== null);
  const groundingBlock =
    renderGroundingBlock(groundingPages) + renderCloneBriefBlock(cloneBriefs);


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
  // Re-render the full committed direction on every turn. The director reads
  // the persisted value first, so edits retain density, motion, FX recipe and
  // concrete design moves instead of degrading to the blueprint's one-line
  // visual summary.
  const designDirection = userJwt
    ? await pickDesignDirection({
        jwt: userJwt,
        projectId: body.projectId,
        brief: lastUserContent,
        memoryEntries,
      })
    : null;
  const designBlock = designDirection ? renderDesignDirectionBlock(designDirection) : "";

  // ---------------------------------------------------------------------------
  // Project Intelligence Context (PIC) — Engine 3.0, phases 1 & 2.
  //
  // One canonical understanding of the project (what it is, who it is for,
  // what it needs) plus a committed design system contract, assembled before
  // any code is written and reused by every later turn. Model passes run on
  // initial/structural turns only; small edits reuse the stored context.
  //
  // Fully additive and fail-open: any failure leaves `picBlock` empty and the
  // pipeline below behaves exactly as it did before.
  // ---------------------------------------------------------------------------
  let picBlock = "";
  let picContext: import("@/server/pic/pic-types").ProjectIntelligenceContext | null = null;
  if (process.env.PETAL_PIC_DISABLED !== "1") {
    try {
      const { assemblePic } = await import("@/server/pic/pic-assemble.server");
      const { renderPicBlock } = await import("@/server/pic/pic-render");
      // Structural = anything that changes product shape: the first build, a
      // cross-cutting request, or a new page/feature.
      const isStructural =
        isInitial ||
        /\b(redesign|re-?design|rebuild|new (page|screen|feature|section)|add (a )?(page|dashboard|auth|login|payment|checkout)|entire (site|website|app)|whole (site|app))\b/i.test(
          lastUserContent || "",
        );
      const assembled = await assemblePic({
        projectId: body.projectId,
        brief: lastUserContent || lastContent,
        isInitial,
        isStructural,
        memoryEntries,
        userId,
        turnId: turnId ?? undefined,
        signal: request.signal,
      });
      picContext = assembled.pic;
      picBlock = `\n\n${renderPicBlock(assembled.pic, { detail: isStructural ? "full" : "summary" })}\n`;
      console.log(
        `[pic] project=${body.projectId ?? "n/a"} rev=${assembled.pic.revision} refreshed=${assembled.refreshed} understanding=${assembled.pic.understanding.source} design=${assembled.pic.design?.source ?? "none"} structural=${isStructural}`,
      );
    } catch (e) {
      console.warn("[pic] assembly skipped:", e instanceof Error ? e.message : String(e));
    }
  }
  void picContext;


  // ---------------------------------------------------------------------------
  // Petal Intelligence — multi-agent planning board.
  //
  // Convenes the specialists this turn actually deserves (a colour tweak gets
  // none; a marketplace gets the full board), reconciles their conflicts, and
  // returns one binding-decisions block. Fully additive: any failure returns an
  // empty block and the pipeline below runs exactly as it did before.
  // ---------------------------------------------------------------------------
  let orchestrationBlock = "";
  try {
    const { orchestrateTurn, summarizeOrchestration } = await import(
      "@/server/agents/orchestrator.server"
    );
    const orchestration = await orchestrateTurn({
      turnId: turnId ?? `turn-${Date.now()}`,
      prompt: lastUserContent,
      projectId: body.projectId ?? null,
      userId: userId ?? null,
      target: buildTarget.id,
      isInitial,
      fileCount: currentFiles.length,
      prd: resolvedPrd?.prd ?? null,
      design: designDirection,
    });
    if (orchestration.block) {
      orchestrationBlock = `\n\n### ${orchestration.block}\n`;
    }
    console.log(summarizeOrchestration(orchestration.telemetry));
    // Phase F — per-agent observability. Fire-and-forget: never blocks a build.
    void import("@/server/agents/telemetry.server")
      .then(({ recordAgentRuns }) =>
        recordAgentRuns({
          telemetry: orchestration.telemetry,
          projectId: body.projectId ?? null,
          userId: userId ?? null,
        }),
      )
      .catch(() => {});
  } catch (e) {
    console.warn("[orchestrator] skipped:", e instanceof Error ? e.message : String(e));
  }


  const persistedBlueprint = !isInitial ? await loadProjectBlueprint(body.projectId) : null;
  // W4 — persisted architecture: what the code actually contains today
  // (routes + owning files, shared components, committed libraries). Keeps
  // follow-up turns from re-deriving (and drifting from) the structure.
  const persistedArchitecture = !isInitial ? await loadProjectArchitecture(body.projectId) : null;
  const blueprintBlock =
    renderBuildBlueprintBlock(persistedBlueprint) + renderArchitectureBlock(persistedArchitecture);


  // Hero Contract — committed hero composition rules for initial landing-page
  // builds. Addresses the "PipelinePilot" failure where SaaS briefs shipped
  // with bare text+arrow CTAs and DotPattern occupying the entire fold.
  let heroContractBlock = "";
  try {
    const { renderHeroContractBlock } = await import("@/server/hero-contract.server");
    heroContractBlock = renderHeroContractBlock({
      isInitial,
      webSubtype: detectedWebSubtype,
      brief: lastUserContent,
    });
    const { renderBrandContractBlock } = await import("@/server/brand-contract.server");
    heroContractBlock += renderBrandContractBlock({ isInitial });
  } catch {
    /* never block a build on contract render failure */
  }

  // Filter out files Petal manages itself before showing the project to the
  // model. The AI never edits these (we drop ops that touch them), but feeding
  // them back as context bloats patch turns and makes targeted edits harder.
  const editablePromptFiles = currentFiles.filter((f) => !isManagedScaffoldPath(f.path));
  // Cross-cutting intent detection — "mobile responsive", "across all pages",
  // "redesign the site", etc. When true we force-include every page/route
  // and every app-level component so the model's `replace` snippets match
  // real bytes instead of hallucinations. Single biggest fix for the
  // "I wasn't able to apply that change" failure mode on broad asks.
  //
  // Engine 3.0 phase 4: the regex verdict is now only the prior. A cheap
  // semantic classifier can WIDEN it (never shrink it), which is what catches
  // "this looks generic" and "nothing works on my phone" — structural asks
  // that no keyword list will ever match.
  let editClassification: import("@/server/edit-classifier.server").EditClassification | null =
    null;
  if (!isInitial) {
    try {
      const { classifyEdit } = await import("@/server/edit-classifier.server");
      editClassification = await classifyEdit({
        prompt: lastUserContent,
        projectPurpose: picContext?.understanding?.summary ?? resolvedPrd?.prd?.purpose ?? null,
        fileCount: currentFiles.length,
        projectId: body.projectId ?? null,
        userId,
        signal: request.signal,
      });
      console.info(
        `[edit-classifier] scope=${editClassification.scope} source=${editClassification.source} dims=${editClassification.dimensions.join(",")} — ${editClassification.reason}`,
      );
    } catch (e) {
      console.warn("[edit-classifier] skipped:", e instanceof Error ? e.message : String(e));
    }
  }
  const isCrossCutting =
    !isInitial &&
    (detectCrossCuttingIntent(lastUserContent) || editClassification?.scope === "structural");
  let pinnedPaths = isCrossCutting ? pickPinnedPaths(editablePromptFiles) : [];
  if (isCrossCutting) {
    console.info(
      `[intent-targets] cross-cutting ask detected — pinning ${pinnedPaths.length} file(s) into prompt context`,
    );
  }
  // Targeted-edit resolution — "change the hero headline", "remove the second
  // pricing card", "rename Get Started to Try free". We match the user's
  // literal anchors (quoted copy, component names, routes, file names,
  // section vocabulary) against the real project bytes, then force those
  // files into the prompt UNTRUNCATED so the model can quote them verbatim
  // in `replace` ops instead of retyping them from memory.
  const editIntent = isInitial
    ? null
    : resolveEditIntent(lastUserContent, editablePromptFiles);
  const editTargetPaths =
    editIntent?.isTargetedEdit && !isCrossCutting ? editIntent.pinnedPaths : [];
  if (editTargetPaths.length > 0) {
    console.info(
      `[edit-intent] verb=${editIntent!.verb} resolved ${editTargetPaths.length} target file(s): ${editTargetPaths.join(", ")}`,
    );
  }


  // When the deterministic resolver comes up empty on a follow-up edit, send
  // the read-only Inspector subagent in: it greps and reads the real bytes on
  // the budget tier and reports back which files and lines actually matter.
  // Costs a few cheap round trips; saves a wrong whole-file rewrite.
  let inspectorReport: InspectorReport | null = null;
  const shouldInspect =
    !isInitial &&
    !isCrossCutting &&
    editTargetPaths.length === 0 &&
    lastUserContent.trim().length > 12 &&
    editablePromptFiles.length > 0;
  if (shouldInspect) {
    inspectorReport = await runInspector({
      userRequest: lastUserContent,
      files: editablePromptFiles,
      projectId: body.projectId ?? "unknown",
      userId,
    });
    if (inspectorReport.ok) {
      console.info(
        `[inspector] ${inspectorReport.steps.length} step(s), targets: ${inspectorReport.targetPaths.join(", ") || "none"}`,
      );
    }
  }
  const inspectorTargets = (inspectorReport?.targetPaths ?? []).filter((p: string) =>
    editablePromptFiles.some((f) => f.path === p),
  );
  let resolvedTargetPaths =
    editTargetPaths.length > 0 ? editTargetPaths : inspectorTargets;

  // Understanding assist: the semantic classifier names the surfaces the user
  // is talking about ("footer", "pricing", "checkout") even when they never
  // quote a string the deterministic resolver can anchor on. Match those hints
  // against real file names so a non-structural ask still arrives with the
  // right file in full instead of being answered from memory.
  if (!isInitial && !isCrossCutting && (editClassification?.hints.length ?? 0) > 0) {
    const hintMatches = editablePromptFiles
      .filter((f) => {
        const name = f.path.split("/").pop()?.toLowerCase().replace(/\.[jt]sx?$/, "") ?? "";
        return editClassification!.hints.some(
          (h) => h.length >= 3 && (name === h || name.includes(h.replace(/\s+/g, "-"))),
        );
      })
      .map((f) => f.path)
      .filter((p) => !resolvedTargetPaths.includes(p))
      .slice(0, 6);
    if (hintMatches.length > 0) {
      resolvedTargetPaths = [...resolvedTargetPaths, ...hintMatches];
      console.info(`[edit-classifier] hint-matched target(s): ${hintMatches.join(", ")}`);
    }
  }



  // Engine 3.0 phase 4 — impact graph. A targeted edit rarely stops at the
  // file it names: whoever imports that file has to keep compiling, and
  // whatever it imports defines the props it may use. Pin that immediate
  // blast radius so the model edits with the callers in view instead of
  // breaking them silently. Deterministic, capped, and skipped when we are
  // already pinning the whole app for a cross-cutting ask.
  if (!isInitial && !isCrossCutting && resolvedTargetPaths.length > 0) {
    try {
      const { computeImpact } = await import("@/server/impact-graph.server");
      const impact = computeImpact(editablePromptFiles, resolvedTargetPaths, {
        radius: 1,
        max: 18,
      });
      const extra = impact.paths.filter(
        (p) => !resolvedTargetPaths.includes(p) && !pinnedPaths.includes(p),
      );
      if (extra.length > 0) {
        pinnedPaths = [...pinnedPaths, ...extra];
        console.info(
          `[impact-graph] pinned ${extra.length} neighbour(s) of ${resolvedTargetPaths.length} target(s): ${extra.slice(0, 8).join(", ")}`,
        );
      }
    } catch (e) {
      console.warn("[impact-graph] skipped:", e instanceof Error ? e.message : String(e));
    }
  }


  const promptBudget = trimFilesForPrompt(
    editablePromptFiles,
    multiEditPromptContext || lastUserContent,
    pinnedPaths,
    resolvedTargetPaths,
  );
  const inspectorAddendum = inspectorReport
    ? (() => {
        const block = inspectorBriefingBlock(inspectorReport);
        return block ? `\n\n${block}` : "";
      })()
    : "";
  const crossCuttingAddendum = isCrossCutting
    ? `\n\nThis is a cross-cutting request — the user wants the change applied across ${pinnedPaths.length} app file(s). The current contents of every page, route, and app-level component are included in full above. This is enough scope: DO NOT ask the user to name a smaller element. For each existing file you materially redesign, emit ONE \`update\` op with the COMPLETE new file contents. For large existing files, a full-page/whole-component redesign is allowed even if it replaces most of the file; otherwise split the redesigned surface into new smaller components and update the parent imports. Skip files that already satisfy the request rather than emitting no-op edits.\n\nCompleteness contract for this turn — a partial answer counts as a failure:\n1. If the ask mentions the design/look/theme/palette: rewrite the design tokens in \`src/styles.css\` (colours, fonts, radii, surfaces) AND restyle EVERY page and app-level component listed above so nothing is left on the old look. Touching one or two files is not a redesign.\n2. Handle EVERY separate clause in the user's message (they are often joined by "and"). If they also asked for a new element such as a footer, header, nav or section, create that component and render it on every page it belongs on in the SAME turn.\n3. In your recap, list one bullet per file you changed so the user can see the full sweep.`

    : (() => {
        // Non-structural edit. Give the model an explicit scope ceiling up
        // front so "make the heading bigger" stops coming back as a rewrite
        // of six files, while still demanding the full ask lands.
        const scopeBlock = isInitial
          ? ""
          : renderScopeContractBlock({
              scope: editClassification?.scope ?? "targeted",
              dimensions: editClassification?.dimensions ?? [],
              targetPaths: resolvedTargetPaths,
            });
        const base =
          editTargetPaths.length > 0
            ? editIntent!.briefing + inspectorAddendum
            : inspectorAddendum;
        return `${base}${scopeBlock}`;
      })();



  const filesContext = isInitial
    ? ""
    : `\n\nEditable app file manifest (all app-owned files Petal may target):\n${compactManifest(currentFiles)}\n\nCurrent project files (trimmed to the most relevant editable files; ${promptBudget.omitted} lower-priority files omitted for speed. Petal-managed UI kit, reusable block library, mobile primitives, examples, and backend integration files are hidden — they exist in the project but you must never edit them):\n\n${promptBudget.files
        .map((f) => `--- ${f.path} ---\n${f.content}`)
        .join("\n\n")}${crossCuttingAddendum}`;
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
    buildTarget,
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
  // Routes the blueprint planned for this build. Used after the stream to
  // detect a turn that shipped only the landing page and deferred the rest.
  const plannedRoutes: string[] = [];
  try {
    const { buildBlueprintFor, renderBlueprintBlock } = await import("@/server/app-composer.server");
    const composed = buildBlueprintFor(lastUserText, { hasBackend: Boolean(backend) });
    if (composed) {
      // Marketing subtype gate: strip auth/account routes from any matched
      // template before they hit the prompt. Otherwise the model gets
      // contradictory instructions — the subtype addendum says "no auth
      // shells" while the blueprint lists `/auth/sign-in` as a route to
      // scaffold, and it either ships auth on a landing page or freezes.
      // The PRD is the authority: a template may satisfy the contract, it may
      // never widen it. Excluded surfaces are stripped before the prompt.
      let narrowed = false;
      if (resolvedPrd) {
        const { filterTemplateRoutes } = await import("@/server/prd/prd-reconcile");
        const kept = filterTemplateRoutes(resolvedPrd.prd, composed.blueprint.routes);
        if (kept.length !== composed.blueprint.routes.length) {
          composed.blueprint.routes = kept;
          narrowed = true;
        }
      }
      if (detectedWebSubtype === "marketing") {
        composed.blueprint.routes = composed.blueprint.routes.filter(
          (r) => !r.startsWith("/auth") && r !== "/account" && r !== "/dashboard",
        );
        narrowed = true;
      }
      archetypeBlock = narrowed ? renderBlueprintBlock(composed.blueprint) : composed.promptBlock;
      for (const r of composed.blueprint.routes ?? []) if (r) plannedRoutes.push(r);
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
    const shape = classifyAppShape(lastUserText);
    if (resolvedPrd) {
      const { reconcileSurfaces } = await import("@/server/prd/prd-reconcile");
      shape.surfaces = reconcileSurfaces(resolvedPrd.prd, shape.surfaces) as typeof shape.surfaces;
    }
    appShapeBlock = renderShapeBlock(shape);
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
    sharedBackendBlock +
    schemaBlock +
    integrationsBlock +
    knowledgeBlock +
    memoryBlock +
    preservationBlock +
    designBlock +
    "\n\n" + COPY_CONTRACT_BLOCK + "\n\n" + COMPOSITION_CONTRACT_BLOCK + "\n\n" +
    blueprintBlock +
    appShapeBlock +
    mobileBlock +
    gameBlock +
    archetypeBlock +
    heroContractBlock;

  // Design taste + section library + locked palette/type.
  // Marketing/fullstack get the landing taste; app/fullstack get the
  // product-UI taste. Additive, cache-safe (lives in the dynamic suffix).
  let designTasteBlock = "";
  try {
    if (detectedWebSubtype === "marketing" || detectedWebSubtype === "fullstack") {
      const taste = renderDesignTasteBlock(lastUserText || "");
      designTasteBlock = taste.text + renderLandingChecklistBlock();
    }
    if (detectedWebSubtype === "app" || detectedWebSubtype === "fullstack") {
      const appUi = renderAppUiBlock(lastUserText || "");
      designTasteBlock += appUi.text + renderAppScreenChecklistBlock();
      // The PRD supersedes the keyword-scraped app spec. Only fall back to the
      // old extractor when the PRD engine produced nothing this turn.
      if (!prdBlock) designTasteBlock += renderAppSpecBlock(lastUserText || "");
    }
  } catch {
    /* never block a build on taste-block failure */
  }


  const dynamicSuffixText =
    dateBlock +
    (intentBrief
      ? `\n\n### Canonical turn intent (HARD CONTRACT)\n${intentBrief}\nSatisfy this exact outcome. Use the original user message for detail, but do not substitute a different feature, page, or product. Before emitting files, verify every planned change directly supports this intent.\n`
      : "") +
    suggestionsBlock +
    resolvedBlock +
    groundingBlock +
    (approvedPlan ? renderApprovedPlanBlock(approvedPlan) : "") +
    dynamic.text +
    // The product contract goes ahead of the taste blocks: what to build first,
    // how it should look second.
    // Project Intelligence Context first: the canonical understanding and the
    // committed design system frame everything the contract blocks add.
    picBlock +
    prdBlock +
    prdScenarioBlock +
    orchestrationBlock +
    designTasteBlock +

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
  const tier = modelTierForPhase(phaseTag.phase, economyMode, phaseTag.confidence);

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
    crossCuttingIntent: isCrossCutting,
    promptChars: lastUserContent.length,
  });
  if (hasVisionTurn) {
    model = MODEL_VISION;
    chosenBy = "vision_pin";
  } else if (multiEditIntent || isCrossCutting) {
    model = MODEL_BEST;
    chosenBy = isCrossCutting ? "cross_cutting_pin" : "multi_edit_pin";
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
  let finalMessages = budget.messages;

  // ---------------------------------------------------------------------
  // Pre-emit agent loop. For work that spans many files or is mechanical,
  // give the model real hands before it writes: grep, read, run a codemod on
  // a real checkout, run the verifier — up to 5 rounds. The emit call below
  // is unchanged and still forced to a single structured payload; it just
  // runs with the transcript of everything the loop learned appended.
  // ---------------------------------------------------------------------
  let agentLoop: AgentLoopResult | null = null;
  if (
    shouldRunAgentLoop({
      isInitial,
      isCrossCutting,
      prompt: lastUserContent,
      fileCount: currentFiles.length,
    })
  ) {
    agentLoop = await runAgentLoop({
      model,
      messages: finalMessages as AgentChatMessage[],
      files: currentFiles,
      projectId: body.projectId ?? "unknown",
      userId,
      signal: abortSignal,
    });
    if (agentLoop.steps.length > 0) {
      console.info(
        `[agent-loop] rounds=${agentLoop.rounds} steps=${agentLoop.steps.length} converged=${agentLoop.converged} changed=${agentLoop.changedPaths.length}`,
      );
      // Adopt any codemod result BEFORE the emit call so every later stage
      // diffs against the real post-codemod bytes.
      currentFiles = agentLoop.files;
      finalMessages = [
        ...finalMessages,
        ...(agentLoop.transcript as typeof finalMessages),
        {
          role: "user",
          content: `${agentLoopSummaryBlock(agentLoop)}\n\nNow emit the final structured edit for whatever still needs changing.`,
        } as (typeof finalMessages)[number],
      ];
    }
  }



  const upstream = await aiChatCompletions({
    feature: "generate",
    budgetAware: true,
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
    signal: abortSignal,
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
    releaseBuildLock(userId, body.projectId);
    return new Response(msg, { status: upstream.status === 402 ? 402 : 502 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Phase 6 — per-tier telemetry. One row per tier per turn,
      // flushed at end-of-turn (success OR failure path) in a single
      // insert. Fire-and-forget; never blocks or throws.
      const recorder = new TurnRecorder({
        turnId: logicalTurnId,
        projectId: body.projectId ?? null,
        messageId: null,
        model,
      });
      try {
        controller.enqueue(encoder.encode(sse({ type: "phase", phase: "thinking" })));
        controller.enqueue(encoder.encode(sse({ type: "status", message: "Reading your request and choosing the safest edit path…" })));
        // Replay the Inspector's investigation into the timeline so the user
        // sees the same trace Petal worked from (searched → read → concluded).
        for (const step of inspectorReport?.steps ?? []) {
          controller.enqueue(
            encoder.encode(
              sse({ type: "tool_step", tool: step.tool, label: step.label, isError: !!step.isError }),
            ),
          );
        }
        // Same for the pre-emit agent loop: every grep, read, codemod and
        // verifier run shows up as its own timeline row.
        for (const step of agentLoop?.steps ?? []) {
          controller.enqueue(
            encoder.encode(
              sse({ type: "tool_step", tool: step.tool, label: step.label, isError: !!step.isError }),
            ),
          );
        }
        if (agentLoop && agentLoop.changedPaths.length > 0) {
          controller.enqueue(
            encoder.encode(
              sse({
                type: "status",
                message: `Codemod updated ${agentLoop.changedPaths.length} file${agentLoop.changedPaths.length === 1 ? "" : "s"}.`,
              }),
            ),
          );
        }
        if (inspectorReport?.ok && inspectorReport.targetPaths.length > 0) {
          controller.enqueue(
            encoder.encode(
              sse({
                type: "status",
                message: `Located the change in ${inspectorReport.targetPaths.join(", ")}.`,
              }),
            ),
          );
        }
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
            maxTokens: isInitial
              ? Math.min(24_000, Math.max(18_000, Math.round(maxCompletionTokens * 1.35)))
              : Math.max(maxCompletionTokens, 8_000),
            crossCuttingIntent: isCrossCutting,
            signal: abortSignal,
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
            // Both attempts failed to produce usable tool output. Never turn
            // that parser/model failure into a prerequisite refusal: recover
            // the missing tool call and ship the safe frontend instead.
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
                  crossCuttingIntent: isCrossCutting,
                  backend,
                  signal: abortSignal,
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

            // Generic case: the model didn't emit usable output after all
            // recovery passes. On an initial build this is a generation
            // failure, never evidence that a detailed brief is ambiguous.
            // Do not ask the user to repeat or explain the same request.
            console.warn(
              "[generate] both attempts produced no usable output, falling back conversationally:",
              retryErr instanceof Error ? retryErr.message : String(retryErr),
            );
            emitConversationalFallback(controller, encoder, {
              files: currentFiles,
              summary: isInitial
                ? "I couldn't complete the build because the app generator failed to return files after its recovery attempts. Your brief is clear — retry this build; you do not need to rewrite the prompt."
                : "I took a careful look but couldn't pin down a safe change for this one. Could you point me at the specific element or behavior you want adjusted? A quick note like 'make the header sticky' or 'change the CTA color to teal' is usually enough.",
              outcome: isInitial ? "blocked" : "answered",
              reason: isInitial ? "initial_generation_no_files" : "no_safe_edit",
            });
            return;
            }
            }
          }
        }

        let { parsed, summary, plan, recap } = payload;

        // ── Chunked generation ────────────────────────────────────────────
        // Large multi-page edits routinely hit the model's output ceiling:
        // the payload truncates and the turn ships only the prefix the model
        // finished. Instead of failing (or silently under-delivering), ask
        // for the REST of its own plan in bounded follow-up chunks and stage
        // them onto the accumulating op/file list, which the existing applier
        // then applies in order. Best-effort: any failure here leaves the
        // already-usable payload untouched.
        try {
          let chunkAssessment = assessChunking({
            rawArgs: collected.args,
            finishReason: collected.finishReason,
            ops: parsed.ops,
            files: parsed.files,
          });

          // Coverage continuation: a clean stop that shipped only the landing
          // page is still an unfinished app — and an EDIT that promised three
          // new pages but shipped one is the same failure. If the turn planned
          // routes that neither the emitted files nor the existing project
          // provide, finish them in THIS turn.
          if (!chunkAssessment.needed) {
            const stepRoutes = parseStepsFromArgs(collected.args)
              .flatMap((s) => s.match(/\/[a-z][a-z0-9-]{1,24}/gi) ?? []);
            // Nav/link targets the app itself declares are promises to the
            // user: a header link to /plants with no page behind it is the
            // same unfinished build as a planned route that never shipped.
            const emittedSource = [
              ...(parsed.files ?? []).map((f) => f.content ?? ""),
              ...(parsed.ops ?? []).map((o) => ("content" in o ? String(o.content ?? "") : "")),
            ].join("\n");
            const linkRoutes = [
              ...Array.from(emittedSource.matchAll(/\bto\s*=\s*["'](\/[a-z][a-z0-9-]{1,24})["']/gi)),
              ...Array.from(emittedSource.matchAll(/\bhref\s*:\s*["'](\/[a-z][a-z0-9-]{1,24})["']/gi)),
            ].map((m) => m[1] ?? "");
            const expectedRoutes = Array.from(
              new Set([...plannedRoutes, ...stepRoutes, ...linkRoutes].map((r) => r.toLowerCase())),
            ).filter((r) => r !== "/");

            if (expectedRoutes.length) {
              const coverage = assessRouteCoverage({
                expectedRoutes,
                ops: parsed.ops,
                files: parsed.files,
                // Edit turns build on top of what already shipped.
                existingPaths: isInitial ? [] : currentFiles.map((f) => f.path),
              });
              if (coverage.needed) chunkAssessment = coverage;
            }
          }


          if (chunkAssessment.needed) {
            console.warn(
              `[chunked-generation] reason=${chunkAssessment.reason} delivered=${chunkAssessment.deliveredPaths.length} remainingSteps=${chunkAssessment.remainingSteps.length}`,
            );
            controller.enqueue(
              encoder.encode(
                sse({
                  type: "status",
                  message:
                    chunkAssessment.reason === "coverage_incomplete"
                      ? "Building the remaining pages so the whole app ships in one go…"
                      : "This edit is large — continuing it in smaller chunks…",
                }),
              ),
            );
            const chunked = await runChunkedGeneration({
              isInitial,
              assessment: chunkAssessment,
              ops: parsed.ops ?? [],
              files: parsed.files ?? [],
              chunkMaxTokens: isInitial ? 12_000 : 8_000,
              onRound: (round, added) => {
                controller.enqueue(
                  encoder.encode(
                    sse({
                      type: "status",
                      message: `Chunk ${round}: added ${added} more change${added === 1 ? "" : "s"}.`,
                    }),
                  ),
                );
              },
              request: async (req) => {
                const res = await structuredRetryCompletion({
                  messages: [
                    ...finalMessages,
                    { role: "assistant", content: assistantTextFromCollected(collected).slice(0, 4_000) },
                    { role: "user", content: req.instruction },
                  ],
                  isInitial,
                  problem: "output_truncated_chunk",
                  hasBackend: Boolean(backend),
                  tool,
                  maxTokens: req.maxTokens,
                  crossCuttingIntent: isCrossCutting,
                  signal: abortSignal,
                  meta: {
                    phase: phaseTag.phase,
                    promptChars: lastUserContent.length,
                    hadAttachments: hasVisionTurn,
                    chosenBy: `chunk_round_${req.round}`,
                    projectId: body.projectId ?? null,
                    userId,
                  },
                });
                if (!res.ok || !res.body) return null;
                const chunkCollected = await relayAndCollect(res, controller, encoder);
                try {
                  const chunkPayload = parseCollectedProject(chunkCollected, isInitial);
                  return {
                    ops: chunkPayload.parsed.ops,
                    files: chunkPayload.parsed.files,
                    summary: chunkPayload.summary,
                    finishReason: chunkCollected.finishReason,
                    steps: parseStepsFromArgs(chunkCollected.args),
                  };
                } catch {
                  // "no ops" simply means the model considers the plan done.
                  return { ops: [], finishReason: chunkCollected.finishReason };
                }
              },
            });
            if (chunked.added > 0) {
              if (isInitial) parsed.files = chunked.files;
              else parsed.ops = chunked.ops;
              console.log(
                `[chunked-generation] rounds=${chunked.rounds} added=${chunked.added} — ${chunked.notes.join("; ")}`,
              );
            }
          }
        } catch (chunkErr) {
          console.warn(
            "[chunked-generation] skipped:",
            chunkErr instanceof Error ? chunkErr.message : String(chunkErr),
          );
        }

        // Honesty ledger — paths the model asked to change that end up
        // byte-identical after apply + recovery.
        const unappliedPaths: string[] = [];
        // Ops the critic refused to apply this turn (disclosed in the summary).
        const criticRejections: CriticRejection[] = [];
        // v3 Phase B — writes refused at the parse gate, disclosed at end of turn.
        const writeGateRejections: WriteRejection[] = [];



        // (Question-first guard removed — see comment near the top of this
        // file. Triage is the single decision point for "is this a question?";
        // generate just builds.)


        let nextFiles: ProjectFile[];
        // The model-authored boundary must be captured BEFORE scaffold
        // injection. A fresh app may emit six files while applyScaffoldKit
        // expands that into 300+ files; those kit files are dependencies, not
        // edits, and must never consume repair rounds or block this turn.
        const authoredPaths = collected.name === "write_project"
          ? Array.from(new Set(
              (parsed.files ?? [])
                .map((file) => file.path)
                .filter((path) => !isScaffoldOwnedPath(path) && !isScaffoldAbsorbedPath(path)),
            ))
          : undefined;
        if (collected.name === "write_project") {
          if (!parsed.files?.length) throw new Error("AI returned no files.");
          // Inject the canonical scaffold (Tailwind v4 + shadcn-style UI kit)
          // so the AI never has to emit boilerplate it can't reliably reproduce.
          // Also inject the backend kit when a backend is attached.
          const appFiles = parsed.files.filter(
            (file) =>
              // package.json is accepted only as dependency intent; the
              // scaffold merger rewrites it into Petal's canonical manifest.
              file.path === "package.json" ||
              (!isScaffoldOwnedPath(file.path) && !isScaffoldAbsorbedPath(file.path)),
          );
          nextFiles = applyScaffoldKit(appFiles, {
            backend: backend ?? undefined,
            sharedBackend: sharedBackend ?? undefined,
            target: buildTarget.id,
          });
          // index.html and src/main.tsx are deterministic Petal shell files.
          // Inject them before write-time validation so streamed path/content
          // drift can never corrupt the mount point or move CSS into TSX.
          nextFiles = ensureRenderableShell(nextFiles, detectedWebSubtype).files;
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

            // A build-repair turn must not depend on the model choosing to
            // emit an op for a protected scaffold file. Heal the managed
            // shell directly before considering a no-edit fallback.
            if (body.isAutoFix) {
              const healedScaffold = applyScaffoldKitForPatch(currentFiles, {
                backend: backend ?? undefined,
                sharedBackend: sharedBackend ?? undefined,
                target: buildTarget.id,
              });
              const healed = runAllRepairs(healedScaffold);
              const before = new Map(currentFiles.map((f) => [f.path, f.content]));
              const changed = healed.files.some((f) => before.get(f.path) !== f.content) ||
                healed.files.length !== currentFiles.length;
              if (changed) {
                console.info("[empty-op-self-heal]", healed.notes.join("; ") || "scaffold restored");
                emitDeterministicRepair(controller, encoder, {
                  files: healed.files,
                  summary: "I repaired the project configuration and restored the managed build files.",
                });
                return;
              }
            }
            recorder.record({
              tier: "apply_ops",
              outcome: "failed",
              duration_ms: 0,
              issue_count: 1,
              details: { reason: "empty_ops", tool: collected.name, turn_id: logicalTurnId },
            });
            recordEditFailureDiagnostic({
              turnId: logicalTurnId,
              projectId: body.projectId ?? null,
              userId,
              model,
              reason: "empty_ops",
              isInitial,
              toolName: collected.name,
              totalOps: Array.isArray(parsed.ops) ? parsed.ops.length : 0,
            });
            // Truth gate: the model didn't emit any file ops. Do NOT surface
            // its `summary` here — it often says "I updated X" while having
            // changed nothing. Always speak in the first person about what
            // really happened.
            emitConversationalFallback(controller, encoder, {
              files: currentFiles,
              summary:
                "I didn't actually change any files on that pass — the model didn't produce an edit I could apply. Tell me the exact element or text to change (e.g. 'in the hero on the landing page, change the headline to …') and I'll do it.",
            });
            return;
          }
          // Defense-in-depth: reject patches that touch the canonical UI kit
          // or scaffold config files. The AI should never need to.
          //
          // v3 Phase C — the ownership list lives in one module
          // (`scaffold-ownership.server.ts`) shared with the pre-emit gate, so
          // "the model may not write this" and "a verifier may not block on
          // this" can never drift apart. `package.json` is in it: dependency
          // changes are owned by the bare import resolver, which writes a real
          // resolved version instead of a guessed one.
          const isProtectedPath = (p: string) =>
            isScaffoldOwnedPath(p) ||
            matchesUserProtectedGlob(p) ||
            // Plan Mode v1 — when a plan was approved, ANY file outside its
            // allow-list is treated as protected and dropped.
            (allowedPathSet !== null && !allowedPathSet.has(p));

          // Honesty ledger — every path the model asked to change that did
          // NOT end up byte-different after apply + recovery. Surfaced to the
          // user at the end of the turn so Petal can never claim "done" for a
          // file it silently failed to touch.

          /**
           * Iteration Standard #3 — "blocked never means stuck".
           *
           * When ops are dropped (protected path, plan scope, critic verdict)
           * the model gets EXACTLY ONE more round: we hand back the ops that
           * were refused, the reason each was refused, and the constraint it
           * has to respect. Only after this round may a rejection be shown to
           * the user. Bounded to one call per turn — `opRepairRoundUsed` is
           * the hard cap, so this can never loop.
           */
          let opRepairRoundUsed = false;
          const requestOpRepair = async (args: {
            problem: string;
            refused: Array<{ op: string; path: string; reason: string }>;
            constraint: string;
          }): Promise<FileOp[]> => {
            if (opRepairRoundUsed || isInitial) return [];
            opRepairRoundUsed = true;
            const refusedList = args.refused
              .slice(0, 12)
              .map((r) => `- ${r.op} ${r.path} — ${r.reason}`)
              .join("\n");
            controller.enqueue(
              encoder.encode(
                sse({
                  type: "tool_step",
                  tool: "op_repair",
                  label: `Reworking ${args.refused.length} rejected change(s)`,
                }),
              ),
            );
            try {
              const res = await structuredRetryCompletion({
                messages: [
                  ...finalMessages,
                  {
                    role: "user" as const,
                    content:
                      `Some of the edits in your last tool call were refused before they were applied:\n` +
                      `${refusedList}\n\n` +
                      `${args.constraint}\n\n` +
                      `Re-emit ONLY the refused work as a single patch_files tool call that respects that ` +
                      `constraint. Use \`update\` with the COMPLETE file contents rather than \`replace\` ` +
                      `when you are unsure the search snippet matches exactly. Do not repeat edits that ` +
                      `were already accepted. If the refused work genuinely cannot be done within the ` +
                      `constraint, return an empty ops array — do not invent a workaround that breaks the app.`,
                  },
                ],
                isInitial: false,
                problem: `op_repair:${args.problem.slice(0, 80)}`,
                hasBackend: Boolean(backend),
                tool: PATCH_FILES_TOOL,
                maxTokens: Math.max(maxCompletionTokens, 12_000),
                crossCuttingIntent: isCrossCutting,
                signal: abortSignal,
                meta: {
                  phase: phaseTag.phase,
                  promptChars: lastUserContent.length,
                  hadAttachments: hasVisionTurn,
                  chosenBy: "op_repair_round",
                  projectId: body.projectId ?? null,
                  userId,
                },
              });
              if (!res.ok || !res.body) return [];
              const repairedCollected = await relayAndCollect(res, controller, encoder);
              const payload = parseCollectedProject(repairedCollected, false);
              return (payload.parsed.ops ?? []).filter((op) => !isProtectedPath(op.path));
            } catch (err) {
              console.warn(
                "[op-repair] round failed:",
                err instanceof Error ? err.message : err,
              );
              return [];
            }
          };

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
          let astDroppedOps = 0;
          // Plan #4 — strip ast-patch ops if the labs flag isn't on. The
          // model isn't supposed to emit them in that case (we don't add
          // the grammar to the prompt), but be defensive: better to ignore
          // than to apply an unauthorized op kind.
          if (!labsFlags.ast_patches) {
            const astCount = safeOps.filter((op) => op.op === "ast-patch").length;
            if (astCount > 0) {
              astDroppedOps = astCount;
              console.warn(`[ast-patches] dropped ${astCount} unauthorized ast-patch op(s)`);
              safeOps = safeOps.filter((op) => op.op !== "ast-patch");
            }
          }
          if (safeOps.length === 0) {
            const userGlobsHit = violations.some((v) => matchesUserProtectedGlob(v.path));
            const planScopeHit =
              allowedPathSet !== null &&
              violations.some((v) => !allowedPathSet!.has(v.path));

            // The model may correctly diagnose a scaffold/build-config fault,
            // but it is not allowed to edit those files directly. Before
            // refusing the turn, run Petal's trusted deterministic repair
            // layer. This closes the old contradiction where Petal said it
            // would fix vite.config.ts, dropped its own op, then asked the
            // user to rephrase. User/plan-protected paths remain untouched.
            const onlyBuildConfigViolations = violations.every((v) =>
              /(^|\/)(vite|vitest|tailwind|postcss|eslint)\.config\.[cm]?[jt]s$/.test(v.path) ||
              v.path === "tsconfig.json" ||
              v.path === "petal-source-plugin.mjs",
            );
            if (
              !userGlobsHit &&
              !planScopeHit &&
              violations.length > 0 &&
              (body.isAutoFix || onlyBuildConfigViolations)
            ) {
              const healedScaffold = applyScaffoldKitForPatch(currentFiles, {
                backend: backend ?? undefined,
                sharedBackend: sharedBackend ?? undefined,
                target: buildTarget.id,
              });
              const healed = runAllRepairs(healedScaffold);
              const before = new Map(currentFiles.map((f) => [f.path, f.content]));
              const changed = healed.files.some((f) => before.get(f.path) !== f.content) ||
                healed.files.length !== currentFiles.length;
              if (changed) {
                const summary = body.isAutoFix
                  ? "I repaired the build configuration and restored the project to a buildable state."
                  : "I fixed the build configuration safely and re-ran Petal's project repairs.";
                console.info("[protected-path-self-heal]", healed.notes.join("; ") || "scaffold restored");
                emitDeterministicRepair(controller, encoder, { files: healed.files, summary });
                return;
              }
            }
            const blockReason = planScopeHit
              ? "plan_scope_blocked"
              : userGlobsHit
              ? "user_protected_path"
              : "protected_path_only";
            // Iteration Standard #3 — one rework round before we tell the
            // user "no". Most of these are the model reaching for the UI kit
            // when the same change belongs in app code.
            const reworked = await requestOpRepair({
              problem: blockReason,
              refused: violations.map((v) => ({
                op: v.op,
                path: v.path,
                reason: planScopeHit
                  ? "outside the approved plan scope"
                  : userGlobsHit
                  ? "protected by the user's PETAL.md rules"
                  : "reserved framework file (UI kit / build config)",
              })),
              constraint: planScopeHit
                ? `You may only touch these files: ${Array.from(allowedPathSet ?? []).slice(0, 40).join(", ")}.`
                : "Do NOT edit files under src/components/ui/, src/components/blocks/, src/components/examples/, src/components/mobile/, src/integrations/backend/, vite.config.ts, tsconfig.json or src/lib/utils.ts. Achieve the same user-visible result from app code (routes, page sections, app-level components, styles.css tokens) instead.",
            });
            if (reworked.length > 0) {
              console.info(`[op-repair] recovered ${reworked.length} op(s) after ${blockReason}`);
              safeOps = reworked;
            } else {
            recorder.record({
              tier: "apply_ops",
              outcome: "failed",
              duration_ms: 0,
              issue_count: violations.length || astDroppedOps || 1,
              details: {
                reason: blockReason,
                total_ops: parsed.ops.length,
                safe_ops: safeOps.length,
                protected_ops: violations.map(opDigest),
                ast_dropped_ops: astDroppedOps,
                turn_id: logicalTurnId,
              },
            });
            recordEditFailureDiagnostic({
              turnId: logicalTurnId,
              projectId: body.projectId ?? null,
              userId,
              model,
              reason: blockReason,
              isInitial,
              toolName: collected.name,
              totalOps: parsed.ops.length,
              safeOps: safeOps.length,
              protectedOps: violations.map(opDigest),
              astDroppedOps,
            });
            emitConversationalFallback(controller, encoder, {
              files: currentFiles,
              outcome: "blocked",
              reason: blockReason,
              blockedPaths: violations.map((v) => v.path),
              summary: planScopeHit
                ? "The change you asked for would touch files outside the plan you approved. Re-send the message and approve the new files in the plan card, or send without Plan first to let me pick the scope."
                : userGlobsHit
                ? "The change you asked for would touch files you've marked as protected in PETAL.md. Update PETAL.md to allow them, or rephrase the request to target other files."
                : "The change you asked for would touch files I keep reserved for the framework (the UI kit / build config). I can do this a different way — tell me the user-visible behavior you want and I'll wire it up in app code instead.",
              suggestions: planScopeHit
                ? ["Approve the wider scope and retry", "Do it without Plan first"]
                : ["Do it in app code instead", "Describe the result you want instead"],
            });
            return;
            }
          }
          // CRITIC GATE — last review before bytes hit the project.
          // Deterministic rules (elisions, blanked files, no-op replaces,
          // entry-file deletes, catastrophic shrink) plus a budget-tier
          // model review. Rejected ops are dropped, never rewritten, and
          // disclosed in the summary. A failing critic approves everything.
          {
            let verdict = await runCritic({
              ops: safeOps,
              files: currentFiles,
              userPrompt: lastUserContent,
              projectId: body.projectId ?? "unknown",
              userId,
              signal: abortSignal,
              prd: resolvedPrd?.prd ?? null,
            });
            if (verdict.rejections.length > 0) {
              criticRejections.push(...verdict.rejections);
              for (const r of verdict.rejections) {
                console.warn(`[critic] blocked ${r.op} ${r.path}: ${r.reason}`);
                controller.enqueue(
                  encoder.encode(
                    sse({
                      type: "tool_step",
                      tool: "critic",
                      label: `Blocked ${r.op} on ${r.path}`,
                      isError: true,
                    }),
                  ),
                );
              }
              // Iteration Standard #3 — hand the rejections back once and let
              // the model re-emit the same work properly (usually a full-file
              // `update` instead of a `replace` whose snippet never matched).
              const reworked = await requestOpRepair({
                problem: "critic_rejection",
                refused: verdict.rejections.map((r) => ({
                  op: r.op,
                  path: r.path,
                  reason: r.reason,
                })),
                constraint:
                  "Never elide code with comments like `// ... rest unchanged`, never blank a file, and never emit a `replace` whose search text does not appear verbatim in the current file. Emit the COMPLETE new contents of each file you change.",
              });
              if (reworked.length > 0) {
                const second = await runCritic({
                  ops: reworked,
                  files: currentFiles,
                  userPrompt: lastUserContent,
                  projectId: body.projectId ?? "unknown",
                  userId,
                  signal: abortSignal,
                });
                if (second.ops.length > 0) {
                  console.info(`[op-repair] critic accepted ${second.ops.length} reworked op(s)`);
                  const reworkedPaths = new Set(second.ops.map((o) => o.path));
                  const kept = criticRejections.filter(
                    (r) => !reworkedPaths.has(r.path),
                  );
                  criticRejections.length = 0;
                  criticRejections.push(...kept, ...second.rejections);
                  verdict = {
                    ...verdict,
                    ops: [...verdict.ops, ...second.ops],
                    rejections: second.rejections,
                    blockedEverything: false,
                  };
                }
              }
            }
            if (verdict.blockedEverything) {
              emitConversationalFallback(controller, encoder, {
                files: currentFiles,
                outcome: "blocked",
                reason: "critic_rejection",
                blockedPaths: verdict.rejections.map((r) => r.path),
                summary:
                  "I reviewed the change before applying it and it was clearly wrong, so I stopped rather than break your app." +
                  criticDisclosure(verdict.rejections),
                suggestions: ["Try that edit again", "Break it into smaller steps"],
              });
              return;
            }
            safeOps = verdict.ops;
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
          // Per-op partial apply. A single bad `replace` op (stale snippet,
          // ambiguous match, oversized region) used to throw and kill the
          // ENTIRE turn even if the other 4 ops were fine. Now we apply each
          // op independently, then run a per-file full-rewrite recovery on
          // each failure. This is the core fix for the "I wasn't able to
          // apply that change on this pass" failure mode on broad asks.
          let patched: ProjectFile[] | null = null;
          let initiallyAppliedOps: Array<{ op: string; path: string }> = [];
          let initiallyFailedOps: Array<{ op: string; path: string; error: string }> = [];
          const rewrittenPaths: string[] = [];
          const applyStartedAt = Date.now();
          {
            // Quality Push A1 — index.html is machine-owned (preview guard,
            // badge, favicon/brand injector, shell restorer all rewrite it),
            // so a model-authored snippet against it can never be trusted to
            // match. Absorb those ops into a deterministic head merge before
            // anything reaches the text-patch path.
            const head = reconcileDocumentHeadOps(currentFiles, safeOps);
            if (head.handled > 0) {
              currentFiles = head.files;
              safeOps = head.ops;
              for (const note of head.notes) console.info("[document-head]", note);
            }
            const partial = applyOpsPartial(currentFiles, safeOps);
            patched = partial.files;

            initiallyAppliedOps = partial.applied.map(opDigest);
            initiallyFailedOps = partial.failed.map((f) => ({ ...opDigest(f.op), error: f.error.slice(0, 300) }));
            if (partial.failed.length > 0) {
              console.warn(
                `[generate] partial apply: ${partial.applied.length}/${safeOps.length} ops landed; ` +
                  `${partial.failed.length} need per-file rewrite (` +
                  partial.failed.map((f) => `${f.op.path}: ${f.error.slice(0, 60)}`).join(" | ") +
                  ")",
              );
              controller.enqueue(
                encoder.encode(
                  sse({
                    type: "status",
                    message:
                      partial.applied.length > 0
                        ? `Landed ${partial.applied.length} edit(s); rewriting ${partial.failed.length} file(s) with full content…`
                        : `Rewriting ${partial.failed.length} file(s) with full content…`,
                  }),
                ),
              );

              // Per-file rewrite recovery. Bounded so a runaway turn can't
              // make N calls per failed op.
              const MAX_REWRITES_PER_TURN = 8;
              const failuresToRetry = partial.failed.slice(0, MAX_REWRITES_PER_TURN);
              for (const failure of failuresToRetry) {
                const path = failure.op.path;
                const currentContent =
                  patched.find((f) => f.path === path)?.content ??
                  currentFiles.find((f) => f.path === path)?.content ??
                  "";
                // Build a tight per-file rewrite prompt. We append an
                // assistant turn (the snippet of the original collected
                // response that touched this file) + a user turn naming
                // the file and demanding a single `update` op with the
                // COMPLETE new contents. Full-file rewrite of ONE file is
                // the easiest thing for the model to get right.
                const rewriteMessages = [
                  ...finalMessages,
                  {
                    role: "user" as const,
                    content:
                      `Your previous edit to ${path} could not be applied: ${failure.error}\n\n` +
                      `Current contents of ${path} (authoritative — your replace snippet did not match these bytes):\n` +
                      `--- ${path} ---\n${currentContent.slice(0, 24_000)}${currentContent.length > 24_000 ? "\n/* ...trimmed... */" : ""}\n--- end ---\n\n` +
                      `Re-emit the change as a SINGLE patch_files tool call containing EXACTLY ONE op: ` +
                      `{ "op": "update", "path": "${path}", "content": "<the COMPLETE new file contents>" }. ` +
                      `Do not use \`replace\`. Do not touch any other file. Do not use keep-existing markers. ` +
                      `If the current contents already satisfy the user's request, return an empty ops array — do not invent edits.`,
                  },
                ];
                const rewrite = await structuredRetryCompletion({
                  messages: rewriteMessages,
                  isInitial: false,
                  problem: `single_file_rewrite:${failure.error.slice(0, 80)}`,
                  hasBackend: Boolean(backend),
                  tool: PATCH_FILES_TOOL,
                  maxTokens: Math.max(maxCompletionTokens, 12_000),
                  crossCuttingIntent: isCrossCutting,
                  signal: abortSignal,
                  meta: {
                    phase: phaseTag.phase,
                    promptChars: lastUserContent.length,
                    hadAttachments: hasVisionTurn,
                    chosenBy: "per_file_rewrite",
                    projectId: body.projectId ?? null,
                    userId,
                  },
                });
                if (!rewrite.ok || !rewrite.body) {
                  console.warn(`[generate] per-file rewrite request failed for ${path}`);
                  continue;
                }
                const rewriteCollected = await relayAndCollect(rewrite, controller, encoder);
                try {
                  const rewritePayload = parseCollectedProject(rewriteCollected, false);
                  const ops = (rewritePayload.parsed.ops ?? []).filter(
                    (op) => op.path === path && !isProtectedPath(op.path),
                  );
                  if (ops.length === 0) {
                    console.info(`[generate] per-file rewrite for ${path} returned no ops — accepting`);
                    continue;
                  }
                  // Apply each op against the in-progress `patched` map.
                  const stepResult = applyOpsPartial(patched, ops);
                  patched = stepResult.files;
                  if (stepResult.applied.length > 0) {
                    rewrittenPaths.push(path);
                    controller.enqueue(
                      encoder.encode(
                        sse({ type: "status", message: `Rewrote ${path} with full content.` }),
                      ),
                    );
                  } else {
                    console.warn(
                      `[generate] per-file rewrite ops for ${path} still failed: ` +
                        stepResult.failed.map((f) => f.error.slice(0, 80)).join("; "),
                    );
                  }
                } catch (rewriteErr) {
                  console.warn(
                    `[generate] per-file rewrite parse failed for ${path}:`,
                    rewriteErr instanceof Error ? rewriteErr.message : String(rewriteErr),
                  );
                }
              }

              // Final verdict for this batch: did anything land at all?
              if (partial.applied.length === 0 && rewrittenPaths.length === 0) {
                recorder.record({
                  tier: "apply_ops",
                  outcome: "failed",
                  duration_ms: Date.now() - applyStartedAt,
                  issue_count: partial.failed.length,
                  details: {
                    reason: "all_ops_failed",
                    total_ops: safeOps.length,
                    safe_ops: safeOps.length,
                    protected_ops: violations.map(opDigest),
                    ast_dropped_ops: astDroppedOps,
                    failed_ops: initiallyFailedOps,
                    turn_id: logicalTurnId,
                  },
                });
                recordEditFailureDiagnostic({
                  turnId: logicalTurnId,
                  projectId: body.projectId ?? null,
                  userId,
                  model,
                  reason: "all_ops_failed",
                  isInitial,
                  toolName: collected.name,
                  totalOps: parsed.ops.length,
                  safeOps: safeOps.length,
                  protectedOps: violations.map(opDigest),
                  astDroppedOps,
                  failedOps: initiallyFailedOps,
                });
                emitConversationalFallback(controller, encoder, {
                  files: currentFiles,
                  outcome: "blocked",
                  reason: "all_ops_failed",
                  streamSummary: false,
                  summary: body.isAutoFix
                    ? "Reverted to the last working version — the automatic repair couldn't be applied safely."
                    : "No safe file change was applied on this pass.",
                });
                return;
              }
            }
          }
          if (!patched) throw new Error("Patch did not produce files.");

          // Truth gate: every op "applied" cleanly, but did anything actually
          // change? A `replace` whose search==replace, or an `update` whose
          // new content equals the old content, leaves files byte-identical.
          // Without this check we'd ship the model's "I edited the landing
          // page" summary while no file actually moved. Compare patched vs.
          // currentFiles BEFORE scaffold re-apply so kit healing can't mask
          // a no-op edit.
          {
            const prevByPath = new Map(currentFiles.map((f) => [f.path, f.content]));
            const nextByPath = new Map(patched.map((f) => [f.path, f.content]));
            const changedPaths: string[] = [];
            for (const [p, c] of nextByPath) {
              if (prevByPath.get(p) !== c) changedPaths.push(p);
            }
            for (const p of prevByPath.keys()) {
              if (!nextByPath.has(p)) changedPaths.push(p);
            }
            // A codemod that already landed this turn IS a real change, even
            // if the emit call then had nothing left to add. Only the case
            // where literally nothing moved is a dead end.
            if (changedPaths.length === 0 && (agentLoop?.changedPaths.length ?? 0) === 0) {
              const claimed = Array.from(new Set(safeOps.map((o) => o.path))).slice(0, 4).join(", ");
              console.warn(`[generate] no-op patch — ops applied but file contents unchanged (${claimed})`);
              recorder.record({
                tier: "apply_ops",
                outcome: "failed",
                duration_ms: Date.now() - applyStartedAt,
                issue_count: 1,
                details: {
                  reason: "byte_identical_patch",
                  total_ops: safeOps.length,
                  safe_ops: safeOps.length,
                  applied_ops: initiallyAppliedOps,
                  failed_ops: initiallyFailedOps,
                  rewritten_paths: rewrittenPaths,
                  turn_id: logicalTurnId,
                },
              });
              recordEditFailureDiagnostic({
                turnId: logicalTurnId,
                projectId: body.projectId ?? null,
                userId,
                model,
                reason: "byte_identical_patch",
                isInitial,
                toolName: collected.name,
                totalOps: parsed.ops.length,
                safeOps: safeOps.length,
                appliedOps: initiallyAppliedOps,
                failedOps: initiallyFailedOps,
                rewrittenPaths,
                affectedPaths: safeOps.map((o) => o.path),
              });
              emitConversationalFallback(controller, encoder, {
                files: currentFiles,
                summary:
                  `I tried to edit ${claimed || "your files"} but the change came out byte-identical to what was already there, so nothing actually moved. Tell me the exact text or element you want changed (and what to change it to) and I'll do it for real.`,
              });
              return;
            }
            recorder.record({
              tier: "apply_ops",
              outcome: initiallyFailedOps.length > 0 || rewrittenPaths.length > 0 ? "fixed" : "ok",
              duration_ms: Date.now() - applyStartedAt,
              issue_count: initiallyFailedOps.length,
              details: {
                reason: initiallyFailedOps.length > 0 ? "partial_apply_recovered" : "applied",
                total_ops: safeOps.length,
                safe_ops: safeOps.length,
                protected_ops: violations.map(opDigest),
                ast_dropped_ops: astDroppedOps,
                applied_ops: initiallyAppliedOps,
                failed_ops: initiallyFailedOps,
                rewritten_paths: rewrittenPaths,
                changed_paths: changedPaths.slice(0, 20),
                turn_id: logicalTurnId,
              },
            });

            // Per-path honesty check. Some ops landed (so we're past the
            // all-or-nothing gate above) but individual files the model
            // claimed to edit may still be byte-identical — that's the
            // "Petal said it did it but it didn't" failure mode.
            const changedSet = new Set(changedPaths);
            for (const p of new Set(safeOps.map((o) => o.path))) {
              if (!changedSet.has(p)) unappliedPaths.push(p);
            }
            for (const v of violations) {
              if (!changedSet.has(v.path) && !unappliedPaths.includes(v.path)) {
                unappliedPaths.push(v.path);
              }
            }
          }


          // Heal-on-patch: re-apply the canonical scaffold to old saved
          // projects whose `src/components/ui/*`, `package.json`, or
          // backend kit files predate later kit upgrades. Without this,
          // legacy projects keep failing builds with errors like
          // "SelectTrigger is not exported by select.tsx" forever
          // because `applyScaffoldKit` was only running on initial
          // create + at build-trigger time.
          // Paths this turn actually rewrote: kit healing must not clobber them.
          const patchedTouched = new Set(
            patched
              .filter((f) => currentFiles.find((c) => c.path === f.path)?.content !== f.content)
              .map((f) => f.path),
          );
          // Stamp customized kit blocks so NEXT turn's kit refresh can't revert
          // this redesign back to the library version.
          patched = patched.map((f) =>
            patchedTouched.has(f.path)
              ? { ...f, content: markKitFileCustomized(f.path, f.content) }
              : f,
          );
          nextFiles = applyScaffoldKitForPatch(patched, {
            backend: backend ?? undefined,
            sharedBackend: sharedBackend ?? undefined,
            target: buildTarget.id,
            keepPaths: patchedTouched,
          });

        }
        if (!nextFiles.some((f) => f.path === "index.html")) {
          throw new Error("Project is missing index.html.");
        }

        // v3 Phase B — WRITE-TIME VALIDATION.
        //
        // Before this gate, an unparseable file was written and then chased by
        // ~30 repair passes and, failing those, a remote build error minutes
        // later. Now every file this turn touched is esbuild-parsed here. One
        // deterministic per-file heal is attempted; if it still doesn't parse
        // the write is refused and the path reverts to its previous bytes. The
        // project therefore cannot enter a state where a source file is
        // syntactically broken, which is the whole point of Phase B.
        {
          const prevByPath = new Map(currentFiles.map((f) => [f.path, f.content]));
          const touched = collected.name === "write_project" && authoredPaths
            ? authoredPaths
            : nextFiles
                .filter((f) => prevByPath.get(f.path) !== f.content)
                .map((f) => f.path);
          if (touched.length > 0) {
            const gate = await runWriteGate({
              before: currentFiles,
              after: nextFiles,
              changedPaths: touched,
            });
            nextFiles = gate.files;
            if (gate.healedPaths.length > 0) {
              console.info("[write-gate] healed at write time:", gate.healedPaths.join(", "));
            }
            if (gate.rejected.length > 0) {
              writeGateRejections.push(...gate.rejected);
              console.warn(
                "[write-gate] refused unparseable write(s):",
                gate.rejected.map((r) => `${r.path}: ${r.detail}`).join(" | "),
              );
              void recordRepairs(
                gate.rejected.map((r) => ({
                  projectId: body.projectId ?? null,
                  userId,
                  phase: "pre_build" as const,
                  passId: "write-gate",
                  signature: signatureOf(r.detail),
                  outcome: "failed" as const,
                  detail: `${r.path}: ${r.detail}${r.reverted ? " (reverted)" : " (not written)"}`,
                })),
              );

            }
          }
        }


        // Single composition point for all deterministic file-graph
        // repairs (extension normalizer → shadcn imports → array safety →
        // local import resolver → bare import resolver). Runs BEFORE the
        // shell guard / build trigger so Rollup never sees an unresolved
        // import. See src/server/repair-all.server.ts.
        {
          // On an edit turn (project already had files), lock the cosmetic
          // repair stages to the files this turn actually touched. Otherwise a
          // targeted ask silently restyles pages the user never mentioned.
          const scopeLock =
            turnBaselineFiles.length > 0
              ? { touchedPaths: diffChangedPaths(turnBaselineFiles, nextFiles) }
              : undefined;
          const repaired = runAllRepairs(nextFiles, scopeLock ? { scopeLock } : undefined);
          if (repaired.notes.length > 0) {
            for (const n of repaired.notes) console.info("[repair-all]", n);
            nextFiles = repaired.files;
            // Bible §7 — every repair records signature → fix → outcome.
            // This is the training set for the next codemod, and the only way
            // to see the same pass masking the same model defect week after
            // week. Fire-and-forget: a ledger write never blocks a build.
            void recordRepairs(
              entriesFromRepairNotes(repaired.notes, {
                projectId: body.projectId ?? null,
                userId,
                phase: "pre_build",
              }),
            );
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
        if (shellGuard.degraded.includes("src/App.tsx") && collected.name === "write_project") {
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
          // Repair before discarding: the stylesheet carries the locked
          // palette and type pair, so falling back to the scaffold makes the
          // app look generic. Only a repair that still fails gets replaced.
          const repaired = repairStylesCss(f.content);
          if (repaired) {
            console.warn(
              `[styles.css repaired] generate reason="${result.reason}" — ${repaired.notes.join("; ")}`,
            );
            return { ...f, content: repaired.css };
          }
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
          authoredPaths,
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
            // §7 cost ceiling — meter the polish pass so later rounds know
            // how much of the turn's repair budget is already gone.
            repairMeter.charge(
              "autofix_cycle_2",
              "google/gemini-2.5-flash-lite",
              (fixOut.result.usage?.total_tokens ?? 0) ||
                Math.ceil(nextFiles.reduce((s, f) => s + f.content.length, 0) / 4) + 4_000,
            );
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
        //
        // v3 Phase A: this loop now also runs on user-initiated "try to fix"
        // turns. It used to be suppressed there to avoid "recursing into
        // another loop", but that was backwards — the repair turn is exactly
        // where convergence matters most, and the loop is already bounded by
        // cycles, wall clock, and the repair cost ceiling. Suppressing it
        // meant the user's explicit fix request got a single unverified pass.
        {

          const AGENT_LOOP_MAX_CYCLES = 3;
          const AGENT_LOOP_WALL_MS = 90_000;
          const loopT0 = Date.now();
          const { verifyFilesLocal: lvFn } = await import("@/server/local-verifier");
          // Shared with the pre-emit gate so "what blocks a turn" has exactly
          // one definition. Two copies of this list is how a kind silently
          // becomes blocking in one place and advisory in the other.
          const { BLOCKING_KINDS, isScaffoldOwned } = await import(
            "@/server/preemit-gate.server"
          );
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
            // `missing-dep` is fixable here (the model can add the import or
            // drop the usage) even though the gate treats it as advisory,
            // because npm pre-flight may still resolve it.
            const stillBad = rawStillBad.filter(
              (i) =>
                (BLOCKING_KINDS.has(i.kind) || i.kind === "missing-dep") &&
                !isScaffoldOwned(i.path),
            );

            if (stillBad.length === 0) {
              console.log(
                `[agent-loop] converged after ${cyc} extra cycle(s) (raw=${rawStillBad.length}, fixable=0)`,
              );
              break;
            }
            const cycleNum = 3 + cyc;
            // §7 hard cost ceiling. Rounds are bounded above; this bounds the
            // money. Crossing it ends the repair phase honestly rather than
            // spending another round on a loop that isn't converging.
            if (repairMeter.status().exhausted) {
              console.warn(
                `[agent-loop] cycle ${cycleNum} skipped — repair cost ceiling reached (${repairMeter.summary()})`,
              );
              controller.enqueue(
                encoder.encode(sse({ type: "cycle_end", cycle: cycleNum, outcome: "hard-stop" })),
              );
              break;
            }
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
              repairMeter.charge(
                `autofix_cycle_${cycleNum}`,
                "google/gemini-2.5-flash-lite",
                (fixOut.result.usage?.total_tokens ?? 0) ||
                  Math.ceil(nextFiles.reduce((s, f) => s + f.content.length, 0) / 4) + 4_000,
              );
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
          // Enforce the product contract on the turn that authored it and on
          // any turn that changed its shape. Cosmetic edits are exempt — the
          // contract is unchanged, so re-checking the whole app is noise.
          resolvedPrd &&
          (resolvedPrd.authored ||
            resolvedPrd.amendment === "additive" ||
            resolvedPrd.amendment === "contradiction")
            ? resolvedPrd.prd
            : null,


        );
        if (!guardOut.ok) {
          // Final-parse-guard couldn't repair this turn's edits. Revert
          // to the prior good files and reply conversationally — no
          // credits charged because nothing safe was written.
          console.warn(
            `[final-parse-guard] reverting turn — unrepairable: ${guardOut.detail}`,
          );
          // Surface the technical reason on the wire too. Worker stdout is not
          // retained, so without this the only signal is a console line nobody
          // can read after the fact.
          controller.enqueue(
            encoder.encode(
              sse({
                type: "timeline",
                step: guardOut.detail?.includes("prd-contract")
                  ? "prd_contract"
                  : "esbuild_parse",
                outcome: "failed",
                message: `Blocked: ${guardOut.detail}`.slice(0, 500),
                ts: Date.now(),
              }),
            ),
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

        // W4 — refresh the persisted architecture doc from the files we are
        // about to ship, so the next turn plans against reality. Runs after
        // the blueprint save (which merges sibling keys) and never throws.
        await saveProjectArchitecture(body.projectId, nextFiles);



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
        // Decide the terminal state BEFORE billing. Charging first meant a
        // turn where the user asked for an edit, the ops all failed to apply
        // and the project came out byte-identical still debited credits —
        // the user paid for nothing and (correctly) called it a loop.
        const turnChangedPaths = diffChangedPaths(turnBaselineFiles, nextFiles);
        const failedEditTurn = turnChangedPaths.length === 0 && unappliedPaths.length > 0;
        if (failedEditTurn) {
          console.warn(
            `[credits] no-op edit turn not billed project=${body.projectId ?? "none"} unapplied=${unappliedPaths.length}`,
          );
        }
        if (!body.isAutoFix && !failedEditTurn) {

          // Single atomic settlement. `settle_build_charge` is idempotent on
          // the turn id (a retried request can never double-charge), drains
          // whatever is actually available — including the daily/monthly FREE
          // buckets a brand-new user has — and books any remainder as debt
          // instead of failing the charge and silently losing the revenue.
          const settleTurnId = logicalTurnId;
          try {
            const { data: settled, error: settleErr } = await supabaseAdmin.rpc(
              "settle_build_charge",
              {
                _user_id: userId,
                _amount: priced.amount,
                _reason: "ai_build_charge",
                _project_id: body.projectId ?? undefined,
                _turn_id: settleTurnId ?? undefined,
                _metadata: {
                  route: "/api/generate",
                  prompt_tokens: priced.promptTokens,
                  completion_tokens: priced.completionTokens,
                  usage_missing: priced.usageMissing,
                  clamped: priced.clamped,
                  model,
                  is_auto_fix: false,
                } as never,
              },
            );
            if (settleErr) throw new Error(settleErr.message);
            const row = Array.isArray(settled) ? settled[0] : settled;
            finalCharged = Number(row?.charged ?? 0);
            const shortfall = Number(row?.shortfall ?? 0);
            if (row?.idempotent) {
              console.info(`[credits] settlement already recorded for turn ${settleTurnId}`);
            } else if (shortfall > 0) {
              // Not a failure any more — the balance was drained and the
              // remainder is owed. Recorded so it can be reconciled.
              console.warn(`[credits] partial settlement: charged=${finalCharged} debt=${shortfall}`);
              await recordUnpaidBuild(userId, body.projectId ?? null, shortfall, {
                reason: "shortfall_booked_as_debt",
              });
            }
          } catch (e) {
            console.warn("[credits] post-build settlement threw", (e as Error).message);
            await recordUnpaidBuild(userId, body.projectId ?? null, priced.amount, {
              reason: (e as Error).message,
            });
          }
        } else {
          console.info(
            `[credits] internal recovery turn not billed project=${body.projectId ?? "none"} amount=${priced.amount}`,
          );
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

        // v3 Phase F — write-gate disclosure. A refused write is the one
        // failure the user MUST hear about: their app is intact, but the part
        // they asked for isn't there. Silence here reads as a silent no-op.
        if (writeGateRejections.length > 0) {
          const note = writeGateDisclosure(writeGateRejections);
          summary = `${summary}${note}`;
          controller.enqueue(encoder.encode(sse({ type: "summary_delta", delta: note })));
        }

        // Critic gate disclosure: name every op that was refused before apply.
        if (criticRejections.length > 0) {
          const note = criticDisclosure(criticRejections);
          summary = `${summary}${note}`;
          controller.enqueue(encoder.encode(sse({ type: "summary_delta", delta: note })));
        }

        // Honesty gate: if the model claimed edits to files that never
        // actually changed, say so instead of letting its "done!" summary
        // ship unchallenged.
        if (unappliedPaths.length > 0) {
          const list = unappliedPaths.slice(0, 5).join(", ");
          const more = unappliedPaths.length > 5 ? ` (+${unappliedPaths.length - 5} more)` : "";
          const note =
            `\n\nHeads up — I could not actually change ${list}${more} on this pass, ` +
            `even though I described those edits. Tell me exactly what should change there ` +
            `(the text or element, and what it should become) and I'll redo just that part.`;
          summary = `${summary}${note}`;
          controller.enqueue(encoder.encode(sse({ type: "summary_delta", delta: note })));
          console.warn(`[generate] unapplied paths disclosed to user: ${unappliedPaths.join(", ")}`);
        }

        // Bible §9 scope guard — a one-line request that rewrites half the
        // project is how features silently disappear. We don't block it (the
        // rewrite is sometimes right), we disclose it and offer the undo, so
        // the user finds out from Petal rather than from a missing page.
        {
          const scope = analyzeEditScope(
            turnBaselineFiles,
            nextFiles,
            lastUserContent,
            editClassification?.scope,
          );

          if (scope.flagged) {
            const note = scopeDisclosure(scope);
            summary = `${summary}${note}`;
            controller.enqueue(encoder.encode(sse({ type: "summary_delta", delta: note })));
            console.warn(
              `[edit-scope-guard] ${scope.reason} (changed=${scope.changedCount}, delta=${scope.totalDeltaBytes}B)`,
            );
          }
        }


        // Iteration Standard #1 — one turn, one terminal state, decided by a
        // byte diff against the snapshot taken when the turn began.
        {
          const turnChanged = turnChangedPaths;
          emitTurnOutcome(controller, encoder, {
            outcome: turnChanged.length > 0 ? "applied" : "answered",
            changedPaths: turnChanged,
            ...(unappliedPaths.length > 0
              ? { blockedPaths: unappliedPaths, reason: "unapplied_claims" }
              : {}),
          });
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
        const userCancelled = abortSignal?.aborted === true;
        let kind = userCancelled ? "aborted" : classifyRawError(raw);
        // A gateway 402 during this turn explains every downstream symptom
        // ("no files", "no edits", unknown). Attribute it to Petal's own AI
        // account instead of telling the user their prompt was too complex —
        // they cannot fix our billing, and "Try a simpler app" is a lie.
        if (
          !userCancelled &&
          (kind === "no_files_emitted" || kind === "no_edit_emitted" || kind === "unknown") &&
          hadRecentProviderPaymentFailure()
        ) {
          kind = "provider_credits_exhausted";
        }
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
          : kind === "provider_credits_exhausted"
            ? {
                // Never let the humanizer blame the prompt for OUR outage.
                message:
                  "Petal's AI is temporarily unavailable — this is on our side, not your prompt. Nothing was charged. Please try again shortly.",
                suggestions: ["Try again"] as string[],
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
        releaseBuildLock(userId, body.projectId);
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
  // Kept in scope so the terminal path can write the assistant reply itself
  // when the browser is gone (see persistAbandonedTurnReply below).
  let turnProjectId: string | null = null;
  const clone = request.clone();
  try {
    const peekAuth = await authorize(clone);
    if (typeof peekAuth === "string") {
      const peekBody = (await clone.json().catch(() => null)) as Body | null;
      if (peekBody?.projectId) {
        turnProjectId = peekBody.projectId;
        recorder = await startTurn({ projectId: peekBody.projectId, userId: peekAuth });
        // Open the server-owned completion record for this request. From here
        // the loop's authority lives in the database, not in the tab: stage,
        // attempts and outstanding defects survive a closed browser.
        if (recorder) {
          const resume = (peekBody as { autoResumeAttempts?: number }).autoResumeAttempts;
          await openTurnCompletion({
            projectId: peekBody.projectId,
            userId: peekAuth,
            turnId: recorder.turnId,
            inheritAttempts: typeof resume === "number" ? resume : 0,
          });
        }
      }
    }
  } catch {
    // Recording is best-effort. Never block the build because of it.
  }

  // Exactly-once terminal write. `cancel()` (client closed the tab, the SSE
  // socket dropped) and `start()`'s `finally` can both fire, and on Cloudflare
  // only one of them may ever run. Without this guard the turn row stayed
  // `running` forever — 400 of them, which made every derived metric useless.
  let turnClosed = false;
  const finishTurnOnce = async (
    status: "succeeded" | "failed" | "aborted",
    errorMessage: string | null,
  ): Promise<void> => {
    if (!recorder || turnClosed) return;
    turnClosed = true;
    try {
      await recorder.finish(status, { errorMessage });
    } catch {
      /* best-effort; the reap_stalled_turns sweeper is the backstop */
    }
  };

  const encoder = new TextEncoder();
  // Detached from `request.signal` on purpose — see the `cancel()` note below.
  const workController = new AbortController();
  // Flipped when the browser goes away; the build keeps running regardless.
  let clientGone = false;
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

      // Last `result` payload seen on the wire. Used only when the client
      // disappeared: the server then writes the assistant reply itself so the
      // thread never ends on an unanswered prompt.
      let lastResult: { summary?: string; plan?: string; recap?: string } | null = null;
      const recordEvent = makeSseTap((type, payload) => {
        if (type === "result") {
          const p = payload as { summary?: string; plan?: string; recap?: string };
          lastResult = {
            summary: typeof p.summary === "string" ? p.summary : undefined,
            plan: typeof p.plan === "string" ? p.plan : undefined,
            recap: typeof p.recap === "string" ? p.recap : undefined,
          };
        }
        recorder?.record(type, payload);
      });
      // The browser can vanish at any moment (tab closed, phone locked,
      // proxy timeout). When it does, `controller.enqueue` starts throwing —
      // but the build itself must keep going and keep recording turn_events
      // so the user gets the finished result when they come back. So every
      // write is best-effort, and `clientGone` just stops us from trying.
      const push = (bytes: Uint8Array) => {
        if (recordEvent) recordEvent(bytes);
        if (clientGone) return;
        try {
          controller.enqueue(bytes);
          lastByteAt = Date.now();
        } catch {
          clientGone = true;
        }
      };
      const emit = (event: StreamEvent) => {
        push(encoder.encode(sse(event)));
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
          if (clientGone) return;
          push(encoder.encode(": ping\n\n"));
        }, 8_000);

        // User-visible heartbeat: rotates phrasing and only fires after
        // 14s of silence so it never overwrites real model narration or
        // file events. Picks the next line in STATUS_ROTATION each tick.
        statusTimer = setInterval(() => {
          if (Date.now() - lastByteAt < 14_000) return;
          emit({
            type: "status",
            message: STATUS_ROTATION[statusIdx % STATUS_ROTATION.length],
          });
          statusIdx++;
        }, 14_000);

        // Pass the turn id directly. Reconstructing TanStack's incoming
        // Request with `new Request(request, ...)` crosses runtime realms and
        // crashes Undici while reading its internal `window` slot.
        // `workController` is intentionally detached from `request.signal`:
        // a closed tab must not cancel a build the user already paid for.
        const response = await handleGenerateRequestCore(
          request,
          recorder?.turnId,
          workController.signal,
        );
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
          // Keep draining even after the client is gone: the bytes still go
          // to the turn recorder, which is what a reconnecting tab replays.
          push(value);
        }
      } catch (e) {
        const raw = e instanceof Error ? e.message : "Generation failed.";
        terminalStatus = workController.signal.aborted ? "aborted" : "failed";
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
        emit({ type: "done", status: terminalStatus });
        // Persist the terminal state before the request ends. A fire-and-forget
        // write is dropped by serverless runtimes once the response closes,
        // leaving turns permanently "running" and inviting reconnect loops.
        await finishTurnOnce(terminalStatus, terminalError);
        // Make sure the thread always ends with an assistant reply. The client
        // normally writes it on `done`, but a dropped socket doesn't always
        // surface as an enqueue failure (buffered writes, a phone that slept,
        // a different device), so `clientGone` can be false while nobody is
        // listening. Give the client a short grace window to land its own
        // write, then reconcile from the server — the helper no-ops when a
        // reply already exists.
        if (turnProjectId) {
          // Hand the request over to the build stage, or close it honestly.
          await markStage(
            turnProjectId,
            terminalStatus === "succeeded" ? "building" : "blocked",
            terminalStatus === "succeeded"
              ? {}
              : {
                  terminal_reason:
                    terminalError?.slice(0, 500) ?? "the build stopped before it finished",
                },
          );
        }
        if (turnProjectId && recorder) {
          await new Promise((r) => setTimeout(r, 2500));
          const done = lastResult as { summary?: string; plan?: string; recap?: string } | null;
          const wroteReply = await persistAbandonedTurnReply({
            projectId: turnProjectId,
            turnId: recorder.turnId,
            status: terminalStatus,
            summary: done?.summary ?? null,
            plan: done?.plan ?? null,
            recap: done?.recap ?? null,
            errorMessage: terminalError,
          }).catch(() => false);
          // We had to write the reply ourselves, which means no client was
          // there to kick off the deploy either. Files are saved but the
          // project would sit with no build at all — start it server-side.
          if (wroteReply && terminalStatus === "succeeded") {
            const auth = request.headers.get("authorization");
            if (auth) {
              await fetch(new URL("/api/builds/trigger", request.url).toString(), {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: auth },
                body: JSON.stringify({ projectId: turnProjectId }),
              }).catch(() => {});
            }
          }
        }
        try {
          controller.close();
        } catch {
          /* already closed by a client disconnect */
        }
      }
    },
    // Fires when the consumer goes away mid-build (tab closed, socket
    // dropped, proxy timeout). This is NOT a cancellation: the pipeline keeps
    // running on the detached work signal and `start()`'s finally block still
    // writes the terminal turn state, so a reconnecting tab replays the whole
    // turn from turn_events. Marking the turn "aborted" here was what made
    // closed tabs look like killed builds.
    cancel() {
      clientGone = true;
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


/**
 * A build that ran but could not be charged is revenue we silently lost, and
 * previously it left nothing behind but a console warning. Record it so the
 * balance can be reconciled instead of disappearing.
 */
/**
 * One-build-at-a-time lock, keyed by user AND project.
 *
 * Builds are priced from token usage AFTER generation, so the pre-flight floor
 * check cannot know the final bill. The lock exists to stop the SAME project
 * being built twice from a double submit — it is not a per-account throttle:
 * working on project A must never refuse a build on project B, and settlement
 * drains the remaining wallet, so a concurrent build can't slip through free.
 *
 * The in-memory entry is only a hint. Before refusing anything we confirm
 * against the database that a turn is genuinely still running for that
 * project; a crashed worker, an aborted stream or a redeployed instance leaves
 * a stale hint, and a stale hint must never cost the user a build.
 */
const BUILD_LOCK_TTL_MS = 5 * 60 * 1000;
/** A turn that hasn't finished in this long is dead, not running. */
const TURN_STALE_MS = 10 * 60 * 1000;
const buildLocks = new Map<string, number>();

function buildLockKey(userId: string, projectId: string | null | undefined): string {
  return `${userId}::${projectId ?? "new"}`;
}

/**
 * Is a turn for this exact project genuinely in flight right now?
 * Also retires stale `running` rows so history stops showing phantom builds.
 */
async function hasLiveTurn(userId: string, projectId: string | null | undefined): Promise<boolean> {
  if (!projectId) return false;
  const client = supabaseAdmin;
  if (!client) return false;
  const cutoff = new Date(Date.now() - TURN_STALE_MS).toISOString();
  try {
    // Retire anything that can no longer be running.
    await client
      .from("turns")
      .update({
        status: "failed",
        ended_at: new Date().toISOString(),
        error_message: "Turn ended without completing.",
      })
      .eq("user_id", userId)
      .eq("status", "running")
      .lt("created_at", cutoff);

    const { data } = await client
      .from("turns")
      .select("id")
      .eq("user_id", userId)
      .eq("project_id", projectId)
      .eq("status", "running")
      .gte("created_at", cutoff)
      .limit(1);
    return Boolean(data && data.length > 0);
  } catch (e) {
    // Never refuse a build because the liveness probe failed.
    console.warn("[build-lock] liveness probe failed:", (e as Error).message);
    return false;
  }
}

async function acquireBuildLock(
  userId: string,
  projectId: string | null | undefined,
): Promise<boolean> {
  const now = Date.now();
  const key = buildLockKey(userId, projectId);
  const heldUntil = buildLocks.get(key);
  if (heldUntil && heldUntil > now) {
    // Held in memory — but only a real running turn justifies a refusal.
    if (await hasLiveTurn(userId, projectId)) return false;
    buildLocks.delete(key);
  }
  buildLocks.set(key, now + BUILD_LOCK_TTL_MS);
  // Opportunistic sweep so the map can't grow unbounded on a long-lived worker.
  if (buildLocks.size > 200) {
    for (const [k, expiry] of buildLocks) if (expiry <= now) buildLocks.delete(k);
  }
  return true;
}

function releaseBuildLock(userId: string, projectId?: string | null): void {
  buildLocks.delete(buildLockKey(userId, projectId));
}

async function recordUnpaidBuild(
  userId: string,
  projectId: string | null,
  amount: number,
  charge: { reason?: string },
) {
  try {
    await supabaseAdmin.from("pipeline_failures").insert({
      surface: "credit_settlement",
      signature: "post_build_charge_failed",
      raw_message: `post-build charge of ${amount} credits failed (${charge.reason ?? "unknown"})`,
      user_id: userId,
      project_id: projectId,
      extra: { amount, reason: charge.reason ?? "unknown" } as never,
    });
  } catch (e) {
    console.error("[credits] could not record unpaid build", (e as Error).message);
  }
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
