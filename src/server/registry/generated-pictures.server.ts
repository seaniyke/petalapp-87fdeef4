/**
 * Memory of pictures Kimble has already made.
 *
 * Before this, every generated picture was uploaded and then forgotten: the
 * file stayed in storage but nothing recorded what it was, so the same
 * subject was paid for again on the next build. This module records each
 * generated picture and finds a suitable one again later.
 *
 * Source priority for any image in a build:
 *   project's own photos → curated library → REMEMBERED → generate → placeholder.
 *
 * Ownership is strict. A picture made for one person's project is only
 * reusable by that project and that person's other projects. It becomes
 * reusable by everyone only when an admin marks it shared.
 *
 * Never throws: a lookup or record problem is not a build failure.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { tokenize, scorePicture, MIN_SCORE, type LibraryPicture } from "./pictures.server";

export interface RememberedPicture {
  id: string;
  url: string;
  subject: string;
  style: string | null;
  mood: string | null;
  tags: string[];
  aspect_ratio: string;
  orientation: string;
  shared: boolean;
  project_id: string | null;
  owner_id: string | null;
}

export interface PictureScope {
  projectId?: string | null;
  ownerId?: string | null;
  turnId?: string | null;
}

const COLUMNS = "id,url,subject,style,mood,tags,aspect_ratio,orientation,shared,project_id,owner_id";

/** A remembered picture scored with exactly the curated-library rules. */
function asScorable(row: RememberedPicture): LibraryPicture {
  return {
    id: row.id,
    url: row.url,
    subject: row.subject ?? "",
    industry: null,
    mood: row.mood,
    tone: null,
    colors: [],
    orientation: row.orientation ?? "",
    aspect_ratio: row.aspect_ratio ?? "",
    has_people: false,
    style: row.style,
    location: null,
    tags: row.tags ?? [],
    source: "generated",
    license: "owned",
  };
}

/** Orientation implied by an aspect ratio, for later matching. */
export function orientationFor(aspectRatio?: string | null): string {
  switch (aspectRatio) {
    case "9:16":
    case "3:4":
      return "portrait";
    case "1:1":
      return "square";
    case "16:9":
    case "4:3":
      return "landscape";
    default:
      return "";
  }
}

/** Short, searchable words describing what the picture shows. */
export function tagsForPrompt(prompt: string): string[] {
  return Array.from(new Set(tokenize(prompt))).slice(0, 12);
}

/**
 * Record a freshly generated picture so later builds can find it.
 * Same URL is only ever recorded once.
 */
export async function rememberGeneratedPicture(row: {
  url: string;
  prompt: string;
  cacheKey?: string | null;
  aspectRatio?: string | null;
  model?: string | null;
  scope?: PictureScope;
}): Promise<void> {
  try {
    const prompt = String(row.prompt ?? "").slice(0, 2000);
    if (!row.url || !prompt) return;
    await supabaseAdmin.from("generated_pictures").upsert(
      {
        url: row.url,
        cache_key: row.cacheKey ?? null,
        prompt,
        subject: prompt.slice(0, 200),
        tags: tagsForPrompt(prompt),
        aspect_ratio: row.aspectRatio ?? "",
        orientation: orientationFor(row.aspectRatio),
        model: row.model ?? null,
        project_id: row.scope?.projectId ?? null,
        owner_id: row.scope?.ownerId ?? null,
        turn_id: row.scope?.turnId ?? null,
      } as never,
      { onConflict: "url" },
    );
  } catch {
    // Remembering a picture must never break a build.
  }
}

/**
 * Best remembered picture for a request, or null when nothing fits well
 * enough — in which case the caller generates exactly as before.
 *
 * Visibility: the same project, the same owner's projects, or anything an
 * admin marked shared. Nothing else is ever considered.
 */
export async function findRememberedPicture(query: {
  request: string;
  scope?: PictureScope;
  briefTags?: string[];
  aspectRatio?: string | null;
}): Promise<RememberedPicture | null> {
  const words = tokenize(query.request);
  if (!words.length) return null;

  const projectId = query.scope?.projectId ?? null;
  const ownerId = query.scope?.ownerId ?? null;

  const rows: RememberedPicture[] = [];
  const seen = new Set<string>();
  const add = (list: RememberedPicture[] | null | undefined) => {
    for (const r of list ?? []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      rows.push(r);
    }
  };

  try {
    const shared = await supabaseAdmin
      .from("generated_pictures")
      .select(COLUMNS)
      .eq("shared", true)
      .eq("active", true)
      .limit(1000);
    add(shared.data as RememberedPicture[] | null);

    if (ownerId) {
      const own = await supabaseAdmin
        .from("generated_pictures")
        .select(COLUMNS)
        .eq("owner_id", ownerId)
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(500);
      add(own.data as RememberedPicture[] | null);
    }

    if (projectId) {
      const proj = await supabaseAdmin
        .from("generated_pictures")
        .select(COLUMNS)
        .eq("project_id", projectId)
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(500);
      add(proj.data as RememberedPicture[] | null);
    }
  } catch {
    // An unreachable memory means "no match", never a failed build.
    return null;
  }

  if (!rows.length) return null;

  const briefTags = (query.briefTags ?? []).map((t) => String(t).toLowerCase());
  let best: RememberedPicture | null = null;
  let bestScore = 0;
  for (const row of rows) {
    // Belt and braces: never consider a row outside the allowed scope, even
    // if a query ever returned one.
    const visible =
      row.shared === true ||
      (!!ownerId && row.owner_id === ownerId) ||
      (!!projectId && row.project_id === projectId);
    if (!visible) continue;
    const score = scorePicture(asScorable(row), words, briefTags, query.aspectRatio);
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  return bestScore >= MIN_SCORE ? best : null;
}
