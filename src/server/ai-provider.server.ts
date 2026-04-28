/**
 * AI provider abstraction.
 *
 * Every server-side AI call in Petal goes through `aiChatCompletions(...)`. The
 * helper picks a provider (Lovable AI by default, OpenRouter optional) and
 * forwards the request as an OpenAI-compatible chat completions call. The
 * caller gets back the raw `Response` so streaming code keeps working without
 * any change.
 *
 * Why this exists:
 *   - Lovable AI is convenient (key auto-provisioned, free monthly credits)
 *     but priced per token. For a heavy code-generation product like Petal,
 *     having a swappable second provider is cheap insurance.
 *   - OpenRouter is also OpenAI-compatible, gives access to Claude/DeepSeek/
 *     Llama/etc., and lets us route by feature (e.g. "code-gen on Claude,
 *     small chats on Gemini Flash").
 *
 * How to switch providers (runtime secrets):
 *   - AI_PROVIDER=openrouter            → all features go to OpenRouter
 *   - AI_PROVIDER_GENERATE=openrouter   → only `generate` feature
 *   - AI_PROVIDER_DISCUSS=lovable       → force one feature back to Lovable
 *   - (unset)                           → defaults to "lovable" everywhere
 *
 * Image generation is HARD-PINNED to Lovable AI because it relies on Gemini's
 * non-standard `message.images` response shape (nano-banana). OpenRouter's
 * image support is patchier and would silently break the feature.
 *
 * Honest caveats (read before flipping the switch):
 *   - Tool-calling shapes are mostly identical across providers but worth a
 *     smoke test per feature after switching (triage + structured outputs).
 *   - OpenRouter rate-limit / out-of-credit errors come back as 429/402 too,
 *     but the JSON body shape differs. We pass status through unchanged so
 *     existing toasts ("Rate limited", "Out of credits") still fire.
 *   - You manage OpenRouter billing + alerts yourself (their dashboard).
 */

export type AiFeature =
  | "generate"
  | "discuss"
  | "triage"
  | "coach"
  | "design"
  | "memory"
  | "recovery"
  | "preflight"
  | "image";

type Provider = "lovable" | "openrouter";

const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Optional per-feature override env var name. We read these lazily so that
 * flipping a secret doesn't require a redeploy of any consumer code.
 */
function featureOverrideEnv(feature: AiFeature): string {
  return `AI_PROVIDER_${feature.toUpperCase()}`;
}

function resolveProvider(feature: AiFeature): Provider {
  // Image gen MUST stay on Lovable AI — see file header.
  if (feature === "image") return "lovable";

  const override = process.env[featureOverrideEnv(feature)]?.toLowerCase();
  const global = process.env.AI_PROVIDER?.toLowerCase();
  const choice = override || global || "lovable";
  if (choice === "openrouter") return "openrouter";
  return "lovable";
}

/**
 * When we route to OpenRouter, the `model` string the caller passed (which is
 * tuned for Lovable AI's catalog) may not exist there 1:1. This map covers the
 * models we actually use today. Anything not in the map is forwarded as-is —
 * OpenRouter accepts most `provider/model` slugs unchanged.
 */
const OPENROUTER_MODEL_MAP: Record<string, string> = {
  // Gemini family — OpenRouter exposes Google's models under similar slugs.
  "google/gemini-3-flash-preview": "google/gemini-2.5-flash",
  "google/gemini-2.5-flash": "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite": "google/gemini-2.5-flash-lite",
  "google/gemini-2.5-pro": "google/gemini-2.5-pro",
  // OpenAI family — pass through; OpenRouter has these slugs.
  "openai/gpt-5": "openai/gpt-5",
  "openai/gpt-5-mini": "openai/gpt-5-mini",
  "openai/gpt-5-nano": "openai/gpt-5-nano",
};

function remapModelForOpenRouter(model: string | undefined): string | undefined {
  if (!model) return model;
  return OPENROUTER_MODEL_MAP[model] ?? model;
}

export interface AiCallOptions {
  /** Which Petal feature is calling — used for per-feature provider routing. */
  feature: AiFeature;
  /** OpenAI-compatible request body (messages, model, stream, tools, ...). */
  body: Record<string, unknown>;
  /** Optional AbortSignal forwarded to fetch. */
  signal?: AbortSignal;
}

/**
 * Make an OpenAI-compatible chat completions call against the resolved provider.
 *
 * Returns the raw `Response`. The caller decides whether to stream
 * (`response.body.getReader()`) or `await response.json()`.
 *
 * Errors are NOT thrown for non-2xx — caller inspects `response.status` so it
 * can surface the existing 402/429 toasts.
 */
export async function aiChatCompletions(opts: AiCallOptions): Promise<Response> {
  const provider = resolveProvider(opts.feature);

  let url: string;
  let apiKey: string | undefined;
  let body = opts.body;

  if (provider === "openrouter") {
    url = OPENROUTER_URL;
    apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      // Fail loud rather than silently falling back — operators should notice.
      throw new Error(
        "OPENROUTER_API_KEY is not configured. Either add the secret or set AI_PROVIDER back to 'lovable'.",
      );
    }
    const remapped = remapModelForOpenRouter(body.model as string | undefined);
    if (remapped !== body.model) {
      body = { ...body, model: remapped };
    }
  } else {
    url = LOVABLE_URL;
    apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      throw new Error("LOVABLE_API_KEY is not configured.");
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  // OpenRouter politely asks for these to attribute traffic. Harmless if absent.
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = process.env.OPENROUTER_REFERER || "https://buildwithpetal.com";
    headers["X-Title"] = "Petal";
  }

  return fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: opts.signal,
  });
}

/** Exposed for diagnostics / admin tooling. */
export function currentProviderFor(feature: AiFeature): Provider {
  return resolveProvider(feature);
}
