/** Thin shim — see `src/lib/intent-registry.ts`. */
import { detectIntent, detectIntentInTurn, type IntentResult } from "./intent-registry";

export type AddPageIntent = IntentResult;

export function detectAddPageIntent(text: string | null | undefined): AddPageIntent {
  return detectIntent("addPage", text);
}

export function detectAddPageIntentInTurn(
  userText: string | null | undefined,
  assistantText: string | null | undefined,
): AddPageIntent {
  return detectIntentInTurn("addPage", userText, assistantText);
}
