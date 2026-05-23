/**
 * Thin shim — actual regex list lives in `src/lib/intent-registry.ts`.
 * Kept so existing call sites (`detectBackendIntent` / `detectBackendIntentInTurn`)
 * keep working without churn.
 */
import { detectIntent, detectIntentInTurn, type IntentResult } from "./intent-registry";

export type BackendIntent = IntentResult;

export function detectBackendIntent(text: string | null | undefined): BackendIntent {
  return detectIntent("backend", text);
}

export function detectBackendIntentInTurn(
  userText: string | null | undefined,
  assistantText: string | null | undefined,
): BackendIntent {
  return detectIntentInTurn("backend", userText, assistantText);
}
