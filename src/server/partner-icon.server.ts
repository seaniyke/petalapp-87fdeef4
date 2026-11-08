/**
 * Copies a partner-hosted logo (e.g. on custardai.dev) into Petal's public
 * image storage so a site's tab icon never depends on the partner's server.
 * Same bucket and folder as owner-uploaded icons: `petal-images/site/<projectId>/`.
 */
import { iconExtension, MAX_ICON_BYTES } from "@/lib/site-image-url";

export type IconCopyResult = { ok: true; url: string } | { ok: false; error: string; message: string };

export async function copyPartnerIcon(projectId: string, sourceUrl: string): Promise<IconCopyResult> {
  let res: Response;
  try {
    res = await fetch(sourceUrl, { redirect: "error", signal: AbortSignal.timeout(10_000) });
  } catch {
    return { ok: false, error: "icon_fetch_failed", message: "Could not download iconUrl (no redirects, 10s limit)." };
  }
  if (!res.ok) {
    return { ok: false, error: "icon_fetch_failed", message: `Downloading iconUrl returned ${res.status}.` };
  }
  const contentType = res.headers.get("content-type");
  const ext = iconExtension(contentType);
  if (!ext) {
    return { ok: false, error: "icon_bad_type", message: "iconUrl must be a PNG, JPEG, WebP, GIF, SVG or ICO image." };
  }
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_ICON_BYTES) {
    return { ok: false, error: "icon_too_large", message: "iconUrl must be 1 MB or smaller." };
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength === 0) return { ok: false, error: "icon_empty", message: "iconUrl returned an empty file." };
  if (bytes.byteLength > MAX_ICON_BYTES) {
    return { ok: false, error: "icon_too_large", message: "iconUrl must be 1 MB or smaller." };
  }

  // Name by content so sending the same logo again reuses the same file.
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hash = Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
  const path = `site/${projectId}/icon-${hash}.${ext}`;
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { error } = await supabaseAdmin.storage
    .from("petal-images")
    .upload(path, bytes, { contentType: type, cacheControl: "31536000", upsert: true });
  if (error) return { ok: false, error: "icon_save_failed", message: "Could not save the icon. Try again." };
  return { ok: true, url: supabaseAdmin.storage.from("petal-images").getPublicUrl(path).data.publicUrl };
}
