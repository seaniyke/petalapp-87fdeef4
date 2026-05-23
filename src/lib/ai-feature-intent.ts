/** Thin shim — see `src/lib/intent-registry.ts`. */
import { detectIntent, detectIntentInTurn, type IntentResult } from "./intent-registry";

export type AiFeatureIntent = IntentResult;

export function detectAiFeatureIntent(text: string | null | undefined): AiFeatureIntent {
  return detectIntent("aiFeature", text);
}

export function detectAiFeatureIntentInTurn(
  userText: string | null | undefined,
  assistantText: string | null | undefined,
): AiFeatureIntent {
  return detectIntentInTurn("aiFeature", userText, assistantText);
}
