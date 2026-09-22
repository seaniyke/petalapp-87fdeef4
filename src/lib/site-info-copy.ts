/**
 * Pure copy helpers for a project's published website info.
 *
 * Kimble narrates its build summaries in first person ("I've built the core of
 * your Due Date Companion!"). That voice must never leak into a page's
 * <meta description>, so everything here rewrites it into app-facing copy.
 */

const NARRATION =
  /^\s*(i(?:'|’)?ve|i have|i|we(?:'|’)?ve|we)\s+(just\s+)?(built|created|scaffolded|set\s?up|made|added|updated|shipped|put together)\b[^.!?]*[.!?]\s*/i;

/** True when the text reads like Kimble talking about its own work. */
export function isAssistantNarration(text: string): boolean {
  return /\b(i(?:'|’)?ve|i have|i've|i built|i created|i added)\b/i.test(text.slice(0, 160));
}

/** Strips assistant narration and returns app-facing description copy. */
export function describeAppFallback(source: string): string {
  let text = (source || "").replace(/\s+/g, " ").trim();
  // Drop leading "I've built …" style sentences until something neutral remains.
  for (let i = 0; i < 3 && NARRATION.test(text); i += 1) {
    text = text.replace(NARRATION, "").trim();
  }
  text = text
    .replace(/^(you can now|now you can|your app|this app)\s+/i, "")
    .replace(/\byour\b/gi, "your")
    .trim();
  if (!text) return "";
  if (text.length > 155) text = `${text.slice(0, 152).replace(/[,;:\s]+\S*$/, "")}…`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Image prompt for a clean, legible app icon / favicon. */
export function iconPromptFor(title: string, description: string): string {
  const name = (title || "app").trim();
  const about = (description || "").trim().slice(0, 160);
  return [
    `A minimal, modern app icon for "${name}".`,
    about ? `The app: ${about}` : "",
    "Single bold symbolic mark, centered, flat vector style, high contrast, simple two-colour palette,",
    "no text, no letters, no words, generous padding, rounded square composition, crisp at 32x32 pixels,",
    "on a solid white background.",
  ]
    .filter(Boolean)
    .join(" ");
}
