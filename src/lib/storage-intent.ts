/** Thin shim — see `src/lib/intent-registry.ts`. */
import { detectIntent, detectIntentInTurn, type IntentResult } from "./intent-registry";

export type StorageIntent = IntentResult;

export function detectStorageIntent(text: string | null | undefined): StorageIntent {
  return detectIntent("storage", text);
}

export function detectStorageIntentInTurn(
  userText: string | null | undefined,
  assistantText: string | null | undefined,
): StorageIntent {
  return detectIntentInTurn("storage", userText, assistantText);
}
