/**
 * SEO intent detector. Mirrors the email/payment intent pattern.
 * Triggers when the user mentions search ranking, share previews, meta tags,
 * sitemap, etc. — areas where AI builders famously ship broken-by-default
 * pages and a whole side-business has emerged to fix them.
 */

const STRONG_SIGNALS: RegExp[] = [
  /\bSEO\b/i,
  /\bsearch engine\b/i,
  /\b(?:rank|ranking) (?:on |in )?Google\b/i,
  /\bgoogle (?:indexing|index|search|results)\b/i,
  /\bget(?:ting)? indexed\b/i,
  /\bmeta (?:tags?|description|title)\b/i,
  /\bopen ?graph\b/i,
  /\bog (?:image|tags?|title)\b/i,
  /\bshare (?:preview|card|image)\b/i,
  /\bsocial (?:preview|card|sharing)\b/i,
  /\btwitter card\b/i,
  /\bsitemap(?:\.xml)?\b/i,
  /\brobots\.txt\b/i,
  /\bcanonical (?:url|tag)\b/i,
  /\bstructured data\b/i,
  /\bJSON-?LD\b/i,
  /\bschema\.org\b/i,
  /\bdiscoverab(?:le|ility)\b/i,
];

const MIN_LENGTH = 6;

export type SeoIntent = { detected: boolean; reason?: string };

export function detectSeoIntent(text: string | null | undefined): SeoIntent {
  if (!text) return { detected: false };
  const t = text.trim();
  if (t.length < MIN_LENGTH) return { detected: false };
  for (const re of STRONG_SIGNALS) {
    const m = t.match(re);
    if (m) return { detected: true, reason: m[0].toLowerCase() };
  }
  return { detected: false };
}

export function detectSeoIntentInTurn(
  userText: string | null | undefined,
  assistantText: string | null | undefined,
): SeoIntent {
  const a = detectSeoIntent(userText);
  if (a.detected) return a;
  return detectSeoIntent(assistantText);
}
