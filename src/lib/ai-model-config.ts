/**
 * CENTRAL AI MODEL CONFIGURATION — single source of truth.
 *
 * Kimble routes 100% of its AI traffic through the Lovable AI Gateway.
 * There are no direct provider integrations (OpenAI / Anthropic / Google /
 * DeepSeek first-party APIs) and no OpenRouter path.
 *
 *     Kimble  →  Lovable AI Gateway  →  configured model
 *
 * To change the model used everywhere, change the constants below (or set the
 * matching environment variable). No other file needs to be touched.
 *
 * NOTE: the model must always be explicit so cost and behaviour are
 * predictable — no "auto" routing.
 */

/** Lovable AI Gateway OpenAI-compatible chat endpoint. */
export const AI_GATEWAY_CHAT_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

/** Lovable AI Gateway base URL (images, transcription, etc.). */
export const AI_GATEWAY_BASE_URL = "https://ai.gateway.lovable.dev/v1";

/**
 * Default text model for every Kimble AI operation.
 * Current Gemini flash on the gateway: tool calling (required by the
 * generation protocol), native vision, 3 credits/M in, 15 credits/M out.
 */
export const DEFAULT_TEXT_MODEL = "google/gemini-3.8-flash";

/**
 * Used when the request contains image parts (screenshots for visual QA,
 * user-uploaded references). The default text model already accepts images,
 * so vision and text share one model.
 */
export const DEFAULT_VISION_MODEL = "google/gemini-3.8-flash";

/**
 * First-build tier — the frontier Gemini model writes the initial app (whole
 * schema, every page, relationships) where deeper reasoning pays off once.
 * Follow-up edits stay on DEFAULT_TEXT_MODEL for speed and cost.
 * Same chat-completions tool protocol as the flash model (verified live).
 */
export const DEFAULT_FIRST_BUILD_MODEL = "google/gemini-4-argon";

/** Single bounded retry target when the primary model errors. */
export const DEFAULT_FALLBACK_MODEL = "openai/gpt-5.6-sol";

/**
 * Image GENERATION model — the gateway's default image model
 * (OpenAI images request format).
 */
export const DEFAULT_IMAGE_MODEL = "openai/gpt-image-2.5-sunburst";

/** Speech-to-text model for the transcription route. */
export const DEFAULT_TRANSCRIBE_MODEL = "openai/gpt-transcribe";

/**
 * Utility tier — short classification / summarisation calls (triage, preflight,
 * phase classification, memory, titles, error humanising). They read a small
 * prompt and emit a few hundred tokens, so the cheapest tool-capable model
 * wins: 1 credit/M in (vs 3 on the build model).
 */
export const DEFAULT_UTILITY_MODEL = "google/gemini-3.1-flash-lite";

/** Cost guard: hard ceiling on output tokens for short utility calls. */
export const UTILITY_MAX_OUTPUT_TOKENS = 1024;

/** Output budget for byte-level stream continuation (finishing a cut-off file). */
export const CONTINUATION_MAX_OUTPUT_TOKENS = 6000;



function env(name: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

/** Resolved default text model (env override wins). */
export function defaultTextModel(): string {
  return env("AI_GATEWAY_MODEL") ?? DEFAULT_TEXT_MODEL;
}

/** Resolved first-build model (env override wins). */
export function defaultFirstBuildModel(): string {
  return env("AI_GATEWAY_FIRST_BUILD_MODEL") ?? DEFAULT_FIRST_BUILD_MODEL;
}

/** Resolved vision model (env override wins). */
export function defaultVisionModel(): string {
  return env("AI_GATEWAY_VISION_MODEL") ?? DEFAULT_VISION_MODEL;
}

/** Resolved fallback model (env override wins). */
export function defaultFallbackModel(): string {
  return env("AI_GATEWAY_FALLBACK_MODEL") ?? DEFAULT_FALLBACK_MODEL;
}

/** Resolved image-generation model (env override wins). */
export function defaultImageModel(): string {
  return env("AI_GATEWAY_IMAGE_MODEL") ?? DEFAULT_IMAGE_MODEL;
}

/** Resolved transcription model (env override wins). */
export function defaultTranscribeModel(): string {
  return env("AI_GATEWAY_TRANSCRIBE_MODEL") ?? DEFAULT_TRANSCRIBE_MODEL;
}

/** Resolved utility-tier model (env override wins). */
export function defaultUtilityModel(): string {
  return env("AI_GATEWAY_UTILITY_MODEL") ?? DEFAULT_UTILITY_MODEL;
}

/**
 * Features whose calls are short classification / summarisation work rather
 * than code generation. They run on the cheaper utility model and have their
 * output capped at UTILITY_MAX_OUTPUT_TOKENS.
 */
export const UTILITY_FEATURES: ReadonlySet<string> = new Set([
  "triage",
  "preflight",
  "memory",
  "coach",
  "recovery",
]);

export function isUtilityFeature(feature: string | null | undefined): boolean {
  return !!feature && UTILITY_FEATURES.has(feature);
}

/**
 * Difficulty-based routing for code-writing turns. Hard work (site-wide or
 * multi-part changes, structural rewrites, long briefs) gets the frontier
 * model; everything else gets the fast code model. The utility model never
 * writes code.
 */
/** micro = one small in-place change (copy, one style); it gets the narrow
 * one-file context and the fast code model. */
export type TaskDifficulty = "micro" | "standard" | "hard";

export function classifyTaskDifficulty(s: {
  scope?: "micro" | "targeted" | "structural" | null;
  crossCutting?: boolean;
  multiEdit?: boolean;
  promptChars?: number;
}): TaskDifficulty {
  if (s.crossCutting || s.multiEdit || s.scope === "structural") return "hard";
  if ((s.promptChars ?? 0) > 1500) return "hard";
  if (s.scope === "micro" && (s.promptChars ?? 0) <= 400) return "micro";
  return "standard";
}

export function modelForDifficulty(d: TaskDifficulty): string {
  return d === "hard" ? defaultFirstBuildModel() : defaultTextModel();
}

/**
 * Model ids Kimble itself configures on the gateway. A caller-supplied id
 * inside this set is honoured as-is; anything else (legacy hardcoded
 * Gemini/Claude/GPT/DeepSeek slugs, stale admin overrides) is coerced to the
 * configured default at the single chokepoint.
 */
export const CONFIGURED_MODEL_IDS: ReadonlySet<string> = new Set([
  DEFAULT_TEXT_MODEL,
  DEFAULT_FIRST_BUILD_MODEL,
  DEFAULT_VISION_MODEL,
  DEFAULT_FALLBACK_MODEL,
  DEFAULT_UTILITY_MODEL,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_TRANSCRIBE_MODEL,
]);

/** True when the id is one of Kimble's configured gateway models. */
export function isConfiguredModel(model: string | null | undefined): boolean {
  return !!model && CONFIGURED_MODEL_IDS.has(model);
}

/**
 * Coerce ANY model id a caller/DB/legacy constant asks for into a configured
 * gateway model. Historic call sites hardcode Gemini/Claude/GPT/DeepSeek
 * slugs; rather than editing 35 files (and risking a missed one), every
 * request is normalised here, at the single chokepoint.
 *
 * `utility: true` routes short classification work to the cheaper utility
 * model — unless the request needs vision, or the caller explicitly asked for
 * one of the configured models.
 */
export function coerceToConfiguredModel(
  requested: string | null | undefined,
  opts?: { vision?: boolean; utility?: boolean },
): string {
  const vision = opts?.vision === true;
  if (isConfiguredModel(requested)) {
    // The utility model is text-only — upgrade only in that case.
    if (vision && requested === defaultUtilityModel()) return defaultVisionModel();
    return requested!;
  }
  if (vision) return defaultVisionModel();
  if (opts?.utility === true) return defaultUtilityModel();
  return defaultTextModel();
}


/**
 * Inference evaluation (NOT production). Model chain under test, one model
 * per call (the gateway has no multi-model fallback array). Enabled only for
 * the bench account with the eval header.
 */
export const INFERENCE_EVAL_HEADER = "x-kimble-inference-eval";
export const INFERENCE_EVAL_USER_IDS = ["42b3c128-bd12-4c94-8d71-e4ae8f5a2a53"] as const;
export const INFERENCE_EVAL_MODELS = [
  "google/gemini-3.8-flash",
  "google/gemini-4-argon",
  "openai/gpt-5.6-sol",
] as const;
