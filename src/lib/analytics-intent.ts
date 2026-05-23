/** Thin shim — see `src/lib/intent-registry.ts`. */
import { detectIntent, detectIntentInTurn, type IntentResult } from "./intent-registry";

export type AnalyticsIntent = IntentResult;

export function detectAnalyticsIntent(text: string | null | undefined): AnalyticsIntent {
  return detectIntent("analytics", text);
}

export function detectAnalyticsIntentInTurn(
  userText: string | null | undefined,
  assistantText: string | null | undefined,
): AnalyticsIntent {
  return detectIntentInTurn("analytics", userText, assistantText);
}
