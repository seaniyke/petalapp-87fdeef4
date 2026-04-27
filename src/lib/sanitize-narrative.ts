/**
 * Detects when a streamed plan/recap/summary segment is leaking Petal's own
 * internal infrastructure reasoning (bundler, Tailwind config, scaffold paths,
 * the route tree, etc.) instead of talking about the user's app.
 *
 * When a leak is detected, we collapse the segment to a generic, friendly
 * placeholder so the chat keeps reading like it's about THEIR product.
 *
 * This is a belt-and-suspenders complement to the system prompt rules in
 * src/server/generate.server.ts — the prompt tells the model not to do this,
 * and this client filter rescues anything that slips through.
 */

// Patterns that indicate the model is talking about Petal's own internals
// rather than the user's app. Case-insensitive substring or regex match.
const INFRA_LEAK_PATTERNS: RegExp[] = [
  /\bsrc\/components\/(ui|examples)\b/i,
  /\bsrc\/integrations\b/i,
  /\bsrc\/lib\/utils\b/i,
  /\brouteTree\.gen\b/i,
  /\bvite\.config\b/i,
  /\btsconfig(\.json)?\b/i,
  /\bpackage\.json\b/i,
  /\b\.lovable\b/i,
  /\bnode_modules\b/i,
  /\btailwind\s*(css)?\s*(compiler|config|scanning)/i,
  /\bbundler\b/i,
  /\bscaffold\b/i,
  /\bbuild (timeout|timing out|is timing|process|pipeline)\b/i,
  /\bcompiler scanning\b/i,
  /\bunused (example )?components\b/i,
];

const PLACEHOLDER = "Resolving a setup issue behind the scenes — back to your app in a moment.";

/**
 * Returns the segment text unchanged when it reads like normal user-facing
 * content. Returns a generic placeholder when it looks like Petal-internal
 * reasoning has leaked through.
 */
export function sanitizeNarrative(text: string | null | undefined): string {
  if (!text) return "";
  const trimmed = text.trim();
  if (!trimmed) return "";

  let hits = 0;
  for (const pattern of INFRA_LEAK_PATTERNS) {
    if (pattern.test(trimmed)) {
      hits += 1;
      if (hits >= 2) return PLACEHOLDER;
    }
  }
  // A single weak hit (e.g. an incidental mention of "bundler") still passes
  // through; two or more independent infra signals collapse the segment.
  return text;
}

/**
 * True when sanitizeNarrative would replace the text with the placeholder.
 * Useful for switching the segment's icon/label to a neutral one.
 */
export function isInfraLeak(text: string | null | undefined): boolean {
  if (!text) return false;
  return sanitizeNarrative(text) === PLACEHOLDER;
}
