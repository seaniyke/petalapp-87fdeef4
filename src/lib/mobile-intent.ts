/** Thin shim — see `src/lib/intent-registry.ts`. */
import { detectIntent, detectIntentInTurn, type IntentResult } from "./intent-registry";

export type MobileIntent = IntentResult;

export function detectMobileIntent(text: string | null | undefined): MobileIntent {
  return detectIntent("mobile", text);
}

export function detectMobileIntentInTurn(
  userText: string | null | undefined,
  assistantText: string | null | undefined,
): MobileIntent {
  return detectIntentInTurn("mobile", userText, assistantText);
}
