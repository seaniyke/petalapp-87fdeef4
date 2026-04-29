/**
 * Analytics intent detector. Triggers when the user wants visitor / page-view
 * tracking — Petal already has a Plausible integration but never proactively
 * surfaces it.
 */

const STRONG_SIGNALS: RegExp[] = [
  /\b(?:track|tracking) (?:visitors?|users?|page ?views?|clicks?|events?|conversions?)\b/i,
  /\b(?:visitor|page ?view|click|event|conversion) (?:tracking|analytics)\b/i,
  /\banalytics (?:dashboard|integration|tool|service|provider)?\b/i,
  /\b(?:plausible|posthog|mixpanel|amplitude|fathom|umami|simple ?analytics)\b/i,
  /\bgoogle analytics\b/i,
  /\bGA4?\b/,
  /\bheatmaps?\b/i,
  /\bfunnel(?:s| analysis)\b/i,
  /\bA\/?B test(?:ing|s)?\b/i,
  /\bsee (?:how many|who) (?:visit|visited|viewed|using)\b/i,
  /\bmeasure (?:traffic|engagement|usage)\b/i,
];

const MIN_LENGTH = 6;

export type AnalyticsIntent = { detected: boolean; reason?: string };

export function detectAnalyticsIntent(text: string | null | undefined): AnalyticsIntent {
  if (!text) return { detected: false };
  const t = text.trim();
  if (t.length < MIN_LENGTH) return { detected: false };
  for (const re of STRONG_SIGNALS) {
    const m = t.match(re);
    if (m) return { detected: true, reason: m[0].toLowerCase() };
  }
  return { detected: false };
}

export function detectAnalyticsIntentInTurn(
  userText: string | null | undefined,
  assistantText: string | null | undefined,
): AnalyticsIntent {
  const a = detectAnalyticsIntent(userText);
  if (a.detected) return a;
  return detectAnalyticsIntent(assistantText);
}
