/**
 * Saved project preview images.
 *
 * Previously every card that showed an app preview pointed an <img> straight
 * at Microlink, so the screenshot service re-rendered the app live on every
 * page load: spinners, 20-40s cold renders, and frequent fallbacks to the
 * branded gradient tile.
 *
 * Now we capture the screenshot ONCE per build, store the bytes in the public
 * `petal-images` bucket, and remember the public URL in
 * `public.project_thumbnails`. Every surface then renders a plain, immutable,
 * CDN-cached image.
 *
 * Everything here is best-effort: a capture failure never throws to the
 * caller, it just leaves the branded tile in place.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PETAL_ROOT_DOMAIN } from "@/lib/petal-subdomain";

const BUCKET = "petal-images";

export type SavedThumbnail = {
  projectId: string;
  buildId: string | null;
  url: string;
};

/**
 * One in-flight capture per project+build. A 60-card gallery asking at once
 * must trigger a single screenshot, not sixty.
 */
const inFlight = new Map<string, Promise<SavedThumbnail | null>>();

type ProjectRow = {
  id: string;
  subdomain: string | null;
  primary_domain_id: string | null;
  published_build_id: string | null;
  latest_build_id: string | null;
};

/** Read whatever saved previews we already have for these projects. */
export async function readSavedThumbnails(
  projectIds: string[],
): Promise<Record<string, SavedThumbnail>> {
  const ids = [...new Set(projectIds.filter(Boolean))].slice(0, 200);
  if (ids.length === 0) return {};
  const { data, error } = await supabaseAdmin
    .from("project_thumbnails")
    .select("project_id, build_id, url")
    .in("project_id", ids);
  if (error || !data) return {};
  const out: Record<string, SavedThumbnail> = {};
  for (const row of data) {
    if (!row.url) continue;
    out[row.project_id] = {
      projectId: row.project_id,
      buildId: row.build_id ?? null,
      url: row.url,
    };
  }
  return out;
}

/**
 * Return the saved preview for a project, capturing it first when missing or
 * when it belongs to an older build.
 */
export async function ensureSavedThumbnail(
  projectId: string,
  expectedBuildId?: string | null,
): Promise<SavedThumbnail | null> {
  if (!projectId) return null;

  const existing = (await readSavedThumbnails([projectId]))[projectId];
  const project = await loadProject(projectId);
  // The build the preview *should* reflect: whatever the caller knows about,
  // otherwise the project's own published/latest build.
  const targetBuild =
    expectedBuildId ?? project?.published_build_id ?? project?.latest_build_id ?? null;

  if (existing && (!targetBuild || existing.buildId === targetBuild)) return existing;
  if (!project) return existing ?? null;

  const key = `${projectId}:${targetBuild ?? ""}`;
  const running = inFlight.get(key);
  if (running) return running;

  const job = captureAndStore(project, targetBuild)
    .catch(() => null)
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, job);
  // A stale-but-present preview is better than a spinner while the new one
  // renders, so hand back what we have and let the capture land in the
  // background.
  return existing ?? job;
}

async function loadProject(projectId: string): Promise<ProjectRow | null> {
  const { data } = await supabaseAdmin
    .from("projects")
    .select("id, subdomain, primary_domain_id, published_build_id, latest_build_id")
    .eq("id", projectId)
    .maybeSingle();
  return (data as ProjectRow | null) ?? null;
}

/** Same priority the Publish sheet uses: custom domain → subdomain → build. */
async function resolveLiveUrl(
  project: ProjectRow,
  buildId: string | null,
): Promise<string | null> {
  if (project.primary_domain_id) {
    const { data: domain } = await supabaseAdmin
      .from("project_domains")
      .select("hostname, status")
      .eq("id", project.primary_domain_id)
      .maybeSingle();
    if (domain?.status === "active" && domain.hostname) return `https://${domain.hostname}`;
  }
  if (project.subdomain) return `https://${project.subdomain}.${PETAL_ROOT_DOMAIN}`;

  const target = buildId ?? project.published_build_id ?? project.latest_build_id;
  if (target) {
    const { data: build } = await supabaseAdmin
      .from("project_builds")
      .select("status, dist_path")
      .eq("id", target)
      .maybeSingle();
    if (build?.status === "ready" && build.dist_path) return build.dist_path;
  }

  // Last resort: the newest ready build for this project.
  const { data: latest } = await supabaseAdmin
    .from("project_builds")
    .select("dist_path")
    .eq("project_id", project.id)
    .eq("status", "ready")
    .order("ready_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return latest?.dist_path ?? null;
}

function screenshotEndpoint(target: string, force: boolean): string {
  const params = new URLSearchParams({
    url: target,
    screenshot: "true",
    meta: "false",
    embed: "screenshot.url",
    "viewport.width": "1280",
    "viewport.height": "900",
    waitUntil: "networkidle0",
  });
  if (force) params.set("force", "true");
  return `https://api.microlink.io/?${params.toString()}`;
}

async function fetchScreenshot(target: string): Promise<ArrayBuffer | null> {
  for (const force of [false, true]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), force ? 45000 : 60000);
    try {
      const res = await fetch(screenshotEndpoint(target, force), {
        signal: controller.signal,
        headers: { Accept: "image/*" },
      });
      if (!res.ok) continue;
      const type = res.headers.get("content-type") ?? "";
      if (!type.startsWith("image/")) continue;
      const bytes = await res.arrayBuffer();
      // Anything this small is an error graphic, not a page render.
      if (bytes.byteLength < 5000) continue;
      return bytes;
    } catch {
      // fall through to the retry
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function captureAndStore(
  project: ProjectRow,
  buildId: string | null,
): Promise<SavedThumbnail | null> {
  const live = await resolveLiveUrl(project, buildId);
  if (!live) return null;

  const bytes = await fetchScreenshot(live);
  if (!bytes) return null;

  // Immutable per build, so the CDN can hold it forever.
  const path = `thumbs/${project.id}/${buildId ?? "latest"}-${Date.now()}.png`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: "image/png", upsert: true, cacheControl: "31536000" });
  if (uploadError) return null;

  const url = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  if (!url) return null;

  const { error: saveError } = await supabaseAdmin.from("project_thumbnails").upsert(
    {
      project_id: project.id,
      build_id: buildId,
      url,
      storage_path: path,
      width: 1280,
      height: 900,
      captured_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "project_id" },
  );
  if (saveError) return null;

  return { projectId: project.id, buildId, url };
}

/**
 * Fire-and-forget warm-up used by the build callback: as soon as a build is
 * ready, capture its preview so nobody ever waits for one.
 */
export function warmProjectThumbnail(projectId: string, buildId: string | null): void {
  void ensureSavedThumbnail(projectId, buildId).catch(() => null);
}
