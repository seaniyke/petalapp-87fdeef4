/** Thin shim — see `src/lib/intent-registry.ts`. */
import { detectIntent, detectIntentInTurn, type IntentResult } from "./intent-registry";

export type PaymentIntent = IntentResult;

export function detectPaymentIntent(text: string | null | undefined): PaymentIntent {
  return detectIntent("payment", text);
}

export function detectPaymentIntentInTurn(
  userText: string | null | undefined,
  assistantText: string | null | undefined,
): PaymentIntent {
  return detectIntentInTurn("payment", userText, assistantText);
}
