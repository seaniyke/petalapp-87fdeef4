/** Thin shim — see `src/lib/intent-registry.ts`. */
import { detectIntent, detectIntentInTurn, type IntentResult } from "./intent-registry";

export type RealtimeIntent = IntentResult;

export function detectRealtimeIntent(text: string | null | undefined): RealtimeIntent {
  return detectIntent("realtime", text);
}

export function detectRealtimeIntentInTurn(
  userText: string | null | undefined,
  assistantText: string | null | undefined,
): RealtimeIntent {
  return detectIntentInTurn("realtime", userText, assistantText);
}
