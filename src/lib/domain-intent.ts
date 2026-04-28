/**
 * Lightweight, regex-based domain-intent detector. Mirrors backend-intent.ts
 * but for "user wants a custom domain" signals. Runs client-side over the
 * latest user message + the assistant's reply so we can show a "Want a custom
 * domain?" suggestion chip inline in the chat.
 *
 * Cheap and dismissible — false positives are fine.
 */

const STRONG_SIGNALS = [
  /\bcustom domain\b/i,
  /\bown domain\b/i,
  /\bmy domain\b/i,
  /\b(?:buy|purchase|register|get) (?:a |an )?domain\b/i,
  /\bdomain name\b/i,
  /\b(?:connect|add|hook up|point|link) (?:a |my |the )?(?:custom )?domain\b/i,
  /\b(?:use|set up|setup) (?:a |my )?(?:custom )?domain\b/i,
  /\b(?:godaddy|namecheap|porkbun|squarespace|google ?domains|cloudflare registrar)\b/i,
  /\b[a-z0-9-]+\.(?:com|net|org|io|app|dev|co|xyz|me|ai|so|store|shop|tech|site|online|info|biz)\b/i,
  /\bDNS (?:records?|setup|config(?:uration)?)\b/i,
  /\b(?:CNAME|A record|nameservers?)\b/i,
  /\bpoint (?:my )?domain (?:to|at)\b/i,
  /\bsubdomain\b/i,
  /\b(?:www\.)?[a-z0-9-]+\.(?:com|net|org|io|app|dev|co)\s*(?:to|→|->)/i,
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
