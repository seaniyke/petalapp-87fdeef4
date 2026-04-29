/**
 * Client helpers for `/api/site-info` — read/update the project's published
 * "Website info" (title / description / favicon / social image) used by the
 * subdomain worker to render <title>, <meta>, and Open Graph tags.
 *
 * Server contract: `src/routes/api/site-info.ts`.
 */
import { supabase } from "@/integrations/supabase/client";

export type SiteInfo = {
  site_title: string | null;
  site_description: string | null;
  site_icon_url: string | null;
  site_og_image_url: string | null;
};

export type SiteInfoInput = Partial<SiteInfo> & { projectId: string };

export async function updateSiteInfo(
  input: SiteInfoInput,
): Promise<{ project: SiteInfo & { id: string; title: string; summary: string | null } }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");

  const resp = await fetch("/api/site-info", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  if (!resp.ok) {
    let msg = `Failed to save (${resp.status})`;
    try {
      const j = (await resp.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return (await resp.json()) as {
    project: SiteInfo & { id: string; title: string; summary: string | null };
  };
}

/** Upload a user-supplied favicon / social image to the public `petal-images`
 *  bucket and return its public URL. Files live under
 *  `site/<projectId>/<kind>-<timestamp>.<ext>` so each project's uploads
 *  stay grouped and old versions are easy to clean up later. */
export async function uploadSiteImage(
  projectId: string,
  kind: "icon" | "og",
  file: File,
): Promise<string> {
  // Browsers sometimes report empty/odd MIME types; fall back to the
  // extension so storage doesn't reject the upload.
  const extFromName = file.name.split(".").pop()?.toLowerCase() || "png";
  const safeExt = extFromName.replace(/[^a-z0-9]/g, "").slice(0, 5) || "png";
  const path = `site/${projectId}/${kind}-${Date.now()}.${safeExt}`;
  const { error } = await supabase.storage
    .from("petal-images")
    .upload(path, file, {
      cacheControl: "31536000",
      upsert: true,
      contentType: file.type || `image/${safeExt}`,
    });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from("petal-images").getPublicUrl(path);
  return data.publicUrl;
}
