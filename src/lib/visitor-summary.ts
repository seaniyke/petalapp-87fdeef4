/**
 * Turns Petal's build narration ("I've scaffolded a professional, multi-page
 * website for your construction company…") into copy a *visitor* enjoys
 * reading ("A professional, multi-page website for a construction company…").
 *
 * Used on public surfaces: the gallery, project pages and their meta tags.
 */

const OPENERS =
  /^\s*(?:okay|alright|sure|done|great)?[,!.\s]*(?:(?:i|we)(?:'|’)?(?:ve| have)?\s+)?(?:just\s+)?(?:now\s+)?(?:built|created|scaffolded|set\s+up|made|designed|generated|added|put\s+together|shipped|whipped\s+up)\s+(?:you\s+|for\s+you\s+)?/i;

export function toVisitorSummary(
  summary?: string | null,
  title?: string | null,
): string {
  const raw = (summary ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return fallback(title);

  let text = raw.replace(OPENERS, "");
  if (text === raw) {
    // No build-narration opener — still scrub stray first person.
    text = text.replace(/^\s*(?:here(?:'|’)?s|this is)\s+/i, "");
  }

  text = text
    .replace(/\bfor your\b/gi, "for a")
    .replace(/\byour\b/gi, "the")
    .replace(/\byours\b/gi, "theirs")
    .replace(/\bI(?:'|’)?ve\b/g, "It has")
    .replace(/\bI\b/g, "It")
    .replace(/\bwe(?:'|’)?ve\b/gi, "It has")
    .trim();

  if (!text) return fallback(title);

  // Re-add an article when the sentence now starts with an adjective/noun.
  if (/^(?:a|an|the)\b/i.test(text) === false && /^[a-z]/.test(text)) {
    text = `A ${text}`;
  }
  text = text.charAt(0).toUpperCase() + text.slice(1);
  if (!/[.!?…]$/.test(text)) text += ".";
  return text;
}

function fallback(title?: string | null): string {
  return title
    ? `${title} — a live app built with Petal. Open it, or remix it into your own.`
    : "A live app built with Petal. Open it, or remix it into your own.";
}
