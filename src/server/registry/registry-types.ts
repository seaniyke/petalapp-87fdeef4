/**
 * Kimble resource registry — shared types.
 *
 * Every design resource Kimble owns (fonts, icons, headers, footers,
 * sections, decorative treatments, pictures, identities, structures)
 * is described by metadata so the builder can RETRIEVE the handful that
 * fit a brief instead of dumping the whole library into a prompt.
 *
 * Rule this exists to enforce: structured resources + metadata +
 * retrieval + deterministic rules + AI reasoning. Never a giant prompt.
 */

export type ResourceKind =
  | "font"
  | "font-pairing"
  | "icon"
  | "header"
  | "footer"
  | "section"
  | "decoration"
  | "illustration"
  | "picture";

/** Common metadata every registry record carries. */
export interface ResourceMeta {
  id: string;
  kind: ResourceKind;
  label: string;
  /** One-line description the model reads. Never shown to the end user. */
  description: string;
  /** Free-form match tags: industries, moods, archetypes, page purposes. */
  tags: string[];
}

/** A scored match returned by retrieval. */
export interface ResourceMatch<T extends ResourceMeta = ResourceMeta> {
  record: T;
  score: number;
}

/** Lowercase + de-duplicate a tag list. */
export function normalizeTags(tags: Array<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const raw of tags) {
    const t = String(raw ?? "").trim().toLowerCase();
    if (t) out.add(t);
  }
  return [...out];
}

/**
 * Score a record against a brief.
 *
 * Deterministic and cheap: tag overlap, plus a weaker signal from words
 * that appear in the brief text. No I/O, no model call.
 */
export function scoreRecord(record: ResourceMeta, briefTags: string[], briefText = ""): number {
  const wanted = new Set(normalizeTags(briefTags));
  const text = briefText.toLowerCase();
  let score = 0;
  for (const tag of record.tags) {
    if (wanted.has(tag)) score += 3;
    else if (tag.length > 3 && text.includes(tag)) score += 1;
  }
  return score;
}

/**
 * Retrieve the best `limit` records for a brief.
 *
 * Always returns `limit` records even when nothing scores — a menu with
 * no options is worse than a neutral menu, and the model still needs
 * something to choose from. Ties keep source order so the result is
 * stable build to build.
 */
export function retrieve<T extends ResourceMeta>(
  records: readonly T[],
  briefTags: string[],
  limit: number,
  briefText = "",
): T[] {
  const scored: ResourceMatch<T>[] = records.map((record) => ({
    record,
    score: scoreRecord(record, briefTags, briefText),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(0, limit)).map((s) => s.record);
}
