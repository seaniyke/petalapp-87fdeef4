/**
 * Add-page intent detector. Mirrors seo-intent / payment-intent.
 *
 * Fires when the user (or Petal's reply) talks about needing additional
 * pages, sections that could stand alone, or classic site pages
 * (about, pricing, contact, blog, faq, services, portfolio, careers).
 *
 * The chip nudges users toward true multi-page sites — better SEO, real
 * URLs, shareable deep links — instead of a single index.tsx with hash
 * anchors. TanStack Start gives us this for free; the gap is awareness.
 */

const STRONG_SIGNALS: RegExp[] = [
  /\babout (?:us|page|section)\b/i,
  /\bpricing page\b/i,
  /\bcontact (?:us|page|form page)\b/i,
  /\bblog (?:page|index|section)?\b/i,
  /\bfaq page\b/i,
  /\bservices page\b/i,
  /\bportfolio page\b/i,
  /\bcareers? page\b/i,
  /\bteam page\b/i,
  /\bcase stud(?:y|ies)\b/i,
  /\bmulti[- ]?page\b/i,
  /\bseparate pages?\b/i,
  /\bits own page\b/i,
  /\bnew page\b/i,
  /\badd (?:an?|another) page\b/i,
  /\/(?:about|pricing|contact|blog|faq|services|portfolio|team|careers)\b/i,
];

const MIN_LENGTH = 6;

export type AddPageIntent = { detected: boolean; reason?: string };

export function detectAddPageIntent(text: string | null | undefined): AddPageIntent {
  if (!text) return { detected: false };
  const t = text.trim();
  if (t.length < MIN_LENGTH) return { detected: false };
  for (const re of STRONG_SIGNALS) {
    const m = t.match(re);
    if (m) return { detected: true, reason: m[0].toLowerCase() };
  }
  return { detected: false };
}

export function detectAddPageIntentInTurn(
  userText: string | null | undefined,
  assistantText: string | null | undefined,
): AddPageIntent {
  const a = detectAddPageIntent(userText);
  if (a.detected) return a;
  return detectAddPageIntent(assistantText);
}
