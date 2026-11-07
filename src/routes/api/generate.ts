import { defaultFirstBuildModel } from "@/lib/ai-model-config";
import { toOperationType } from "@/lib/operation-identity";
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
import { EMPTY_HOME_BUILD_FAILURE_MESSAGE } from "@/server/build-failure-copy";
import { assessCompleteness, incompleteBuildMessage, requestedRoutesFor } from "@/server/engine/build-state";
import { currentTurnContext, markUpstreamFailed, runWithTurnContext } from "@/server/turn-context.server";
import { RecoveryBudget, RECOVERY_LIMITS } from "@/server/engine/recovery-policy";
import { AgentCircuitBreaker, classifyFailure } from "@/server/execution/circuit-breaker";
import {
  salvagePartialToolArgs,
  dropUnusableOps,
  dropUnusableFiles,
} from "@/server/tool-args-salvage.server";


import { pickPinnedPaths } from "@/server/intent-targets.server";
import { resolveEditIntent } from "@/server/edit-intent.server";
import { buildSectionExpansionPatch } from "@/server/section-expansion.server";

import {
  runCritic,
  criticDisclosure,
  type CriticRejection,
} from "@/server/critic-agent.server";

import { applyScaffoldKit, applyScaffoldKitForPatch, markKitFileCustomized, STYLES_CSS } from "@/server/scaffold-kit";
import { getBuildTarget, isMobileTarget } from "@/lib/build-targets";
import { isPausedKitPath } from "@/lib/site-flags";
import { resolveBuildTarget } from "@/lib/target-inference";
import { getWebSubtypeAddendum } from "@/lib/web-subtype";

import { lookupBackendForGenerate, lookupSharedBackendForGenerate } from "@/server/backend-connector.server";
import { resolveIntentActions } from "@/server/intent-actions.server";
import { detectSurfaceIntent } from "@/lib/kimble-surfaces";
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
import { agentIO } from "@/server/agent-io.server";
import { saveCreditPause } from "@/server/credit-pause.server";
import { checkGenerateRateLimit, rateLimitResponse, secretsMatch } from "@/server/rate-limit.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  streamDeltaHasOutput,
  aiChatCompletions,
  markLastCallFailure,
  updateLastCallUsage,
  estimateCostUsdMicro,
  hadRecentProviderPaymentFailure,
} from "@/server/ai-provider.server";
import { DEFAULT_BUILD_ECONOMICS, priceTurnCost, creditsForCost, economicCeilingUsd } from "@/lib/build-pricing";
import type { GatewayUsage } from "@/server/credit-pricing.server";
import {
  clearPendingMemory,
  loadProjectMemory,
  renderMemoryBlock,
  savePendingMemory,
  updateProjectMemory,
} from "@/server/project-memory.server";
import {
  parsePreservationRules,
  renderPreservationBlock,
  makeProtectedGlobMatcher,
} from "@/server/preservation-rules";
import { pickDesignDirection, readDirectionFromMemory, renderDesignDirectionBlock } from "@/server/design-director.server";
import {
  applyStatedIntent,
  readStatedDesignIntent,
  renderCategoryCompositionBlock,
  renderStatedIntentBlock,
} from "@/server/design-intent.server";

import {
  humanizeBuildError,
  classifyRawError,
  isTransientFailure,
} from "@/server/self-recovery.server";
import { recordModelOutcome } from "@/server/model-kill-switch.server";
import { pickDynamicSnippets, renderCurrentDateBlock, renderSchemaBlock } from "@/server/dynamic-prompts.server";
import { renderDesignTasteBlock } from "@/server/design-taste.server";
import {
  keepChatPhotos,
  loadProjectPictures,
  renderProjectPictureBlock,
} from "@/server/registry/project-pictures.server";
import { renderAppUiBlock, renderAppScreenChecklistBlock } from "@/server/app-ui-library.server";
import { renderAppSpecBlock } from "@/server/app-spec.server";
import { MAX_USER_PROMPT_HARD_CEILING_CHARS, promptExceedsHardCeiling } from "@/lib/prompt-limits";

import { findAntiSamenessIssues } from "@/server/anti-sameness.server";
import { loadCoreKnowledge, loadSkillKnowledge, loadColorGuide } from "@/server/agent-knowledge";
import { assembleFirstBuildContext } from "@/server/engine/first-build-context";
import { createTelemetrySink, runWithExecutionSummary, takeExecutionSummary } from "@/server/engine/loop-telemetry";
import type { CallTrace } from "@/server/engine/tool-loop";
import { selectHistoryForGeneration } from "@/server/context/budget";
import { renderLearningBlock } from "@/server/learning-injector.server";
import { detectHighStakesIntent } from "@/lib/high-stakes-intent";
import { renderPetalCapabilitiesBlock } from "@/server/petal-capabilities.server";
import { autofixFiles } from "@/server/stream-autofixer";
import { fallbackEstimate } from "@/server/preflight-estimate.server";
import { classifyPhase, modelTierForPhase, type Phase } from "@/server/phase-classifier.server";
// Tier 3 model verifier removed: it duplicated the deterministic local
// verifier and its recovery pass was unconditionally skipped by the
// Phase D one-round autofix cap, so it only added latency + tokens.
import { runLocalVerifyTier } from "@/server/pipeline/tier-local-verify";
import {
  assessChunking,
  assessRouteCoverage,
  buildChunkInstruction,
  parseStepsFromArgs,
  runChunkedGeneration,
} from "@/server/chunked-generation.server";
import { firstBuildSeedFiles, FIRST_BUILD_TOOL_NOTE, firstBuildBrief } from "@/server/engine/first-build";

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
import {
  isScaffoldAbsorbedPath,
  isScaffoldOwnedPath,
  projectAuthoredFiles,
  isVerifierExempt,
} from "@/server/scaffold-ownership.server";
import {
  runWriteGate,
  writeGateDisclosure,
  type WriteRejection,
} from "@/server/write-gate.server";
import { injectPreviewGuard } from "@/server/preview-guard.server";
import {
  checkFileBudgets,
  enforceFileBudgets,
  looksIncomplete,
  type FileBudgetIssue,
} from "@/server/file-budget.server";
import { pickBestModel } from "@/server/smart-router.server";
import { evaluateCostCeiling } from "@/server/cost-ceiling.server";
import { recordAiOutcome } from "@/server/ai-outcomes.server";
import { budgetMessages, type BudgetMessage } from "@/server/context/budget";
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
import { buildEditBoundary } from "@/server/edit-boundary.server";
import { decideBackendGate, renderBackendGateBlock } from "@/server/two-phase-gate.server";
import { ensureBrandIdentity } from "@/server/brand-identity.server";
import {
  estimateTokens,
  promptTokenCeiling,
  anchoredWindows,
  readErrorFrame,
  userFacingProviderMessage,
  type ProviderError,
} from "@/server/prompt-budget.server";
import { normalizeClientTurnId, startTurn, turnBelongsToUser, type TurnRecorderHandle } from "@/server/turn-recorder.server";
import {
  openTurnCompletion,
  markStage,
  markInterruptedForResume,
} from "@/server/turn-completion.server";
import { persistAbandonedTurnReply } from "@/server/abandoned-turn-reply.server";
import { gatherWebIntel } from "@/server/web-intel/web-intel.server";
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
  /** When true, this run is an internal auto-fix triggered by Kimble itself
   *  after a failed build. It changes prompt shaping and scaffold healing
   *  ONLY — it does NOT skip credit checks or charging. Every model call
   *  costs money, so every model call is metered. */
  isAutoFix?: boolean;
  isInternalRepair?: boolean;
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
  /** Set by the autonomous resume worker: how many repair rounds this request
   *  has already spent, so the server-owned budget carries across turns
   *  instead of resetting every time a new turn row is opened. */
  autoResumeAttempts?: number;
  /** Set by the resume worker: continue an interrupted first build from its
   *  durable checkpoint instead of starting from zero. */
  resumeCheckpointId?: string;
  /** What the user is looking at in the preview when they sent the message:
   *  the currently open route and, when picked, the selected element. Used to
   *  resolve "this page" / "this button" instead of guessing. */
  viewContext?: {
    path?: string;
    title?: string;
    heading?: string | null;
    element?: {
      tag?: string;
      text?: string;
      id?: string | null;
      classes?: string | null;
      sourceFile?: string | null;
      sourceLine?: string | null;
    } | null;
  };
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

const MODEL_FAST = "google/gemini-3.1-flash-lite";
const MODEL_BEST = "google/gemini-3.8-flash";
// Phase-aware reasoning candidates. Added to the smart-router pool so
// the telemetry-driven picker (`pickBestModel`) can promote whichever
// model is winning on success_rate / cost / latency for a given
// (feature, phase). They fall back to the Gemini defaults when no
// telemetry exists yet, and the phase_router cheap-direct path still
// short-circuits to MODEL_FAST for trivial turns.
const MODEL_REASONING = "openai/gpt-5.4";
const MODEL_CLAUDE = "anthropic/claude-sonnet-5";
/** Escalation model used when the primary returned prose / no tool call.
 *  This must be a model that is known-good on the Lovable AI gateway for
 *  streamed tool calls. GPT-5 was returning HTTP 400 in production retry
 *  telemetry, which meant the retry never actually ran and `no_edit_emitted`
 *  leaked to users. */
const MODEL_STRUCTURED_RETRY = "google/gemini-3.8-flash";

/** One billable call's cost: provider-reported (ACTUAL) or token-estimated. */
function turnCallCost(u: GatewayUsage, model: string = MODEL_STRUCTURED_RETRY): import("@/lib/build-pricing").CallCost {
  if (typeof u.cost === "number" && Number.isFinite(u.cost)) return { costUsd: u.cost, basis: "actual" };
  const micro = estimateCostUsdMicro(u.model ?? model, u.prompt_tokens ?? 0, u.completion_tokens ?? 0, u.prompt_tokens_details?.cached_tokens ?? null);
  return micro == null ? { costUsd: null, basis: "unknown" } : { costUsd: micro / 1e6, basis: "estimated" };
}
/** Vision-capable model used whenever the latest turn carries image attachments. */
const MODEL_VISION = "google/gemini-3.8-flash";

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
    // Truncation still escalates via the structured retry path (22k), so the
    // first attempt can be sized for a lean build rather than the worst case.
    if ((args.promptChars ?? 0) >= 700) return 16_000;
    if ((args.promptChars ?? 0) >= 350) return 12_000;
    return 10_000;
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
  // Constraint-aware retention BEFORE any truncation: earlier user messages
  // that state a standing rule ("always…", "never…", brand, font) survive,
  // alongside the immediate context for bare confirmations. The message budget
  // later fits the result to the token ceiling with the same priorities.
  return selectHistoryForGeneration(messages, lastUserIdx, needsPreviousContext);
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

export interface PromptBudgetOptions {
  /** Hard ceiling in tokens. Nothing may push the file block past this. */
  tokenCeiling?: number;
  /** 1-based anchor lines per path — large files are sent as windows. */
  anchors?: Record<string, number[]>;
  /** Multiplier applied when re-issuing a refused turn with less context. */
  shrink?: number;
}

export interface PromptBudgetResult {
  files: ProjectFile[];
  omitted: number;
  /** Estimated tokens the file block costs. Logged next to `files_sent`. */
  estimatedTokens: number;
  /** True when the ceiling — not relevance — decided what was dropped. */
  ceilingHit: boolean;
}

/** Default ceiling for the file block when the caller doesn't compute one. */
const DEFAULT_FILE_BLOCK_TOKEN_CEILING = 60_000;

function trimFilesForPrompt(
  files: ProjectFile[],
  latestPrompt = "",
  pinnedPaths: string[] = [],
  // Paths resolved as the literal target of a targeted edit. These are sent in
  // full whenever the budget allows: the model has to quote their bytes
  // verbatim in `replace` ops. When the budget does NOT allow it they are sent
  // as anchored windows — never head-truncated, which is what used to make
  // `replace` snippets miss the tail of a file.
  fullPaths: string[] = [],
  options: PromptBudgetOptions = {},
): PromptBudgetResult {

  const multiEditIntent = detectMultiEditIntent(latestPrompt);
  const full = new Set(fullPaths);
  const pinned = new Set([...pinnedPaths, ...fullPaths]);
  const shrink = options.shrink ?? 1;
  const anchors = options.anchors ?? {};

  // Cross-cutting intents need a larger budget — the whole point of pinning
  // is so the model sees every page/component at once.
  const expandForPinned = pinned.size > 0;
  const fileLimit = Math.max(
    4,
    Math.round(
      (expandForPinned
        ? Math.max(MULTI_EDIT_CONTEXT_FILE_LIMIT, pinned.size + 8)
        : multiEditIntent
          ? MULTI_EDIT_CONTEXT_FILE_LIMIT
          : PATCH_CONTEXT_FILE_LIMIT) * shrink,
    ),
  );
  // The real ceiling. Unlike the old character budget this is measured in the
  // unit the model actually enforces, and NOTHING is exempt from it.
  const tokenCeiling = Math.max(
    6_000,
    Math.round((options.tokenCeiling ?? DEFAULT_FILE_BLOCK_TOKEN_CEILING) * shrink),
  );
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
  let usedTokens = 0;
  let ceilingHit = false;
  // Priority order: edit targets, pins, then relevance. Pinning decides WHO
  // gets the budget first — it no longer exempts anyone from it.
  for (const file of [...files].sort(
    (a, b) =>
      (isPromptRelevant(a) ? 3 : rank(a.path)) - (isPromptRelevant(b) ? 3 : rank(b.path)) ||
      rank(a.path) - rank(b.path) ||
      a.path.localeCompare(b.path),
  )) {
    if (picked.length >= fileLimit) break;
    if (usedTokens >= tokenCeiling) {
      ceilingHit = true;
      break;
    }
    const isPinned = pinned.has(file.path);
    const isFull = full.has(file.path);
    const remaining = tokenCeiling - usedTokens;

    // Send the part, not the whole file: anything with known anchors and more
    // bytes than its share of the budget goes out as merged windows around the
    // lines that matter, with the gaps and their real line numbers marked.
    const fileAnchors = anchors[file.path];
    const softLimit = isPinned || isPromptRelevant(file)
      ? RELEVANT_FILE_CONTEXT_CHAR_LIMIT
      : LARGE_FILE_CONTEXT_CHAR_LIMIT;

    let content = file.content;
    if (!isFull && content.length > softLimit) {
      content = fileAnchors?.length
        ? anchoredWindows(content, { lines: fileAnchors, pad: 45, maxLines: 420 })
        : `${content.slice(0, softLimit)}\n\n/* ...trimmed for context budget... */`;
    } else if (isFull && estimateTokens(content) > remaining && fileAnchors?.length) {
      content = anchoredWindows(content, { lines: fileAnchors, pad: 60, maxLines: 500 });
    }

    const cost = estimateTokens(`${file.path}\n${content}`) + 8;
    if (picked.length > 0 && usedTokens + cost > tokenCeiling) {
      ceilingHit = true;
      // An edit target that still doesn't fit gets its windows; if there are
      // no anchors we'd rather drop it than blow the ceiling and be refused.
      if (isFull && fileAnchors?.length) {
        const windowed = anchoredWindows(file.content, { lines: fileAnchors, pad: 30, maxLines: 200 });
        const windowCost = estimateTokens(`${file.path}\n${windowed}`) + 8;
        if (usedTokens + windowCost <= tokenCeiling) {
          picked.push({ path: file.path, content: windowed });
          usedTokens += windowCost;
        }
      }
      continue;
    }
    picked.push({ path: file.path, content });
    usedTokens += cost;
  }
  return {
    files: picked,
    omitted: Math.max(0, files.length - picked.length),
    estimatedTokens: usedTokens,
    ceilingHit,
  };
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
  // Internal caller (the autonomous resume worker). There is no user session
  // behind a scheduled repair round, so the worker proves itself with the
  // shared builder secret and names the user it acts for. Every downstream
  // credit and ownership check still runs against that user id.
  const internalSecret = request.headers.get("x-petal-internal-secret");
  const internalUser = request.headers.get("x-petal-internal-user");
  if (internalSecret && internalUser) {
    const expected = process.env.BUILDER_SHARED_SECRET;
    if (expected && secretsMatch(internalSecret, expected)) return internalUser;
    return new Response("Unauthorized", { status: 401 });
  }

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
  // Verification needs the signing keys over the network. A momentary blip
  // there is not a signed-out user, so give it one quiet second chance before
  // rejecting a perfectly good session mid-turn.
  let { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) {
    await new Promise((r) => setTimeout(r, 400));
    ({ data, error } = await supabase.auth.getClaims(token));
  }
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
    /** OpenAI/Anthropic via the gateway normalize cached prefix tokens here. */
    prompt_tokens_details?: { cached_tokens?: number };
    /** Anthropic raw via the gateway exposes these directly. */
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  } | null;
  /**
   * Upstream refusal carried INSIDE a 200 stream. The gateway reports upstream
   * failures as `{"error": {...}}` frames with no `choices`; before this the
   * reader skipped them and the turn looked empty instead of refused.
   */
  providerError?: ProviderError | null;
  /** Upstream provider that served this stream, when the gateway reports it. */
  upstream?: string | null;
  /** Set when the provider stopped making progress and we abandoned it. */
  stall?: { ms: number; afterOutput: boolean; upstream: string | null } | null;
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
/**
 * Progress watchdog. Keep-alive comments keep bytes flowing on a dead
 * upstream, so the byte-idle timer alone let one DigitalOcean stream sit for
 * ~10 minutes after 4 tokens. These count only frames carrying model output
 * (text, tool arguments or reasoning):
 *  - FIRST_OUTPUT: request accepted but nothing produced yet (large prompts
 *    need prefill time; reasoning deltas count as output).
 *  - STALL: output had started, then stopped. A healthy stream emits many
 *    tokens a second, so 90s of silence is a dead provider, not a slow one.
 * Healthy long generations are unaffected — there is no total-time cap here.
 */
// Measured 2026-09-24: DeepInfra normally emits tool arguments within ~2s,
// but Azure buffers the whole tool call (first frame at 123s for 1.5K
// tokens), so the pre-output bound must stay generous.
const STREAM_FIRST_OUTPUT_TIMEOUT_MS = 300_000;
const STREAM_STALL_TIMEOUT_MS = 90_000;

/**
 * DEV-only fault injection (body.testFault === "stall"): forward the real
 * upstream's first output frames, then go silent except for keep-alive
 * comments — the exact shape of the Rise & Crumb DigitalOcean stall.
 */
function simulateDeadStream(real: Response): Response {
  const reader = real.body!.getReader();
  const enc = new TextEncoder();
  let frames = 0;
  let dead = false;
  const out = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      if (dead) {
        await new Promise((r) => setTimeout(r, 10_000));
        ctrl.enqueue(enc.encode(": GATEWAY PROCESSING\n\n"));
        return;
      }
      const { value, done } = await reader.read();
      if (done) { dead = true; return; }
      ctrl.enqueue(value);
      // Stop after the first frame that carries real output (the DO case:
      // a few tokens, then silence). The real reader is held, not read.
      frames++;
      const txt = new TextDecoder().decode(value);
      if (frames >= 2 && /"(content|reasoning|arguments)":"[^"]/.test(txt)) dead = true;
    },
    cancel(reason) { void reader.cancel(reason).catch(() => {}); },
  });
  return new Response(out, { status: real.status, headers: real.headers });
}

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
  // Kimble is about to build *before* the file body streams.
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

  const streamStartedAt = Date.now();
  let lastOutputAt: number | null = null;
  while (true) {
    const progressDeadline =
      lastOutputAt == null
        ? streamStartedAt + STREAM_FIRST_OUTPUT_TIMEOUT_MS
        : lastOutputAt + STREAM_STALL_TIMEOUT_MS;
    const progressWait = Math.max(0, progressDeadline - Date.now());
    const stallFires = progressWait < STREAM_IDLE_TIMEOUT_MS;
    const STALL = Symbol("stall");
    // Race the next chunk read against an idle-timeout. If the upstream
    // goes silent for STREAM_IDLE_TIMEOUT_MS the provider is wedged —
    // cancel the reader and throw a classifiable timeout. This replaces
    // the old behaviour of relying solely on the wall-clock ceiling,
    // which would also kill streams that were happily producing bytes.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const idle = new Promise<typeof STALL>((resolve, reject) => {
      timer = setTimeout(() => {
        if (stallFires) resolve(STALL);
        else reject(new Error("operation was aborted due to timeout (stream idle)"));
      }, stallFires ? progressWait : STREAM_IDLE_TIMEOUT_MS);
    });
    let value: Uint8Array | undefined;
    let done = false;
    try {
      const result = await Promise.race([reader.read(), idle]);
      if (result === STALL) {
        const stalledMs = Date.now() - (lastOutputAt ?? streamStartedAt);
        tool.stall = { ms: stalledMs, afterOutput: lastOutputAt != null, upstream: tool.upstream ?? null };
        console.warn(
          `[stream-stall] upstream=${tool.upstream ?? "?"} noOutputFor=${stalledMs}ms afterOutput=${lastOutputAt != null} argsChars=${tool.args.length}`,
        );
        try { await reader.cancel(`stall:${stalledMs}`); } catch { /* ignore */ }
        break;
      }
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
      // A refusal arrives as a 200 stream frame carrying `error` and no
      // `choices`. Capture it — skipping it is what made refused turns look
      // empty and got the identical oversized request re-sent twice.
      const frameProvider = (json as { provider?: unknown }).provider;
      if (typeof frameProvider === "string" && frameProvider) tool.upstream = frameProvider;
      {
        const d = (json as { choices?: Array<{ delta?: Record<string, unknown> }> })?.choices?.[0]?.delta;
        if (d && streamDeltaHasOutput(d)) lastOutputAt = Date.now();
      }
      const frameError = readErrorFrame(json);
      if (frameError) {
        tool.providerError = frameError;
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
          if (summaryNow.length > summaryEmitted.length && !currentTurnContext().holdSummary) {
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
  // Stream is over — close out only the checklist items the model actually
  // reached (by its files' `step` tags). Steps it never wrote stay unticked:
  // a plan item is never shown done unless its files were written.
  for (let i = 0; i < Math.min(activeStep, stepsEmitted); i++) {
    controller.enqueue(encoder.encode(sse({ type: "step_status", index: i, status: "done" })));
  }
  // Authoritative per-turn exclusion: a stalled or empty upstream is never
  // re-picked by any later call in this turn (sync, before any retry runs).
  if (tool.upstream && (tool.stall || tool.finishReason === "error" || (!tool.name && !tool.args.trim() && !tool.text.trim()))) {
    markUpstreamFailed(tool.upstream);
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
  problem: string;
  hasBackend: boolean;
  tool: typeof WRITE_PROJECT_TOOL | typeof PATCH_FILES_TOOL;
  maxTokens: number;
  crossCuttingIntent?: boolean;
  signal: AbortSignal;
  /** Resend the ORIGINAL request unchanged (provider failure). Routing away
   *  from failed upstreams is owned solely by engine/provider-policy. */
  providerStalled?: boolean;
  meta: {
    phase: Phase;
    promptChars: number;
    hadAttachments: boolean;
    chosenBy: string;
    projectId?: string | null;
    userId?: string | null;
    turnId?: string | null;
    fallbackNumber?: number | null;
    fallbackFromUpstream?: string | null;
    recoveryReason?: string | null;
  };
}): Promise<Response> {
  const bodyBase = {
    messages: args.providerStalled
      ? args.messages
      : addStructuredRetryInstruction(args.messages, {
          problem: args.problem,
          hasBackend: args.hasBackend,
          crossCuttingIntent: args.crossCuttingIntent,
        }),
    tools: [args.tool],
    tool_choice: { type: "function", function: { name: args.tool.function.name } },
    max_tokens: args.maxTokens,
    // Retries/continuations must spend their budget on code, not thinking.
    reasoning: { enabled: false },
    stream: true,
  };

  const primary = await aiChatCompletions({
    feature: "generate",
    body: { ...bodyBase, model: MODEL_STRUCTURED_RETRY },
    timeoutTier: "stream",
    // No providerOverride: follow the resolved provider (DB → default).
    // Legacy note: pinning "lovable" here once meant a funded OpenRouter
    // account was never used and every turn died on the Lovable gateway's 402.
    lockCallerModel: true,
    signal: args.signal,
    meta: args.meta,
  });
  // One attempt here. Model/provider fallback is owned by aiChatCompletions
  // and the provider policy — no second backup-model retry layer.
  return primary;
}

async function recoverMissingToolOutput(args: {
  chatMessages: Array<{ role: string; content: unknown }>;
  collected: ParsedTool;
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
  const requiredTool = "patch_files";
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
    problem: "previous response contained prose instead of the required tool call",
    hasBackend: Boolean(args.backend),
    tool: args.tool,
    maxTokens: 10_000,
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
  const parsed = parseCollectedProject(recoveredCollected);
  return { ...parsed, collected: recoveredCollected, usedRecovery: true };
}

/**
 * Emit a conversational AI reply WITHOUT failing the turn — used as the
 * deterministic fallback whenever generation can't safely produce edits.
 *
 * The user sees a normal Kimble message with a friendly explanation and
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
    cause?: string;
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
    outcome?: "answered" | "blocked" | "failed";
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
    // Mobile ships as the same React app wrapped in a Capacitor native shell
    // (see scaffold-kit-mobile-shell.ts + mobile-codemagic-template.server.ts).
    // `capacitor.config.ts` is scaffold-injected, so the only real failure
    // mode here is the generic "no renderable app" case the web guard covers.
    // Never roll a mobile turn back for not being Expo — that path does not
    // exist in Kimble's store pipeline.
    if (!hasAny((p) => p.startsWith("src/pages/")) && !has("src/App.tsx")) {
      return "I started building this as a mobile app but the output had no screens in it, so I rolled it back rather than hand you an empty app. Re-send the prompt and name the screens you want (e.g. 'home feed, add item, profile') and I'll build them.";
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


/** Edit turns only — first builds never produce a collected reply (tool loop). */
function parseCollectedProject(collected: ParsedTool): ParsedProjectPayload {
  if (!collected.name || !collected.args) {
    throw new Error("AI did not return usable edits for this request.");
  }
  if (collected.name === "write_project") {
    throw new Error("AI tried to rewrite the whole project. Edits must be incremental patches.");
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
        `[generate] salvaged ${salvaged.recovered} op(s) from a ${salvaged.truncated ? "truncated" : "malformed"} tool payload`,
      );
      parsed = salvaged.parsed as ParsedProjectPayload["parsed"];
    } else {
      console.error("Failed to parse tool args", e, collected.args.slice(0, 500));
      const looksCutOff = collected.args.length > 0 && !collected.args.trimEnd().endsWith("}");
      throw new Error(
        looksCutOff
          ? "AI response was cut off before the project JSON finished. Retrying with smaller files."
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
      console.warn(
        `[generate] dropped ${dropped} unusable op(s); first keys=${JSON.stringify(
          Object.keys((parsed.ops as unknown as Record<string, unknown>[])[0] ?? {}),
        )} sample=${JSON.stringify((parsed.ops as unknown[])[0] ?? null).slice(0, 200)}`,
      );
      parsed.ops = ops as unknown as ParsedProjectPayload["parsed"]["ops"];
    }
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
  args: { problem: string; hasBackend?: boolean; crossCuttingIntent?: boolean },
): T {
  const requiredTool = "patch_files";
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
  const retryBlock = `\n\nSTRUCTURED RETRY — your previous response could not be applied (${args.problem}). Retry now with a smaller, safer ${requiredTool} tool call. You MUST call ${requiredTool}; return complete JSON tool arguments only; include every required field.${scopeHint} For edit turns, prefer exact \`replace\` ops for small changes instead of resending whole files.${chunkHint} Keep files short and split large UI into components.${backendHint}`;
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

/**
 * "Add a logo" is a first-class capability, not a model gamble.
 *
 * When the app has no brand mark, build one from its own name and palette and
 * wire it everywhere a mark belongs — header/footer surfaces, the placeholder
 * glyphs standing in for it, and the site icon.
 */
function deterministicBrandMarkFallback(args: {
  currentFiles: ProjectFile[];
  latestUserContent: string;
}): ParsedProjectPayload | null {
  if (!/\b(logo|brand ?mark|wordmark|monogram|favicon|app icon)\b/i.test(args.latestUserContent)) {
    return null;
  }
  let result: { files: ProjectFile[]; notes: string[] };
  try {
    result = ensureBrandIdentity(args.currentFiles);
  } catch {
    return null;
  }
  const before = new Map(args.currentFiles.map((f) => [f.path, f.content]));
  const ops = result.files
    .filter((f) => before.get(f.path) !== f.content)
    .map((f) => ({
      op: before.has(f.path) ? ("update" as const) : ("create" as const),
      path: f.path,
      content: f.content,
    }));
  if (ops.length === 0) return null;

  const summary = "Added a logo built from the app's own name and colours, and used it across the header, footer and site icon.";
  const recap = ops.map((o) => `- ${o.op === "create" ? "Added" : "Updated"} ${o.path}`).join("\n");
  return {
    parsed: {
      plan: "Create the brand mark and wire it into every surface that shows a logo.",
      summary,
      ops: ops as ParsedProjectPayload["parsed"]["ops"],
      recap,
    },
    summary,
    plan: "Create the brand mark and wire it into every surface that shows a logo.",
    recap,
  };
}

function deterministicPatchFallback(args: {
  currentFiles: ProjectFile[];
  latestUserContent: string;
}): ParsedProjectPayload | null {
  const brandMark = deterministicBrandMarkFallback(args);
  if (brandMark) return brandMark;

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

function isDirectLogoPlacementRequest(prompt: string): boolean {
  const compact = prompt.trim();
  if (!/\b(?:logo|brand ?mark|wordmark|monogram|favicon|app icon)\b/i.test(compact)) return false;
  if (!/\b(?:add|create|include|put|place|show|use|make)\b/i.test(compact)) return false;
  // Requests to redesign an existing mark still need design judgement.
  return !/\b(?:change|replace|redesign|restyle|colour|color|font|bigger|smaller|animate|upload|image)\b/i.test(compact);
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
 * Kimble v3 Phase A — the closed-loop pre-emit gate.
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
  /** Files as they were before this turn — the safe content to fall back to. */
  priorFiles: ProjectFile[] = [],
  /** The turn's ONE repair (shared budget). Broken generated files get it
   *  before anything is set aside. */
  repair?: (file: ProjectFile, detail: string) => Promise<string | null>,
  /** Provider failure recorded by the repair step, if any. */
  infraFailure: () => Error | null = () => null,
  /** Creates one missing shared module (root-cause repair). */
  createMissing?: import("@/server/engine/missing-nodes").CreateModule,
): Promise<{ ok: true; files: ProjectFile[] } | { ok: false; detail: string; origin?: "infrastructure" | "code" }> {
  const { runPreEmitGate, formatGateIssues } = await import("@/server/preemit-gate.server");
  const { blockedRemovals } = await import("@/server/engine/structural-deps");
  const { recoverMissingPrimitives } = await import("@/server/engine/deterministic-primitives");
  // Allowlisted generic primitives only; project-specific modules are never stubbed.
  const primitives = recoverMissingPrimitives(files);
  if (primitives.added.length) {
    console.log(`[deterministic-primitives] provided ${JSON.stringify(primitives.added)}`);
    files = primitives.files;
    changedPaths = [...changedPaths, ...primitives.added];
  }
  // Root cause first: a missing module is the broken node, not its importers.
  if (createMissing) {
    const { resolveMissingNodes } = await import("@/server/engine/missing-nodes");
    const nodes = await resolveMissingNodes(files, changedPaths, createMissing);
    if (nodes.created.length) {
      console.log(`[missing-nodes] created ${JSON.stringify(nodes.created)}`);
      controller.enqueue(encoder.encode(sse({ type: "timeline", step: "missing_nodes", outcome: "ok", count: nodes.created.length, message: `Created ${nodes.created.length} missing shared file(s): ${nodes.created.join(", ")}`, ts: Date.now() })));
      files = nodes.files;
      changedPaths = [...changedPaths, ...nodes.created];
    }
    if (nodes.blocked.length) {
      console.warn(`[missing-nodes] blocked ${JSON.stringify(nodes.blocked)}`);
      const inf = infraFailure();
      if (inf) return { ok: false, detail: inf.message, origin: "infrastructure" };
    }
  }


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
    // Scope-locked to this turn's files so the cosmetic stages cannot restyle
    // screens the turn never touched.
    afterRepair: (candidate) =>
      runAllRepairs(
        candidate,
        changedPaths.length > 0 && priorFiles.length > 0
          ? { scopeLock: { touchedPaths: changedPaths }, localOnly: true }
          : undefined,
      ).files,
  });

  if (report.rounds > 0) {
    console.log(`[preemit-gate] ${report.trace.join(" | ")}`);
  }

  if (!report.ok) {
    const validatorFailure = report.issues.find((i) => i.kind === "validator-unavailable");
    if (validatorFailure) {
      console.error(`[preemit-gate] validation unavailable — refusing to classify or quarantine files: ${validatorFailure.detail}`);
      controller.enqueue(
        encoder.encode(sse({
          type: "timeline",
          step: "esbuild_parse",
          outcome: "failed",
          message: "Code validation was unavailable — build stopped safely",
          ts: Date.now(),
        })),
      );
      return { ok: false, detail: validatorFailure.detail };
    }
    // Salvage before surrender. Observed on a real build: two of eight files
    // came back truncated (an unterminated string, unbalanced braces), the
    // repair rounds made no progress, and the ENTIRE turn was rolled back —
    // the user got nothing at all for a complete app.
    //
    // A small number of bad files is not a bad turn. Drop just those (or
    // restore their pre-turn content), re-run deterministic repairs so the
    // import resolver keeps the app resolving, and ship the rest. The
    // placeholder-completion pass downstream then writes the dropped screens
    // for real.
    let badPaths = Array.from(new Set(report.issues.map((i) => i.path))).filter(Boolean);
    // Every eligible broken file goes through the same single repair first
    // (Home and the layout got none in the live run; Contact did).
    if (repair && badPaths.length > 0) {
      let working = gated;
      const fixedPaths: string[] = [];
      for (const p of badPaths) {
        const file = working.find((f) => f.path === p);
        if (!file) continue;
        const detail = report.issues.filter((i) => i.path === p).map((i) => `${i.kind}: ${i.detail}`).join("; ");
        let out: string | null = null;
        try { out = await repair(file, detail); } catch { out = null; }
        if (out && out !== file.content) {
          working = working.map((f) => (f.path === p ? { path: p, content: out! } : f));
          fixedPaths.push(p);
        }
      }
      // Diagnosis before destruction: if the repair step failed because the
      // AI provider failed, nothing here says the files are invalid enough to
      // remove. Preserve everything and report the infrastructure failure.
      const infra = infraFailure();
      if (infra) {
        return { ok: false, detail: infra.message, origin: "infrastructure" };
      }
      if (fixedPaths.length) {
        const again = await runPreEmitGate(working, changedPaths, { maxRounds: 0, prd });
        console.log(`[preemit-gate] repair attempted=${JSON.stringify(fixedPaths)} ok=${again.report.ok}`);
        if (again.report.ok) return { ok: true, files: again.files };
        const still = new Set(again.report.issues.map((i) => i.path));
        gated.splice(0, gated.length, ...again.files);
        badPaths = badPaths.filter((p) => still.has(p));
      }
    }
    // First builds (no prior files) always keep the good files: a broken page
    // is set aside, never a reason to discard the pages that work.
    const priorPaths = new Set(priorFiles.map((f) => f.path));
    // Dependency-aware: a structurally critical file (entry, app shell,
    // shared module) may be replaced by its prior verified content, never
    // dropped. If one would have to be dropped, preserve the last valid state.
    const blocked = blockedRemovals(gated, badPaths, (p) => priorPaths.has(p));
    if (blocked.length) {
      console.warn(`[preemit-gate] refusing to remove structurally critical file(s) ${JSON.stringify(blocked)}`);
      return { ok: false, detail: `critical file failed verification: ${formatGateIssues(report.issues.filter((i) => blocked.includes(i.path)), 3)}`, origin: "code" };
    }
    const salvageable = badPaths.length > 0 && badPaths.length < gated.length && (priorFiles.length === 0 || badPaths.length <= 4);
    if (salvageable) {
      try {
        const bad = new Set(badPaths);
        const priorByPath = new Map(priorFiles.map((f) => [f.path, f.content] as const));
        const kept = gated.filter((f) => !bad.has(f.path));
        for (const p of badPaths) {
          const previous = priorByPath.get(p);
          if (previous !== undefined) kept.push({ path: p, content: previous });
        }
        const repaired = runAllRepairs(
          kept,
          changedPaths.length > 0 && priorFiles.length > 0
            ? { scopeLock: { touchedPaths: changedPaths }, localOnly: true }
            : undefined,
        ).files;
        const recheck = await runPreEmitGate(
          repaired,
          changedPaths.filter((p) => !bad.has(p)),
          { maxRounds: 0, prd },
        );
        if (recheck.report.ok) {
          console.log(`[preemit-gate] salvaged turn by quarantining ${badPaths.length} file(s)`);
          controller.enqueue(
            encoder.encode(sse({ type: "status", message: "Setting aside a file that couldn't be fixed…" })),
          );
          return { ok: true, files: recheck.files };
        }
      } catch (e) {
        console.warn("[preemit-gate] salvage failed:", e instanceof Error ? e.message : String(e));
      }
    }
    // FIRST BUILDS: never discard the build. Isolate every file that still
    // fails (plus anything that then fails because it imported one), keep
    // everything valid, and let the completeness check report the real
    // state. There is no prior project to roll back to — "rollback" here
    // meant deleting good pages.
    if (priorFiles.length === 0) {
      const { isolateBrokenFiles, isOwnContentIssue } = await import("@/server/engine/build-state");
      let kept = gated;
      let bad = new Set(badPaths.length ? badPaths : report.issues.map((i) => i.path).filter(Boolean));
      const isolated: string[] = [];
      for (let round = 0; round < 3 && bad.size > 0; round++) {
        const critical = blockedRemovals(kept, bad, () => false);
        if (critical.length) {
          console.warn(`[preemit-gate] first build: refusing to isolate critical file(s) ${JSON.stringify(critical)}`);
          return { ok: false, detail: `critical file failed verification: ${critical.join(", ")}`, origin: "code" };
        }
        isolated.push(...bad);
        kept = isolateBrokenFiles(kept, bad);
        const again = await runPreEmitGate(kept, changedPaths.filter((p) => !isolated.includes(p)), { maxRounds: 0, prd });
        kept = again.files;
        // Only a file whose OWN content is broken is isolated. A valid file
        // that merely imports an isolated one (App.tsx → Home) is kept; the
        // completeness check reports the missing dependency honestly.
        bad = new Set(
          again.report.issues
            .filter((i) => isOwnContentIssue(i.kind))
            .map((i) => i.path)
            .filter((p) => p && !isolated.includes(p)),
        );
      }
      console.warn(`[preemit-gate] first build: isolated ${JSON.stringify(isolated)}; kept ${kept.length} file(s)`);
      controller.enqueue(encoder.encode(sse({ type: "status", message: "Setting aside files that couldn't be fixed…" })));
      return { ok: true, files: kept };
    }
    // EDITS: revert only this turn's change to the prior project. A failed
    // gate is NOT an infra error; it just means this edit wasn't safe.
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
  /** Real setup-stage progress for the user while no stream exists yet.
   *  `phase` moves the phase rail only when that stage truly starts. */
  onStage?: (stage: { message: string; phase?: "thinking" | "designing" }) => void,
): Promise<Response> {
  const abortSignal = workSignal ?? request.signal;
  // Setup-stage timing: one log line per stage so slow starts are measurable.
  const setupStartedAt = Date.now();
  let stageAt = setupStartedAt;
  const stageMarks: Array<{ name: string; at: number }> = [{ name: "open", at: setupStartedAt }];
  const stage = (name: string, message?: string, phase?: "thinking" | "designing") => {
    const now = Date.now();
    console.info(`[setup-timing] turn=${turnId ?? "n/a"} ${name} +${now - stageAt}ms total=${now - setupStartedAt}ms`);
    stageAt = now;
    stageMarks.push({ name, at: now });
    if (message) {
      try {
        onStage?.({ message, phase });
      } catch {
        /* progress is cosmetic */
      }
    }
  };
  // One durable identity must follow the logical turn through telemetry,
  // reconnects and billing. Creating a second id inside the stream broke the
  // database's exactly-once settlement guarantee on transport retries.
  const logicalTurnId = turnId ?? crypto.randomUUID();
  const authResult = await authorize(request);
  if (authResult instanceof Response) return authResult;
  const userId = authResult;
  {
    // Isolated inference evaluation: bench account + explicit header only.
    const { INFERENCE_EVAL_HEADER, INFERENCE_EVAL_USER_IDS, INFERENCE_EVAL_MODELS } = await import("@/lib/ai-model-config");
    const evalHdr = request.headers.get(INFERENCE_EVAL_HEADER);
    if (evalHdr && (INFERENCE_EVAL_USER_IDS as readonly string[]).includes(String(userId))) {
      const all = INFERENCE_EVAL_MODELS as readonly string[];
      // "chain" = full hierarchy; a model id = that model alone (per-candidate runs).
      const models = evalHdr === "chain" ? [...all] : all.includes(evalHdr) ? [evalHdr] : [];
      const tc = currentTurnContext();
      if (models.length && Object.keys(tc).length) {
        tc.inferenceEval = { models };
        console.log(`[inference-eval] models=${models.join(",")}`);
      }
    }
  }

  const economyMode = await loadEconomyMode(userId);

  // P0-4: app-level abuse protection. Runs BEFORE the credit floor check
  // so rate-limited requests never charge the wallet.
  const rl = checkGenerateRateLimit(userId);
  if (!rl.ok) return rateLimitResponse(rl);

  // Provider key check is handled inside aiChatCompletions; we only verify
  // here so we can surface the existing friendly 500 if no provider is set.
  if (!process.env.LOVABLE_API_KEY) {
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
  const kitSyncedPaths = new Set<string>();
  /** True only once this turn's change passed every gate and is being committed. */
  let turnCommittedForMemory = false;
  const turnBaselineFiles = currentFiles;

  /**
   * AI Generation Bible §7 — the repair phase is bounded by rounds AND by a
   * hard cost ceiling. Rounds alone don't bound spend: one repair pass over a
   * 40-file project costs more than ten over a small one. Repair is Kimble's
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
  // Started now so it overlaps the requirements pass instead of queueing
  // behind it. Awaited at its original place; same input, same result.
  let earlyBriefExpansion: ReturnType<typeof expandBriefIfVague> | null = null;
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
  const balance = await checkCreditBalance({ userId, amount: DEFAULT_BUILD_ECONOMICS.minChargeCredits });
  if (!balance.ok) {
    if (balance.reason === "insufficient_credits") {
      return new Response(
        JSON.stringify({
          error:
            "You're out of credits. Add credits in Settings → Credits to keep generating.",
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
          // Terminal frame: a proposal is a COMPLETED turn now waiting on the
          // user. Without it the client reads the clean EOF as a dropped
          // build and tries to reconnect to a turn that never existed.
          controller.enqueue(
            planEncoder.encode(sse({ type: "done", status: "plan_proposed" })),
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
                    "Kimble couldn't draft a plan for that request. Try sending again without Plan first.",
                  kind: classifyRawError(raw),
                  raw: raw.slice(0, 240),
                }),
              ),
            );
            // Keep the terminal frame so the client surfaces THIS error
            // instead of a generic "could not reconnect" one.
            controller.enqueue(
              planEncoder.encode(sse({ type: "done", status: "failed" })),
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
  if (isInitial) earlyBriefExpansion = expandBriefIfVague(latestUserMessage(messages)).catch(() => ({ expanded: false, brief: latestUserMessage(messages) }) as Awaited<ReturnType<typeof expandBriefIfVague>>);
  if (isInitial) {
    const tc = currentTurnContext();
    if (Object.keys(tc).length > 0) tc.holdSummary = true;
  }
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

  // Project Memory — durable facts learned across previous turns. Loaded
  // with the user's JWT so RLS enforces ownership. Loaded here (not later)
  // because the first-build setup fan-out below needs it.
  const reqAuth = request.headers.get("authorization");
  const userJwt = reqAuth?.startsWith("Bearer ") ? reqAuth.slice("Bearer ".length) : "";
  const memoryEntries =
    body.projectId && userJwt ? await loadProjectMemory(userJwt, body.projectId) : [];

  // First-build setup fan-out. The PRD, the design direction and the PIC
  // understanding pass each depend ONLY on the brief (+ memory), never on
  // each other's output, so they run concurrently instead of back-to-back.
  // Same calls, same inputs, same consumers — only the waiting is removed.
  let earlyDesign: Promise<Awaited<ReturnType<typeof pickDesignDirection>>> | null = null;
  let earlyUnderstanding: Promise<import("@/server/pic/pic-types").PicUnderstanding> | null = null;
  const startSetupFanOut = async () => {
    if (!isInitial || body.isAutoFix || body.isInternalRepair) return;
    const setupBrief = earlyBriefExpansion
      ? (await earlyBriefExpansion).brief
      : latestUserMessage(messages);
    // A repair classification later simply ignores these (see isRepairTurn uses).
    if (userJwt) {
      earlyDesign = pickDesignDirection({ jwt: userJwt, projectId: body.projectId, brief: setupBrief, memoryEntries });
      earlyDesign.catch(() => {});
    }
    if (process.env.PETAL_PIC_DISABLED !== "1") {
      const { understandRequest } = await import("@/server/understanding.server");
      earlyUnderstanding = understandRequest(setupBrief, {
        userId,
        projectId: body.projectId ?? null,
        prior: null,
        signal: request.signal,
      });
      earlyUnderstanding.catch(() => {});
    }
  };

  if (buildTarget.id === "web") {
    try {
      const { resolvePrdForTurn } = await import("@/server/prd/prd-engine.server");
      stage("pre_prd", "Working out what your app needs to do…");
      const prdPromise = resolvePrdForTurn({
        brief: lastContent,
        projectId: body.projectId,
        userId,
      });
      prdPromise.catch(() => {});
      await startSetupFanOut().catch((e) => console.warn("[setup] fan-out skipped:", e instanceof Error ? e.message : String(e)));
      resolvedPrd = await prdPromise;
      prdBlock = resolvedPrd.promptBlock;
      prdScenarioBlock = resolvedPrd.scenarioBlock;
      prdNote = resolvedPrd.note;
      // When the contract itself changed, Kimble must say so in one sentence
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

  // Generic design/craft guidance now lives in the canonical agent
  // knowledge (src/server/agent-knowledge), loaded below as `coreKnowledge`.




  // Look up the project's attached backend (BYO Supabase). When present,
  // we both inject the pre-configured client and tell the AI it exists.
  let backend = body.projectId ? await lookupBackendForGenerate(body.projectId) : null;
  let sharedBackend =
    !backend && body.projectId ? await lookupSharedBackendForGenerate(body.projectId) : null;

  // Intent → action. The inline "Enable X" cards were removed; Kimble now acts
  // on the same detection itself. Best-effort: any failure leaves the turn
  // exactly as it would have been.
  // Product planner verdict, decided BEFORE any page is written: an
  // application (internal or public+app) needs accounts and saved data; a
  // public website does not. First builds only — edits keep what they have.
  let productNeedsBackend: { reason: string } | null = null;
  if (isInitial) {
    try {
      const { deriveIntentContract } = await import("@/server/prd/intent-contract");
      const c = deriveIntentContract(latestUserMessage(messages), null);
      if (c.surface === "app" || c.surface === "public+app") {
        productNeedsBackend = {
          reason: `Your ${c.label || "app"} needs user accounts and saved data.`,
        };
      }
    } catch {
      /* no verdict — keyword detection below still applies */
    }
  }
  const intentActions = await resolveIntentActions({
    projectId: body.projectId,
    prompt: latestUserMessage(messages),
    productNeedsBackend,

    hasBackend: Boolean(backend),
    hasSharedBackend: Boolean(sharedBackend),
  });
  if (intentActions.enabledSharedBackend && body.projectId) {
    sharedBackend = await lookupSharedBackendForGenerate(body.projectId);
  }
  // Cloud economics — kept apart from AI/build economics. The shared tier
  // runs inside Kimble's own database, so its per-project cost is not
  // measured: recorded as a resource with an UNKNOWN cost, never invented.
  if (intentActions.cloud.status === "enabled" && body.projectId) {
    void import("@/server/cost-events.server").then(({ recordCostEvents }) =>
      recordCostEvents([{
        sourceRef: `cloud:provision:shared:${body.projectId}`,
        userId,
        projectId: body.projectId,
        stage: "cloud_provision",
        category: "DATABASE",
        provider: "kimble_shared(supabase)",
        resource: "shared_backend",
        quantity: 1,
        unit: "project",
        costUsd: null,
        basis: "UNKNOWN",
        metadata: { domain: "cloud", tier: "kimble", event: "provisioned", includes: ["database", "auth", "rest_api"] },
      }]),
    ).catch(() => {});
  }


  const sharedBackendBlock = sharedBackend
    ? `\n\n### Backend (Kimble Cloud, shared tier) is connected\nThis project has a FREE shared backend: a real database + user accounts, no SQL and no migrations. Use the pre-configured client — never call createClient, never import @supabase/supabase-js, never write SQL or emit a MIGRATION block.\n\nImports:\n- import { db, auth } from "@/integrations/backend/client"\n- import { useAuth, AuthProvider } from "@/integrations/backend/auth"\n\nData API (collections are created on first write):\n- await db.list<T>("tasks", { mine: true, limit: 50 }) -> { records }\n- await db.create("tasks", { title, done: false })\n- await db.update("tasks", id, { done: true })\n- await db.remove("tasks", id)\nEach record is { id, collection, user_id, data, created_at, updated_at } — your fields live under \`record.data\`.\n\nAuth: auth.signUp / auth.signIn / auth.signOut, or useAuth() for { user, loading }. Wrap the app once with <AuthProvider>.\nREAL DATA IS REQUIRED: every page that lists, creates or changes the app's records (orders, users, bookings, tasks…) must load them with db.list and save them with db.create / db.update / db.remove from the first time you write it. Do NOT create a mock/sample/fake data module (e.g. src/lib/mock-data.ts) and do NOT hard-code record arrays — the final check rejects any page that shows only sample data while this backend is connected. Show an empty state (with a create action) when a collection has no records yet. Constant lookups (status labels, nav items) are fine inline.\nLimits: 5,000 rows and 25 collections. Never overwrite anything under src/integrations/backend/ — protected.\n`
    : "";

  const backendBlock = backend
    ? `\n\n### Backend (auth + database + storage) is connected\nThe project has a backend. Use the pre-configured client — never call createClient yourself, never import from @supabase/supabase-js directly, never hard-code URLs or keys.\n\nImports:\n- import { supabase } from "@/integrations/backend/client"\n- import { useAuth, AuthProvider } from "@/integrations/backend/auth"\n- import { uploadFile, getPublicUrl } from "@/integrations/backend/storage"\n\nWrap the app once with <AuthProvider>. Never overwrite anything under src/integrations/backend/ — those files are protected.\n\nIf you need a new table, end your summary with a fenced sql block prefixed "MIGRATION:" — do not try to run it. The user runs migrations manually.\n`
    : "";

  // Live schema injection: best-effort, soft-fails, cached. Lists existing
  // tables + key columns so the model reuses real tables instead of
  // hallucinating ones, and so column names in queries match reality.
  const schemaBlock = await renderSchemaBlock({ backend, projectId: body.projectId });

  // Marketplace integrations (Resend, Plausible, etc.) — tells Kimble
  // which helpers exist so it uses them instead of reinventing.
  const integrationsBlock = body.projectId
    ? await loadInstalledIntegrationsContext(body.projectId)
    : "";

  // Auto-suggest: when the user asks for a capability we already have a
  // marketplace integration for (and it isn't installed yet), inject a
  // short prompt block so Kimble recommends installing it instead of
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
  // (userJwt + memoryEntries are loaded before the PRD stage — see setup fan-out.)
  // Replaced below by the precedence-resolved memory once the project
  // manifest exists (source beats memory; the current request beats both).
  let memoryBlock = renderMemoryBlock(memoryEntries);

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
    const expansion = await (earlyBriefExpansion ?? expandBriefIfVague(lastUserContent));
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
    hasBackendConnected: Boolean(backend) || Boolean(sharedBackend),
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
  // committed aesthetic — the root cause of "every Kimble app looks the
  // same / sidebar + dashboard for a feed prompt".
  // Re-render the full committed direction on every turn. The director reads
  // the persisted value first, so edits retain density, motion, FX recipe and
  // concrete design moves instead of degrading to the blueprint's one-line
  // visual summary.
  // Classify EARLY (deterministic, no AI call) so a repair turn never runs
  // the first-build stages below. A runtime-error repair must not re-pick a
  // design direction, re-map the product, or present "Choosing a design
  // direction" to the user — it reads the failing code and fixes exactly
  // that. The same classification is reused for execution scope later.
  const { classifyRequest } = await import("@/server/execution");
  const turnClassification = classifyRequest(lastUserContent || "", { isInitial });
  const isRepairTurn =
    turnClassification.operation === "repair" ||
    Boolean(body.isAutoFix) ||
    Boolean(body.isInternalRepair);

  // Repair turns reuse the COMMITTED design direction read-only (no model
  // call, no re-selection). Other turns pick as before — the picker itself
  // short-circuits to the persisted direction when one exists.
  stage(
    "pre_design",
    isRepairTurn ? "Reading the failing code…" : "Choosing a design direction…",
    isRepairTurn ? undefined : "designing",
  );
  const rawDesignDirection = userJwt
    ? isRepairTurn
      ? readDirectionFromMemory(memoryEntries)
      : await (earlyDesign ??
          pickDesignDirection({
            jwt: userJwt,
            projectId: body.projectId,
            brief: lastUserContent,
            memoryEntries,
          }))
    : null;
  // The person's own words outrank anything auto-picked, on every turn.
  const statedIntent = readStatedDesignIntent(lastUserContent || "");
  const designDirection = applyStatedIntent(rawDesignDirection, statedIntent);
  // Structural = anything that changes product shape: the first build, a
  // cross-cutting request, or a new page/feature. Computed once here and
  // reused by both the design block and PIC so they agree on how much
  // context this turn actually needs.
  const isStructuralTurn =
    !isRepairTurn &&
    (isInitial ||
      /\b(redesign|re-?design|rebuild|new (page|screen|feature|section)|add (a )?(page|dashboard|auth|login|payment|checkout)|entire (site|website|app)|whole (site|app))\b/i.test(
        lastUserContent || "",
      ));

  const renderDirection = (packageOwnsVisuals: boolean) =>
    designDirection
      ? renderDesignDirectionBlock(designDirection, {
          detail: isStructuralTurn ? "full" : "compact",
          packageOwnsVisuals,
        })
      : "";
  const directionPart = renderDirection(false);
  let designBlock =
    directionPart +
    // Composition guidance only matters while new surface is being built.
    (isStructuralTurn ? await renderCategoryCompositionBlock(lastUserContent || "") : "") +
    renderStatedIntentBlock(statedIntent) +
    // Pictures already made for this project/owner (or admin-shared): a few
    // compact lines so the AI reuses instead of asking for a new one.
    (isStructuralTurn || /\b(image|photo|picture|hero|gallery|banner)\b/i.test(lastUserContent || "")
      ? await (await import("@/server/registry/generated-pictures.server"))
          .renderReusablePicturesBlock({
            request: lastUserContent || "",
            scope: { projectId: body.projectId ?? null, ownerId: userId ?? null },
          })
          .catch(() => "")
      : "");


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
      const isStructural = isStructuralTurn;
      stage(
        "pre_pic",
        isRepairTurn ? "Reviewing the affected area…" : "Mapping your pages and sections…",
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
        designDirection,
        understanding: isRepairTurn ? null : earlyUnderstanding,
      });
      picContext = assembled.pic;
      // The design system package owns colours/fonts: the director block
      // drops its palette + typography so there is exactly one visual authority.
      if (assembled.pic.design?.package && directionPart) {
        designBlock = renderDirection(true) + designBlock.slice(directionPart.length);
      }
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
  // Kimble Intelligence — multi-agent planning board.
  //
  // Convenes the specialists this turn actually deserves (a colour tweak gets
  // none; a marketplace gets the full board), reconciles their conflicts, and
  // returns one binding-decisions block. Fully additive: any failure returns an
  // empty block and the pipeline below runs exactly as it did before.
  // ---------------------------------------------------------------------------
  let orchestrationBlock = "";
  // Phase 1 — only convene the board when the turn genuinely reshapes the
  // product. Everyday edits skip it entirely: no extra calls, no extra wait,
  // no chance of an unrequested requirement being injected.
  // Reliability rebuild: the 5-specialist board (product/design/ux/
  // architecture/security) cost ~23 serial model calls per run and only
  // restated what the PRD + design direction already give the generator.
  // Off by default; KIMBLE_AGENT_BOARD=1 restores it.
  const orchestratorWorthwhile =
    process.env["KIMBLE_AGENT_BOARD"] === "1" && (isInitial || isStructuralTurn);
  try {
    if (!orchestratorWorthwhile) throw new Error("skip: board off (PRD + design direction cover it)");
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

  // Filter out files Kimble manages itself before showing the project to the
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
  // ONE classification for this request (operation, mode, edit size,
  // dimensions, cross-cutting). Deterministic; no AI classifier call.
  const { buildExecutionScope, renderScopeBlock } = await import("@/server/execution");
  // turnClassification was computed once before the design stage (a repair
  // turn must be known before first-build stages run) — reuse it here.
  const editClassification = turnClassification.edit;
  if (editClassification) {
    console.info(
      `[classify] op=${turnClassification.operation} scope=${editClassification.scope} dims=${editClassification.dimensions.join(",")} cross=${turnClassification.crossCutting} — ${turnClassification.reason}`,
    );
  }

  // Edit Intelligence phase 1 + 3 — turn the message into an explicit change
  // set (every clause, plus anything the user said to preserve), and resolve
  // bare references ("the button too") against what the last turn changed.
  // Both are deterministic; the change set is audited against the real diff
  // after the edit lands.
  const { extractChangeSet, renderChangeSetBlock } = await import("@/server/change-set.server");
  const turnChangeSet = isInitial
    ? { items: [], preserve: [], multi: false }
    : extractChangeSet(lastUserContent);
  let focusBlock = "";
  let focusPinnedPaths: string[] = [];
  if (!isInitial && body.projectId) {
    try {
      const { loadEditFocus } = await import("@/server/edit-history.server");
      const { resolveWithFocus } = await import("@/server/edit-focus.server");
      const priorFocus = await loadEditFocus(body.projectId);
      const resolved = resolveWithFocus({
        prompt: lastUserContent,
        changeSet: turnChangeSet,
        focus: priorFocus,
      });
      if (resolved.applied) {
        focusBlock = resolved.block;
        focusPinnedPaths = resolved.pinnedPaths;
        console.info(
          `[edit-focus] resolved against previous turn (${priorFocus?.target}) — pinning ${focusPinnedPaths.length} file(s)`,
        );
      }
    } catch (e) {
      console.warn("[edit-focus] skipped:", e instanceof Error ? e.message : String(e));
    }
  }
  const { kitTargetGuidance } = await import("@/server/change-set.server");
  const changeSetBlock = isInitial
    ? ""
    : `${renderChangeSetBlock(turnChangeSet)}${kitTargetGuidance(turnChangeSet, currentFiles)}`;
  // Deterministic App Map from the CURRENT files (never memory). The writer
  // and every repair in this turn see the same facts: router, entry, routes,
  // pages, shared layout, navigation.
  const { renderAppMapBlock, appMapFacts } = await import("@/server/engine/app-map");
  // Project Context layer — deterministic manifest, design language,
  // precedence-resolved memory and fail-closed section flags. No AI call.
  const { assembleProjectContext } = await import("@/server/context");
  const projectCtx = assembleProjectContext({
    files: currentFiles,
    request: lastUserContent || "",
    isInitial,
    memoryEntries,
    manifestInputs: {
      projectId: body.projectId ?? null,
      backendKind: sharedBackend ? "shared" : backend ? "dedicated" : "none",
    },
  });
  const turnAppMap = projectCtx.manifest?.appMap ?? null;
  memoryBlock = projectCtx.memoryBlock;
  {
    const stale = projectCtx.memory.filter((m) => m.status !== "active");
    if (stale.length) {
      console.info(`[project-context] memory not applied: ${stale.map((m) => `${m.key}(${m.status}: ${m.reason})`).join("; ")}`);
    }
    console.info(`[project-context] flags=${JSON.stringify(projectCtx.flags)}`);
    console.info(`[design-knowledge] mode=${projectCtx.designKnowledge.mode} category=${projectCtx.designKnowledge.category ?? "-"} topics=${projectCtx.designKnowledge.topics.join(",") || "-"}`);
  }
  const appMapBlock = turnAppMap
    ? renderAppMapBlock(turnAppMap) + projectCtx.structureBlock + projectCtx.designBlock + projectCtx.designKnowledgeBlock
    : projectCtx.designKnowledgeBlock;
  const appMapRepairBlock = turnAppMap ? renderAppMapBlock(turnAppMap, 900).trim() : "";
  if (turnChangeSet.items.length > 1) {
    console.info(
      `[change-set] ${turnChangeSet.items.length} requested change(s), ${turnChangeSet.preserve.length} preservation rule(s)`,
    );
  }

  const isCrossCutting = turnClassification.crossCutting;
  let pinnedPaths = isCrossCutting ? pickPinnedPaths(editablePromptFiles) : [];
  if (isCrossCutting) {
    console.info(
      `[intent-targets] cross-cutting ask detected — pinning ${pinnedPaths.length} file(s) into prompt context`,
    );
  }
  for (const p of focusPinnedPaths) {
    if (!pinnedPaths.includes(p) && editablePromptFiles.some((f) => f.path === p)) {
      pinnedPaths.push(p);
    }
  }
  // Phase 4 — the page the user is actually looking at (and any element they
  // picked) becomes explicit context, and the files rendering that page get
  // pinned so they survive prompt trimming.
  let viewBlock = "";
  if (!isInitial && body.viewContext) {
    try {
      const { renderViewContext, routeCandidatePaths } = await import(
        "@/server/view-context.server"
      );
      const viewPaths = routeCandidatePaths(
        body.viewContext,
        editablePromptFiles.map((f) => f.path),
      );
      viewBlock = renderViewContext(body.viewContext, viewPaths);
      const picked = body.viewContext.element?.sourceFile;
      for (const p of [...viewPaths, ...(picked ? [picked] : [])]) {
        if (!pinnedPaths.includes(p) && editablePromptFiles.some((f) => f.path === p)) {
          pinnedPaths.push(p);
        }
      }
      if (viewBlock) {
        console.info(
          `[view-context] ${body.viewContext.path ?? "(no route)"} — pinned ${viewPaths.length} file(s)`,
        );
      }
    } catch (e) {
      console.warn("[view-context] skipped:", e instanceof Error ? e.message : String(e));
    }
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
  let editTargetPaths =
    editIntent?.isTargetedEdit && !isCrossCutting ? editIntent.pinnedPaths : [];
  // Plain-words screen match ("the sign-in form", "the home page") — finds the
  // target without an AI round trip, so the Inspector rarely has to run.
  if (!isInitial && !isCrossCutting) {
    const { findScreenTargets, expandPageSections, findAdjacentSection } = await import(
      "@/server/screen-target.server"
    );
    const screen = Array.from(
      new Set([
        ...expandPageSections(
          lastUserContent,
          findScreenTargets(lastUserContent, editablePromptFiles.map((f) => f.path)),
          editablePromptFiles,
        ),
        ...findAdjacentSection(lastUserContent, editablePromptFiles),
      ]),
    );
    if (screen.length > 0) {
      editTargetPaths = Array.from(new Set([...screen, ...editTargetPaths])).slice(0, 8);
    }
    // Starter-kit files (fx, three, examples, ui…) are never the target of an
    // edit to the user's own app: a word like "hero" or "text" matching
    // `fx/hero-parallax` must not put it in write scope.
    const ownTargets = editTargetPaths.filter((p) => !isVerifierExempt(p));
    if (ownTargets.length > 0) editTargetPaths = ownTargets;
    if (screen.length > 0) {
      console.info(`[screen-target] ${screen.join(", ")}`);
    }
  }
  if (editTargetPaths.length > 0) {
    console.info(
      `[edit-intent] verb=${editIntent!.verb} resolved ${editTargetPaths.length} target file(s): ${editTargetPaths.join(", ")}`,
    );
  }


  // Manifest-based focused selection: page types and component names matched
  // against the request. Deterministic, so the Inspector AI only runs when
  // project structure alone cannot name the target.
  if (!isInitial && !isCrossCutting && editTargetPaths.length === 0 && projectCtx.selection) {
    const picked = projectCtx.selection.primary.filter(
      (p) => editablePromptFiles.some((f) => f.path === p) && !isVerifierExempt(p),
    );
    if (picked.length > 0) {
      editTargetPaths = picked;
      console.info(
        `[project-context] selected ${picked.map((p) => `${p} (${projectCtx.selection!.reasons[p]})`).join(", ")}`,
      );
    }
  }

  // Targets come only from deterministic location (edit intent, manifest
  // selection, classifier hints) — no separate AI inspector call.
  let resolvedTargetPaths = editTargetPaths;

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
      .filter((p) => !resolvedTargetPaths.includes(p) && !isVerifierExempt(p))
      .slice(0, 6);
    if (hintMatches.length > 0) {
      resolvedTargetPaths = [...resolvedTargetPaths, ...hintMatches];
      console.info(`[edit-classifier] hint-matched target(s): ${hintMatches.join(", ")}`);
    }
  }



  /** Import neighbours of the resolved targets — writable on a targeted edit. */
  let impactNeighbourPaths: string[] = [];
  // Engine 3.0 phase 4 — impact graph. A targeted edit rarely stops at the
  // file it names: whoever imports that file has to keep compiling, and
  // whatever it imports defines the props it may use. Pin that immediate
  // blast radius so the model edits with the callers in view instead of
  // breaking them silently. Deterministic, capped, and skipped when we are
  // already pinning the whole app for a cross-cutting ask.
  if (
    !isInitial &&
    !isCrossCutting &&
    editClassification?.scope !== "micro" &&
    resolvedTargetPaths.length > 0
  ) {

    try {
      const { computeImpact } = await import("@/server/impact-graph.server");
      const impact = computeImpact(editablePromptFiles, resolvedTargetPaths, {
        radius: 1,
        max: 18,
      });
      impactNeighbourPaths = impact.paths.filter((p) => !resolvedTargetPaths.includes(p));
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


  // Execution discipline — deterministic operation class + enforced scope.
  // Shared chrome and unrelated pages are protected on targeted edits; the
  // scope never grows silently. No AI call.
  const executionScope = buildExecutionScope({
    request: lastUserContent || "",
    classification: turnClassification,
    manifest: projectCtx.manifest,
    targets: resolvedTargetPaths,
    neighbours: impactNeighbourPaths,
  });
  const executionScopeBlockBase = isInitial ? "" : renderScopeBlock(executionScope);
  // Lifecycle phase in the agent context (existing prompt assembly).
  const { initialDepth } = await import("@/server/execution");
  const turnInitialDepth = initialDepth(turnClassification, lastUserContent || "");
  // Execution complexity (internal): drives decomposition and is the
  // expected-cost baseline recorded with this turn's economics.
  const { assessExecution } = await import("@/server/execution/complexity");
  const turnRequirementCount = Math.max(
    turnChangeSet.items.length,
    (resolvedPrd as { prd?: { requirements?: unknown[] } } | null)?.prd?.requirements?.length ?? 0,
  );
  const turnComplexityBase = {
    isInitial,
    operation: (turnClassification as { operation?: string }).operation ?? null,
    request: lastUserContent || "",
    requirementCount: turnRequirementCount,
    plannedPages: 0,
    existingFiles: currentFiles.length,
    crossCutting: Boolean(turnClassification.crossCutting),
    backendInvolved: Boolean(backend),
    integrations: 0,
  };
  const turnEscalations: string[] = [];
  const turnStrategy: Record<string, unknown> = { decomposedPages: [] as string[] };
  console.info(`[complexity] ${JSON.stringify(assessExecution(turnComplexityBase))}`);
  // Economic ledger opens BEFORE expensive execution: even a catastrophic
  // failure leaves a measurable record (finalized at the terminal boundary).
  {
    const opened = assessExecution(turnComplexityBase);
    void agentIO().recordEconomics({
      turnId: logicalTurnId,
      userId,
      projectId: body.projectId ?? null,
      feature: "generate",
      creditsCharged: 0,
      isAutoFix: Boolean(body.isAutoFix),
      result: "running",
      metadata: { opened_at: new Date().toISOString(), execution_class: opened.class, expected_cost_usd: opened.expectedCostUsd },
    });
  }
  // Billing: estimate from the class, then HOLD credits before any expensive
  // work. The hold is the turn's runaway ceiling; settlement charges measured
  // cost capped by it, and every terminal turn releases what is left.
  let buildReservation: import("@/server/build-reservation.server").Reservation | null = null;
  if (!body.isAutoFix && turnId) {
    const { reserveBuildCredits } = await import("@/server/build-reservation.server");
    buildReservation = await reserveBuildCredits({ userId, turnId: logicalTurnId, cls: assessExecution(turnComplexityBase).class });
    console.info(`[credits] reserve ${JSON.stringify(buildReservation)}`);
    if (!buildReservation.ok && !buildReservation.error) {
      return new Response(
        JSON.stringify({
          error: `This request needs about ${buildReservation.estimated.toFixed(2)} credits and you have ${buildReservation.available.toFixed(2)} available. Add credits in Settings → Credits to continue.`,
        }),
        { status: 402, headers: { "Content-Type": "application/json" } },
      );
    }
  }
  const lifecycleBlock = await (async () => {
    try {
      const { renderLifecycleContext } = await import("@/server/context/lifecycle");
      let currentRevision: number | null = null;
      let buildRevision: number | null = null;
      let buildStatus: string | null = null;
      let publishedRevision: number | null = null;
      const knownIssues: string[] = [];
      if (!isInitial && body.projectId) {
        const { data: proj } = await supabaseAdmin
          .from("projects").select("revision, latest_build_id, published_build_id").eq("id", body.projectId).maybeSingle();
        currentRevision = (proj?.revision as number | null) ?? null;
        const ids = [proj?.latest_build_id, proj?.published_build_id].filter(Boolean) as string[];
        if (ids.length) {
          const { data: builds } = await supabaseAdmin.from("project_builds").select("id, status, project_revision, error_message").in("id", ids);
          for (const b of builds ?? []) {
            if (b.id === proj?.latest_build_id) {
              buildRevision = (b.project_revision as number | null) ?? null;
              buildStatus = b.status as string;
              if (b.status === "failed" && b.error_message) knownIssues.push(String(b.error_message).slice(0, 160));
            }
            if (b.id === proj?.published_build_id) publishedRevision = (b.project_revision as number | null) ?? null;
          }
        }
      }
      return "\n\n" + renderLifecycleContext({
        isInitial,
        operationType: toOperationType(turnClassification.operation, { isInitial }),
        executionDepth: turnInitialDepth,
        currentRevision,
        buildRevision,
        buildStatus,
        publishedRevision,
        designSystem: picContext?.design?.package?.systemId ?? null,
        accent: picContext?.design?.package?.accent ?? null,
        routes: (projectCtx.manifest?.pages ?? []).map((p) => String((p as { route?: string; path?: string }).route ?? (p as { path?: string }).path ?? "")).filter(Boolean),
        relevantFiles: resolvedTargetPaths,
        recentChanges: [],
        knownIssues,
      });
    } catch (e) {
      console.warn("[lifecycle] context unavailable", (e as Error).message);
      return "";
    }
  })();
  // Conditional read-only parallel exploration (skipped for LIGHT / first build).
  const explorationBlock = await (async () => {
    try {
      const { exploreProject } = await import("@/server/context/explore");
      const r = await exploreProject({ files: currentFiles, cls: assessExecution(turnComplexityBase).class, isInitial, request: lastUserContent || "" });
      turnStrategy.exploration = r.ran ? r.roles : `skipped:${r.skippedReason}`;
      return r.block;
    } catch {
      return "";
    }
  })();
  const executionScopeBlock = `${executionScopeBlockBase}${lifecycleBlock}${explorationBlock}`;
  // One TurnLedger per turn: enforces TURN_LIMITS on repairs, writes and
  // deletes; the TurnTransaction at the commit point is accounted by it.
  const { TurnLedger, commitTurn } = await import("@/server/execution");
  const turnLedger = new TurnLedger();
  const turnChecks: Array<{ check: string; verdict: import("@/server/execution").Verdict; detail?: string }> = [];
  console.info(
    `[execution] op=${executionScope.operation} mode=${turnClassification.mode} plan=${turnClassification.planRequired} targets=${executionScope.affectedFiles.length} protected=${executionScope.protectedAreas.length} (${turnClassification.reason})`,
  );

  // Anchors let large files travel as windows around the exact lines that
  // matter instead of whole files — the single biggest reduction for a
  // targeted edit, and it keeps the tail of a file reachable.
  const promptAnchors: Record<string, number[]> = {};
  for (const target of editIntent?.targets ?? []) {
    const lines = target.anchors.map((a) => a.line).filter((n) => Number.isFinite(n));
    if (lines.length) promptAnchors[target.path] = lines;
  }
  // Hard ceiling for the file block, derived from the model's own context
  // window minus the output reservation. Nothing is exempt from it.
  // The concrete model is picked further down, so budget against the smallest
  // window in the pool — being conservative here is the point.
  const fileBlockCeiling = Math.round(
    promptTokenCeiling({ model: null, completionBudgetTokens: 16_000 }) * 0.55,
  );
  // Reliability rebuild, phase 2 — strict target-only context.
  //
  // A one-element edit used to arrive with a dozen neighbouring pages in the
  // prompt, which is exactly how "add a back button to sign in" came back as a
  // rewrite of the landing page. When the scope is small AND we resolved real
  // target files, the model sees ONLY those files (plus the design tokens it
  // needs to stay on-palette). Everything else is unreachable, so it cannot be
  // rewritten by accident.
  const strictScope =
    !isInitial &&
    !isCrossCutting &&
    resolvedTargetPaths.length > 0 &&
    (editClassification?.scope === "micro" || editClassification?.scope === "targeted");
  const contextFiles = strictScope
    ? (() => {
        const keep = new Set<string>(resolvedTargetPaths);
        if (editClassification?.scope === "targeted") {
          for (const p of impactNeighbourPaths) keep.add(p);
        }
        keep.add("src/styles.css");
        const narrowed = editablePromptFiles.filter((f) => keep.has(f.path));
        return narrowed.length > 0 ? narrowed : editablePromptFiles;
      })()
    : editablePromptFiles;
  if (strictScope) {
    console.info(
      `[strict-context] ${editClassification?.scope} edit — sending ${contextFiles.length} of ${editablePromptFiles.length} file(s)`,
    );
  }
  const promptBudget = trimFilesForPrompt(
    contextFiles,
    multiEditPromptContext || lastUserContent,
    strictScope ? pinnedPaths.filter((p) => contextFiles.some((f) => f.path === p)) : pinnedPaths,
    resolvedTargetPaths,
    { tokenCeiling: fileBlockCeiling, anchors: promptAnchors },
  );

  // Read-before-edit: exactly the files whose current content the model
  // receives this operation count as inspected. Nothing else may be
  // overwritten (enforced at TurnLedger.write, the write boundary).
  for (const f of promptBudget.files) turnLedger.recordRead(f.path);
  console.info(
    `[prompt-budget] files_sent=${promptBudget.files.length} omitted=${promptBudget.omitted} est_tokens=${promptBudget.estimatedTokens} ceiling=${fileBlockCeiling}${promptBudget.ceilingHit ? " (ceiling hit)" : ""}`,
  );
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
        const base = editTargetPaths.length > 0 ? editIntent!.briefing : "";
        return `${base}${scopeBlock}`;
      })();



  // Built from a budget result so a refused (too-large) turn can be re-issued
  // immediately with a smaller one instead of repeating the same request.
  const renderFilesContext = (budget: PromptBudgetResult): string =>
    isInitial
      ? appMapBlock
      : `\n\nEditable app file manifest (all app-owned files Kimble may target):\n${compactManifest(currentFiles)}\n\nCurrent project files (trimmed to the most relevant editable files; ${budget.omitted} lower-priority files omitted for speed. Some large files are shown as the regions around the lines that matter, with the untouched ranges marked — quote only bytes you can actually see. Kimble-managed UI kit, reusable block library, mobile primitives, examples, and backend integration files are hidden — they exist in the project but you must never edit them):\n\n${budget.files
          .map((f) => `--- ${f.path} ---\n${f.content}`)
          .join("\n\n")}${crossCuttingAddendum}${viewBlock}${focusBlock}${changeSetBlock}${appMapBlock}${executionScopeBlock}`;
  const filesContext = renderFilesContext(promptBudget);
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
  // A bounded edit on existing files gets editing rules, not building rules.
  const boundedEdit =
    !isInitial &&
    !isCrossCutting &&
    (editClassification?.scope === "micro" || editClassification?.scope === "targeted");
  const dynamic = pickDynamicSnippets({
    messages,
    hasBackend: Boolean(backend),
    buildTarget,
    boundedEdit,
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
      // Requested scope is authoritative: a template may never add pages the
      // user did not ask for (Rise & Crumb: "bakery" → /reservations).
      {
        const { narrowRoutesToRequest } = await import("@/server/requested-scope");
        const scoped = narrowRoutesToRequest(lastUserText, composed.blueprint.routes, {
          marketing: detectedWebSubtype === "marketing",
        });
        if (scoped.join("|") !== composed.blueprint.routes.join("|")) {
          composed.blueprint.routes = scoped;
          narrowed = true;
        }
      }
      archetypeBlock = narrowed ? renderBlueprintBlock(composed.blueprint) : composed.promptBlock;
      // Archetype/blueprint routes are ADVISORY patterns, never requirements.
      // They are not added to plannedRoutes: required pages come only from
      // pages the user named, the intent contract, and the product surface.
      // (A template's route list used to fail builds as "missing requested
      // pages" for products outside the known domains.)
    }
  } catch {
    // Never block a build on composer failure.
  }

  // Intent contract (PRD): validate the plan against the REQUEST before any
  // expensive generation. No template match → the archetype's pages are the
  // plan; divergent pages (e.g. a shop inside a hospital system) are removed.
  let intentContract: import("@/server/prd/intent-contract").IntentContract | null = null;
  if (isInitial) {
    try {
      const { deriveIntentContract, divergentPages, renderIntentBlock } = await import("@/server/prd/intent-contract");
      intentContract = resolvedPrd?.prd.intent ?? deriveIntentContract(lastUserText, resolvedPrd?.prd ?? null);
      const bad = divergentPages(intentContract, plannedRoutes, lastUserText);
      if (bad.length) {
        console.warn(`[intent] removed divergent planned routes ${JSON.stringify(bad)} (archetype=${intentContract.archetype})`);
        for (const r of bad) plannedRoutes.splice(plannedRoutes.indexOf(r), 1);
        // The template's blueprint described the drifted pages; the contract
        // below replaces it rather than competing with it.
        if (intentContract.archetype) archetypeBlock = "";
      }
      // Plan validation: the plan must actually cover the requested product's
      // core modules. Under half covered → replan onto the contract's modules
      // BEFORE any page is generated (no generation/repair cycles wasted).
      if (intentContract.pages.length) {
        const core = intentContract.pages.map((pg) => pg.route);
        // Template sub-pages (e.g. /dashboard/items) duplicate contract pages;
        // keep only nested routes the contract lists or the user named.
        const lowerAsk = lastUserText.toLowerCase();
        for (const r of [...plannedRoutes]) {
          const segs = r.split("/").filter(Boolean);
          if (segs.length > 1 && segs[0] !== "auth" && !core.includes(r) && !lowerAsk.includes(segs[segs.length - 1]!.replace(/^\$/, ""))) {
            plannedRoutes.splice(plannedRoutes.indexOf(r), 1);
          }
        }
        const covered = core.filter((r) => plannedRoutes.includes(r)).length;
        if (covered * 2 < core.length) {
          const added = core.filter((r) => !plannedRoutes.includes(r));
          plannedRoutes.push(...added);
          turnStrategy.planCorrection = { archetype: intentContract.archetype, removed: bad, added };
          console.log(`[intent] plan corrected archetype=${intentContract.archetype} plan=${JSON.stringify(plannedRoutes)}`);
        } else if (bad.length) {
          turnStrategy.planCorrection = { archetype: intentContract.archetype, removed: bad, added: [] };
        }
      }
      archetypeBlock += renderIntentBlock(intentContract);
    } catch (e) {
      console.warn(`[intent] contract unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Bounded first-build generation units. Pages the user named are the plan
  // even without a template match. A build whose pages would overflow one
  // output budget writes the shared shell + the first pages now; the
  // coverage continuation below writes only the remaining pages (it never
  // rewrites delivered files). Small builds stay one call.
  // PLAN: the one scope contract the WRITE stage executes.
  let firstBuildPlan: import("@/server/engine/plan").FirstBuildPlan | null = null;
  if (isInitial) {
    try {
      const { planFirstBuild } = await import("@/server/engine/plan");
      // Sized against the ACTUAL first-unit output ceiling this turn sends.
      const firstUnitMaxOutput = completionBudget({
        isInitial: true,
        phase: "implement" as Phase,
        hasVisionTurn: false,
        multiEditIntent: false,
        promptChars: lastUserText.length,
      });
      const firstPlan = planFirstBuild({ prompt: lastUserText, plannedRoutes, maxOutputTokens: firstUnitMaxOutput });
      for (const r of firstPlan.routes) if (!plannedRoutes.includes(r)) plannedRoutes.push(r);
      firstBuildPlan = firstPlan;
      console.log(firstPlan.log);
    } catch {
      /* never block a build on unit planning */
    }
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
    // Force the block on when the resolved build target IS mobile, even if
    // the wording of this particular turn ("add a filter") carries no mobile
    // signal — otherwise follow-up turns drift back to desktop layouts.
    mobileBlock = renderMobileGuidanceBlock(lastUserText, {
      force: isMobileTarget(buildTarget.id),
    });
  } catch {
    // Never block a build on guidance failure.
  }

  // Layer M — Game generation guidance. Fires when the user asks Kimble to
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
  // Order: stable system/build rules → stable design rules → project-stable
  // reference (backend/schema/integrations/blueprint). Anything keyed on the
  // request text or on notes that change turn to turn lives in
  // `changingProjectText` at the head of the suffix.
  const coreKnowledge = loadCoreKnowledge(isInitial ? "full" : "compact");
  console.info(`[agent-knowledge] core=${coreKnowledge.file}`);
  const staticPrefixText =
    baseSystem +
    buildTargetBlock +
    capabilitiesBlock +
    // Canonical agent knowledge: full system.md on a first build, compact.md
    // on edits/continuations. Only one of the two is ever loaded. Stable per
    // mode, so it stays inside the cached prefix.
    "\n\n" + coreKnowledge.text + "\n\n" +
    backendBlock +
    sharedBackendBlock +
    schemaBlock +
    integrationsBlock +
    renderBuildBlueprintBlock(persistedBlueprint);

  const changingProjectText =
    renderArchitectureBlock(persistedArchitecture) +
    memoryBlock +
    preservationBlock +
    knowledgeBlock +
    designBlock +
    multiEditBlock +
    appShapeBlock +
    mobileBlock +
    gameBlock +
    archetypeBlock +
    heroContractBlock;

  // Design taste + section library + locked palette/type.
  // Marketing/fullstack get the landing taste; app/fullstack get the
  // product-UI taste. Additive, cache-safe (lives in the dynamic suffix).
  let designTasteBlock = "";
  // A one-line change does not need the full design manual (palette, type
  // pairings, section library, header patterns, icon vocabulary, imagery
  // rules). Every capability added here made EVERY request heavier; a
  // targeted non-visual edit now carries none of it.
  const editScopeForPrompt = editClassification?.scope ?? "targeted";
  const skipDesignManual =
    !isInitial &&
    !isCrossCutting &&
    // A one-thing ask never needs the whole design manual, even a visual one:
    // "make this button green" is not a redesign.
    (editScopeForPrompt === "micro" ||
      (editScopeForPrompt === "targeted" &&
        !(editClassification?.dimensions ?? []).includes("visual")));
  try {
    if (skipDesignManual) {
      designTasteBlock = "";
    } else if (detectedWebSubtype === "marketing" || detectedWebSubtype === "fullstack") {
      // Section framework now comes from the section-architectures /
      // page-composition knowledge skills, not a second checklist.
      designTasteBlock = renderDesignTasteBlock(lastUserText || "", { packageOwnsVisuals: !!picContext?.design?.package }).text;
    }
    if (!skipDesignManual && (detectedWebSubtype === "app" || detectedWebSubtype === "fullstack")) {
      const appUi = renderAppUiBlock(lastUserText || "", { packageOwnsVisuals: !!picContext?.design?.package });
      designTasteBlock += appUi.text + renderAppScreenChecklistBlock();
      // The PRD supersedes the keyword-scraped app spec. Only fall back to the
      // old extractor when the PRD engine produced nothing this turn.
      if (!prdBlock) designTasteBlock += renderAppSpecBlock(lastUserText || "");
    }
  } catch {
    /* never block a build on taste-block failure */
  }

  // Photos someone attached in chat become real photos of this project, and
  // they outrank anything generated.
  let ownPhotoBlock = "";
  try {
    if (hasVisionTurn) {
      await keepChatPhotos(body.projectId ?? null, messages[lastUserIdx]?.attachments);
    }
    // Conditional context: project photos only when the request is about
    // imagery (or carries photos). Unknown → not included.
    if (projectCtx.flags.images || hasVisionTurn) {
      ownPhotoBlock = renderProjectPictureBlock(await loadProjectPictures(body.projectId ?? null));
    }
  } catch {
    /* a photo lookup must never block a build */
  }
  designTasteBlock += ownPhotoBlock;

  // Focused expertise — a short set of craft rules chosen for THIS request
  // instead of the whole manual on every one. Deterministic and capped.
  let skillsBlock = "";
  try {
    const { renderSkillsForTurn } = await import("@/server/skills");
    const picked = renderSkillsForTurn({
      scope: editClassification?.scope ?? (isInitial ? "structural" : "targeted"),
      dimensions: editClassification?.dimensions ?? [],
      text: lastUserText || "",
      isInitial,
      isCrossCutting,
      touchesData: projectCtx.flags.database || projectCtx.flags.forms,
    });
    skillsBlock = picked.text;
    if (picked.ids.length) console.info(`[skills] ${picked.ids.join(", ")}`);
  } catch (e) {
    console.warn("[skills] skipped:", e instanceof Error ? e.message : String(e));
  }



  // Selected design-system package (if any): DESIGN.md + token/accent/font
  // summary. Outranks generic design defaults, never the user's request.
  let designSystemBlock = "";
  try {
    const { designSystemBlockFor } = await import("@/server/design-systems/context");
    designSystemBlock = designSystemBlockFor(picContext?.design);
  } catch (e) {
    console.warn("[design-systems] skipped:", e instanceof Error ? e.message : String(e));
  }

  // Context budget — measure everything before sending. When over, drop
  // optional material lowest-value first (history → skills → memory →
  // design → project state). Rules, the request and files are required.
  const contextBudget = (await import("@/server/context")).applyContextBudget(
    [
      { id: "system", priority: "required", text: staticPrefixText },
      { id: "files", priority: "required", text: filesContext },
      { id: "intent", priority: "required", text: (intentBrief ?? "") + resolvedBlock + groundingBlock + dynamic.text + intentActions.promptBlock + astPatchBlock + backendGateBlock + highStakesBlock + visionAddendum },
      { id: "pic", priority: "project-state", text: picBlock },
      { id: "prd", priority: "project-state", text: boundedEdit ? "" : prdBlock + prdScenarioBlock },
      { id: "designSystem", priority: "project-state", text: designSystemBlock },
      { id: "designTaste", priority: "design", text: designTasteBlock },
      { id: "memory", priority: "memory", text: memoryBlock },
      { id: "skills", priority: "skills", text: skillsBlock },
      { id: "orchestration", priority: "history", text: orchestrationBlock },
      { id: "learning", priority: "history", text: learningBlock },
      { id: "suggestions", priority: "inference", text: suggestionsBlock },
    ],
    promptTokenCeiling({ model: null, completionBudgetTokens: 16_000 }),
  );
  const keep = (id: string, text: string) => (contextBudget.dropped.includes(id) ? "" : text);
  console.info(
    `[context-budget] tokens=${contextBudget.tokens} budget=${contextBudget.budget}${contextBudget.dropped.length ? ` dropped=${contextBudget.dropped.join(",")}` : ""}${contextBudget.overRequired ? " (required sections alone exceed budget)" : ""}`,
  );
  const budgetedChanging = contextBudget.dropped.includes("memory") && memoryBlock
    ? changingProjectText.replace(memoryBlock, "")
    : changingProjectText;

  const dynamicSuffixText =
    budgetedChanging +
    dateBlock +
    (intentBrief
      ? `\n\n### Canonical turn intent (HARD CONTRACT)\n${intentBrief}\nSatisfy this exact outcome. Use the original user message for detail, but do not substitute a different feature, page, or product. Before emitting files, verify every planned change directly supports this intent.\n`
      : "") +
    keep("suggestions", suggestionsBlock) +
    resolvedBlock +
    groundingBlock +
    (approvedPlan ? renderApprovedPlanBlock(approvedPlan) : "") +
    dynamic.text +
    // The product contract goes ahead of the taste blocks: what to build first,
    // how it should look second.
    // Project Intelligence Context first: the canonical understanding and the
    // committed design system frame everything the contract blocks add.
    keep("pic", picBlock) +
    keep("prd", boundedEdit ? "" : prdBlock + prdScenarioBlock) +
    keep("orchestration", orchestrationBlock) +
    keep("designSystem", designSystemBlock) +
    keep("designTaste", designTasteBlock) +
    keep("skills", skillsBlock) +
    keep("learning", learningBlock) +
    highStakesBlock +
    visionAddendum +
    backendGateBlock +
    intentActions.promptBlock +

    astPatchBlock +
    filesContext;

  console.info(
    "[prompt-parts] " +
      Object.entries({
        staticPrefix: staticPrefixText, changing: changingProjectText, date: dateBlock, intent: intentBrief ?? "", suggestions: suggestionsBlock,
        resolved: resolvedBlock, grounding: groundingBlock, dynamic: dynamic.text, pic: picBlock, prd: prdBlock,
        prdScenario: prdScenarioBlock, orchestration: orchestrationBlock, designTaste: designTasteBlock,
        skills: skillsBlock, learning: learningBlock, highStakes: highStakesBlock, vision: visionAddendum,
        backendGate: backendGateBlock, intentActions: intentActions.promptBlock, astPatch: astPatchBlock, files: filesContext,
      })
        .filter(([, v]) => v.length > 0)
        .map(([k, v]) => `${k}=${v.length}`)
        .join(" "),
  );
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
      // OpenAI via the gateway ignores the marker safely and relies on
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

  // Graceful degradation for free accounts past the month's cost ceiling:
  // keep building, but on the cheap model. Never surfaced to the user, never
  // applied to paid accounts, and skipped entirely if the cost is unknown.
  const ceiling = await evaluateCostCeiling(userId);
  if (ceiling.degrade && model !== MODEL_FAST) {
    console.log(
      `[cost-ceiling] degrading model for free account: $${ceiling.monthCostUsd} >= $${ceiling.ceilingUsd}`,
    );
    model = MODEL_FAST;
    chosenBy = `${chosenBy}+cost_ceiling`;
  }

  // "deep" preset enables extended reasoning on the gateway. Models
  // that don't support `reasoning` simply ignore the field, so this
  // is safe to send unconditionally for deep turns.
  // Every other turn sends reasoning OFF explicitly. Measured 2026-09-24:
  // with the field omitted the code model thinks by default, and two
  // Rise & Crumb first builds spent all 18,000 completion tokens on hidden
  // reasoning (reasoning_tokens=18000, finish=length) and emitted zero code.
  const reasoningField =
    preset === "deep"
      ? { reasoning: { effort: "high" as const } }
      : { reasoning: { enabled: false } };

  // Tier 7 — context-budget pre-check. Estimate the input token cost
  // of the assembled messages and, if it exceeds the chosen model's
  // safe window, either upgrade to a larger-context model or drop
  // the oldest non-system messages until it fits. Eliminates silent
  // context-overflow failures (truncated/empty completions).
  // Web Intelligence (information only). Runs only when the user supplied a
  // URL; its sole output is one bounded system block placed before the
  // latest user message. It never writes files or calls a model.
  stage("pre_web_intel");
  const webIntel = await gatherWebIntel({
    message: lastUserContent,
    signal: abortSignal,
    turnId: logicalTurnId,
    projectId: body.projectId ?? null,
  });
  if (webIntel.status === "ok") {
    const at = Math.max(1, chatMessages.length - 1);
    (chatMessages as Array<{ role: string; content: unknown }>).splice(at, 0, { role: "system", content: webIntel.block });
  }
  // Same budget module and ceiling as the section budget above; the system
  // prompt (already budgeted) is pinned, only conversation history is fitted.
  const budget = budgetMessages(
    chatMessages as BudgetMessage[],
    promptTokenCeiling({ model, completionBudgetTokens: 16_000 }),
  );
  if (budget.droppedCount > 0) {
    console.log(
      `[context-budget] history est=${budget.estimatedTokens} budget=${budget.budget} dropped=${budget.droppedCount} model=${model}`,
    );
  }
  let finalMessages = budget.messages as typeof chatMessages;


  // ---------------------------------------------------------------------
  // Pre-emit agent loop. For work that spans many files or is mechanical,
  // give the model real hands before it writes: grep, read, run a codemod on
  // a real checkout, run the verifier — up to 5 rounds. The emit call below
  // is unchanged and still forced to a single structured payload; it just
  // runs with the transcript of everything the loop learned appended.
  // ---------------------------------------------------------------------
  const directLogoEdit = !isInitial && isDirectLogoPlacementRequest(lastUserContent)
    ? deterministicBrandMarkFallback({ currentFiles, latestUserContent: lastUserContent })
    : null;

  // RESUME: an interrupted first build continues from its durable checkpoint.
  // The saved shell answer replaces the first model call; saved pages are
  // re-staged and skipped by the page writer. Every gate still runs.
  const checkpointTurnId = /^[0-9a-f-]{36}$/i.test(logicalTurnId) ? logicalTurnId : null;
  let resumed: Awaited<ReturnType<typeof import("@/server/build-checkpoint.server").claimCheckpoint>> = null;
  if (isInitial && body.resumeCheckpointId && body.projectId && checkpointTurnId) {
    const { claimCheckpoint } = await import("@/server/build-checkpoint.server");
    resumed = await claimCheckpoint(body.resumeCheckpointId, body.projectId, checkpointTurnId);
    console.log(`[checkpoint] resume ${body.resumeCheckpointId} → ${resumed ? `claimed pages=${Object.keys(resumed.checkpoint.pages ?? {}).length} preserved=${JSON.stringify(resumed.preserved)}` : "not claimable, starting fresh"}`);
  } else if (isInitial && body.projectId && checkpointTurnId) {
    // A previous attempt stopped part-way and KEPT its validated work
    // (partial checkpoint): the next first-build request continues from it
    // instead of discarding it and paying for the same pages again.
    const { loadResumableCheckpoint, claimCheckpoint } = await import("@/server/build-checkpoint.server");
    const { PARTIAL_OUTCOME } = await import("@/lib/partial-build");
    const cp = await loadResumableCheckpoint(body.projectId).catch(() => null);
    if (cp && cp.terminal_outcome === PARTIAL_OUTCOME) {
      resumed = await claimCheckpoint(cp.id, body.projectId, checkpointTurnId);
      console.log(`[checkpoint] continue partial ${cp.id} → ${resumed ? `claimed pages=${Object.keys(resumed.checkpoint.pages ?? {}).length}` : "not claimable, starting fresh"}`);
    }
  }
  const resumeShell = resumed?.checkpoint.shell ?? null;
  /** Validated files this turn wrote (kept if the build stops part-way). */
  const partialWork = new Map<string, string>();
  let partialKept = false;
  const resumedBilled: Record<string, string> | null =
    resumed && resumed.checkpoint.terminal_outcome === "partial" ? { ...(resumed.checkpoint.pages ?? {}) } : null;

  stage("pre_write", resumeShell ? "Picking up where the build left off…" : "Starting to write your app…");
  // First builds never make a monolithic write_project call: the tool loop
  // below IS the first-build executor, starting from the (possibly resumed)
  // workspace. Only edits send the single structured patch request.
  const upstream = isInitial || directLogoEdit ? null : await aiChatCompletions({
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
    timeoutTier: "stream",
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
      turnId: logicalTurnId,
    },
  });

  if (!isInitial && !directLogoEdit && (!upstream || !upstream.ok || !upstream.body)) {
    // Upstream rejected before doing any work — nothing was charged,
    // nothing to refund. Just surface a friendly error.
    const upstreamStatus = upstream?.status ?? 502;
    let msg = `AI gateway error (${upstreamStatus})`;
    if (upstreamStatus === 429) msg = "Rate limit reached. Please wait a moment.";
    else if (upstreamStatus === 402)
      msg = "AI credits exhausted. Add credits in Settings → Workspace → Usage.";
    else {
      try {
        const text = upstream ? await upstream.text() : "No response";
        console.error("AI gateway error", upstreamStatus, text);
      } catch {
        /* ignore */
      }
    }
    releaseBuildLock(userId, body.projectId);
    return new Response(msg, { status: upstreamStatus === 402 ? 402 : 502 });
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
        if (webIntel.status === "ok") {
          controller.enqueue(encoder.encode(sse({
            type: "status",
            message: `Read ${webIntel.intel.pages.length} page${webIntel.intel.pages.length === 1 ? "" : "s"} of the website you linked — using it as reference`,
          })));
        } else if (webIntel.status === "unavailable" && webIntel.need === "required") {
          // Never fabricate a site the user asked to rebuild.
          emitConversationalFallback(controller, encoder, {
            files: currentFiles,
            summary: `I couldn't read ${webIntel.url}, so I haven't built anything — I won't guess what's on your site. Check the link opens publicly and send it again.`,
            outcome: "blocked",
            reason: "web_intel_unavailable",
          });
          return;
        } else if (webIntel.status === "unavailable") {
          controller.enqueue(encoder.encode(sse({
            type: "status",
            message: "Couldn't read the website you linked — building from your description instead",
          })));
        }
        controller.enqueue(encoder.encode(sse({ type: "phase", phase: "thinking" })));
        if (buildReservation?.ok) {
          controller.enqueue(encoder.encode(sse({ type: "credits_planned", credits: buildReservation.estimated })));
        }
        {
          // Real provisioning outcome (it already happened above) — never a guess.
          const cd = intentActions.cloud;
          const say = (message: string) => controller.enqueue(encoder.encode(sse({ type: "status", message })));
          if (cd.status === "enabled") {
            say(`${cd.reason} Kimble Cloud enabled a database and sign-in for it.`);
            say("Connecting your app to Kimble Cloud…");
          } else if (cd.status === "already_enabled" && isInitial) {
            say("Kimble Cloud is already on for this project — connecting your app to it…");
          } else if (cd.status === "failed" && cd.needed) {
            say(`${cd.reason ?? "This app needs saved data."} Kimble Cloud couldn't be switched on, so accounts and saved data are not connected yet.`);
          }
        }
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
        // Every page-writing call's tokens are billed with the main call.
        const pageWriteUsages: Array<GatewayUsage | null> = [];
        if (resumed) {
          const pv = resumed.preserved;
          controller.enqueue(encoder.encode(sse({
            type: "timeline",
            step: "continuation",
            outcome: "ok",
            message: `Resumed from saved progress: kept the layout and ${pv.pages} finished page${pv.pages === 1 ? "" : "s"} (${pv.aiCalls} AI calls, ~$${pv.costUsd.toFixed(3)}, ${Math.round(pv.elapsedMs / 60000)} min of work not repeated)`,
            ts: Date.now(),
          })));
        }
        // First builds: no model call here. The workspace (empty, or the
        // resumed checkpoint) is handed straight to the tool loop.
        let collected: ParsedTool = isInitial
          ? {
              name: "write_project",
              args: JSON.stringify({ files: firstBuildSeedFiles(resumeShell?.args) }),
              text: "",
              finishReason: "stop",
              usage: null,
              providerError: null,
            }
          : directLogoEdit
          ? {
              name: "patch_files",
              args: JSON.stringify(directLogoEdit.parsed),
              text: "",
              finishReason: "stop",
              usage: null,
              providerError: null,
            }
          : await relayAndCollect(
              import.meta.env.DEV && (body as { testFault?: string }).testFault === "stall"
                ? simulateDeadStream(upstream as Response)
                : (upstream as Response),
              controller,
              encoder,
            );

        // ── The service refused ───────────────────────────────────────────
        // A refusal used to look like an empty reply, so the identical
        // request went out twice more. Now we read the refusal and answer it:
        // too big → send less and go again; busy → switch model and go again.
        if (collected.providerError && !collected.name && !collected.text.trim()) {
          const refusal = collected.providerError;
          console.warn(
            `[provider-refusal] kind=${refusal.kind} code=${refusal.code ?? "-"} msg=${refusal.message}`,
          );
          const reissue = async (
            nextMessages: typeof finalMessages,
            nextModel: string,
            why: string,
          ) => {
            const retryUpstream = await aiChatCompletions({
              feature: "generate",
              budgetAware: true,
              body: {
                model: nextModel,
                messages: nextMessages,
                tools: [tool],
                tool_choice: { type: "function", function: { name: tool.function.name } },
                max_tokens: maxCompletionTokens,
                stream: true,
                ...reasoningField,
              },
              timeoutTier: "stream",
              signal: abortSignal,
              meta: {
                phase: phaseTag.phase,
                promptChars: lastUserContent.length,
                hadAttachments: hasVisionTurn,
                chosenBy: why,
                projectId: body.projectId ?? null,
                userId,
                turnId: logicalTurnId,
              },
            });
            if (!retryUpstream.ok || !retryUpstream.body) return null;
            return relayAndCollect(retryUpstream, controller, encoder);
          };

          if (refusal.kind === "context_overflow") {
            controller.enqueue(
              encoder.encode(sse({ type: "status", message: "Narrowing in on the files that matter…" })),
            );
            const smaller = trimFilesForPrompt(
              editablePromptFiles,
              multiEditPromptContext || lastUserContent,
              pinnedPaths,
              resolvedTargetPaths,
              { tokenCeiling: fileBlockCeiling, anchors: promptAnchors, shrink: 0.45 },
            );
            const smallerContext = renderFilesContext(smaller);
            const nextMessages = finalMessages.map((m) =>
              typeof m.content === "string" && m.content.includes(filesContext) && filesContext
                ? { ...m, content: m.content.replace(filesContext, smallerContext) }
                : m,
            ) as typeof finalMessages;
            console.info(
              `[provider-refusal] re-issuing with ${smaller.files.length} files / ~${smaller.estimatedTokens} tokens (was ${promptBudget.files.length} / ~${promptBudget.estimatedTokens})`,
            );
            const retried = await reissue(nextMessages, model, "refusal_retry:smaller_context");
            if (retried) collected = retried;
          } else if (refusal.kind === "capacity" || refusal.kind === "unknown") {
            controller.enqueue(
              encoder.encode(sse({ type: "status", message: "Picking this back up…" })),
            );
            const backupModel = model === MODEL_BEST ? MODEL_FAST : MODEL_BEST;
            const retried = await reissue(finalMessages, backupModel, "refusal_retry:backup_model");
            if (retried) collected = retried;
          }

          if (!collected.name && !collected.text.trim()) {
            emitConversationalFallback(controller, encoder, {
              files: currentFiles,
              summary: `${userFacingProviderMessage(refusal.kind)} Nothing was changed — send it again and Kimble will pick it straight back up.`,
              outcome: "blocked",
              reason: `provider_refusal:${refusal.kind}`,
            });
            return;
          }
        }
        // Running credit estimate. The main completion's usage is known the
        // moment the model stream ends — long before verify + deploy finish —
        // so the card can show "N credits used" while work is still going
        // instead of only revealing the cost at the very end. Auto-fix turns
        // are on Kimble's tab and never show a number.
        if (!body.isAutoFix) {
          try {
            controller.enqueue(
              encoder.encode(
                sse({
                  type: "credits_estimate",
                  credits: creditsForCost(
                    [collected.usage ? { ...collected.usage, model: (collected.usage as GatewayUsage).model ?? model } : null, ...pageWriteUsages]
                      .filter((u): u is GatewayUsage => !!u)
                      .reduce((a, u) => a + (turnCallCost(u).costUsd ?? 0), 0),
                    DEFAULT_BUILD_ECONOMICS,
                  ),
                }),
              ),
            );
          } catch {
            /* estimate is cosmetic — never break the stream over it */
          }
        }
        controller.enqueue(encoder.encode(sse({ type: "phase", phase: "polishing" })));
        controller.enqueue(encoder.encode(sse({ type: "status", message: "Applying changes…" })));

        let payload: ParsedProjectPayload;
        // A stream that ended with finish_reason "error" is a provider failure
        // exactly like a stall: its partial output is never trusted.
        const firstStall =
          collected.stall ??
          (collected.finishReason === "error" ? { upstream: collected.upstream ?? null, ms: 0 } : null);
        console.log(
          `[collect] first tool=${collected.name} finish=${collected.finishReason ?? "?"} upstream=${collected.upstream ?? "?"} argsChars=${collected.args.length} pages=${(collected.args.match(/"path"\s*:\s*"src\/pages\/[^"]+"/g) ?? []).join(",")}`,
        );
        // THE bounded recovery table for this turn (engine/recovery-policy).
        const recovery = new RecoveryBudget();
        recovery.setTurn({ request: lastUserContent, targets: resolvedTargetPaths });
        // THE agent circuit breaker for this turn (execution/circuit-breaker).
        // RecoveryBudget bounds each recovery mechanism; the breaker decides
        // whether the agent is making useful progress at all. A fresh one per
        // turn — it never survives into an unrelated request.
        const breaker = new AgentCircuitBreaker();
        /** Guidance the breaker wants the next repair attempt to see. */
        let breakerGuidance: string | null = null;
        // Set when an AI-backed recovery step failed because the PROVIDER
        // failed (502/timeout/outage). That is never evidence about the code:
        // no file may be isolated, reverted or deleted on its account.
        let infraFailure: import("@/lib/failure-classification").InfrastructureFailure | null = null;
        const turnContextFor = (path: string | null): string =>
          [recovery.summarize(path), breakerGuidance, appMapRepairBlock].filter(Boolean).join("\n\n");
        try {
          // A stalled provider's partial output is never trusted: resend the
          // original request to a different upstream instead.
          if (firstStall) {
            controller.enqueue(
              encoder.encode((turnEscalations.includes("provider_stall") || turnEscalations.push("provider_stall"), sse({ type: "status", message: "The AI service went quiet — continuing on another connection…" }))),
            );
            throw new Error(`provider stream stalled (${firstStall.upstream ?? "unknown upstream"}, ${firstStall.ms}ms without output)`);
          }
          payload = isInitial
            ? { parsed: { files: firstBuildSeedFiles(collected.args) }, summary: "" }
            : parseCollectedProject(collected);
        } catch (e) {
          controller.enqueue(
            encoder.encode(sse({ type: "status", message: "Retrying the response safely…" })),
          );
          const firstCollected = collected;
          // A payload that ran out of room must never be retried at the same
          // ceiling — that reproduces the exact truncation and the turn dies
          // as "no safe edit". Give the retry materially more headroom.
          const firstWasTruncated =
            isTruncatedFinishReason(collected.finishReason) ||
            (collected.args.trim().length > 0 && !collected.args.trimEnd().endsWith("}"));
          // Bounded recovery table (provider_failure). A resend whose own
          // upstream stalls, errors or drops the stream is a provider failure
          // too — it gets the next allowed provider, never a parse attempt on
          // untrusted partial output. Routing away from failed upstreams is
          // the provider policy's job.
          let providerFailed = Boolean(firstStall);
          let lastFailedUpstream: string | null = firstStall?.upstream ?? null;
          let attempts = 0;
          let retryTrusted = false;
          let lastErr: unknown = e;
          while (recovery.take("provider_failure")) {
            attempts++;
            // Recorded for observability only. Provider trouble is owned by
            // the provider layer (gateway failover + per-turn upstream
            // exclusions) and can NEVER trip the agent breaker: a model that
            // stalled is not an agent that is reasoning badly.
            breaker.recordFailure({
              category: "provider_failure",
              tool: "ai_provider",
              path: null,
              message: lastErr instanceof Error ? lastErr.message : "invalid structured response",
            });
            recovery.record({
              kind: "provider_failure",
              stage: "generation",
              path: null,
              reason: lastErr instanceof Error ? lastErr.message : "invalid structured response",
              action: providerFailed
                ? "resent the original request to another provider (partial output discarded)"
                : "resent the original request with more room",
              upstream: lastFailedUpstream,
            });
            const retry = await structuredRetryCompletion({
              messages: finalMessages,
              problem: lastErr instanceof Error ? lastErr.message : "invalid structured response",
              hasBackend: Boolean(backend),
              tool,
              maxTokens: firstWasTruncated
                  ? Math.min(20_000, Math.max(16_000, Math.round(maxCompletionTokens * 1.6)))
                  : Math.max(maxCompletionTokens, 8_000),
              crossCuttingIntent: isCrossCutting,
              signal: abortSignal,
              providerStalled: providerFailed,
              meta: {
                phase: phaseTag.phase,
                promptChars: lastUserContent.length,
                hadAttachments: hasVisionTurn,
                chosenBy: providerFailed ? "provider_stall_retry" : "structured_retry",
                projectId: body.projectId ?? null,
                userId,
                turnId: logicalTurnId,
                fallbackNumber: attempts,
                fallbackFromUpstream: lastFailedUpstream,
                recoveryReason: providerFailed ? "provider_stall" : "invalid_structured_output",
              },
            });
            if (!retry.ok || !retry.body) break;
            try {
              collected = await relayAndCollect(retry, controller, encoder);
            } catch (streamErr) {
              if (abortSignal.aborted) throw streamErr;
              lastErr = streamErr;
              providerFailed = true;
              lastFailedUpstream = null;
              console.warn("[generate] resend stream failed:", streamErr instanceof Error ? streamErr.message : String(streamErr));
              controller.enqueue(encoder.encode((turnEscalations.includes("provider_stall") || turnEscalations.push("provider_stall"), sse({ type: "status", message: "The AI service went quiet — continuing on another connection…" }))));
              continue;
            }
            const retryStall =
              collected.stall ??
              (collected.finishReason === "error" ? { upstream: collected.upstream ?? null, ms: 0 } : null);
            if (retryStall) {
              lastErr = new Error(`provider stream stalled (${retryStall.upstream ?? "unknown upstream"})`);
              providerFailed = true;
              lastFailedUpstream = retryStall.upstream ?? null;
              controller.enqueue(encoder.encode((turnEscalations.includes("provider_stall") || turnEscalations.push("provider_stall"), sse({ type: "status", message: "The AI service went quiet — continuing on another connection…" }))));
              continue;
            }
            retryTrusted = true;
            break;
          }
          if (attempts === 0) throw e;
          try {
            if (!retryTrusted) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
            payload = parseCollectedProject(collected);
          } catch (retryErr) {
            // Both attempts failed to produce usable tool output. Never turn
            // that parser/model failure into a prerequisite refusal: recover
            // the missing tool call and ship the safe frontend instead.
            // A stalled first attempt's partial text is never trusted as a
            // recovery source.
            const recoverySource = assistantTextFromCollected(collected)
              ? collected
              : firstStall
                ? null
                : firstCollected;
            const recovered = isMissingToolOutputError(retryErr) && recoverySource
              ? await recoverMissingToolOutput({
                  chatMessages: finalMessages,
                  collected: recoverySource,
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

            // The work was too big for one response. Before giving up, ask
            // for a deliberately SMALL first chunk of the model's own plan —
            // small enough that it cannot overflow. The chunk continuation
            // loop below then finishes the rest in the same turn.
            let smallChunk: ParsedProjectPayload | null = null;
            if (firstWasTruncated && recovery.take("truncated_output")) {
              try {
                controller.enqueue(
                  encoder.encode(
                    sse({ type: "status", message: "This one is large — building it in smaller pieces…" }),
                  ),
                );
                const chunkRes = await structuredRetryCompletion({
                  messages: [
                    ...finalMessages,
                    {
                      role: "assistant",
                      content: assistantTextFromCollected(firstCollected).slice(0, 4_000),
                    },
                    {
                      role: "user",
                      content: buildChunkInstruction({
                        round: 1,
                        isInitial: false,
                        deliveredPaths: [],
                        remainingSteps: parseStepsFromArgs(firstCollected.args),
                        reason: "truncated_output",
                      }),
                    },
                  ],
                  problem: "output_truncated_first_chunk",
                  hasBackend: Boolean(backend),
                  tool,
                  maxTokens: 6_000,
                  crossCuttingIntent: isCrossCutting,
                  signal: abortSignal,
                  meta: {
                    phase: phaseTag.phase,
                    promptChars: lastUserContent.length,
                    hadAttachments: hasVisionTurn,
                    chosenBy: "truncation_small_chunk",
                    projectId: body.projectId ?? null,
                    userId,
                    turnId: logicalTurnId,
                  },
                });
                if (chunkRes.ok && chunkRes.body) {
                  const chunkCollected = await relayAndCollect(chunkRes, controller, encoder);
                  smallChunk = parseCollectedProject(chunkCollected);
                  collected = chunkCollected;
                }
              } catch (chunkErr) {
                console.warn(
                  "[generate] small-chunk recovery failed:",
                  chunkErr instanceof Error ? chunkErr.message : String(chunkErr),
                );
                smallChunk = null;
              }
            }
            if (smallChunk) {
              payload = smallChunk;
            } else {

            const deterministic = deterministicPatchFallback({ currentFiles, latestUserContent: lastUserContent });
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
            // recovery passes (edit turns only — first builds never get here).
            console.warn(
              "[generate] both attempts produced no usable output, falling back conversationally:",
              retryErr instanceof Error ? retryErr.message : String(retryErr),
            );
            emitConversationalFallback(controller, encoder, {
              files: currentFiles,
              summary: "That one didn't land, and nothing in your app was changed. Send it again and Kimble will pick it straight back up.",
              outcome: "answered",
              reason: "no_safe_edit",
            });
            return;
            }
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
          // Edits only continue into missing pages when the user actually asked
          // for new pages — existing nav links are not a request to build them.
          const editAskedForPages =
            /\b(add|create|build|make|new)\b[^.!?]{0,40}\b(pages?|routes?|screens?)\b/i.test(lastUserContent) &&
            !/\b(on|in) the [a-z -]{0,30}(page|screen)\b/i.test(lastUserContent);
          // Edits: only pages the user named. First builds use the
          // deterministic completeness stage below instead.
          if (!chunkAssessment.needed && !isInitial && editAskedForPages) {
            const { extractRequestedPages, pageNameToRoute } = await import("@/server/requested-scope");
            const expectedRoutes = Array.from(
              new Set(extractRequestedPages(lastUserContent).map(pageNameToRoute).map((r) => r.toLowerCase())),
            ).filter((r) => r !== "/");
            if (expectedRoutes.length) {
              const emittedSource = [
                ...(parsed.files ?? []).map((f) => f.content ?? ""),
                ...(parsed.ops ?? []).map((o) => ("content" in o ? String(o.content ?? "") : "")),
              ].join("\n");
              const coverage = assessRouteCoverage({
                expectedRoutes,
                requireAppShell: false,
                ops: parsed.ops,
                files: parsed.files,
                existingPaths: currentFiles.map((f) => f.path),
                routerSource: [
                  emittedSource,
                  ...currentFiles
                    .filter((f) => /src\/(App|main|router)\.(t|j)sx?$/i.test(f.path))
                    .map((f) => f.content ?? ""),
                ].join("\n"),
              });
              if (coverage.needed) chunkAssessment = coverage;
            }
          }

          // WRITE stage (first builds): the tool loop is the ONLY executor.
          // It starts from the empty (or resumed) workspace; there is no
          // earlier generation call.
          if (isInitial) {
            const { targetOf: wantOf, DECOMPOSED_MARKER } = await import("@/server/engine/write");
            const { pageFileFor } = await import("@/server/engine/plan");
            const checkpointApi = await import("@/server/build-checkpoint.server");
            // Snapshot of the shell answer exactly as parsed, taken before any
            // deterministic cleanup (which re-runs identically on resume).
            const shellSnapshot = { name: "write_project", args: JSON.stringify(parsed), text: "", finishReason: "stop" };
            const requested = requestedRoutesFor(lastUserText, plannedRoutes);
            // The plan is authoritative; requested routes only fill in if
            // planning failed.
            const planned = resumed?.checkpoint.planned?.length
              ? resumed.checkpoint.planned
              : firstBuildPlan?.pages ?? requested.map((route) => ({ route, file: pageFileFor(route) }));
            if (!resumed && checkpointTurnId && body.projectId) {
              const shellSaved = await checkpointApi.saveShellCheckpoint({
                projectId: body.projectId,
                userId,
                turnId: checkpointTurnId,
                request: lastUserText,
                shell: shellSnapshot,
                planned,
              });
              turnStrategy.checkpoint = { saved: shellSaved.ok ? 1 : 0, failed: shellSaved.ok ? 0 : 1, shellError: shellSaved.ok ? null : shellSaved.error };
              controller.enqueue(encoder.encode(sse({ type: "timeline", step: "checkpoint", outcome: shellSaved.ok ? "ok" : "failed", message: shellSaved.ok ? "Saved the shared layout" : "Could not save progress (the build continues, but can't resume if interrupted)", ts: Date.now() })));
            }
            // Output-limit continuation: pages the shell's own router already
            // imports but that were never written (the shell call ran out of
            // room, or planning under-counted) are the remaining work — write
            // them here, under the same bounded WRITE-stage budget.
            // The agent loop reconciles planned goals with the router's actual
            // pages under canonical identity (no second scheduler). Router pages
            // that diverge from the intent contract are removed first.
            if (intentContract) {
              const { routerPages } = await import("@/server/engine/router-facts");
              const { pageKey } = await import("@/server/engine/router-facts");
              const plannedKeys = new Set(planned.map((p: { route: string }) => pageKey(p.route)));
              const extra = routerPages(parsed.files ?? []).filter((p) => !plannedKeys.has(pageKey(p.route)));
              if (extra.length) {
                const { divergentPages, stripRoutesFromRouter } = await import("@/server/prd/intent-contract");
                const bad = new Set(divergentPages(intentContract, extra.map((p) => p.route), lastUserText));
                if (bad.size) {
                  const badFiles = extra.filter((p) => bad.has(p.route)).map((p) => p.file);
                  const app = parsed.files?.find((f) => f.path === "src/App.tsx");
                  const cleaned = app ? stripRoutesFromRouter(app.content, badFiles) : null;
                  if (app && cleaned !== null) {
                    app.content = cleaned;
                    console.warn(`[intent] dropped divergent router pages ${JSON.stringify([...bad])}`);
                    controller.enqueue(encoder.encode(sse({ type: "timeline", step: "intent_check", outcome: "ok", message: `Removed pages that don't belong in this product: ${[...bad].join(", ")}`, ts: Date.now() })));
                  }
                }
              }
            }
            const pages = planned;
            // Stop boundary: no page writer starts after the user pressed Stop.
            await agentIO().assertActive(turnId, abortSignal, "page writing");
            // ONE persistent tool-calling conversation finishes the build. The
            // first response's files are validated at the same boundary as
            // every later write; finish is refused while the workspace is
            // incomplete. No per-page calls, no second scheduler.
            const { runToolLoop } = await import("@/server/engine/tool-loop");
            const { buildEconomics: loopEconomics, economicsValues: loopEconomicsValues } = await import("@/server/economics-config.server");
            // Runaway ceiling = size estimate × headroom. The size estimate is
            // the p90 of MEASURED first-build tokens priced at the model this
            // loop runs (never the flat DeepSeek-era class dollars alone), so
            // a normal build finishes and only a runaway is stopped.
            const { estimateFirstBuildCost, predictCallCostUsd } = await import("@/server/engine/loop-cost-estimate");
            const { firstBuildTokenSamples } = await import("@/server/build-reservation.server");
            const { modelPricePerM } = await import("@/server/ai-provider.server");
            const loopModelPrice = modelPricePerM(defaultFirstBuildModel());
            const loopEcon = await loopEconomics();
            const loopSizeEstimate = estimateFirstBuildCost(await firstBuildTokenSamples(), loopModelPrice, Math.max(1, Math.round((await loopEconomicsValues()).estimate_min_samples ?? 20)));
            const loopCeilingUsd = economicCeilingUsd(null, Math.max(buildReservation?.classCostUsd ?? 0, loopSizeEstimate.usd), loopEcon) /* internal cost limit, decoupled from the effort-priced hold */;
            turnStrategy.loopSizeEstimate = { usd: loopSizeEstimate.usd, basis: loopSizeEstimate.basis, samples: loopSizeEstimate.samples, model: defaultFirstBuildModel() };
            const loopSpentBeforeUsd = collected.usage ? (turnCallCost(collected.usage, model).costUsd ?? buildReservation?.classCostUsd ?? 0) : 0;
            const { makeCallModel } = await import("@/server/engine/tool-loop-model");
            const { validateUnitImports, undefinedNames } = await import("@/server/engine/work-unit");
            const { verifyFilesEsbuild } = await import("@/server/esbuild-verifier.server");
            const { checkUndefinedIdentifiers: checkIdsForUnits } = await import("@/server/verification/identifiers.server");
            const { withProviderRetry } = await import("@/server/engine/provider-retry");
            const seedFiles = resumed ? checkpointApi.checkpointSeedFiles(resumed.checkpoint, parsed.files ?? []) : (parsed.files ?? []);
            const pendingWrites: Array<{ path: string; content: string }> = [];
            const loopTraces: CallTrace[] = [];
            const telemetry = createTelemetrySink(
              { turnId: logicalTurnId ?? null, projectId: body.projectId ?? null },
              async () => {
                const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
                return (row) => supabaseAdmin.from("tool_loop_calls" as never).insert(row as never);
              },
            );
            // Cognitive tiering: the first build runs on the frontier model;
            // edits keep the fast model (MODEL_BEST / MODEL_STRUCTURED_RETRY).
            const firstBuildModel = defaultFirstBuildModel();
            const callModel = makeCallModel(
              (reqBody, signal) =>
                withProviderRetry(
                  () =>
                    aiChatCompletions({
                      feature: "generate",
                      body: { ...reqBody, reasoning: { enabled: false }, model: firstBuildModel },
                      timeoutTier: "stream_first_build",
                      lockCallerModel: true,
                      codeOutput: true,
                      signal: signal ?? abortSignal,
                      meta: {
                        phase: phaseTag.phase,
                        promptChars: lastUserContent.length,
                        hadAttachments: hasVisionTurn,
                        chosenBy: "tool_loop",
                        projectId: body.projectId ?? null,
                        userId,
                        turnId: logicalTurnId,
                      },
                    }),
                  { signal: signal ?? abortSignal },
                ),
              (u) => {
                if (!u) return;
                pageWriteUsages.push({ ...u, model: firstBuildModel });
                // Cost capture: every loop call's ai_call_log row gets its
                // tokens and cost (ACTUAL from the provider, else ESTIMATED).
                void updateLastCallUsage({
                  feature: "generate",
                  model: firstBuildModel,
                  promptTokens: u.prompt_tokens ?? null,
                  completionTokens: u.completion_tokens ?? null,
                  totalTokens: u.total_tokens ?? null,
                  cachedPromptTokens: u.prompt_tokens_details?.cached_tokens ?? null,
                  actualCostUsd: typeof u.cost === "number" ? u.cost : null,
                  turnId: logicalTurnId,
                });
              },
            );
            // Minimum sufficient context: tiered knowledge (always-on /
            // task-conditional in the stable prefix, the rest retrievable
            // as read-only knowledge/*.md). One source per rule; the design
            // playbook rides in the brief only.
            const fbContext = assembleFirstBuildContext({
              knowledge: {
                basePrompt: baseSystem,
                manual: coreKnowledge.text,
                skills: Object.fromEntries(
                  (["copy-and-verify", "motion", "page-composition", "redesign-safety", "section-architectures"] as const).map((id) => [id, loadSkillKnowledge(id)]),
                ),
                extras: {
                  "Design taste manual": designTasteBlock,
                  "Kimble craft skills for this request": skillsBlock,
                  "Colour guide": loadColorGuide(),
                  "Request-specific reference snippets": dynamic.text,
                  "Past learning": learningBlock,
                },
              },
              subtype: detectedWebSubtype ?? "",
              productSurface: intentContract?.surface ?? null,
              hasBackend: !!(backend || sharedBackend),
              productContract: {
                intent: intentBrief ? `### Canonical turn intent (HARD CONTRACT)\n${intentBrief}\nSatisfy this exact outcome; do not substitute a different feature, page, or product.` : "",
                resolved: resolvedBlock,
                grounding: groundingBlock,
                pic: picBlock,
                prd: prdBlock + prdScenarioBlock,
                orchestration: orchestrationBlock,
                architecture: renderArchitectureBlock(persistedArchitecture),
                memory: memoryBlock,
                knowledge: knowledgeBlock,
                design: designBlock,
                appShape: appShapeBlock,
                mobile: mobileBlock,
                game: gameBlock,
                archetype: archetypeBlock,
                heroContract: heroContractBlock,
                highStakes: highStakesBlock,
                backendGate: backendGateBlock,
                intentActions: intentActions.promptBlock,
              },
              projectReference: {
                buildTarget: buildTargetBlock,
                capabilities: capabilitiesBlock,
                backend: backendBlock,
                sharedBackend: sharedBackendBlock,
                schema: schemaBlock,
                integrations: integrationsBlock,
                blueprint: renderBuildBlueprintBlock(persistedBlueprint),
              },
              toolNote: FIRST_BUILD_TOOL_NOTE,
            });
            console.log(`[first-build-context] ${Object.entries(fbContext.parts).map(([k, v]) => `${k}=${v}`).join(" ")} onDemand=${fbContext.reference.length}`);
            turnStrategy.firstBuildContext = { parts: fbContext.parts, tiers: fbContext.tiers };
            // One finalization path: the summary is built on every terminal state.
            const done = await runWithExecutionSummary({
              turnId: logicalTurnId ?? null,
              traces: loopTraces,
              turnStartedAt: setupStartedAt,
              stages: stageMarks,
              telemetry,
              onSummary: (s) => {
                turnStrategy.executionSummary = s;
                if (telemetry.failures.length) turnStrategy.telemetryFailures = telemetry.failures.slice(0, 20);
              },
            }, async () => runToolLoop({
              // Economic ceiling: the hold as variable cost. Unmeasured calls
              // count at the class estimate so they can never run for free.
              costCeilingUsd: loopCeilingUsd,
              spentBeforeUsd: loopSpentBeforeUsd,
              costOf: (r) => {
                if (typeof r.usage?.costUsd === "number" && Number.isFinite(r.usage.costUsd)) return r.usage.costUsd;
                if (r.usage) {
                  const c = turnCallCost({ prompt_tokens: r.usage.promptTokens, completion_tokens: r.usage.completionTokens, prompt_tokens_details: { cached_tokens: r.usage.cachedTokens } } as GatewayUsage, firstBuildModel).costUsd;
                  if (c != null) return c;
                }
                // Unmeasured call: never free — the per-build size estimate stands in.
                return Math.max(buildReservation?.classCostUsd ?? 0.03, loopSizeEstimate.usd);
              },
              // Checked before EVERY call, including the first: all prompt
              // tokens at the uncached rate plus a typical write's output.
              predictCallUsd: (promptTokens) => predictCallCostUsd(promptTokens, loopModelPrice),
              goal: lastUserText,
              system: fbContext.system,
              brief: firstBuildBrief(
                lastUserText,
                planned as Array<{ route: string; file: string }>,
                seedFiles.map((f) => f.path),
                await (async () => {
                  const sel = picContext?.design?.package;
                  if (!sel) return null;
                  const { getDesignSystem } = await import("@/server/design-systems/registry");
                  const pkg = getDesignSystem(sel.systemId);
                  if (!pkg) return null;
                  return {
                    name: pkg.meta.name,
                    accent: sel.accent,
                    displayFont: picContext?.design?.typography?.displayFont ?? pkg.meta.fonts[0] ?? "serif",
                    bodyFont: picContext?.design?.typography?.bodyFont ?? pkg.meta.fonts[1] ?? "sans-serif",
                    playbook: pkg.designMd,
                  };
                })(),
                sharedBackend ? { shared: true } : null,
              ),

              files: seedFiles,
              // The kit the commit applies, visible (read-only) to reads and
              // import validation so advertised modules actually resolve.
              reference: applyScaffoldKit([], { backend: backend ?? undefined, sharedBackend: sharedBackend ?? undefined, target: buildTarget.id })
                .filter((f) => f.path !== "src/App.tsx" && !f.path.startsWith("src/pages/") && !seedFiles.some((s) => s.path === f.path))
                .filter((f) => !isPausedKitPath(f.path))
                .concat(fbContext.reference),
              seedPaths: seedFiles.map((f) => f.path),
              callModel,
              // THE readiness authority: the exact proposed-tree transform and
              // source verification commitTurn runs (scaffold + shell, then
              // verifyProposedSource with the same requested routes).
              readiness: async (tree, changed) => {
                const { verifyProposedSource } = await import("@/server/verification/source.server");
                const { readinessOf } = await import("@/server/verification/readiness");
                const authored = projectAuthoredFiles(tree);
                const proposed = ensureRenderableShell(
                  applyScaffoldKit(authored, { backend: backend ?? undefined, sharedBackend: sharedBackend ?? undefined, target: buildTarget.id }),
                  detectedWebSubtype,
                ).files;
                const v = await verifyProposedSource({
                  tree: proposed,
                  changedPaths: changed.filter((p) => proposed.some((f) => f.path === p)),
                  requestedRoutes: requestedRoutesFor(lastUserText, plannedRoutes),
                  requireShell: true,
                  requireLiveData: Boolean(sharedBackend),
                });
                return readinessOf(v);
              },
              validate: async (file, tree) => {
                // Stylesheets are validated too: a v3-style @tailwind
                // directive next to the v4 @theme tokens breaks the CSS
                // build, which source verification alone cannot see.
                if (/\.css$/.test(file.path)) {
                  const css: string[] = [];
                  if (/^\s*@tailwind\s+(base|components|utilities)\b/m.test(file.content)) {
                    css.push(`${file.path}: @tailwind directives are Tailwind v3. This project is Tailwind v4 — the stylesheet already imports Tailwind and defines its tokens in @theme.`);
                  }
                  const open = (file.content.match(/\{/g) ?? []).length;
                  const close = (file.content.match(/\}/g) ?? []).length;
                  if (open !== close) css.push(`${file.path}: unbalanced braces (${open} '{' vs ${close} '}').`);
                  return css;
                }
                if (!/\.(tsx?|jsx?)$/.test(file.path)) return [];
                const v = await verifyFilesEsbuild([file], [file.path]);
                if (v.status === "unavailable") throw new Error(v.unavailableDetail ?? v.unavailableReason ?? "esbuild unavailable");
                const out = v.issues.map((i) => i.message);
                if (out.length) return out;
                return [
                  ...validateUnitImports(file, tree).map((d) => d.message),
                  ...undefinedNames(file, tree, (t, c) => checkIdsForUnits(t, c)).map((d) => d.message),
                ];
              },
              typecheck: (tree, paths) => {
                const r = checkIdsForUnits(tree, paths);
                return r.status === "failed" ? r.issues.map((i) => `${i.path}:${i.line} ${i.message}`) : [];
              },
              onWrite: async (f) => {
                pendingWrites.push(f);
                controller.enqueue(encoder.encode(sse({ type: "file_complete", path: f.path, bytes: f.content.length, index: 1, content: f.content })));
                if (checkpointTurnId) {
                  const ok = await checkpointApi.checkpointFiles(checkpointTurnId, [f]);
                  const cs = (turnStrategy.checkpoint ??= { saved: 0, failed: 0 }) as { saved: number; failed: number };
                  if (ok) cs.saved += 1; else cs.failed += 1;
                }
                return true;
              },
              isProtected: (p) => executionScope.isProtected(p),
              signal: abortSignal,
              onTrace: (t) => {
                loopTraces.push(t);
                // Per-step execution telemetry: non-blocking; failures are logged + counted, never silent.
                telemetry.record(t);
                console.log(`[tool-loop] call=${t.call} ms=${t.durationMs} ttft=${t.ttftMs} in=${t.usage?.promptTokens ?? "?"} cached=${t.usage?.cachedTokens ?? "?"} out=${t.usage?.completionTokens ?? "?"} upstream=${t.upstream ?? "?"} tools=${t.toolCalls.join(",")} read=${t.filesRead.join(",")} writes=${t.writes} toolMs=${t.toolMs} validMs=${t.validationMs}`);
                controller.enqueue(encoder.encode(sse({ type: "timeline", step: "agent_tool", outcome: "ok", message: `AI step ${t.call}: ${t.toolCalls.length} actions, ${t.writes} files`, ts: Date.now() })));
              },
              onEvent: (e) => {
                if (e.kind === "status") controller.enqueue(encoder.encode(sse({ type: "status", message: e.detail ?? "" })));
              },
            }));
            // Whatever the loop spent comes off the repair budget: the whole
            // turn stays inside the one economic ceiling.
            repairMeter.capAt(Math.max(0, loopCeilingUsd - done.state.spentUsd));
            turnStrategy.economicCeiling = { ceilingUsd: loopCeilingUsd, loopSpentUsd: done.state.spentUsd, repairCeilingUsd: repairMeter.ceilingUsd, stopReason: done.state.stopReason };
            turnStrategy.toolLoop = { outcome: done.outcome, calls: done.traces.length, incomplete: done.incomplete, traces: loopTraces };
            console.log(`[tool-loop] outcome=${done.outcome} calls=${done.traces.length} written=${done.state.written.length} incomplete=${JSON.stringify(done.incomplete)}`);
            parsed.files = done.files;
            if (done.outcome !== "finished") {
              const { validatedWrites } = await import("@/lib/partial-build");
              for (const f of validatedWrites(done.state.written, done.state.validation, done.files)) partialWork.set(f.path, f.content);
            }
            if (done.outcome === "cancelled") await agentIO().assertActive(turnId, abortSignal, "tool loop");
            if (done.incomplete.length) {
              controller.enqueue(encoder.encode(sse({ type: "timeline", step: "page_write", outcome: "failed", message: `Still incomplete: ${done.incomplete.slice(0, 5).join("; ")}`, ts: Date.now() })));
            }
          }

          if (chunkAssessment.needed && !isInitial) {
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
              isInitial: false,
              assessment: chunkAssessment,
              ops: parsed.ops ?? [],
              files: parsed.files ?? [],
              maxRounds: RECOVERY_LIMITS.truncated_output,
              chunkMaxTokens: 8_000,
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
                    turnId: logicalTurnId,
                  },
                });
                if (!res.ok || !res.body) return null;
                let chunkCollected = await relayAndCollect(res, controller, encoder);
                // One bounded resend of THIS chunk when its provider failed.
                // The failed upstream is already in the turn exclusion set, so
                // the resend lands elsewhere. Completed pages stay protected
                // by mergeChunk; no loop beyond this single retry.
                const chunkFailed =
                  Boolean(chunkCollected.stall) ||
                  (!chunkCollected.name && !chunkCollected.args.trim() && !chunkCollected.text.trim());
                if (chunkFailed && recovery.take("provider_failure", `chunk_${req.round}`)) {
                  console.warn(
                    `[chunked-generation] round=${req.round} provider_failed upstream=${chunkCollected.upstream ?? "?"} excluded=${JSON.stringify(Array.from(currentTurnContext().failedUpstreams ?? []))} — one resend`,
                  );
                  const again = await structuredRetryCompletion({
                    messages: [
                      ...finalMessages,
                      { role: "assistant", content: assistantTextFromCollected(collected).slice(0, 4_000) },
                      { role: "user", content: req.instruction },
                    ],
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
                      chosenBy: `chunk_round_${req.round}_provider_retry`,
                      projectId: body.projectId ?? null,
                      userId,
                      turnId: logicalTurnId,
                      fallbackNumber: 1,
                      fallbackFromUpstream: chunkCollected.upstream ?? null,
                      recoveryReason: chunkCollected.stall ? "provider_stall" : "provider_empty_stream",
                    },
                  });
                  if (!again.ok || !again.body) return null;
                  chunkCollected = await relayAndCollect(again, controller, encoder);
                }
                try {
                  const chunkPayload = parseCollectedProject(chunkCollected);
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
              parsed.ops = chunked.ops;
              console.log(
                `[chunked-generation] rounds=${chunked.rounds} added=${chunked.added} — ${chunked.notes.join("; ")}`,
              );
            }
          }
        } catch (chunkErr) {
          // First builds: the tool loop IS the build — never swallow its failure.
          if (isInitial || abortSignal.aborted) throw chunkErr;
          console.warn(
            "[chunked-generation] skipped:",
            chunkErr instanceof Error ? chunkErr.message : String(chunkErr),
          );
        }

        // Honesty ledger — paths the model asked to change that end up
        // byte-identical after apply + recovery.
        const unappliedPaths: string[] = [];
        let unlandedOps = 0;
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
          // package.json is accepted only as dependency intent; the
          // scaffold merger rewrites it into Kimble's canonical manifest.
          const appFiles = projectAuthoredFiles(parsed.files);
          nextFiles = applyScaffoldKit(appFiles, {
            backend: backend ?? undefined,
            sharedBackend: sharedBackend ?? undefined,
            target: buildTarget.id,
          });
          // index.html and src/main.tsx are deterministic Kimble shell files.
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
          // Edit boundary — a small ask may not rewrite a page it never named.
          // Built once per turn; stands down for initial builds, cross-cutting
          // work and anything we could not confidently resolve to target files.
          const editBoundary = buildEditBoundary({
            scope: editClassification?.scope ?? null,
            targetPaths: resolvedTargetPaths,
            neighbourPaths: impactNeighbourPaths,
            existingPaths: currentFiles.map((f) => f.path),
            disabled: isInitial || isCrossCutting,
            allowNewPages: /\b(add|create|build|new)\b[^.!?]{0,40}\b(pages?|routes?|screens?)\b/i.test(lastUserContent),
          });
          if (editBoundary.enforced) {
            console.info(`[edit-boundary] ${editBoundary.describe()}`);
          }

          const isProtectedPath = (p: string) =>
            isScaffoldOwnedPath(p) ||
            matchesUserProtectedGlob(p) ||
            // Plan Mode v1 — when a plan was approved, ANY file outside its
            // allow-list is treated as protected and dropped.
            (allowedPathSet !== null && !allowedPathSet.has(p)) ||
            // A file the request never pointed at, on a small edit.
            !editBoundary.allows(p) ||
            // Shared chrome / unrelated page outside the execution scope.
            (!isInitial && !isCrossCutting && executionScope.isProtected(p));

          // Honesty ledger — every path the model asked to change that did
          // NOT end up byte-different after apply + recovery. Surfaced to the
          // user at the end of the turn so Kimble can never claim "done" for a
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
                  turnId: logicalTurnId,
                },
              });
              if (!res.ok || !res.body) return [];
              const repairedCollected = await relayAndCollect(res, controller, encoder);
              const payload = parseCollectedProject(repairedCollected);
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
            // refusing the turn, run Kimble's trusted deterministic repair
            // layer. This closes the old contradiction where Kimble said it
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
                  : "I fixed the build configuration safely and re-ran Kimble's project repairs.";
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
              // A no-op (already-true) change needs no rework: nothing the
              // user asked for was lost, so no second model call.
              // Exception: if EVERY op was a no-op, the model did nothing the
              // user asked for — give it one chance to do the rest.
              const allNoOp = verdict.ops.length === 0 && verdict.rejections.every((r) => r.silent);
              const needsRework = allNoOp || verdict.rejections.some((r) => !r.silent);
              const reworked = !needsRework ? [] : await requestOpRepair({
                problem: "critic_rejection",
                refused: verdict.rejections.map((r) => ({
                  op: r.op,
                  path: r.path,
                  reason: r.reason,
                })),
                constraint:
                  (allNoOp
                    ? "Every change you emitted was already true in the file. Skip parts that are already done and emit only the parts of the request that are NOT yet true. "
                    : "") +
                  "Never elide code with comments like `// ... rest unchanged`, never blank a file, and never emit a no-op. Use `replace` ops whose search text is copied verbatim from the current file (large files only accept `replace`); emit a full-file `update` only for a small file.",
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
            let partial = applyOpsPartial(currentFiles, safeOps);
            // A replace whose snippet was written against the wrong file:
            // if the search text matches exactly one OTHER write-allowed
            // target, move the op there (deterministic, no AI call).
            if (!isInitial && partial.failed.length > 0 && resolvedTargetPaths.length > 1) {
              let moved = 0;
              const fixedOps = safeOps.map((op) => {
                if (op.op !== "replace") return op;
                const failed = partial.failed.find((f) => f.op === op);
                const search = (op as { search?: string }).search;
                if (!failed || !search) return op;
                const hits = resolvedTargetPaths.filter((p) => {
                  if (p === op.path) return false;
                  const c = currentFiles.find((f) => f.path === p)?.content ?? "";
                  const i = c.indexOf(search);
                  return i >= 0 && c.indexOf(search, i + 1) < 0;
                });
                if (hits.length !== 1) return op;
                moved++;
                console.info(`[generate] retargeted replace ${op.path} → ${hits[0]} (snippet matched there)`);
                return { ...op, path: hits[0] };
              });
              if (moved > 0) {
                safeOps = fixedOps;
                partial = applyOpsPartial(currentFiles, safeOps);
              }
            }
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
                const rewriteAttempt = recovery.record({
                  kind: "apply_failure",
                  stage: "apply",
                  path,
                  reason: failure.error,
                  action: "one-file rewrite against the current bytes",
                });
                const rewriteMessages = [
                  ...finalMessages,
                  {
                    role: "user" as const,
                    content:
                      `${turnContextFor(path)}\n\n` +
                      `Your previous edit to ${path} could not be applied: ${failure.error}\n\n` +
                      `Current contents of ${path} (authoritative — your replace snippet did not match these bytes):\n` +
                      `--- ${path} ---\n${currentContent.slice(0, 24_000)}${currentContent.length > 24_000 ? "\n/* ...trimmed... */" : ""}\n--- end ---\n\n` +
                      // Large files only accept `replace` (the applier rejects
                      // a whole-file resend that keeps most of the file), so
                      // asking for a full update there guaranteed a second
                      // failure. The current bytes are shown above, so replace
                      // snippets copied from them match.
                      (currentContent.split("\n").length > 150
                        ? `Re-emit the change as a SINGLE patch_files tool call with one or more \`replace\` ops on ${path} only. ` +
                          `Copy each \`search\` snippet VERBATIM from the current contents above (a few whole lines, unique in the file) and always include \`replace\`. `
                        : `Re-emit the change as a SINGLE patch_files tool call containing EXACTLY ONE op: ` +
                          `{ "op": "update", "path": "${path}", "content": "<the COMPLETE new file contents>" }. `) +
                      `Do not touch any other file. Do not use keep-existing markers. ` +
                      `If the current contents already satisfy the user's request, return an empty ops array — do not invent edits.`,
                  },
                ];
                const rewrite = await structuredRetryCompletion({
                  messages: rewriteMessages,
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
                    turnId: logicalTurnId,
                  },
                });
                if (!rewrite.ok || !rewrite.body) {
                  console.warn(`[generate] per-file rewrite request failed for ${path}`);
                  continue;
                }
                const rewriteCollected = await relayAndCollect(rewrite, controller, encoder);
                try {
                  const rewritePayload = parseCollectedProject(rewriteCollected);
                  const ops = (rewritePayload.parsed.ops ?? []).filter(
                    (op) => op.path === path && !isProtectedPath(op.path),
                  );
                  if (ops.length === 0) {
                    recovery.resolve(rewriteAttempt, "kept_previous");
                    console.info(`[generate] per-file rewrite for ${path} returned no ops — accepting`);
                    continue;
                  }
                  // Apply each op against the in-progress `patched` map.
                  const stepResult = applyOpsPartial(patched, ops);
                  patched = stepResult.files;
                  recovery.resolve(
                    rewriteAttempt,
                    stepResult.applied.length > 0 ? "fixed" : "failed",
                    stepResult.applied.length > 0 ? patched.find((f) => f.path === path)?.content : null,
                  );
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

              unlandedOps = partial.failed.filter((f) => !rewrittenPaths.includes(f.op.path)).length;
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
            if (changedPaths.length === 0) {
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
            // "Kimble said it did it but it didn't" failure mode.
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
          // Files the kit sync refreshed are Kimble housekeeping, not this
          // edit: keep them out of the tidy/repair scope below.
          const patchedByPath = new Map(patched.map((f) => [f.path, f.content]));
          for (const f of nextFiles) {
            if (patchedByPath.get(f.path) !== f.content) kitSyncedPaths.add(f.path);
          }

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
              // A broken generated page is repaired (that file only, once,
              // re-verified) instead of silently dropped.
              repair: async (file, detail) => {
                // Circuit breaker first: a tripped turn makes no further AI
                // calls, so a repeated failure stops here instead of paying
                // for another attempt that already failed twice.
                const verdict = breaker.recordFailure({
                  category: classifyFailure(detail),
                  tool: "write_gate",
                  path: file.path,
                  message: detail,
                });
                breakerGuidance = verdict.guidance;
                if (verdict.tripped) {
                  console.warn(`[circuit-breaker] ${JSON.stringify(breaker.snapshot())}`);
                  return null;
                }
                controller.enqueue(
                  encoder.encode(sse({ type: "status", message: `Fixing a code error in ${file.path}…` })),
                );
                // One shared per-file budget for every repair in this turn.
                if (!recovery.take("broken_file", file.path)) return null;
                if (!turnLedger.use("repair", "write-gate compile repair", file.path).ok) return null;
                const turnContext = turnContextFor(file.path);
                const n = recovery.record({
                  kind: "broken_file",
                  stage: "validation",
                  path: file.path,
                  reason: detail,
                  action: "compile repair of this file only (write gate)",
                });
                const { repairBrokenFile } = await import("@/server/engine/repair");
                let out: string | null;
                try {
                  out = await repairBrokenFile(file, detail, {
                    turnId: logicalTurnId,
                    projectId: body.projectId ?? null,
                    userId,
                    turnContext,
                  });
                } catch (e) {
                  const { isInfrastructureFailure } = await import("@/lib/failure-classification");
                  if (!isInfrastructureFailure(e)) throw e;
                  infraFailure = e;
                  recovery.resolve(n, "kept_previous");
                  return null;
                }
                if (!out) recovery.resolve(n, "kept_previous");
                else {
                  recovery.resolve(n, "pending", out);
                  // A repaired file is real progress: clear this file's
                  // failure count and the consecutive-failure run.
                  breaker.recordProgress("file_repaired", file.path);
                  breakerGuidance = null;
                }
                return out;
              },
            });
            if (gate.validationFailure) {
              throw new Error(`Authoritative code validation unavailable: ${gate.validationFailure}`);
            }
            // Provider outage during a repair: stop before the write gate's
            // rejections change anything. Nothing is committed; the last
            // valid project state stands.
            if (infraFailure) throw infraFailure;
            nextFiles = gate.files;
            // Rejected writes were reverted inside the proposed tree (existing
            // policy): the rest of the turn may land, so this is a WARNING.
            turnChecks.push({
              check: "write_gate",
              verdict: gate.rejected.length ? "WARNING" : "PASS",
              detail: gate.rejected.map((r) => r.path).join(", ") || undefined,
            });
            for (const p of gate.repairedPaths ?? []) recovery.resolvePath(p, "fixed");
            for (const p of gate.repairFailedPaths ?? []) recovery.resolvePath(p, "kept_previous");
            if (gate.repairedPaths?.length || gate.repairFailedPaths?.length) {
              console.info(
                `[write-gate] ai-repair repaired=${JSON.stringify(gate.repairedPaths ?? [])} failed=${JSON.stringify(gate.repairFailedPaths ?? [])}`,
              );
            }
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
                  turnId: logicalTurnId,
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

        // CIRCUIT BREAKER STOP BOUNDARY. Tripped means the agent kept hitting
        // the same failure without getting closer. Stop here: no further AI
        // calls, no commit, no charge — the transaction never opens, so the
        // project keeps its previous state by construction.
        if (breaker.tripped) {
          console.warn(`[circuit-breaker] tripped ${JSON.stringify(breaker.snapshot())}`);
          emitConversationalFallback(controller, encoder, {
            files: currentFiles,
            summary: breaker.userMessage(),
            outcome: "failed",
            reason: `circuit_breaker:${breaker.reason()?.rule ?? "unknown"}`,
          });
          return;
        }


        // Single composition point for all deterministic file-graph
        // repairs (extension normalizer → shadcn imports → array safety →
        // local import resolver → bare import resolver). Runs BEFORE the
        // shell guard / build trigger so Rollup never sees an unresolved
        // import. See src/server/repair-all.server.ts.
        {
          // The model-authored/diff boundary is authoritative on every turn.
          // A fresh scaffold contains hundreds of pre-verified files; their
          // presence is never permission to inspect or rewrite them.
          const cleanupPaths = turnBaselineFiles.length > 0
            ? diffChangedPaths(turnBaselineFiles, nextFiles).filter((p) => !kitSyncedPaths.has(p))
            : (authoredPaths ?? []).filter((p) => !isVerifierExempt(p));
          const scopeLock = { touchedPaths: cleanupPaths };
          const cleanupT0 = Date.now();
          const repaired = runAllRepairs(nextFiles, {
            scopeLock,
            // First builds and edits both use a local view. Cross-cutting intent
            // widens authored paths upstream; it does not widen cleanup here.
            localOnly: true,
          });
          if (repaired.notes.length > 0) {
            for (const n of repaired.notes) console.info("[repair-all]", n);
            // Cleanup may never break a file that parsed before it ran.
            const { revertCleanupBreakage } = await import("@/server/write-gate.server");
            const guarded = await revertCleanupBreakage(nextFiles, repaired.files, cleanupPaths);
            if (guarded.reverted.length) console.warn(`[cleanup-guard] reverted cleanup on ${JSON.stringify(guarded.reverted)} (it broke them)`);
            nextFiles = guarded.files;
            {
              // Cleanup may only touch the files this turn wrote.
              const { guardCleanup } = await import("@/server/verification/gates");
              const scoped = guardCleanup(turnBaselineFiles.length ? turnBaselineFiles : nextFiles, nextFiles, [...cleanupPaths, ...kitSyncedPaths]);
              if (turnBaselineFiles.length && scoped.reverted.length) {
                console.warn(`[cleanup-guard] reverted out-of-scope cleanup on ${JSON.stringify(scoped.reverted.slice(0, 20))}`);
                nextFiles = scoped.files;
              }
            }
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
          // Change-scope telemetry. One line per turn so an unexplained
          // expansion ("changed 3 files, shipped 300") is visible instead of
          // being buried inside repair notes.
          const finalScope = diffChangedPaths(turnBaselineFiles, nextFiles);
          console.info(
            `[turn-scope] read=${nextFiles.length} targeted=${resolvedTargetPaths.length} written=${scopeLock?.touchedPaths.length ?? finalScope.length} final=${finalScope.length} initial=${isInitial}`,
          );
          const ambientAttempt = currentTurnContext().attemptId ?? null;
          console.info(
            `[cleanup-scope] turn=${logicalTurnId} attempt=${ambientAttempt ?? "none"} unit=generation written=${cleanupPaths.length} modified=${finalScope.length} cleanup=${cleanupPaths.length} duration_ms=${Date.now() - cleanupT0} result=${repaired.notes.length > 0 ? "fixed" : "ok"} skipped=${cleanupPaths.length === 0} paths=${JSON.stringify(cleanupPaths)}`,
          );
          if (
            !isInitial &&
            scopeLock &&
            finalScope.length > Math.max(12, scopeLock.touchedPaths.length * 2)
          ) {
            console.warn(
              `[turn-scope] unexplained expansion: turn wrote ${scopeLock.touchedPaths.length} file(s) but ${finalScope.length} differ from the baseline.`,
            );
          }
        }

        const shellGuard = ensureRenderableShell(nextFiles, detectedWebSubtype);
        // ROOT-CAUSE GATE: if the model failed to emit a real src/App.tsx,
        // we used to silently inject a "Your app is being prepared"
        // placeholder and ship it as a successful build. That's the bug
        // class behind every "Kimble built a blank app" report — a placeholder
        // screen shipped as a finished product. Treat it as a turn failure
        // instead: revert files, never charge credits, and ask the user to
        // retry with a more concrete prompt. index.html + main.tsx repairs
        // are still safe to keep (they only restore the mount point).
        // First builds: never roll back pages that were written. The missing
        // or placeholder layout is left out (never shipped as a placeholder)
        // and the authoritative completeness check reports the real state.
        if (isInitial && shellGuard.degraded.includes("src/App.tsx")) {
          console.warn("[renderable-shell] no real App.tsx on a first build — leaving it to the completeness check");
          nextFiles = shellGuard.files.filter((f) => f.path !== "src/App.tsx");
        } else if (shellGuard.degraded.includes("src/App.tsx") && collected.name === "write_project") {
          console.warn("[renderable-shell] model emitted empty/placeholder App.tsx — failing turn");
          emitConversationalFallback(controller, encoder, {
            files: currentFiles,
            summary:
              EMPTY_HOME_BUILD_FAILURE_MESSAGE,
            outcome: "failed",
            reason: "empty_home",
          });
          return;
        } else {
          nextFiles = shellGuard.files;
        }
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
              message: "Checking the files Kimble just wrote for build errors…",
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
        // Phase 1 — a long file is only thrown away when it's genuinely
        // unfinished. Complete work reaches the user, however large it is.
        const contentByPathBudget = new Map(nextFiles.map((f) => [f.path, f.content]));
        // Size is NEVER a correctness rule. Whether a file is unfinished is
        // decided by the parser/verifier at any size; size only signals that
        // the next write of this page should be decomposed.
        void contentByPathBudget;
        void looksIncomplete;
        void enforceFileBudgets;
        const budgetRejections: FileBudgetIssue[] = [];
        const budgetDowngraded = budgetVerdict.rejections.filter(
          (r) => !budgetRejections.includes(r),
        );
        if (budgetDowngraded.length > 0) {
          budgetVerdict.warnings.push(
            ...budgetDowngraded.map((r) => ({ ...r, severity: "warn" as const })),
          );
        }
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
        const preAutofixChangedPaths = diffChangedPaths(turnBaselineFiles, nextFiles);
        const autofixOut = autofixFiles(nextFiles, preAutofixChangedPaths);
        {
          // Autofix is cleanup: only files this turn already changed.
          const { guardCleanup } = await import("@/server/verification/gates");
          const scoped = guardCleanup(nextFiles, autofixOut.files, preAutofixChangedPaths);
          if (scoped.reverted.length) console.warn(`[cleanup-guard] autofix out of scope on ${JSON.stringify(scoped.reverted.slice(0, 20))}`);
          nextFiles = scoped.files;
        }
        if (autofixOut.report.fixedCount > 0) {
          console.log(
            `[autofix] ${autofixOut.report.fixedCount} fix(es):`,
            autofixOut.report.notes.join("; "),
          );
        }
        recorder.record({
          tier: "stream_autofix",
          outcome: autofixOut.report.fixedCount > 0 ? "fixed" : "ok",
          duration_ms: Date.now() - autofixT0,
          issue_count: autofixOut.report.fixedCount,
          details: { notes: autofixOut.report.notes.slice(0, 8) },
        });
        // Controlled repair-path test (development server only): break the
        // first file this edit changed the way a truncated model reply would,
        // so the real verify → one targeted repair → verify path can be
        // measured. Never active in a production build.
        if (import.meta.env.DEV && (body as { testFault?: string }).testFault === "syntax" && !isInitial) {
          const changedNow = new Set(diffChangedPaths(turnBaselineFiles, nextFiles));
          const victim = resolvedTargetPaths.find((p) => changedNow.has(p) && /\.tsx$/.test(p));
          if (victim) {
            nextFiles = nextFiles.map((f) => {
              if (f.path !== victim) return f;
              const i = f.content.lastIndexOf("\n}");
              return i < 0 ? f : { ...f, content: f.content.slice(0, i) + "\n" + f.content.slice(i + 2) };
            });
            console.warn(`[test-fault] removed the closing brace of ${victim}`);
          }
        }
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
        if (localOut.validationFailure) {
          controller.enqueue(encoder.encode(sse({
            type: "timeline",
            step: "esbuild_parse",
            outcome: "failed",
            message: "Code parser unavailable — validation stopped",
            ts: Date.now(),
          })));
          throw new Error(`Authoritative code validation unavailable: ${localOut.validationFailure}`);
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

        // Dependency closure: every package the bundled import graph needs
        // (kit files included) must be in package.json. Adds only.
        {
          const { missingReachableDeps, addMissingDeps } = await import("@/server/engine/deps");
          const pkgFile = nextFiles.find((f) => f.path === "package.json");
          const missing = pkgFile ? missingReachableDeps(nextFiles) : [];
          if (pkgFile && missing.length) {
            try {
              pkgFile.content = addMissingDeps(pkgFile.content, missing);
              console.log(`[deps-closure] added ${missing.join(", ")}`);
            } catch (e) {
              console.warn("[deps-closure] could not patch package.json:", e);
            }
          }
        }

        // Router provider: pages using Link/Routes crash at runtime with
        // "cannot destructure 'basename'" if nothing mounts a router. The
        // deterministic fixer only wraps the entry when it's truly missing.
        {
          const { fixMissingRouterProvider } = await import("@/server/router-provider.server");
          const rp = fixMissingRouterProvider(nextFiles);
          if (rp.notes.length) {
            nextFiles = rp.files;
            console.log(`[router-provider] ${rp.notes.join("; ")}`);
          }
        }

        // Tier 2.46 — deterministic strip of npm-confirmed-hallucinated
        // imports. We do this BEFORE continuation/esbuild so the parse
        // tier doesn't trip on identifiers that point at packages the
        // installer can never resolve. The replaced code is ugly on
        // purpose to flag the bad sections clearly in the source — the
        // user can ask Kimble in a follow-up turn to reimplement them.
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

        // REPAIR is one stage: the write-time single-file repair (write-gate →
        // engine/repair). Truncated files fail to parse and are repaired there.

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
        if (esbuildVerdict.status === "unavailable") {
          throw new Error(
            `Authoritative code validation unavailable: ${esbuildVerdict.unavailableDetail ?? esbuildVerdict.unavailableReason ?? "initialization error"}`,
          );
        }

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

        const generationQualityIssues = findGenerationQualityIssues(nextFiles, detectedWebSubtype, {
          template: designDirection?.template,
        });
        if (generationQualityIssues.length > 0) {
          console.warn(
            `[generation-quality] ${generationQualityIssues.length} issue(s):`,
            generationQualityIssues.map((i) => `${i.path}: ${i.detail}`).join("; "),
          );
        }

        // (Post-write autofix and the extra repair round were removed: the
        // only AI repair is the write-time single-file repair.)
        const agentLoopUsages: Array<GatewayUsage | null> = [];

        // Phase 4: resolve `petal-image://...` placeholders into real
        // AI-generated images uploaded to the public petal-images
        // bucket. Failures fall back to picsum so the build never
        // breaks because of a flaky image call.
        try {
          const imageTargetPaths = isInitial
            ? undefined
            : diffChangedPaths(turnBaselineFiles, nextFiles).filter(
                // Kimble's own building-block refresh is housekeeping, not
                // this request: never make pictures for files nobody edited.
                (p) => !kitSyncedPaths.has(p),
              );
          const imageTargetSet = imageTargetPaths ? new Set(imageTargetPaths) : null;
          const hasPlaceholders = nextFiles.some(
            (f) =>
              (!imageTargetSet || imageTargetSet.has(f.path)) &&
              // Earlier pictures that could not be made are retried too.
              (f.content.includes("petal-image://") || f.content.includes("petal-pending%3A")),
          );
          const seenPictureUrls = new Set<string>();
          if (hasPlaceholders) {
            await agentIO().assertActive(turnId, abortSignal, "images");
            controller.enqueue(
              encoder.encode(sse({ type: "status", message: "Generating images…" })),
            );
            const imgResult = await resolvePetalImagePlaceholders(
              nextFiles,
              // Each picture is announced the moment it exists so the build
              // card can show it landing instead of a count at the end.
              ({ url, index }) => {
                // Economics: one cost row per picture. A URL already seen in
                // this turn is a reuse (provider not charged again → $0);
                // otherwise the provider cost is not reported here → UNKNOWN.
                const reused = seenPictureUrls.has(url);
                seenPictureUrls.add(url);
                void import("@/server/cost-events.server").then(({ recordCostEvents }) =>
                  recordCostEvents([
                    {
                      sourceRef: `image:${logicalTurnId}:${index}`,
                      userId,
                      projectId: body.projectId ?? null,
                      turnId: logicalTurnId,
                      stage: "images",
                      category: "IMAGE_GENERATION",
                      resource: url.slice(0, 300),
                      quantity: 1,
                      unit: "image",
                      costUsd: reused ? 0 : null,
                      basis: reused ? "ACTUAL" : "UNKNOWN",
                      metadata: { reused, index },
                    },
                  ]),
                );
                controller.enqueue(
                  encoder.encode(
                    sse({
                      type: "timeline",
                      step: "image_resolve",
                      outcome: "fixed",
                      message: `Made picture ${index}`,
                      count: index,
                      url,
                      ts: Date.now(),
                    }),
                  ),
                );
              },
              body.projectId ?? null,
              imageTargetPaths,
              {
                // A picture that could not be made is said plainly (and kept
                // in the turn's events for audit), never passed off as real.
                onFailure: ({ reason }) => {
                  controller.enqueue(
                    encoder.encode(
                      sse({
                        type: "timeline",
                        step: "image_resolve",
                        outcome: "failed",
                        message: `One picture couldn't be made yet (${reason.slice(0, 80)}) — it will be retried on the next change.`,
                        ts: Date.now(),
                      }),
                    ),
                  );
                },
              },
            );
            nextFiles = imgResult.files;
            if (imgResult.resolved > 0) {
              controller.enqueue(
                encoder.encode(
                  sse({
                    type: "status",
                    message: `Made ${imgResult.resolved} picture${imgResult.resolved === 1 ? "" : "s"}.`,
                  }),
                ),
              );
            }
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

        // Missing shared modules: created inside the execution loop (first
        // builds) and by the final check's root-cause step — no separate pass.
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
          // Pre-turn files: a handful of broken outputs get quarantined back
          // to these instead of throwing the whole turn away.
          currentFiles,
          async (file, detail) => {
            // Circuit breaker owns "is this worth another attempt"; the
            // recovery budget owns "how many attempts this mechanism gets".
            const verdict = breaker.recordFailure({
              category: classifyFailure(detail),
              tool: "final_parse_guard",
              path: file.path,
              message: detail,
            });
            breakerGuidance = verdict.guidance;
            if (verdict.tripped) {
              console.warn(`[circuit-breaker] ${JSON.stringify(breaker.snapshot())}`);
              return null;
            }
            if (infraFailure) return null;
            if (!recovery.take("broken_file", file.path)) return null;
            controller.enqueue(encoder.encode(sse({ type: "status", message: `Fixing a code error in ${file.path}…` })));
            // Build-server logs aren't retained — record the exact reason on
            // the wire so a failed final check can be diagnosed afterwards.
            controller.enqueue(encoder.encode(sse({ type: "timeline", step: "esbuild_parse", outcome: "failed", message: `Final check on ${file.path}: ${detail}`.slice(0, 500), ts: Date.now() })));
            const turnContext = turnContextFor(file.path);
            const n = recovery.record({
              kind: "broken_file",
              stage: "validation",
              path: file.path,
              reason: detail,
              action: "compile repair of this file only (final check)",
            });
            const { repairBrokenFile } = await import("@/server/engine/repair");
            let out: string | null;
            try {
              out = await repairBrokenFile(file, detail, { turnId: logicalTurnId, projectId: body.projectId ?? null, userId, turnContext });
            } catch (e) {
              const { isInfrastructureFailure } = await import("@/lib/failure-classification");
              if (!isInfrastructureFailure(e)) throw e;
              infraFailure = e;
              recovery.resolve(n, "kept_previous");
              return null;
            }
            recovery.resolve(n, out ? "pending" : "kept_previous", out);
            if (out) {
              breaker.recordProgress("file_repaired", file.path);
              breakerGuidance = null;
            }
            return out;
          },
          () => infraFailure,
          // Missing-node recovery: a missing shared module is created ONCE,
          // before any dependent page is repaired individually.
          async (node, context) => {
            if (!turnLedger.use("repair", "missing shared module", node.target).ok) return null;
            controller.enqueue(encoder.encode(sse({ type: "status", message: `Creating missing shared file ${node.target}…` })));
            const { createMissingModule } = await import("@/server/engine/repair");
            try {
              return await createMissingModule(node, context, {
                turnId: logicalTurnId,
                projectId: body.projectId ?? null,
                userId,
                turnContext: turnContextFor(node.target),
              });
            } catch (e) {
              const { isInfrastructureFailure } = await import("@/lib/failure-classification");
              if (!isInfrastructureFailure(e)) throw e;
              infraFailure = e;
              return null;
            }
          },
        );

        if (!guardOut.ok && guardOut.origin === "infrastructure") {
          const { guidanceFor } = await import("@/lib/failure-classification");
          const g = guidanceFor("infrastructure");
          console.warn(`[final-parse-guard] provider failure during repair — preserving files: ${guardOut.detail}`);
          controller.enqueue(encoder.encode(sse({ type: "timeline", step: "esbuild_parse", outcome: "failed", message: `Infrastructure: ${guardOut.detail}`.slice(0, 500), ts: Date.now() })));
          emitConversationalFallback(controller, encoder, {
            files: currentFiles,
            summary: `${g.headline} ${g.preserved} Send "continue" when you're ready and I'll pick up exactly where this stopped.`,
            suggestions: ["Continue"],
            outcome: "failed",
            reason: "infrastructure:provider_unavailable",
          });
          return;
        }

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
            // A tripped breaker explains WHY it stopped trying; otherwise the
            // existing generic revert message stands.
            summary: breaker.tripped
              ? breaker.userMessage()
              : "I drafted the change but it didn't pass my final safety check, so I rolled it back to keep your app building. Want me to try a smaller version of the same change, or break it into a couple of steps?",
            // A reverted change is a failed turn — never a "succeeded" done.
            outcome: "failed",
            reason: breaker.tripped
              ? `circuit_breaker:${breaker.reason()?.rule ?? "unknown"}`
              : "final_check_reverted",
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

        // Pages are written only by the WRITE stage (engine/write.ts).



        // Edit Intelligence phase 1/2/6 — did every requested change actually
        // land? The prompt asks for all of them; this checks the real diff.
        // Anything missing gets ONE focused pass (inside the existing repair
        // budget); whatever still hasn't landed is disclosed rather than
        // reported as success. Preservation violations are surfaced too.
        if (!isInitial && turnChangeSet.items.length > 0) {
          try {
            const { auditChangeSet, unmetDisclosure, runCompletenessPass } = await import(
              "@/server/edit-audit.server"
            );
            let audit = auditChangeSet({
              changeSet: turnChangeSet,
              before: turnBaselineFiles,
              after: nextFiles,
              memory: memoryEntries,
            });
            // A bounded edit (one or two asks) is never re-run by a second
            // model: the unmet item is disclosed instead. Only requests with
            // several explicit parts, or new pages that did not appear, get
            // the one completeness pass.
            const completenessWarranted =
              turnChangeSet.items.length >= 3 ||
              /\b(add|create|build|new)\b[^.!?]{0,40}\b(pages?|routes?|screens?)\b/i.test(lastUserContent);
            if (audit.unmet.length > 0 && completenessWarranted) {
              controller.enqueue(
                encoder.encode(
                  sse({ type: "status", message: "Checking every part of your request landed." }),
                ),
              );
              const pass = await runCompletenessPass({
                userRequest: lastUserContent,
                unmet: audit.unmet,
                files: nextFiles,
                candidatePaths: (pinnedPaths.length > 0
                  ? pinnedPaths
                  : nextFiles.map((f) => f.path)
                ).slice(0, 8),
                model,
                projectId: body.projectId ?? undefined,
                userId,
                signal: abortSignal,
              });
              if (pass.ran && pass.files.length > 0) {
                nextFiles = pass.files;
                audit = auditChangeSet({
                  changeSet: turnChangeSet,
                  before: turnBaselineFiles,
                  after: nextFiles,
                  memory: memoryEntries,
                });
              }
            }
            if (audit.unmet.length > 0 || audit.violations.length > 0) {
              summary = `${summary}${unmetDisclosure(audit.unmet, audit.violations)}`;
            }
            if (body.projectId) {
              const { recordEdit } = await import("@/server/edit-history.server");
              const { focusFromTurn } = await import("@/server/edit-focus.server");
              await recordEdit({
                projectId: body.projectId,
                turnId: logicalTurnId ?? null,
                userRequest: lastUserContent,
                changeSet: turnChangeSet,
                audit,
                focus: focusFromTurn({
                  changeSet: turnChangeSet,
                  changedPaths: audit.changedPaths,
                }),
                revertTo: {
                  paths: audit.changedPaths,
                  files: turnBaselineFiles
                    .filter((f) => audit.changedPaths.includes(f.path))
                    .map((f) => ({ path: f.path, content: f.content ?? "" })),
                },
              });
            }
          } catch (e) {
            console.warn("[edit-audit] skipped:", e instanceof Error ? e.message : String(e));
          }
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

        // Kimble Cloud reads what this app needs — shared, its own database,
        // or its own server — and records it. Deterministic, no AI call, and
        // never allowed to break a turn.
        if (body.projectId) {
          try {
            const { recordTierIntent } = await import("@/server/cloud-tier.server");
            const signal = await recordTierIntent(body.projectId, lastUserContent ?? "");
            // Needing its own server means getting one now, not at the next
            // daily sweep. considerCompute re-reads the tier, is idempotent,
            // checks credits/capacity, records the outcome and never throws.
            if (signal.tier === "kimble_compute") {
              const { considerCompute } = await import("@/server/backend-autoscale.server");
              await considerCompute(body.projectId);
            }
          } catch (e) {
            console.warn("[cloud-tier] intent skipped:", e instanceof Error ? e.message : String(e));
          }
        }

        // W4 — refresh the persisted architecture doc from the files we are
        // about to ship, so the next turn plans against reality. Runs after
        // the blueprint save (which merges sibling keys) and never throws.
        await saveProjectArchitecture(body.projectId, nextFiles);



        // Charge ONCE, after the build succeeds. Cost is computed from
        // the MAIN generate call's token usage only — `collected.usage`
        // covers the patch_files / write_project completion, not the
        // side calls (design-director, self-check, humanize-error).
        // Those run on Kimble's tab so users never get surprise-charged
        // for our internal QA passes. Do NOT add their usage here.
        //
        // AUTO-FIX runs are also on Kimble's tab — the user did not ask
        // for this turn, Kimble is fixing its own broken build. We log
        // the would-be amount for analytics but never debit the user.
        // Aggregate every user-billable sub-call's token usage and price
        // ONCE. Today this array holds just the main generate completion;
        // when we add user-requested fix cycles inside the agentic loop,
        // they push into `turnUsages` and the user still sees a single
        // debit at end of turn. Internal QA cycles (post-stream autofix,
        // continuation, self-check) stay on Kimble's tab and are NOT
        // appended here — same convention as `body.isAutoFix`.
        const turnUsages: Array<GatewayUsage | null> = [
          collected.usage ? { ...collected.usage, model: (collected.usage as GatewayUsage).model ?? model } : null,
          ...pageWriteUsages,
          ...agentLoopUsages,
        ];
        // ONE pricer (src/lib/build-pricing): measured cost → credits. Each
        // call is ACTUAL (provider cost) or ESTIMATED (tokens × price table);
        // a call with no usage at all is never free — the class estimate
        // stands in. The reservation caps the result (DB-enforced).
        const { buildEconomics } = await import("@/server/economics-config.server");
        let priced: import("@/lib/build-pricing").PricedTurn = priceTurnCost(
          turnUsages.filter((u): u is GatewayUsage => !!u).map((u) => turnCallCost(u)),
          await buildEconomics(),
          buildReservation?.classCostUsd ?? 0,
        );

        // Backfill the usage tokens onto the ai_call_log row that
        // `aiChatCompletions` inserted before the stream body was read.
        // Without this, every streaming generate call shows NULL tokens
        // and we can't distinguish "model returned a full project" from
        // "model returned a one-line refusal".
        // Pull cached-prefix tokens out of whichever shape the upstream used.
        // OpenAI / Anthropic via the gateway: usage.prompt_tokens_details.cached_tokens.
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
          // The gateway may return a real USD amount on the usage object when
          // available; when it doesn't, the estimate is labelled as such.
          actualCostUsd:
            typeof (collected.usage as { cost?: unknown } | undefined)?.cost === "number"
              ? ((collected.usage as { cost: number }).cost)
              : null,
          turnId: logicalTurnId,
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
        // Stop boundary: after Stop nothing is billed, saved or built. This is
        // the last point before settlement → persistence commit together.
        // Commit point: atomically claims the turn against a concurrent Stop.
        await agentIO().claimCommit(turnId, abortSignal);
        // LIVE MUTATION BOUNDARY — the proposed tree is staged into one
        // TurnTransaction (accounted by turnLedger), scope-enforced and
        // checked; only a committed outcome is billed and persisted.
        // Deterministic design-system install: the selected package's tokens,
        // accent, fonts and components are (re)applied to the proposed tree so
        // the committed revision always carries them, whatever the AI wrote.
        // Idempotent; on failure the tree is left as the AI proposed it.
        {
          const { applyPackageToTree } = await import("@/server/design-systems/authority");
          const pkgApply = applyPackageToTree(nextFiles, picContext?.design);
          if (pkgApply.applied) {
            nextFiles = pkgApply.files;
            if (pkgApply.changedPaths.length) console.info(`[design-system] installed ${picContext?.design?.package?.systemId}/${picContext?.design?.package?.accent} paths=${pkgApply.changedPaths.join(",")}`);
          } else if (picContext?.design?.package) {
            console.warn(`[design-system] not applied: ${pkgApply.reason}`);
          }
          // Site identity (tab name, icon, theme colour) is written here, after
          // cleanup, because cleanup restores Kimble-owned index.html.
          if (isInitial) {
            const { ensureSiteIdentity } = await import("@/server/brand-identity.server");
            const identity = ensureSiteIdentity(nextFiles, resolvedPrd?.prd?.productName ?? null);
            nextFiles = identity.files;
            for (const n of identity.notes) console.info("[site-identity]", n);
          }
          const { lintDesignSystem } = await import("@/server/design/design-system-lint.server");
          if (picContext?.design) {
            const lint = lintDesignSystem(nextFiles, picContext.design);
            if (lint.findings.length) console.info(`[design-lint] errors=${lint.errorCount} warnings=${lint.warningCount}: ${lint.findings.slice(0, 5).map((v) => `${v.rule}@${v.path}`).join(", ")}`);
          }
        }
        // Documented read-before-edit exception: on a FIRST_BUILD the starter
        // template is the foundation the build is designed to author over.
        if (isInitial) for (const f of turnBaselineFiles) turnLedger.recordRead(f.path);
        const txResult = await commitTurn({
          baseline: turnBaselineFiles,
          proposed: nextFiles,
          ledger: turnLedger,
          isSystemPath: (p) =>
            isScaffoldOwnedPath(p) ||
            kitSyncedPaths.has(p) ||
            (authoredPaths !== undefined && !authoredPaths.includes(p)),
          protectionReason: (p) =>
            isInitial || isCrossCutting ? null : executionScope.protectionReason(p),
          checks: turnChecks,
          cancelled: () => abortSignal.aborted,
          // AUTHORITATIVE source verification of the proposed tree. esbuild
          // is re-run on the proposed bytes (not a verdict computed earlier
          // on a different tree), then the existing source gates decide.
          verifySource: async (tree, changed) => {
            const { verifyProposedSource } = await import("@/server/verification/source.server");
            return verifyProposedSource({
              tree,
              changedPaths: changed,
              requestedRoutes: isInitial ? requestedRoutesFor(lastUserText, plannedRoutes) : [],
              requireShell: isInitial,
              requireLiveData: isInitial && Boolean(sharedBackend),
            });
          },
        });
        const txCommitted = txResult.outcome.status === "committed";
        // Agent said finished (readiness passed) but commit verification did
        // not: an ARCHITECTURAL error (both read the same authority), never
        // a normal failure. Recorded so it can't hide.
        {
          const loopOutcome = (turnStrategy.toolLoop as { outcome?: string } | undefined)?.outcome;
          if (loopOutcome === "finished" && txResult.verification && txResult.verification.status !== "READY" && txResult.verification.status !== "IN_PROGRESS") {
            turnStrategy.readinessDivergence = { status: txResult.verification.status, gate: txResult.verification.failedGate, reason: txResult.verification.reason };
            console.error(`[readiness_divergence] loop finished but commit verification=${txResult.verification.status} gate=${txResult.verification.failedGate} reason=${txResult.verification.reason}`);
          }
        }
        // A committed turn has delivered its checkpoint's work: retire it so
        // it can never be resumed (no duplicate of committed work).
        if (txCommitted && checkpointTurnId) {
          const { markCheckpointConsumed } = await import("@/server/build-checkpoint.server");
          await markCheckpointConsumed(checkpointTurnId);
        } else if (checkpointTurnId && txResult.outcome.status !== "committed") {
          const { keepPartialWork } = await import("@/lib/partial-build");
          const loopOutcomeNow = (turnStrategy.toolLoop as { outcome?: string } | undefined)?.outcome;
          if (keepPartialWork({ isInitial, loopOutcome: loopOutcomeNow, committed: false, keptFiles: partialWork.size })) {
            // The build stopped part-way (not wrong code): keep its validated
            // work for the next attempt instead of throwing it away.
            const { markCheckpointPartial } = await import("@/server/build-checkpoint.server");
            partialKept = await markCheckpointPartial(checkpointTurnId);
            turnStrategy.partialBuild = { kept: [...partialWork.keys()], saved: partialKept };
          }
          if (!partialKept) {
            // Final verification (or commit) refused this turn: close its saved
            // progress with the outcome so it can never look resumable. Evidence kept.
            const { retireCheckpoint } = await import("@/server/build-checkpoint.server");
            const oc = txResult.outcome as { status: string; reason?: string };
            await retireCheckpoint(checkpointTurnId, oc.reason ?? oc.status);
          }
        }
        // FINAL execution depth: classifier's initial depth, raised (never
        // lowered) by deterministic impact analysis of what actually changed.
        if (txResult.outcome.status === "committed") {
          const { finalDepth } = await import("@/server/execution");
          const fd = finalDepth(turnInitialDepth, txResult.outcome.changed, { codeChanged: true });
          console.info(`[depth] initial=${turnInitialDepth} final=${fd.depth}${fd.escalatedBy.length ? ` escalated_by=${fd.escalatedBy.map((f) => `${f.path}:${f.reason}`).slice(0, 5).join(",")}` : ""}`);
          if (turnId && /^[0-9a-f-]{36}$/i.test(turnId)) {
            void (async () => {
              const { data: op } = await supabaseAdmin.from("economic_operations" as never).select("metadata").eq("turn_id", turnId).maybeSingle();
              const meta = ((op as { metadata?: Record<string, unknown> } | null)?.metadata ?? {}) as Record<string, unknown>;
              await supabaseAdmin.from("economic_operations" as never).update({
                metadata: { ...meta, initial_depth: turnInitialDepth, final_depth: fd.depth, escalated_by: fd.escalatedBy.slice(0, 10) },
              } as never).eq("turn_id", turnId);
            })().catch(() => {});
          }
        }
        console.info(
          `[execution] tx=${txResult.outcome.status} changed=${txCommitted && txResult.outcome.status === "committed" ? txResult.outcome.changed.length : 0} rejections=${JSON.stringify(txResult.rejections.slice(0, 5))} ledger=${JSON.stringify(turnLedger.summary().counts)}`,
        );
        if (txResult.outcome.status === "committed") {
          nextFiles = txResult.outcome.files;
          // The turn produced a verified, committed result. Lock the breaker:
          // a late failure from an earlier tool call can never retroactively
          // turn a successful turn into a tripped one.
          breaker.recordProgress("verification_passed");
          breaker.complete();
        } else {
          // CANCELLATION HAS PRIORITY over every breaker rule: a user Stop is
          // never reported or recorded as an agent failure.
          if (txResult.outcome.reason === "cancelled") throw new Error("Turn cancelled before commit");
          // A blocked commit is an agent failure the breaker must see — this
          // is the authoritative verification verdict, not a guess.
          for (const r of txResult.rejections.slice(0, 3)) {
            breaker.recordFailure({
              category: r.reason === "scope_violation" ? "scope_violation" : "verification_failed",
              tool: r.stage === "source_verification" ? (r.gate ?? "source_verification") : "execution",
              path: r.path ?? null,
              message: r.detail,
            });
          }
          // Nothing lands: the project keeps its previous state.
          nextFiles = txResult.outcome.files;
          if (txResult.outcome.reason !== "no changes") {
            // ONE authoritative verdict: the model's narration ("it ships
            // with…") described code that was never saved, so it is replaced
            // outright — not appended to.
            const { buildTerminalResult, formatTerminalResult } = await import("@/lib/terminal-result");
            const verdict = buildTerminalResult({
              turnId: logicalTurnId,
              category: breaker.tripped
                ? "circuit_breaker"
                : txResult.rejections.some((r) => r.reason === "scope_violation")
                  ? "scope_violation"
                  : "verification_failed",
              committedRevision: null,
              rejections: txResult.rejections.slice(0, 3).map((r) => ({ path: r.path ?? null, detail: r.detail })),
              partial: partialKept
                ? {
                    kept: [...partialWork.keys()],
                    remaining: ((turnStrategy.toolLoop as { incomplete?: string[] } | undefined)?.incomplete ?? []).length
                      ? (turnStrategy.toolLoop as { incomplete: string[] }).incomplete
                      : txResult.rejections.slice(0, 5).map((r) => `${r.path ? `${r.path}: ` : ""}${r.detail}`),
                  }
                : null,
            });
            summary = breaker.tripped
              ? `${formatTerminalResult(verdict)}\n\n${breaker.userMessage()}`
              : formatTerminalResult(verdict);
            controller.enqueue(encoder.encode(sse({ type: "summary_delta", delta: `\n\n${summary}` })));
          }
          if (breaker.tripped) {
            console.warn(`[circuit-breaker] tripped at commit ${JSON.stringify(breaker.snapshot())}`);
          }
        }
        let finalCharged = 0;
        // Server-side file persistence — the ONE generation write. Files,
        // project code revision and turn.committed_revision are saved in one
        // database transaction, BEFORE billing: a save that fails (including a
        // revision_conflict because another save landed during this turn)
        // leaves the project at its previous revision and is never charged.
        let persistError: string | null = null;
        let committedRevision: number | null = null;
        const persistCommitted = async () => {
          if (!(body.projectId && txCommitted && nextFiles.length > 0)) return;
          const byPath = new Map<string, { path: string; content: string }>();
          for (const f of nextFiles) {
            const p = f.path.trim();
            if (!p) continue;
            byPath.set(p, { path: p, content: f.content ?? "" });
          }
          try {
            const saved = await agentIO().replaceFiles(body.projectId, Array.from(byPath.values()), { turnId: logicalTurnId ?? turnId ?? null });
            persistError = saved.error;
            committedRevision = saved.error ? null : saved.revision;
          } catch (e) {
            persistError = (e as Error).message;
          }
          console.info(
            `[revision] project=${body.projectId} turn=${logicalTurnId ?? turnId ?? "none"} committed_revision=${committedRevision ?? "none"}${persistError ? ` save_failed=${persistError.slice(0, 160)}` : ""}`,
          );
        };
        // Decide the terminal state BEFORE billing. Charging first meant a
        // turn where the user asked for an edit, the ops all failed to apply
        // and the project came out byte-identical still debited credits —
        // the user paid for nothing and (correctly) called it a loop.
        const turnChangedPaths = diffChangedPaths(turnBaselineFiles, nextFiles);
        const { isUnbillableTurn } = await import("@/lib/build-outcome");
        const failedEditTurn = isUnbillableTurn({
          changedPathCount: turnChangedPaths.length,
          unappliedPathCount: unappliedPaths.length,
          txCommitted,
          outcomeStatus: txResult.outcome.status,
          outcomeReason: (txResult.outcome as { reason?: string | null }).reason ?? null,
        });
        if (failedEditTurn) {
          console.warn(
            `[credits] no-op edit turn not billed project=${body.projectId ?? "none"} unapplied=${unappliedPaths.length}`,
          );
        }
        // ONE authoritative final cost: flush every in-flight cost write
        // (the last loop step's usage backfill included), then price from
        // the durable per-call records. In-memory usage is only the fallback
        // when the records cannot be read.
        let settledFrom: "recorded" | "memory" = "memory";
        let billableCalls: number | null = null;
        let recordedRows: Awaited<ReturnType<typeof import("@/server/ai-provider.server").readTurnCallCosts>> = null;
        if (logicalTurnId) {
          const { flushCostWrites, readTurnCallCosts } = await import("@/server/ai-provider.server");
          const flushed = await flushCostWrites();
          if (flushed.timedOut) console.warn(`[credits] cost writes still pending at settlement: ${flushed.pending}`);
          const rows = await readTurnCallCosts(logicalTurnId);
          recordedRows = rows;
          if (rows && rows.length) {
            const { priceRecordedCalls } = await import("@/lib/build-pricing");
            const rp = priceRecordedCalls(rows, await buildEconomics(), buildReservation?.classCostUsd ?? 0);
            priced = rp;
            billableCalls = rp.billableCalls;
            settledFrom = "recorded";
          }
        }
        // CUSTOMER PRICE = effort curve over productive work (never AI cost).
        // `priced` above stays the INTERNAL cost for margin and reporting.
        const internalCostUsd = priced.costUsd;
        const effortEval = await (async () => {
          const ep = await import("@/lib/effort-pricing");
          const { economicsValues } = await import("@/server/economics-config.server");
          const v = (await economicsValues()) as Record<string, number>;
          const cfg = ep.effortConfig(v);
          const cls = assessExecution({ ...turnComplexityBase, plannedPages: firstBuildPlan?.pages.length ?? 0 }).class;
          // Starter-kit files are Kimble's scaffold, not work done for this request.
          const toMap = (fs: ProjectFile[]) => Object.fromEntries(projectAuthoredFiles(fs).map((f) => [f.path, f.content ?? ""]));
          // Kept partial work is priced once: here if this turn kept it, never
          // again when a later turn resumes from that already-billed checkpoint.
          const { effortTrees } = await import("@/lib/partial-build");
          const keptMap = partialKept ? toMap([...partialWork].map(([path, content]) => ({ path, content }) as ProjectFile)) : null;
          const trees = effortTrees({ baseline: toMap(turnBaselineFiles), committedTree: txCommitted ? toMap(nextFiles) : null, kept: keptMap, resumedBilled: resumedBilled ? toMap(Object.entries(resumedBilled).map(([path, content]) => ({ path, content }) as ProjectFile)) : null });
          const diff = ep.diffSignals(trees.from, trees.to, (p) => ep.PAGE_PATH.test(p));
          const rows = recordedRows ?? [];
          const verifyCalls = rows.filter((r) => r.stage === "verify").length;
          const signals = {
            cls,
            ...diff,
            capabilities: (turnComplexityBase.backendInvolved ? 1 : 0) + (turnComplexityBase.integrations ?? 0),
            validationsPassed: txCommitted ? 1 + verifyCalls : 0,
            durationMs: Date.now() - setupStartedAt,
          };
          const eff = ep.effortScore(signals, cfg.weights);
          const credits = ep.creditsForEffort(eff.score, cfg.curve);
          const wasted = ep.wastedCostUsd(rows as never);
          const prof = ep.profitability(credits, v.revenue_per_credit_usd ?? 0.13, internalCostUsd, wasted);
          const flags = ep.economicFlags(prof, buildReservation?.estimatedEffort != null ? { effort: buildReservation.estimatedEffort } : null, eff.score, { marginFloorPct: cfg.marginFloorPct, wasteShare: 0.3, estimateError: cfg.estimateError });
          return { cls, signals: { ...signals, linesPerFile: undefined, linesChanged: diff.linesPerFile.reduce((a, b) => a + b, 0) }, score: eff.score, parts: eff.parts, credits, prof, flags };
        })().catch((e) => { console.warn("[credits] effort pricing failed, using cost price", (e as Error).message); return null; });
        if (effortEval) priced = { ...priced, amount: effortEval.credits };
        // A partial build that kept validated work is billable for that work
        // only (effort over the kept files); anything else rolled back is not.
        if (!body.isAutoFix && (!failedEditTurn || partialKept)) {
          // A held reservation already guarantees the (capped) charge.
          const finalBalance = buildReservation?.ok
            ? ({ ok: true } as const)
            : await agentIO().checkBalance(userId, priced.amount);
          if (!finalBalance.ok && finalBalance.reason === "insufficient_credits" && body.projectId && logicalTurnId) {
            const checkpointId = await saveCreditPause({
              turnId: logicalTurnId,
              projectId: body.projectId,
              userId,
              requiredCredits: priced.amount,
              baselineFiles: turnBaselineFiles,
              candidateFiles: nextFiles,
              originalRequest: lastUserContent,
              resultPayload: { summary, plan, recap, creditsCharged: 0 },
            });
            controller.enqueue(encoder.encode(sse({ type: "credits_paused", checkpointId, requiredCredits: priced.amount })));
            return;
          }
          // Single atomic settlement. `settle_build_charge` is idempotent on
          // the turn id (a retried request can never double-charge), drains
          // whatever is actually available — including the daily/monthly FREE
          // buckets a brand-new user has — and books any remainder as debt
          // instead of failing the charge and silently losing the revenue.
          await persistCommitted();
          const settleTurnId = logicalTurnId;
          if (persistError) {
            console.warn(`[credits] turn not billed: save failed project=${body.projectId ?? "none"}`);
          } else try {
            const row = await agentIO().settleCharge({
                userId,
                amount: priced.amount,
                projectId: body.projectId ?? null,
                turnId: settleTurnId ?? null,
                metadata: {
                  route: "/api/generate",
                  // Server-side classifier result; the DB derives credit
                  // purpose from it (allow-list), never from the caller.
                  operation_type: toOperationType(turnClassification.operation, { isInitial }),
                  cost_basis: priced.basis,
                  cost_usd: priced.costUsd,
                  pricing: effortEval ? "effort" : "cost_fallback",
                  effort_score: effortEval?.score ?? null,
                  unknown_calls: priced.unknownCalls,
                  cost_source: settledFrom,
                  billable_calls: billableCalls,
                  estimated_credits: buildReservation?.estimated ?? null,
                  reserved_credits: buildReservation?.reserved ?? null,
                  model,
                  is_auto_fix: false,
                },
            });
            finalCharged = Number(row?.charged ?? 0);
            const shortfall = Number(row?.shortfall ?? 0);
            if (row?.idempotent) {
              console.info(`[credits] settlement already recorded for turn ${settleTurnId}`);
            } else if (shortfall > 0) {
              // Builds never create customer debt: the uncollected part is
              // Kimble's cost, recorded internally for reconciliation.
              console.warn(`[credits] settlement capped: charged=${finalCharged} uncollected=${shortfall}`);
            }
          } catch (e) {
            console.warn("[credits] post-build settlement threw", (e as Error).message);
            await recordUnpaidBuild(userId, body.projectId ?? null, priced.amount, {
              reason: (e as Error).message,
            });
          }
        } else {
          await persistCommitted();
          console.info(
            `[credits] internal recovery turn not billed project=${body.projectId ?? "none"} amount=${priced.amount}`,
          );
        }

        // A failed save (e.g. revision_conflict) means nothing landed: the
        // project keeps its previous files AND previous revision.
        const txSaved = txCommitted && !persistError;
        if (persistError) {
          const { isRevisionConflict } = await import("@/lib/build-revision");
          nextFiles = turnBaselineFiles;
          const note = isRevisionConflict(persistError)
            ? `\n\nYour project changed while I was working, so I didn't save this change over the newer version. Your app is exactly as it was — send the request again and I'll apply it to the latest version.`
            : `\n\nI couldn't save this change, so your app was left exactly as it was. Send it again and I'll retry.`;
          summary = `${summary}${note}`;
          controller.enqueue(encoder.encode(sse({ type: "summary_delta", delta: note })));
        }

        // Internal economics record for this turn. Admin-only accounting:
        // what the customer paid next to what the turn cost Kimble, with the
        // cost explicitly marked actual / estimated / unknown. Best-effort —
        // never allowed to affect the build or the charge.
        const turnComplexity = assessExecution({
          ...turnComplexityBase,
          plannedPages: firstBuildPlan?.pages.length ?? 0,
          escalations: turnEscalations,
        });
        // The summary already rides on turnStrategy here; release the hand-off entry.
        if (turnStrategy.executionSummary) takeExecutionSummary(logicalTurnId);
        void agentIO().recordEconomics({
          execution: {
            class: turnComplexity.class,
            expectedCostUsd: turnComplexity.expectedCostUsd,
            signals: turnComplexity.signals,
            strategy: turnStrategy,
            committed: txCommitted,
            outcome: txCommitted ? "applied" : failedEditTurn ? "answered" : "failed",
            failureOrigin: txCommitted ? null : infraFailure ? "infrastructure" : "code",
            elapsedMs: Date.now() - setupStartedAt,
          },
          turnId: logicalTurnId,
          userId,
          projectId: body.projectId ?? null,
          feature: "generate",
          creditsCharged: finalCharged,
          agentRounds: agentLoopUsages.length,
          isAutoFix: Boolean(body.isAutoFix),
          result: failedEditTurn ? "no_op" : "generated",
          metadata: {
            priced_amount: priced.amount,
            internal_cost_usd: internalCostUsd,
            effort: effortEval ? { score: effortEval.score, class: effortEval.cls, parts: effortEval.parts, signals: effortEval.signals, estimated_effort: buildReservation?.estimatedEffort ?? null } : null,
            profitability: effortEval?.prof ?? null,
            economic_flags: effortEval?.flags ?? [],
            priced_cost_usd: priced.costUsd,
            priced_basis: priced.basis,
            unknown_calls: priced.unknownCalls,
            estimated_credits: buildReservation?.estimated ?? null,
            reserved_credits: buildReservation?.reserved ?? null,
            estimate_basis: buildReservation?.estimateBasis ?? null,
            model,
            // Reliability record for this turn. Counters only — never user
            // content, prompts or secrets.
            circuit_breaker: breaker.snapshot(),
          },
        });



        // (Legacy `continuation_handoff` SSE emit removed along with the
        // Continue-building chip.)

        // Cycle 1 wraps cleanly. The activity card uses this to switch the
        // sub-caption back to the success line instead of leaving the last
        // verifier message on screen.
        controller.enqueue(
          encoder.encode(sse({ type: "cycle_end", cycle: 1, outcome: txCommitted ? "clean" : "hard-stop" })),
        );

        // v3 Phase F — write-gate disclosure. A refused write is the one
        // failure the user MUST hear about: their app is intact, but the part
        // they asked for isn't there. Silence here reads as a silent no-op.
        if (txCommitted && writeGateRejections.length > 0) {
          const note = writeGateDisclosure(writeGateRejections);
          summary = `${summary}${note}`;
          controller.enqueue(encoder.encode(sse({ type: "summary_delta", delta: note })));
        }

        // Critic gate disclosure: name every op that was refused before apply.
        if (txCommitted && criticRejections.length > 0) {
          const note = criticDisclosure(criticRejections);
          summary = `${summary}${note}`;
          controller.enqueue(encoder.encode(sse({ type: "summary_delta", delta: note })));
        }

        // Honesty gate: if the model claimed edits to files that never
        // actually changed, say so instead of letting its "done!" summary
        // ship unchallenged.
        if (txCommitted && unappliedPaths.length > 0) {
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

        if (txCommitted && unlandedOps > 0 && unappliedPaths.length === 0) {
          const note =
            `\n\nHeads up — ${unlandedOps === 1 ? "one part" : `${unlandedOps} parts`} of what you asked didn't land on this pass. ` +
            `Send it again and I'll finish just that part.`;
          summary = `${summary}${note}`;
          controller.enqueue(encoder.encode(sse({ type: "summary_delta", delta: note })));
          console.warn(`[generate] ${unlandedOps} unlanded op(s) disclosed to user`);
        }

        // Bible §9 scope guard — a one-line request that rewrites half the
        // project is how features silently disappear. We don't block it (the
        // rewrite is sometimes right), we disclose it and offer the undo, so
        // the user finds out from Kimble rather than from a missing page.
        {
          const scope = analyzeEditScope(
            turnBaselineFiles,
            nextFiles,
            lastUserContent,
            editClassification?.scope,
          );

          if (txCommitted && scope.flagged) {
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
        // COMPLETENESS SAFETY GATE — success is a deterministic consequence of
        // the build state, never of an AI self-check. A first build that is
        // missing requested pages is reported as incomplete and not built.
        // DIAGNOSTIC ONLY: the commit decision above (routes gate, incl. the
        // app shell) is authoritative. This explains a rolled-back first
        // build to the user; after a commit it is empty by construction and
        // can never turn a committed/failed verdict into anything else.
        let scopeMissing: string[] = [];
        if (isInitial && nextFiles.length > 0) {
          const requested = requestedRoutesFor(lastUserText, plannedRoutes);
          const verdict = txCommitted
            ? { complete: true, missingRoutes: [] as string[] }
            : assessCompleteness({ requestedRoutes: requested, files: nextFiles });
          scopeMissing = verdict.missingRoutes;
          {
            // Derived from the authoritative verification record — no second
            // copy of the shell rule.
            const shellFinding = (txResult.verification?.gates ?? []).some((g) => g.gate === "routes" && g.verdict === "FAIL" && g.reasons.some((r) => r.startsWith("app shell")));
            if (!txCommitted && shellFinding && !scopeMissing.includes("app shell")) {
              scopeMissing = ["app shell", ...scopeMissing];
              verdict.complete = false;
            }
          }
          console.log(
            `[build-state] requested=${JSON.stringify(requested)} complete=${verdict.complete} missing=${JSON.stringify(scopeMissing)}`,
          );
          if (!verdict.complete) {
            const { describeIncomplete } = await import("@/server/engine/build-state");
            const { pageFileFor } = await import("@/server/engine/plan");
            const state = describeIncomplete({ requestedRoutes: requested, missingRoutes: scopeMissing, files: nextFiles, fileFor: pageFileFor });
            console.log(`[build-state] created=${JSON.stringify(state.created)} notCreated=${JSON.stringify(state.notCreated)} unlinked=${JSON.stringify(state.unlinked)} shellMissing=${state.shellMissing}`);
            let note = incompleteBuildMessage(scopeMissing, state);
            {
              const { providersExhaustedForTurn } = await import("@/server/turn-context.server");
              if (providersExhaustedForTurn()) {
                note += "\n\nWhy: the AI service had no available capacity to write the missing parts, so those requests couldn't run. Nothing was built or charged — send it again and I'll write only what's missing.";
              }
            }
            // A failed build's message is the state report only — never the
            // model's own "it's live" narration.
            summary = note.trim();
            controller.enqueue(encoder.encode(sse({ type: "summary_delta", delta: note })));
          } else {
            // Pages are complete, but build, browser check and publishing
            // haven't run yet: never let the message claim the site is live.
            const { neutraliseSuccessClaims } = await import("@/server/engine/build-state");
            summary = neutraliseSuccessClaims(summary ?? "");
          }
        }
        {
          const turnChanged = turnChangedPaths;
          const { providersExhaustedForTurn } = await import("@/server/turn-context.server");
          {
            const { shouldRecordMemory } = await import("@/server/context/memory-model");
            turnCommittedForMemory = shouldRecordMemory({
              committed: txSaved,
              cancelled: request.signal.aborted,
              missingScope: scopeMissing.length,
            });
          }
          // Verification pipeline — source gates (syntax, dependencies, routes).
          // Build and browser gates are added by the build callback. The record
          // names the first failing gate; UNAVAILABLE/UNKNOWN never count as FAIL.
          // The authoritative record is the one commitTurn() produced on the
          // proposed tree; it is never recomputed here from other files.
          const sourceVerification = txResult.verification ?? {
            status: "UNVERIFIED" as const,
            gates: [],
            failedGate: null,
            reason: txCommitted ? "no changed files to verify" : txResult.outcome.status === "rolled_back" ? txResult.outcome.reason : null,
            repairTargets: [],
          };
          console.info(
            `[verification] ${sourceVerification.gates.map((g) => `${g.gate}=${g.verdict}`).join(" ")} status=${sourceVerification.status}${sourceVerification.failedGate ? ` failed=${sourceVerification.failedGate}: ${sourceVerification.reason}` : ""}`,
          );
          // One inspectable record per edit turn: why each file changed and
          // why anything was considered broken — no guessing afterwards.
          if (!isInitial) {
            controller.enqueue(
              encoder.encode(
                sse({
                  // Stored with the turn for diagnosis; the client ignores it.
                  type: "edit_record",
                  outcome: scopeMissing.length === 0 ? "committed" : "not_committed",
                  record: {
                    request: lastUserContent.slice(0, 400),
                    intent: editClassification?.scope ?? null,
                    scope: resolvedTargetPaths,
                    operation: executionScope.operation,
                    mode: turnClassification.mode,
                    protectedAreas: executionScope.protectedAreas.slice(0, 20),
                    protectedTouched: turnChanged.filter((p) => executionScope.isProtected(p)),
                    verification: sourceVerification,
                    filesRead: contextFiles.map((f) => f.path).slice(0, 40),
                    filesChanged: turnChanged.slice(0, 40),
                    housekeeping: [...kitSyncedPaths].slice(0, 40),
                    appMap: turnAppMap ? appMapFacts(turnAppMap) : null,
                    recovery: recovery.history(),
                  },
                } as never),
              ),
            );
          }
          const txBlocked =
            !!persistError ||
            (!txCommitted && txResult.outcome.status === "rolled_back" && txResult.outcome.reason !== "no changes");
          emitTurnOutcome(controller, encoder, txBlocked
            ? {
                outcome: "failed",
                changedPaths: [],
                blockedPaths: txResult.rejections.map((r) => r.path).filter((p): p is string => Boolean(p)),
                reason: persistError
                  ? "commit_rejected"
                  : sourceVerification.status === "FAILED"
                    ? "verification_failed"
                    : sourceVerification.status === "UNVERIFIED" && txResult.rejections.some((r) => r.reason === "unverified")
                      ? "verification_unavailable"
                      : "commit_rejected",
              }
            : scopeMissing.length > 0
            ? { outcome: "failed", changedPaths: turnChanged, reason: "requested_scope_missing", ...(providersExhaustedForTurn() ? { cause: "providers_exhausted" } : {}) }
            : {
                outcome: turnChanged.length > 0 ? "applied" : "answered",
                changedPaths: turnChanged,
                ...(unappliedPaths.length > 0
                  ? { blockedPaths: unappliedPaths, reason: "unapplied_claims" }
                  : {}),
              });
        }

        // Product progress — re-evaluate the PRD's requirements against the
        // committed files. No build has been verified yet, so nothing can be
        // promoted to COMPLETED here (the build callback does that for the
        // current revision only). Suggestions come from what really remains.
        let productSuggestions: string[] = [];
        let productProgressOut: import("@/server/prd/prd-requirements").ProductProgress | null = null;
        if (body.projectId && resolvedPrd && txSaved && typeof committedRevision === "number") {
          try {
            const { recordRequirementEvidence } = await import("@/server/prd/prd-progress.server");
            const { continuationSuggestions, productProgress, renderProgressSummary } = await import(
              "@/server/prd/prd-requirements"
            );
            const reqs = await recordRequirementEvidence({
              projectId: body.projectId,
              build: null,
              files: nextFiles.map((f) => ({ path: f.path, content: f.content ?? "" })),
              projectRevision: committedRevision,
              turn: {
                brief: lastUserContent ?? "",
                changedPaths: turnChangedPaths,
                blockedPaths: Array.from(new Set([
                  ...unappliedPaths,
                  ...txResult.rejections.map((r) => r.path).filter((p): p is string => Boolean(p)),
                ])),
              },
            });
            if (reqs?.length) {
              productSuggestions = continuationSuggestions(reqs);
              productProgressOut = productProgress(reqs);
              if (productProgressOut.completed < productProgressOut.total) {
                const truth = renderProgressSummary(reqs, resolvedPrd.prd.productName);
                if (truth) summary = `${summary ?? ""}\n\n${truth}`.trim();
              }
            }
          } catch (e) {
            console.warn("[prd-progress] turn evaluation skipped:", e instanceof Error ? e.message : String(e));
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
              persisted: Boolean(body.projectId && txSaved && nextFiles.length > 0),
              committedRevision,
              ...(txSaved ? {} : { noFileChanges: true }),
              ...(productProgressOut ? { productProgress: productProgressOut } : {}),
              ...(backendGate.gated && backendGate.suggestions.length > 0
                ? { suggestions: backendGate.suggestions }
                : productSuggestions.length > 0
                  ? { suggestions: productSuggestions }
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

        // (AI self-check removed: success is decided only by the deterministic
        // build state. An AI opinion can never mark a build complete or not.)

        // Kill-switch: this turn produced a usable edit on the primary
        // model — record a success sample so a transient blip doesn't
        // trip the cool-off.
        recordModelOutcome(typeof model === "string" ? model : null, true);

        // Memory writer — durable outbox first, then the fast inline
        // attempt. The writer's input is saved onto the turn row BEFORE the
        // turn ends, so if this worker dies right after responding, the
        // turn-resume cron replays it and the turn is never forgotten.
        // Failures are logged inside; never block the reply or the build.
        // Notes are written only for a change that was actually kept.
        if (body.projectId && userJwt && turnCommittedForMemory) {
          void savePendingMemory(logicalTurnId, {
            userMessage: lastUserContent,
            assistantSummary: summary,
          });
          void updateProjectMemory({
            jwt: userJwt,
            projectId: body.projectId,
            userMessage: lastUserContent,
            assistantSummary: summary,
          })
            .then(async (done) => {
              if (done) await clearPendingMemory(logicalTurnId);
            })
            .catch((e) => console.warn("[project-memory] writer rejected:", e));
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
        // ("no files", "no edits", unknown). Attribute it to Kimble's own AI
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
              message: "You stopped Kimble. Send a new message when you're ready.",
              suggestions: [] as string[],
            }
          : kind === "provider_credits_exhausted"
            ? {
                // Never let the humanizer blame the prompt for OUR outage.
                message:
                  "Kimble's AI is temporarily unavailable — this is on our side, not your prompt. Nothing was charged. Please try again shortly.",
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
        // site), degrade gracefully to a normal Kimble reply instead of
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
              "That one didn't land, and nothing in your app was changed. Send it again and Kimble will pick it straight back up.",
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

/**
 * Read an `error` payload out of one complete SSE block, if that is what it
 * is. Used to hold back failures Kimble is about to retry itself.
 */
function errorPayloadOf(block: string): { message: string; raw: string } | null {
  if (!block.includes('"type":"error"')) return null;
  const data = block
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .join("");
  if (!data) return null;
  try {
    const parsed = JSON.parse(data) as { type?: string; message?: string; raw?: string };
    if (parsed.type !== "error") return null;
    return { message: parsed.message ?? "", raw: parsed.raw ?? "" };
  } catch {
    return null;
  }
}

function creditPausePayloadOf(block: string): { checkpointId: string } | null {
  if (!block.includes('"type":"credits_paused"')) return null;
  const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
  try {
    const parsed = JSON.parse(data) as { type?: string; checkpointId?: string };
    return parsed.type === "credits_paused" && parsed.checkpointId ? { checkpointId: parsed.checkpointId } : null;
  } catch {
    return null;
  }
}

/**
 * Wording for a failure the user genuinely has to know about. Never blames
 * their connection — by the time this is shown, Kimble has already decided the
 * request cannot be finished on its own.
 */
function humanizeStreamFailure(raw: string): string {
  const kind = classifyRawError(raw);
  if (kind === "credits_exhausted" || kind === "provider_credits_exhausted") {
    return raw;
  }
  return "Kimble couldn't finish this one. Nothing was charged — send it again and it'll pick up from here.";
}

export async function handleGenerateRequest(request: Request): Promise<Response> {
  // Peek auth + projectId so we can open a `turns` row BEFORE the inner
  // pipeline starts streaming. The inner core also reads the body, so we
  // clone the request to avoid consuming it twice.
  let recorder: TurnRecorderHandle | null = null;
  // Kept in scope so the terminal path can write the assistant reply itself
  // when the browser is gone (see persistAbandonedTurnReply below).
  let turnProjectId: string | null = null;
  // Owner of this turn — used to attribute every AI call it makes.
  let turnUserId: string | null = null;
  // The request we would need to re-run if this turn dies mid-generation.
  let turnUserRequest = "";
  const {
    durableAgentEnabled,
    DURABLE_TURN_HEADER,
    buildAgentJobPayload,
    dispatchAgentJob,
    ingressAcceptedResponse,
  } = await import("@/server/durable-agent.server");
  const isInternalCaller = Boolean(request.headers.get("x-petal-internal-secret"));
  const durableTurnHeader = request.headers.get(DURABLE_TURN_HEADER);
  const clone = request.clone();
  try {
    const peekAuth = await authorize(clone);
    if (typeof peekAuth === "string") {
      turnUserId = peekAuth;
      const peekBody = (await clone.json().catch(() => null)) as Body | null;
      if (peekBody?.projectId) {
        turnProjectId = peekBody.projectId;
        const msgs = (peekBody as { messages?: Array<{ role?: string; content?: unknown }> })
          .messages;
        const lastUser = Array.isArray(msgs)
          ? [...msgs].reverse().find((m) => m?.role === "user")
          : null;
        if (lastUser && typeof lastUser.content === "string") {
          turnUserRequest = lastUser.content;
        }
        // Client-minted turn id: the phone persists it before sending, so a
        // drop before the first response byte is still resumable. If a row
        // with this id already exists for this user, this request is a
        // retried send — tell the client to attach to the running turn
        // instead of starting (and charging for) a second build.
        const clientTurnId = normalizeClientTurnId(
          (peekBody as { turnId?: unknown }).turnId,
        );
        // The builder's internal call for a durable job: the ingress already
        // opened this exact row, so record into it instead of deduping.
        const attachDurable =
          isInternalCaller && !!clientTurnId && durableTurnHeader === clientTurnId;
        if (!attachDurable && clientTurnId && (await turnBelongsToUser(clientTurnId, peekAuth))) {
          return new Response("Turn already accepted", {
            status: 409,
            headers: { "x-kimble-turn-id": clientTurnId },
          });
        }
        // Durable ingress: the browser must not be the caller of the run —
        // on the live host its disconnect would kill the work. Open the turn
        // row, hand the job to the builder, and let the browser tail events.
        // The resume worker also asks for durable dispatch: a resumed long
        // build must run on the build server, not inside this request.
        const wantsDurable = !isInternalCaller || (!attachDurable && request.headers.get("x-kimble-durable-dispatch") === "1");
        if (wantsDurable && durableAgentEnabled()) {
          const turnId = clientTurnId ?? crypto.randomUUID();
          let opened: Awaited<ReturnType<typeof startTurn>>;
          try {
            opened = await startTurn({ projectId: peekBody.projectId, userId: peekAuth, turnId, heartbeat: false });
          } catch (e) {
            const taken = slotTakenResponse(e);
            if (taken) return taken;
            throw e;
          }
          const job = buildAgentJobPayload(
            request,
            opened.turnId,
            peekAuth,
            peekBody as unknown as Record<string, unknown>,
          );
          const sent = await dispatchAgentJob(job);
          if (!sent.ok) {
            console.error("[durable-agent] dispatch failed", sent.status, sent.reason);
            await opened
              .finish("failed", { errorMessage: `dispatch_failed: ${sent.reason}`.slice(0, 500) })
              .catch(() => {});
            return new Response(
              "Kimble couldn't start that build just now. Nothing was charged — please send it again.",
              { status: 503 },
            );
          }
          return ingressAcceptedResponse(opened.turnId);
        }
        try {
          recorder = await startTurn({
            projectId: peekBody.projectId,
            userId: peekAuth,
            turnId: clientTurnId,
            attach: attachDurable,
          });
        } catch (e) {
          const taken = slotTakenResponse(e);
          if (taken) return taken;
          throw e;
        }
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
            isAutoFix: Boolean(peekBody.isAutoFix),
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
    status: "succeeded" | "failed" | "aborted" | "awaiting_credits",
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
  let attemptCtx: import("@/server/turn-context.server").TurnContext | null = null;
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
        "Still working — Kimble is keeping the build connected.",
        "Reviewing the pieces and checking for build errors…",
        "Almost there — verifying everything compiles before shipping.",
        "Polishing the last few details — won't be much longer.",
      ];
      let statusIdx = 0;

      // Last `result` payload seen on the wire. Used only when the client
      // disappeared: the server then writes the assistant reply itself so the
      // thread never ends on an unanswered prompt.
      let lastResult: { summary?: string; plan?: string; recap?: string } | null = null;
      // Plan Mode short-circuit: the inner pipeline proposed a plan and ended
      // the stream on purpose. That is a COMPLETED turn waiting on the user's
      // approval — no build ran, no files changed, and the plan card on the
      // client IS the reply. The finally block below must not write a
      // "Finished this build while you were away" bubble or kick off a deploy.
      let planProposed = false;
      const recordEvent = makeSseTap((type, payload) => {
        if (type === "plan_proposed") planProposed = true;
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


      let terminalStatus: "succeeded" | "failed" | "aborted" | "awaiting_credits" = "succeeded";
      let terminalError: string | null = null;
      // Set when this turn has been queued to finish itself server-side. The
      // user is told nothing: no error card, no retry button, no "connection
      // dropped" line. The resume worker carries the request to completion.
      let silentRecovery = false;
      let unregisterCancel: (() => void) | null = null;

      /**
       * Queue the turn for silent completion when the failure is one Kimble can
       * simply run again. Returns true when the caller should stay quiet.
       */
      const recoverSilently = async (raw: string, userCancelled: boolean): Promise<boolean> => {
        if (silentRecovery) return true;
        if (!turnProjectId || !turnUserRequest) return false;
        if (!isTransientFailure(classifyRawError(raw), raw, userCancelled)) return false;
        const queued = await markInterruptedForResume({
          projectId: turnProjectId,
          userRequest: turnUserRequest,
        }).catch(() => false);
        if (!queued) return false;
        // Saved pages of this turn go with it to the resume worker.
        if (recorder?.turnId) {
          const { markCheckpointResumable } = await import("@/server/build-checkpoint.server");
          await markCheckpointResumable(recorder.turnId).catch(() => false);
        }
        silentRecovery = true;
        emit({ type: "recovering" });
        emit({ type: "status", message: "Still working — Kimble is finishing this off." });
        return true;
      };

      try {
        // Announce the turn id FIRST so the client can persist it locally
        // and use it to reconnect if the tab/phone is closed mid-build.
        if (recorder) {
          emit({ type: "turn_id", turnId: recorder.turnId });
        }
        // The message asked for a part of Kimble itself — tell the builder to
        // open it. Purely a UI hint: nothing is charged, started or written,
        // and a detection failure leaves the turn exactly as it is today.
        try {
          const surfaceSignal = detectSurfaceIntent(turnUserRequest);
          if (surfaceSignal) {
            emit({ type: "open_surface", surface: surfaceSignal.surface.id });
          }
        } catch {
          /* ignore */
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
          // A Stop that landed on another worker is picked up here too (the
          // same-worker case aborts instantly via the controller registry).
          if (recorder && !workController.signal.aborted) {
            void import("@/server/turn-cancel.server").then(async (m) => {
              if (await m.isTurnCancelled(recorder.turnId)) m.abortLocalTurn(recorder.turnId);
            });
          }
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
        // Every AI call made anywhere inside the pipeline inherits this
        // turn/project/user, so utility calls stop landing in telemetry
        // with null attribution.
        if (recorder) {
          const { registerTurnController } = await import("@/server/turn-cancel.server");
          unregisterCancel = registerTurnController(recorder.turnId, workController);
        }
        const outerCtx = currentTurnContext();
        attemptCtx = {
          // Railway runtime: keep the gateway adapters the entry attached.
          agentIO: outerCtx.agentIO ?? null,
          agentDb: outerCtx.agentDb,
          turnId: recorder?.turnId ?? null,
          projectId: turnProjectId,
          userId: turnUserId,
          attemptId: crypto.randomUUID(),
          signal: workController.signal,
          ended: false,
        };
        const response = await runWithTurnContext(
          attemptCtx,
          () =>
            handleGenerateRequestCore(request, recorder?.turnId, workController.signal, ({ message, phase }) => {
              if (phase) emit({ type: "phase", phase });
              emit({ type: "status", message });
            }),
        );
        if (!response.ok || !response.body) {
          const raw = await response.text().catch(() => `Request failed (${response.status})`);
          terminalStatus = "failed";
          terminalError = raw.slice(0, 500);
          if (!(await recoverSilently(raw, false))) {
            emit({
              type: "error",
              message: raw || "Kimble couldn't start that build. Please try again.",
              kind: classifyRawError(raw),
              raw: raw.slice(0, 500),
            });
          }
          return;
        }

        const reader = response.body.getReader();
        // The inner pipeline reports its own failures as `error` SSE events
        // rather than by throwing, so transient ones have to be caught on the
        // wire. Frame the stream into whole SSE blocks, and hold back any
        // error we are about to retry ourselves — the user should never see a
        // failure Kimble is already finishing on its own.
        const decoder = new TextDecoder();
        let sseBuffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });
          let cut = sseBuffer.indexOf("\n\n");
          while (cut !== -1) {
            const block = sseBuffer.slice(0, cut + 2);
            sseBuffer = sseBuffer.slice(cut + 2);
            const failure = errorPayloadOf(block);
            const creditPause = creditPausePayloadOf(block);
            // Authoritative terminal state: any turn_outcome of "failed" makes
            // the turn failed. Nothing downstream may report it as succeeded.
            // A build that produced nothing ("blocked" with a no-files reason)
            // is a failure too — never a "succeeded" done event.
            // ONE mapping from the authoritative turn outcome to the final
            // status. The outcome block decides; nothing else may flip a
            // failed outcome back to succeeded.
            const { turnOutcomeStatus } = await import("@/server/engine/build-state");
            const outcomeStatus = turnOutcomeStatus(block);
            if (outcomeStatus === "failed") {
              terminalStatus = "failed";
              terminalError = /"reason":\s*"([^"]+)"/.exec(block)?.[1] ?? "build incomplete";
            }
            if (creditPause) {
              terminalStatus = "awaiting_credits";
              terminalError = "Waiting for credits";
            }
            if (failure && (await recoverSilently(failure.raw || failure.message, workController.signal.aborted))) {
              terminalStatus = "failed";
              terminalError = (failure.raw || failure.message).slice(0, 500);
            } else {
              // An error the user sees ends the turn as failed — never "succeeded".
              if (failure) {
                terminalStatus = "failed";
                terminalError = (failure.raw || failure.message).slice(0, 500);
              }
              // Keep pushing even after the client is gone: the bytes still go
              // to the turn recorder, which is what a reconnecting tab replays.
              push(encoder.encode(block));
            }
            cut = sseBuffer.indexOf("\n\n");
          }
        }
        if (sseBuffer) push(encoder.encode(sseBuffer));
      } catch (e) {
        const raw = e instanceof Error ? e.message : "Generation failed.";
        const userCancelled = workController.signal.aborted;
        terminalStatus = userCancelled ? "aborted" : "failed";
        terminalError = raw.slice(0, 500);
        if (!(await recoverSilently(raw, userCancelled))) {
          emit({
            type: "error",
            message: humanizeStreamFailure(raw),
            kind: classifyRawError(raw),
            raw: raw.slice(0, 500),
          });
        }
      } finally {
        // Any AI call still logged under this attempt is background work that
        // outlived it — tagged "after_end" so it never joins a live result.
        if (attemptCtx) attemptCtx.ended = true;
        if (pingTimer) clearInterval(pingTimer);
        if (statusTimer) clearInterval(statusTimer);
        unregisterCancel?.();
        // An explicit Stop is the terminal state, whatever the inner pipeline
        // reported on its way out. Never re-queued, never built, never billed.
        if (workController.signal.aborted && terminalStatus !== "awaiting_credits") {
          terminalStatus = "aborted";
          terminalError = terminalError ?? "cancelled_by_user";
          silentRecovery = false;
        }
        // Always emit a terminal `done` event so resumers know to stop tailing.
        emit({ type: "done", status: terminalStatus });
        // Persist the terminal state before the request ends. A fire-and-forget
        // write is dropped by serverless runtimes once the response closes,
        // leaving turns permanently "running" and inviting reconnect loops.
        // NO FINAL OUTCOME WITHOUT A DURABLE RECORD. For every non-success
        // exit, the cost record and the assistant's terminal reply are written
        // while the turn is still running (the build service may only write
        // for a running turn), THEN the terminal status is persisted.
        let failureReplyWritten = false;
        if (recorder && turnUserId && terminalStatus !== "succeeded" && terminalStatus !== "awaiting_credits") {
          const { classifyFailureOrigin } = await import("@/lib/failure-classification");
          await agentIO()
            .recordEconomics({
              turnId: recorder.turnId,
              userId: turnUserId,
              projectId: turnProjectId ?? null,
              feature: "generate",
              creditsCharged: 0,
              result: terminalStatus,
              finalizeOnly: true,
              metadata: {
                terminal_status: terminalStatus,
                failure_reason: terminalError?.slice(0, 300) ?? null,
                failure_origin: terminalError ? classifyFailureOrigin(new Error(terminalError)) : null,
                // Build-level summary of the partial execution (same builder as success).
                execution_summary: takeExecutionSummary(recorder.turnId),
                customer_charge: 0,
              },
            })
            .catch(() => undefined);
          if (turnProjectId && !silentRecovery && !planProposed) {
            await new Promise((r) => setTimeout(r, 2500));
            const done = lastResult as { summary?: string; plan?: string; recap?: string; committedRevision?: number | null } | null;
            failureReplyWritten = await persistAbandonedTurnReply({
              projectId: turnProjectId,
              turnId: recorder.turnId,
              status: terminalStatus,
              summary: done?.summary ?? null,
              plan: done?.plan ?? null,
              recap: done?.recap ?? null,
              errorMessage: terminalError,
              committedRevision: done?.committedRevision ?? null,
            }).catch(() => false);
          }
        }
        await finishTurnOnce(terminalStatus, terminalError);
        // Make sure the thread always ends with an assistant reply. The client
        // normally writes it on `done`, but a dropped socket doesn't always
        // surface as an enqueue failure (buffered writes, a phone that slept,
        // a different device), so `clientGone` can be false while nobody is
        // listening. Give the client a short grace window to land its own
        // write, then reconcile from the server — the helper no-ops when a
        // reply already exists.
        if (turnProjectId && !silentRecovery && !planProposed && terminalStatus !== "awaiting_credits") {
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
        // A turn queued for silent completion must not write a reply at all:
        // the resumed run owns the conversation, and a "this didn't finish"
        // bubble is exactly what we are removing.
        if (turnProjectId && recorder && !silentRecovery && !planProposed && terminalStatus !== "awaiting_credits" && !failureReplyWritten && terminalStatus === "succeeded") {
          await new Promise((r) => setTimeout(r, 2500));
          const done = lastResult as { summary?: string; plan?: string; recap?: string; committedRevision?: number | null } | null;
          const wroteReply = await persistAbandonedTurnReply({
            projectId: turnProjectId,
            turnId: recorder.turnId,
            status: terminalStatus,
            summary: done?.summary ?? null,
            plan: done?.plan ?? null,
            recap: done?.recap ?? null,
            errorMessage: terminalError,
            committedRevision: done?.committedRevision ?? null,
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
const buildLocks = new Map<string, number>();

function buildLockKey(userId: string, projectId: string | null | undefined): string {
  return `${userId}::${projectId ?? "new"}`;
}

/**
 * Is a turn for this exact project genuinely in flight right now?
 * Also retires stale `running` rows so history stops showing phantom builds.
 */
/**
 * Another turn owns this project's generation slot: answer 409 with its id so
 * the client follows that execution (same contract as a retried send).
 */
function slotTakenResponse(e: unknown): Response | null {
  const id = (e as { name?: string; existingTurnId?: string } | null);
  if (id?.name !== "GenerationSlotTaken" || !id.existingTurnId) return null;
  return new Response("Generation already running", {
    status: 409,
    headers: { "x-kimble-turn-id": id.existingTurnId, "x-kimble-slot": "running" },
  });
}

async function hasLiveTurn(userId: string, projectId: string | null | undefined): Promise<boolean> {
  if (!projectId) return false;
  const client = supabaseAdmin;
  if (!client) return false;
  try {
    const { data } = await client
      .from("turns")
      .select("id")
      .eq("user_id", userId)
      .eq("project_id", projectId)
      .eq("status", "running")
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
                "Kimble hit an unexpected error before starting your build. No credits were charged. Please try again.",
              detail: message,
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
