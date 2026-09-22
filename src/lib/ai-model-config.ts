/**
 * CENTRAL AI MODEL CONFIGURATION — single source of truth.
 *
 * Kimble routes 100% of its AI traffic through OpenRouter. There are no
 * direct provider integrations (OpenAI / Anthropic / Google / DeepSeek
 * first-party APIs) and no Lovable AI Gateway chat path.
 *
 *     Kimble  →  OpenRouter  →  DeepSeek
 *
 * To change the model used everywhere, change the constants below (or set the
 * matching environment variable). No other file needs to be touched.
 *
 * NOTE: `openrouter/auto` is deliberately never used — the model must always
 * be explicit so cost and behaviour are predictable.
 */

/** OpenRouter OpenAI-compatible chat endpoint. */
export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Default text model for every Kimble AI operation.
 * Cheapest DeepSeek model on OpenRouter that supports tool calling
 * (required by the generation protocol) — $0.089/M in, $0.177/M out, 1M ctx.
 */
export const DEFAULT_TEXT_MODEL = "deepseek/deepseek-v4-flash";

/**
 * Used when the request contains image parts (screenshots for visual QA,
 * user-uploaded references). The default text model is text-only.
 */
export const DEFAULT_VISION_MODEL = "deepseek/deepseek-v4-flash-vision-exp";

/** Single bounded retry target when the primary model errors. */
export const DEFAULT_FALLBACK_MODEL = "deepseek/deepseek-v3.2";

/**
 * Image GENERATION model. DeepSeek has no image-output model, so this stays
 * on the cheapest image model available *through OpenRouter* — still
 * OpenRouter-only, no direct Google API call.
 */
export const DEFAULT_IMAGE_MODEL = "google/gemini-2.5-flash-image";

/**
 * Utility tier — short classification / summarisation calls (triage, preflight,
 * phase classification, memory, titles, error humanising). They read a small
 * prompt and emit a few hundred tokens, so the cheapest tool-capable DeepSeek
 * input price wins. $0.040/M in (vs $0.089/M on the build model), 1.3M ctx.
 */
export const DEFAULT_UTILITY_MODEL = "deepseek/deepseek-v4-flash-0731";

/** Cost guard: hard ceiling on output tokens for short utility calls. */
export const UTILITY_MAX_OUTPUT_TOKENS = 1024;


function env(name: string): string | undefined {
  if (typeof process === "undefined" || !process.env) return undefined;
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

/** Resolved default text model (env override wins). */
export function defaultTextModel(): string {
  return env("OPENROUTER_MODEL") ?? DEFAULT_TEXT_MODEL;
}

/** Resolved vision model (env override wins). */
export function defaultVisionModel(): string {
  return env("OPENROUTER_VISION_MODEL") ?? DEFAULT_VISION_MODEL;
}

/** Resolved fallback model (env override wins). */
export function defaultFallbackModel(): string {
  return env("OPENROUTER_FALLBACK_MODEL") ?? DEFAULT_FALLBACK_MODEL;
}

/** Resolved image-generation model (env override wins). */
export function defaultImageModel(): string {
  return env("OPENROUTER_IMAGE_MODEL") ?? DEFAULT_IMAGE_MODEL;
}

/** True for any model slug served by DeepSeek on OpenRouter. */
export function isDeepSeekModel(model: string | null | undefined): boolean {
  return !!model && model.startsWith("deepseek/");
}

/**
 * Coerce ANY model id a caller/DB/legacy constant asks for into the
 * configured DeepSeek model. Historic call sites hardcode Gemini/Claude/GPT
 * slugs; rather than editing 35 files (and risking a missed one), every
 * request is normalised here, at the single chokepoint.
 */
export function coerceToConfiguredModel(
  requested: string | null | undefined,
  opts?: { vision?: boolean },
): string {
  const vision = opts?.vision === true;
  if (isDeepSeekModel(requested)) {
    // A DeepSeek text model cannot read images — upgrade only in that case.
    if (vision && !/vision/.test(requested!)) return defaultVisionModel();
    return requested!;
  }
  return vision ? defaultVisionModel() : defaultTextModel();
}
