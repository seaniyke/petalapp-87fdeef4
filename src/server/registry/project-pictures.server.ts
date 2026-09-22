/**
 * Photos the person added to their own project.
 *
 * Source priority for any image in a build:
 *   the project's own photos → curated library → generation → placeholder.
 *
 * A photo someone uploaded is always the most truthful picture of their
 * business, so it outranks anything invented. This module owns step one.
 *
 * Never throws: a lookup problem means "no match", not a failed build.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { tokenize } from "./pictures.server";

export interface ProjectPicture {
  id: string;
  url: string;
  label: string;
  tags: string[];
}

/** Hard cap — a project's own photos are a shortlist, not an archive dump. */
const MAX_PICTURES = 60;

/** Only the newest few are named in the prompt; the rest still match by slug. */
const MAX_IN_PROMPT = 12;

const CACHE_MS = 60 * 1000;
const cache = new Map<string, { at: number; rows: ProjectPicture[] }>();

/** Drop a project's cached photos so a fresh upload is usable immediately. */
export function forgetProjectPictures(projectId: string): void {
  cache.delete(projectId);
}

export async function loadProjectPictures(projectId: string | null | undefined): Promise<ProjectPicture[]> {
  if (!projectId) return [];
  const hit = cache.get(projectId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
  try {
    const { data, error } = await supabaseAdmin
      .from("project_pictures")
      .select("id,url,label,tags")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(MAX_PICTURES);
    if (error) throw error;
    const rows = (data ?? []) as ProjectPicture[];
    cache.set(projectId, { at: Date.now(), rows });
    return rows;
  } catch {
    return hit?.rows ?? [];
  }
}

/** A weak match is worse than a good generated image. */
export const MIN_SCORE = 4;

/** Deterministic, no I/O. Label words count most, then tags. */
export function scoreProjectPicture(pic: ProjectPicture, words: string[]): number {
  const want = new Set(words);
  let score = 0;
  for (const w of tokenize(pic.label)) if (want.has(w)) score += 4;
  for (const t of pic.tags) if (want.has(String(t).toLowerCase())) score += 3;
  return score;
}

/**
 * Best photo the owner uploaded for this request, or null when none fits.
 */
export async function findProjectPicture(
  projectId: string | null | undefined,
  request: string,
): Promise<ProjectPicture | null> {
  const words = tokenize(request);
  if (!words.length) return null;
  const rows = await loadProjectPictures(projectId);
  if (!rows.length) return null;

  let best: ProjectPicture | null = null;
  let bestScore = 0;
  for (const pic of rows) {
    const score = scoreProjectPicture(pic, words);
    if (score > bestScore) {
      bestScore = score;
      best = pic;
    }
  }
  return bestScore >= MIN_SCORE ? best : null;
}

/**
 * Prompt block naming the owner's own photos with their real URLs, so the
 * build uses the actual business instead of inventing a lookalike.
 * Returns "" when there are none — no empty headings in the prompt.
 */
export function renderProjectPictureBlock(pictures: ProjectPicture[]): string {
  if (!pictures.length) return "";
  const lines = pictures
    .slice(0, MAX_IN_PROMPT)
    .map((p) => {
      const label = p.label.trim() || "untitled photo";
      const tags = p.tags.length ? ` (${p.tags.slice(0, 6).join(", ")})` : "";
      return `- ${label}${tags} → ${p.url}`;
    })
    .join("\n");

  return `\n\n[The owner's own photos — use these before inventing any image]
These are real photographs of this business, uploaded by its owner. They beat
anything generated.
${lines}

Rules:
- Put a photo where its subject belongs. Never use one as generic decoration.
- Use the URL exactly as written, in a plain <img src="..."> (or CSS background).
- Give every one real alt text describing what it actually shows.
- Only fall back to a \`petal-image://\` placeholder where none of these fits.
`;
}
