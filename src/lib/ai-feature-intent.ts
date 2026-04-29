/**
 * AI-feature intent detector. Triggers when the user wants to ADD an AI
 * capability to THEIR app (chatbot, summarizer, translator, image gen).
 *
 * Critical purpose: prevent Petal from asking the user for an OpenAI / Claude
 * key when our Lovable AI Gateway already handles it for free.
 *
 * Heuristic: provider names alone aren't enough (the user might just be
 * comparing tools). Require an "add / build / integrate" verb nearby OR
 * a clear AI-feature verb like "summarize", "translate", "generate".
 */

const FEATURE_VERBS: RegExp[] = [
  /\b(?:add|build|integrate|wire (?:up|in)|set up|setup|implement) (?:an? )?(?:AI|chatbot|assistant|copilot|agent)/i,
  /\b(?:add|build|integrate|wire (?:up|in)|set up|setup|implement) (?:an? )?(?:chat|chatbot|assistant)\b/i,
  /\b(?:summari[sz]e|translate|paraphrase|rewrite|classify|extract|transcribe|moderate|generate|caption) (?:the |a |this |these )?(?:text|content|article|email|image|images?|audio|file|comment|review|message)/i,
  /\bAI[- ]powered\b/i,
  /\bask (?:an? )?AI\b/i,
  /\b(?:LLM|large language model)\b/i,
  /\b(?:image|text|content|copy) generation\b/i,
  /\b(?:auto|automatically) (?:summari[sz]e|translate|tag|caption|reply|respond)/i,
  /\bsemantic search\b/i,
  /\bembeddings?\b/i,
];

/** Provider mentions only count when paired with an action verb. */
const PROVIDER_NAMES =
  /\b(?:OpenAI|GPT-?[345]|ChatGPT|Claude|Anthropic|Gemini|Google AI|Mistral|Llama|DeepSeek|Perplexity)\b/i;
const ACTION_VERBS =
  /\b(?:add|build|integrate|use|wire|set ?up|connect|call|hook (?:up|into)|via|with|using)\b/i;

const MIN_LENGTH = 8;

export type AiFeatureIntent = { detected: boolean; reason?: string };

export function detectAiFeatureIntent(text: string | null | undefined): AiFeatureIntent {
  if (!text) return { detected: false };
  const t = text.trim();
  if (t.length < MIN_LENGTH) return { detected: false };

  for (const re of FEATURE_VERBS) {
    const m = t.match(re);
    if (m) return { detected: true, reason: m[0].toLowerCase() };
  }
  if (PROVIDER_NAMES.test(t) && ACTION_VERBS.test(t)) {
    const provider = t.match(PROVIDER_NAMES)?.[0]?.toLowerCase();
    return { detected: true, reason: provider ? `use ${provider}` : "use AI" };
  }
  return { detected: false };
}

export function detectAiFeatureIntentInTurn(
  userText: string | null | undefined,
  assistantText: string | null | undefined,
): AiFeatureIntent {
  const a = detectAiFeatureIntent(userText);
  if (a.detected) return a;
  return detectAiFeatureIntent(assistantText);
}
