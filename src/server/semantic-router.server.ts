/**
 * Semantic router — picks ONE archetype from a brief.
 *
 * Embeddings-free: lowercased synonym + token overlap scoring against the
 * system catalog. Cheap (~1ms), deterministic, no model call. Returns
 * null if confidence is below threshold so the existing template scorer
 * (templates.server.ts pickTemplateForBrief) stays the fallback.
 */

import { ARCHETYPES, type ArchetypeSpec } from "./system-catalog.server";

const STOP = new Set([
  "a", "an", "the", "to", "for", "of", "and", "or", "with", "build", "make",
  "create", "me", "my", "i", "want", "need", "app", "site", "website", "platform",
  "tool", "page", "system", "online", "simple",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

export interface SemanticMatch {
  archetype: ArchetypeSpec;
  score: number;
  /** "synonym" = direct phrase hit, "tokens" = bag-of-words overlap. */
  reason: "synonym" | "tokens";
}

/** Match a brief to its top archetype. Returns null if confidence too low. */
export function routeBrief(brief: string): SemanticMatch | null {
  const text = brief.toLowerCase();
  const briefTokens = new Set(tokens(text));
  if (briefTokens.size === 0) return null;

  let best: SemanticMatch | null = null;

  for (const arch of ARCHETYPES) {
    // 1. Direct synonym phrase match (strong signal).
    let synonymHit = false;
    for (const syn of arch.synonyms) {
      if (text.includes(syn.toLowerCase())) {
        synonymHit = true;
        const score = 10 + syn.length / 5;
        if (!best || score > best.score) {
          best = { archetype: arch, score, reason: "synonym" };
        }
        break;
      }
    }
    if (synonymHit) continue;

    // 2. Token overlap (weaker signal).
    let overlap = 0;
    for (const syn of arch.synonyms) {
      for (const t of tokens(syn)) {
        if (briefTokens.has(t)) overlap += 1;
      }
    }
    if (overlap >= 2) {
      const score = overlap;
      if (!best || score > best.score) {
        best = { archetype: arch, score, reason: "tokens" };
      }
    }
  }

  // Confidence floor — below this we let the template scorer take over.
  if (!best || best.score < 3) return null;
  return best;
}
