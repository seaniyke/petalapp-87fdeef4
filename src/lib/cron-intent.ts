/** Thin shim — see `src/lib/intent-registry.ts`. */
import { detectIntent, detectIntentInTurn, type IntentResult } from "./intent-registry";

export type CronIntent = IntentResult;

export function detectCronIntent(text: string | null | undefined): CronIntent {
  return detectIntent("cron", text);
}

export function detectCronIntentInTurn(
  userText: string | null | undefined,
  assistantText: string | null | undefined,
): CronIntent {
  return detectIntentInTurn("cron", userText, assistantText);
}
