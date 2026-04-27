/**
 * AI image generation pipeline (Phase 4).
 *
 * Two responsibilities:
 *   1. `generatePetalImage(prompt, opts)` — call Lovable AI's Gemini image
 *      model and upload the result to the public `petal-images` bucket,
 *      returning a stable HTTPS URL.
 *   2. `resolvePetalImagePlaceholders(files)` — scan freshly-generated
 *      project files for `petal-image://...` placeholder URLs and replace
 *      each one with a real generated image URL.
 *
 * The placeholder protocol lets the AI request "a real image of a coffee
 * shop hero" without needing a tool round-trip mid-stream — it just writes
 * `<img src="petal-image://coffee-shop-hero-warm-morning-light" />` and the
 * server resolves it post-stream. This keeps the SSE relay loop simple and
 * payloads small (no base64 round-tripping through the model).
 */
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ProjectFile } from "./generate.server";

const BUCKET = "petal-images";
const IMAGE_MODEL = "google/gemini-2.5-flash-image";

/** Hard cap — protects against an AI that emits 50 placeholder URLs in one turn. */
const MAX_IMAGES_PER_GENERATION = 6;

/** Matches `petal-image://<slug-or-prompt>` inside any string content.
 *  The "value" capture stops at whitespace, quotes, parens, or angle brackets
 *  so it survives being embedded in JSX, CSS `url(...)`, JSON, etc. */
const PLACEHOLDER_RE = /petal-image:\/\/([^\s"'`<>\)]+)/g;

export type GenerateImageOptions = {
  /** Free-form description; longer + more visual = better results. */
  prompt: string;
  /** Aspect ratio hint baked into the prompt (the model is text-to-image). */
  aspectRatio?: "1:1" | "16:9" | "4:3" | "3:4" | "9:16";
  /** Optional cache key — same key returns the same URL. */
  cacheKey?: string;
};

export type GenerateImageResult = {
  url: string;
  cached: boolean;
};

/** Convert a slug like "coffee-shop-hero-warm-morning-light" to a real prompt.
 *  We keep it lossy on purpose — the AI is encouraged to write descriptive
 *  slugs (or full sentences) which we then expand. */
function slugToPrompt(slug: string): string {
  // Decode URL-encoded slugs (the AI may emit `petal-image://a%20red%20car`).
  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    /* leave as-is */
  }
  // If it already reads like a sentence, return verbatim.
  if (/\s/.test(decoded) || decoded.length > 40) return decoded;
  // Otherwise turn dashes/underscores into spaces.
  return decoded.replace(/[-_]+/g, " ").trim();
}

/** Aspect-ratio guidance the image model can actually act on. */
function aspectGuidance(ratio?: GenerateImageOptions["aspectRatio"]): string {
  switch (ratio) {
    case "16:9":
      return " Wide cinematic 16:9 aspect ratio.";
    case "4:3":
      return " Landscape 4:3 aspect ratio.";
    case "3:4":
      return " Portrait 3:4 aspect ratio.";
    case "9:16":
      return " Tall mobile 9:16 aspect ratio.";
    case "1:1":
      return " Perfectly square 1:1 aspect ratio.";
    default:
      return "";
  }
}

/** Stable filename so identical prompts dedupe to the same upload. */
function cacheKeyFor(prompt: string, ratio?: string): string {
  return createHash("sha256")
    .update(`${prompt}::${ratio ?? "default"}`)
    .digest("hex")
    .slice(0, 24);
}

/** Returns the public URL if the object already exists in the bucket. */
async function lookupCached(filename: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .list("", { search: filename, limit: 1 });
  if (error || !data?.some((o) => o.name === filename)) return null;
  return supabaseAdmin.storage.from(BUCKET).getPublicUrl(filename).data.publicUrl;
}

/** Decode a `data:image/png;base64,...` URL to raw bytes + mime. */
function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("AI returned non-data-URL image");
  const mime = m[1];
  const b64 = m[2];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime };
}

function extensionFor(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
}

/** Generate one image via Lovable AI Gateway and upload to the public bucket. */
export async function generatePetalImage(
  opts: GenerateImageOptions,
): Promise<GenerateImageResult> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("AI gateway is not configured.");

  const prompt = opts.prompt.trim();
  if (!prompt) throw new Error("Image prompt is empty.");

  const key = opts.cacheKey ?? cacheKeyFor(prompt, opts.aspectRatio);
  // Probe cache first (we don't know mime yet — try both common ones).
  for (const ext of ["png", "jpg", "webp"]) {
    const filename = `${key}.${ext}`;
    const cached = await lookupCached(filename);
    if (cached) return { url: cached, cached: true };
  }

  const fullPrompt = `${prompt}.${aspectGuidance(opts.aspectRatio)} High quality, professional, no watermarks, no text overlays.`;

  const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      messages: [{ role: "user", content: fullPrompt }],
      modalities: ["image", "text"],
    }),
  });

  if (!upstream.ok) {
    const body = await upstream.text().catch(() => "");
    throw new Error(
      `Image gateway error (${upstream.status})${body ? `: ${body.slice(0, 200)}` : ""}`,
    );
  }

  const json = (await upstream.json()) as {
    choices?: Array<{
      message?: { images?: Array<{ image_url?: { url?: string } }> };
    }>;
  };
  const dataUrl = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!dataUrl) throw new Error("Image gateway returned no image.");

  const { bytes, mime } = dataUrlToBytes(dataUrl);
  const filename = `${key}.${extensionFor(mime)}`;

  const { error: upErr } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(filename, bytes, {
      contentType: mime,
      cacheControl: "31536000, immutable",
      upsert: true,
    });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

  const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(filename);
  return { url: pub.publicUrl, cached: false };
}

/** Walk every file content, find `petal-image://...` URLs, and replace them
 *  with real generated images. Replacements are deduped by slug so the same
 *  placeholder used five times only generates one image. Failures fall back
 *  to a deterministic picsum URL so the build never breaks because of a flaky
 *  image generation call. */
export async function resolvePetalImagePlaceholders(
  files: ProjectFile[],
): Promise<{ files: ProjectFile[]; resolved: number; failed: number }> {
  // 1. Collect all unique placeholders across the project.
  const slugs = new Set<string>();
  for (const f of files) {
    PLACEHOLDER_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PLACEHOLDER_RE.exec(f.content)) !== null) {
      slugs.add(m[1]);
    }
  }
  if (slugs.size === 0) return { files, resolved: 0, failed: 0 };

  // 2. Cap to avoid runaway generations.
  const ordered = Array.from(slugs).slice(0, MAX_IMAGES_PER_GENERATION);
  const skipped = Array.from(slugs).slice(MAX_IMAGES_PER_GENERATION);

  // 3. Resolve each — concurrency 2 to be gentle on the gateway.
  const urlMap = new Map<string, string>();
  let resolved = 0;
  let failed = 0;
  const queue = [...ordered];

  async function worker() {
    while (queue.length) {
      const slug = queue.shift();
      if (!slug) return;
      try {
        const r = await generatePetalImage({ prompt: slugToPrompt(slug) });
        urlMap.set(slug, r.url);
        resolved += 1;
      } catch (e) {
        failed += 1;
        console.warn(`[petal-image] generation failed for "${slug}":`, e);
        // Deterministic fallback so the file still renders something.
        const seed = Math.abs(
          [...slug].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7),
        );
        urlMap.set(slug, `https://picsum.photos/seed/${seed}/1200/800`);
      }
    }
  }
  await Promise.all([worker(), worker()]);

  // 4. For slugs we skipped due to the cap, still substitute picsum so the
  // app doesn't try to load `petal-image://` (which would 404).
  for (const slug of skipped) {
    const seed = Math.abs(
      [...slug].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7),
    );
    urlMap.set(slug, `https://picsum.photos/seed/${seed}/1200/800`);
  }

  // 5. Apply substitutions.
  const next = files.map((f) => {
    if (!f.content.includes("petal-image://")) return f;
    const updated = f.content.replace(PLACEHOLDER_RE, (_match, slug) => {
      return urlMap.get(slug) ?? `https://picsum.photos/seed/${slug}/1200/800`;
    });
    return updated === f.content ? f : { ...f, content: updated };
  });

  return { files: next, resolved, failed };
}
