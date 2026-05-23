/** Thin shim — see `src/lib/intent-registry.ts`. */
import { detectIntent, detectIntentInTurn, type IntentResult } from "./intent-registry";

export type SeoIntent = IntentResult;

export function detectSeoIntent(text: string | null | undefined): SeoIntent {
  return detectIntent("seo", text);
}

export function detectSeoIntentInTurn(
  userText: string | null | undefined,
  assistantText: string | null | undefined,
): SeoIntent {
  return detectIntentInTurn("seo", userText, assistantText);
}
