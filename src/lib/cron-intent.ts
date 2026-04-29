/**
 * Scheduled-jobs / cron intent detector. Triggers when the user describes
 * recurring or background work — needs pg_cron + an API route.
 */

const STRONG_SIGNALS: RegExp[] = [
  /\b(?:every|each) (?:minute|hour|day|night|morning|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(?:daily|nightly|weekly|monthly|hourly) (?:digest|email|report|summary|reminder|sync|backup|cleanup|job|cron|task)\b/i,
  /\b(?:scheduled|schedule a|recurring) (?:email|job|task|reminder|report|notification|digest)\b/i,
  /\b(?:cron|cronjob|cron job|pg_?cron)\b/i,
  /\bbackground (?:job|task|worker|process)\b/i,
  /\b(?:auto|automatically) (?:send|email|notify|reset|clean ?up|expire|archive|sync|run)/i,
  /\b(?:reminder|digest) (?:email|notification)s?\b/i,
  /\brun (?:this |the |a )?(?:job|task|script) (?:every|once|on a schedule|periodically)/i,
  /\bperiodic(?:ally)?\b/i,
];

const MIN_LENGTH = 8;

export type CronIntent = { detected: boolean; reason?: string };

export function detectCronIntent(text: string | null | undefined): CronIntent {
  if (!text) return { detected: false };
  const t = text.trim();
  if (t.length < MIN_LENGTH) return { detected: false };
  for (const re of STRONG_SIGNALS) {
    const m = t.match(re);
    if (m) return { detected: true, reason: m[0].toLowerCase() };
  }
  return { detected: false };
}

export function detectCronIntentInTurn(
  userText: string | null | undefined,
  assistantText: string | null | undefined,
): CronIntent {
  const a = detectCronIntent(userText);
  if (a.detected) return a;
  return detectCronIntent(assistantText);
}
