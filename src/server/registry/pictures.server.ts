/**
 * Picture intelligence.
 *
 * Before this, every image in a generated app was invented from scratch
 * (slow, expensive, uneven) or fell back to a random placeholder. Now the
 * builder searches a curated, tagged library FIRST and only generates
 * when nothing fits.
 *
 * Source priority: curated library → project uploads → generation →
 * procedural placeholder. This module owns the first step.
 *
 * Never throws: a library miss is a missing option, not a build failure.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface LibraryPicture {
  id: string;
  url: string;
  subject: string;
  industry: string | null;
  mood: string | null;
  tone: string | null;
  colors: string[];
  orientation: string;
  aspect_ratio: string;
  has_people: boolean;
  style: string | null;
  location: string | null;
  tags: string[];
  source: string;
  license: string;
}

const CACHE_MS = 5 * 60 * 1000;
let cache: { at: number; rows: LibraryPicture[] } | null = null;

/** Load the active library, cached — it is small and read on every build. */
export async function loadPictureLibrary(force = false): Promise<LibraryPicture[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  try {
    const { data, error } = await supabaseAdmin
      .from("design_pictures")
      .select(
        "id,url,subject,industry,mood,tone,colors,orientation,aspect_ratio,has_people,style,location,tags,source,license",
      )
      .eq("active", true)
      .limit(2000);
    if (error) throw error;
    const rows = (data ?? []) as LibraryPicture[];
    cache = { at: Date.now(), rows };
    return rows;
  } catch {
    // An unreachable library must never stop a build — fall through to
    // generation exactly as before.
    return cache?.rows ?? [];
  }
}

const STOP = new Set([
  "the", "a", "an", "of", "and", "with", "for", "in", "on", "at", "to",
  "image", "photo", "picture", "hero", "background", "shot", "high", "quality",
]);

/** Split a placeholder slug or prompt into meaningful words. */
export function tokenize(text: string): string[] {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !STOP.has(w));
}

export interface PictureQuery {
  /** The placeholder slug or prompt the build asked for. */
  request: string;
  /** Archetype/industry tags from the brief. */
  briefTags?: string[];
  /** "16:9" etc, when the build asked for a shape. */
  aspectRatio?: string | null;
}

/**
 * Score one picture against a request. Deterministic, no I/O.
 *
 * Subject words count most, then tags, then industry/mood, then shape.
 * A picture must clear MIN_SCORE to be used — a weak match looks worse
 * than a generated image.
 */
export function scorePicture(pic: LibraryPicture, words: string[], briefTags: string[], aspectRatio?: string | null): number {
  const want = new Set(words);
  const tags = new Set(briefTags.map((t) => t.toLowerCase()));
  let score = 0;

  for (const w of tokenize(pic.subject)) if (want.has(w)) score += 4;
  for (const t of pic.tags) {
    const tag = t.toLowerCase();
    if (want.has(tag)) score += 3;
    else if (tags.has(tag)) score += 2;
  }
  for (const field of [pic.industry, pic.mood, pic.style, pic.tone, pic.location]) {
    if (!field) continue;
    const f = field.toLowerCase();
    if (want.has(f)) score += 2;
    else if (tags.has(f)) score += 1;
  }
  if (aspectRatio && pic.aspect_ratio === aspectRatio) score += 1;
  return score;
}

/** A match below this is not worth using. */
export const MIN_SCORE = 6;

/**
 * Best library picture for a request, or null when nothing fits well
 * enough — in which case the caller generates as before.
 */
export async function findLibraryPicture(query: PictureQuery): Promise<LibraryPicture | null> {
  const words = tokenize(query.request);
  if (!words.length) return null;
  const rows = await loadPictureLibrary();
  if (!rows.length) return null;

  const briefTags = (query.briefTags ?? []).map((t) => String(t).toLowerCase());
  let best: LibraryPicture | null = null;
  let bestScore = 0;
  for (const pic of rows) {
    const score = scorePicture(pic, words, briefTags, query.aspectRatio);
    if (score > bestScore) {
      bestScore = score;
      best = pic;
    }
  }
  return bestScore >= MIN_SCORE ? best : null;
}
