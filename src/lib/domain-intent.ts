/**
 * Lightweight, regex-based domain-intent detector. Mirrors backend-intent.ts
 * but for "user wants a custom domain" signals. Runs client-side over the
 * latest user message + the assistant's reply so we can show a "Want a custom
 * domain?" suggestion chip inline in the chat.
 *
 * Cheap and dismissible — false positives are fine.
 */

// Only fire on explicit, unambiguous intent. We deliberately avoid matching
// bare domain mentions like "reactjs.org" — those almost always refer to a
// third-party site, not something the user wants to connect or buy.
const STRONG_SIGNALS = [
  /\bcustom domain\b/i,
  /\bown domain\b/i,
  /\bmy (?:own )?domain\b/i,
  /\b(?:buy|purchase|register) (?:a |an |my )?(?:custom |new )?domain\b/i,
  /\b(?:connect|hook up|point|link) (?:a |my |the )?(?:custom )?domain\b/i,
  /\b(?:use|set up|setup) (?:a |my )?(?:custom )?domain\b/i,
  /\bDNS (?:records?|setup|config(?:uration)?)\b/i,
  /\bnameservers?\b/i,
  /\bpoint (?:my )?domain (?:to|at)\b/i,
];

const MIN_LENGTH = 8;

export type DomainIntent = {
  detected: boolean;
  /** Short reason for the chip tooltip ("buy domain", "connect domain"). */
  reason?: string;
};

export function detectDomainIntent(text: string | null | undefined): DomainIntent {
  if (!text) return { detected: false };
  const t = text.trim();
  if (t.length < MIN_LENGTH) return { detected: false };

  for (const re of STRONG_SIGNALS) {
    const m = t.match(re);
    if (m) return { detected: true, reason: m[0].toLowerCase() };
  }
  return { detected: false };
}

export function detectDomainIntentInTurn(
  userText: string | null | undefined,
  assistantText: string | null | undefined,
): DomainIntent {
  const a = detectDomainIntent(userText);
  if (a.detected) return a;
  return detectDomainIntent(assistantText);
}
