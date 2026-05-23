/** Thin shim — see `src/lib/intent-registry.ts`. */
import { detectIntent, detectIntentInTurn, type IntentResult } from "./intent-registry";

export type DomainIntent = IntentResult;

export function detectDomainIntent(text: string | null | undefined): DomainIntent {
  return detectIntent("domain", text);
}

export function detectDomainIntentInTurn(
  userText: string | null | undefined,
  assistantText: string | null | undefined,
): DomainIntent {
  return detectIntentInTurn("domain", userText, assistantText);
}
