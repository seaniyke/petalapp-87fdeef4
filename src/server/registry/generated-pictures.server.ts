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
  category?: string | null;
  industry?: string | null;
  visual_traits?: string[] | null;
  width?: number | null;
  height?: number | null;
}

/** Where a remembered picture may be reused. */
export type PictureReuseScope = "global" | "project" | "user";

export function scopeOf(row: Pick<RememberedPicture, "shared" | "project_id" | "owner_id">, scope?: PictureScope): PictureReuseScope | null {
  if (row.shared) return "global";
  if (scope?.projectId && row.project_id === scope.projectId) return "project";
  if (scope?.ownerId && row.owner_id === scope.ownerId) return "user";
  return null;
}

export interface PictureScope {
  projectId?: string | null;
  ownerId?: string | null;
  turnId?: string | null;
}

const COLUMNS =
  "id,url,subject,style,mood,tags,aspect_ratio,orientation,shared,project_id,owner_id,category,industry,visual_traits,width,height";

/** A remembered picture scored with exactly the curated-library rules. */
function asScorable(row: RememberedPicture): LibraryPicture {
  return {
    id: row.id,
    url: row.url,
    subject: row.subject ?? "",
    industry: row.industry ?? null,
    mood: row.mood,
    tone: row.category ?? null,
    colors: row.visual_traits ?? [],
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

const VOCAB: Record<"style" | "mood" | "industry" | "category", Array<[string, RegExp]>> = {
  style: [
    ["illustration", /\b(illustrat|vector|flat art|cartoon)/],
    ["3d render", /\b(3d|render|isometric)\b/],
    ["minimal", /\b(minimal|minimalist|clean)\b/],
    ["photography", /\b(photo|photograph|shot|portrait|interior|landscape|close-?up|lifestyle)/],
  ],
  mood: [
    ["warm", /\b(warm|cozy|cosy|golden|sunset|inviting)\b/],
    ["dark", /\b(dark|moody|night|noir)\b/],
    ["bright", /\b(bright|airy|sunny|light-filled|fresh)\b/],
    ["calm", /\b(calm|serene|peaceful|tranquil|soft)\b/],
    ["energetic", /\b(energetic|vibrant|bold|dynamic)\b/],
    ["luxury", /\b(luxury|luxurious|elegant|premium)\b/],
  ],
  industry: [
    ["food & drink", /\b(coffee|cafe|restaurant|bakery|food|dish|bar|kitchen|chef|menu)\b/],
    ["fitness", /\b(gym|fitness|yoga|workout|athlete)\b/],
    ["real estate", /\b(house|home|apartment|property|real estate|villa)\b/],
    ["travel", /\b(travel|hotel|resort|beach|vacation|airbnb)\b/],
    ["technology", /\b(tech|software|saas|dashboard|laptop|code|startup)\b/],
    ["health", /\b(clinic|doctor|health|medical|dental|wellness)\b/],
    ["fashion & beauty", /\b(fashion|clothing|salon|beauty|model|boutique)\b/],
    ["finance", /\b(finance|bank|money|invest|fintech|crypto)\b/],
  ],
  category: [
    ["people", /\b(person|people|woman|man|team|customer|portrait|smiling)\b/],
    ["product", /\b(product|bottle|package|device|packshot)\b/],
    ["place", /\b(interior|exterior|room|storefront|office|street|building|space)\b/],
    ["nature", /\b(nature|forest|mountain|ocean|sea|garden|sky)\b/],
    ["food", /\b(dish|plate|meal|pastry|bread|coffee cup|latte|dessert)\b/],
    ["abstract", /\b(abstract|pattern|texture|gradient)\b/],
  ],
};

const TRAITS = /\b(red|orange|yellow|green|blue|purple|pink|black|white|gold|golden|neutral|pastel|monochrome|colou?rful|natural light|soft light|studio light|shallow depth|wide angle|aerial|close-?up|overhead)\b/g;

/** Deterministic description of a prompt: no AI call, used to make pictures findable. */
export function describePrompt(prompt: string): {
  style: string | null;
  mood: string | null;
  industry: string | null;
  category: string | null;
  visual_traits: string[];
} {
  const p = String(prompt ?? "").toLowerCase();
  const pick = (k: keyof typeof VOCAB) => VOCAB[k].find(([, re]) => re.test(p))?.[0] ?? null;
  const traits = Array.from(new Set(p.match(TRAITS) ?? [])).slice(0, 8);
  return { style: pick("style"), mood: pick("mood"), industry: pick("industry"), category: pick("category"), visual_traits: traits };
}

/** Pixel size read from an image header (PNG, JPEG, WebP). Null when unknown. */
export function imageDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  try {
    const b = bytes;
    if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) {
      const w = (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19];
      const h = (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23];
      return { width: w >>> 0, height: h >>> 0 };
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return null;
        const marker = b[i + 1];
        const len = (b[i + 2] << 8) | b[i + 3];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
        }
        i += 2 + len;
      }
      return null;
    }
    if (b.length > 30 && b[0] === 0x52 && b[8] === 0x57 && b[12] === 0x56) {
      const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (kind === "VP8X") return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
      if (kind === "VP8 ") return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
      if (kind === "VP8L") {
        const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    }
  } catch {
    /* unknown header */
  }
  return null;
}

/** "vendor/model-name" → "vendor". */
export function providerFor(model?: string | null): string | null {
  const m = String(model ?? "");
  return m.includes("/") ? m.split("/")[0] : m || null;
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
  width?: number | null;
  height?: number | null;
  scope?: PictureScope;
}): Promise<void> {
  try {
    const prompt = String(row.prompt ?? "").slice(0, 2000);
    if (!row.url || !prompt) return;
    const d = describePrompt(prompt);
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
        provider: providerFor(row.model),
        style: d.style,
        mood: d.mood,
        industry: d.industry,
        category: d.category,
        visual_traits: d.visual_traits,
        width: row.width ?? null,
        height: row.height ?? null,
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
  const ranked = await rankRememberedPictures(query, 1);
  return ranked[0]?.row ?? null;
}

/**
 * Remembered pictures ranked for a request, best first, only those clearing
 * the quality bar and inside the caller's scope. Never throws.
 */
export async function rankRememberedPictures(
  query: { request: string; scope?: PictureScope; briefTags?: string[]; aspectRatio?: string | null },
  limit = 5,
): Promise<Array<{ row: RememberedPicture; score: number; scope: PictureReuseScope }>> {
  const words = tokenize(query.request);
  if (!words.length) return [];

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
    return [];
  }

  if (!rows.length) return [];

  const briefTags = (query.briefTags ?? []).map((t) => String(t).toLowerCase());
  const out: Array<{ row: RememberedPicture; score: number; scope: PictureReuseScope }> = [];
  for (const row of rows) {
    // Belt and braces: never consider a row outside the allowed scope, even
    // if a query ever returned one.
    const visible = scopeOf(row, { projectId, ownerId });
    if (!visible) continue;
    const score = scorePicture(asScorable(row), words, briefTags, query.aspectRatio);
    if (score >= MIN_SCORE) out.push({ row, score, scope: visible });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

/**
 * Compact list of reusable pictures for the AI — a handful of lines, never
 * the whole library. Empty when nothing relevant exists.
 */
export async function renderReusablePicturesBlock(query: {
  request: string;
  scope?: PictureScope;
  limit?: number;
}): Promise<string> {
  try {
    const ranked = await rankRememberedPictures(query, query.limit ?? 5);
    if (!ranked.length) return "";
    const lines = ranked.map(({ row }) => {
      const shape = row.width && row.height ? `${row.width}x${row.height}` : row.aspect_ratio || row.orientation || "";
      const bits = [row.category, row.mood, shape].filter(Boolean).join(", ");
      return `- ${row.url} — ${row.subject.slice(0, 90)}${bits ? ` (${bits})` : ""}`;
    });
    return (
      "\n\n## Pictures you already have\n" +
      "These were made for this project or its owner earlier. When one fits, use its URL directly instead of a new petal-image:// placeholder:\n" +
      lines.join("\n") +
      "\n"
    );
  } catch {
    return "";
  }
}
