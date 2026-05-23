/** Thin shim — see `src/lib/intent-registry.ts`. */
import { detectIntent, detectIntentInTurn, type IntentResult } from "./intent-registry";

export type EmailIntent = IntentResult;

export function detectEmailIntent(text: string | null | undefined): EmailIntent {
  return detectIntent("email", text);
}

export function detectEmailIntentInTurn(
  userText: string | null | undefined,
  assistantText: string | null | undefined,
): EmailIntent {
  return detectIntentInTurn("email", userText, assistantText);
}
