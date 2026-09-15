/**
 * Project thumbnail used by the gallery, projects page, and projects drawer.
 *
 * Behavior:
 *   - If the project has a published URL (custom domain or
 *     <slug>.buildwithpetal.com), we render a real screenshot using
 *     Microlink's free screenshot endpoint. No API key required.
 *   - If the screenshot fails to load OR the project hasn't been published
 *     yet, we fall back to a deterministic gradient tile with the project's
 *     initials — fast, attractive, and always works.
 *
 * Microlink free tier serves the image directly via:
 *   https://api.microlink.io/?url=<URL>&screenshot=true&meta=false&embed=screenshot.url
 * It caches results aggressively, so repeat visits are instant.
 */
import { useEffect, useState } from "react";
import { PETAL_ROOT_DOMAIN } from "@/lib/petal-subdomain";
import { PetalLoader } from "@/components/PetalLoader";
import { supabase } from "@/integrations/supabase/client";

/**
 * Cache of project id -> deployment URL so a 60-card gallery doesn't fire the
 * same lookup twice. Shared across every mounted thumbnail.
 *
 * The lookup goes through `project_screenshot_url`, a security-definer
 * function that returns the latest READY build's public deployment URL for a
 * project the caller may see (public, or their own). That URL is reachable by
 * the screenshot service — unlike `/api/preview/:id`, which requires a bearer
 * token and therefore always rendered as a blank/authwall tile.
 */
const deployUrlCache = new Map<string, Promise<string | null>>();

function fetchDeployUrl(projectId: string, buildId?: string | null): Promise<string | null> {
  // Keyed by build so a fresh deploy re-resolves instead of serving the URL
  // of the previous build forever.
  const key = `${projectId}:${buildId ?? ""}`;
  const cached = deployUrlCache.get(key);
  if (cached) return cached;
  const p = (async () => {
    try {
      const { data } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: string | null }>
      )("project_screenshot_url", { p_project_id: projectId });
      return typeof data === "string" && data ? data : null;
    } catch {
      return null;
    }
  })();

  deployUrlCache.set(key, p);
  return p;
}


export function ProjectThumbnail({
  projectId,
  className = "h-28",
  title,
  subdomain,
  customDomain,
  publishedUrl,
  buildId,
  fit = "cover",
}: {
  projectId: string;
  className?: string;
  title?: string;
  /** The project's claimed Petal subdomain slug, e.g. "my-app". */
  subdomain?: string | null;
  /** An active custom domain hostname, e.g. "example.com". */
  customDomain?: string | null;
  /** Explicit override — used by callers that already resolved the URL. */
  publishedUrl?: string | null;
  /**
   * The project's published (or latest) build id. When the project has no
   * subdomain or custom domain we resolve this build's deployment URL and
   * screenshot that, so every shipped app has a real thumbnail.
   */
  buildId?: string | null;
  /** "cover" crops to fill (grid tiles); "contain" shows the whole page (detail hero). */
  fit?: "cover" | "contain";
}) {
  const [deployUrl, setDeployUrl] = useState<string | null>(null);
  // Every unpublished project gets a lookup — a build id is a nice hint that
  // one exists, but cards in the drawer/gallery often don't carry it.
  const needsDeployUrl = !publishedUrl && !customDomain && !subdomain && !!projectId;

  useEffect(() => {
    if (!needsDeployUrl) return;
    let alive = true;
    void fetchDeployUrl(projectId, buildId).then((url) => {
      if (alive) setDeployUrl(url);
    });
    return () => {
      alive = false;
    };
    // `buildId` participates so a freshly finished build re-resolves.
  }, [needsDeployUrl, projectId, buildId]);


  const url = resolveLiveUrl({
    projectId,
    subdomain,
    customDomain,
    publishedUrl: publishedUrl ?? deployUrl,
  });
  const contain = fit === "contain";
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Retry counter for the screenshot provider. We only ever use Microlink:
  // it returns the real page screenshot or nothing. (The WordPress mShots
  // backup was removed — while it warms a page it serves a generic WordPress
  // "W" placeholder image, which shipped as the app's thumbnail.)
  const [attempt, setAttempt] = useState(0);
  const showImage = url && !failed;

  // Reset whenever the resolved target changes (e.g. a build just landed).
  useEffect(() => {
    setFailed(false);
    setLoaded(false);
    setAttempt(0);
  }, [url]);

  // The screenshot service can hang (cold render, rate limit) without ever
  // firing onError, which left the tile showing a spinner forever. Cold
  // renders routinely take 20-40s, so the first attempt gets a generous
  // deadline, then we retry with a cache-bypass, then fall back to the
  // gradient.
  useEffect(() => {
    if (!showImage || loaded) return;
    const t = setTimeout(() => {
      setAttempt((a) => {
        if (a < 2) return a + 1;
        setFailed(true);
        return a;
      });
    }, attempt === 0 ? 30000 : 20000);
    return () => clearTimeout(t);
  }, [showImage, loaded, url, attempt]);

  // A transient cold-render failure used to stick the gradient tile forever.
  // Give the provider one more chance a little later — by then its cache is
  // warm and the retry is cheap.
  useEffect(() => {
    if (!failed) return;
    const t = setTimeout(() => {
      setFailed(false);
      setLoaded(false);
      setAttempt(1);
    }, 60000);
    return () => clearTimeout(t);
  }, [failed, url]);




  return (
    <div
      className={`relative overflow-hidden ${contain ? "bg-muted/30" : ""} ${className}`}
      aria-hidden
    >
      {showImage ? (
        <>
          {!loaded && (
            <div className="absolute inset-0 grid place-items-center bg-muted/40">
              <PetalLoader size={28} />
            </div>
          )}
          <img
            key={attempt}
            src={screenshotUrl(url, fit, attempt)}
            alt=""
            loading="eager"
            decoding="async"
            fetchPriority="high"
            className={`absolute inset-0 h-full w-full ${contain ? "object-contain object-center" : "object-cover object-top"} transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`}
            onLoad={() => setLoaded(true)}
            onError={() => (attempt === 0 ? setAttempt(1) : setFailed(true))}
          />
        </>
      ) : (
        <Fallback projectId={projectId} title={title} />
      )}
    </div>
  );
}

function Fallback({ projectId, title }: { projectId: string; title?: string }) {
  const palette = pickPalette(projectId);
  const initials = (title ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "·";

  return (
    <div
      className="absolute inset-0"
      style={{ background: palette.gradient }}
    >
      <div className="absolute inset-0 bg-grain opacity-25" />
      <div className="absolute inset-0 grid place-items-center">
        <div
          className="grid h-14 w-14 place-items-center rounded-2xl bg-white/85 text-lg font-display text-foreground shadow-[var(--shadow-soft)] backdrop-blur"
          style={{ color: palette.ink }}
        >
          {initials}
        </div>
      </div>
    </div>
  );
}

function resolveLiveUrl({
  projectId,
  subdomain,
  customDomain,
  publishedUrl,
}: {
  projectId?: string;
  subdomain?: string | null;
  customDomain?: string | null;
  publishedUrl?: string | null;
}): string | null {
  if (publishedUrl) return publishedUrl;
  if (customDomain) return `https://${customDomain}`;
  if (subdomain) return `https://${subdomain}.${PETAL_ROOT_DOMAIN}`;
  // No live URL resolved yet. We deliberately do NOT point the screenshot
  // service at /api/preview/:id — that route requires a bearer token, so the
  // service would capture an empty auth wall and ship it as the thumbnail.
  // The branded gradient tile is the honest fallback until a build deploys.
  void projectId;
  return null;
}


function screenshotUrl(
  target: string,
  fit: "cover" | "contain" = "cover",
  attempt = 0,
): string {
  // Microlink free endpoint — returns the real page screenshot directly. We
  // pass a viewport sized for a nice card crop and wait for network idle so
  // SPAs finish rendering before the snapshot is taken.
  //
  // There is deliberately no second provider: mShots answers cold requests
  // with a generic WordPress placeholder graphic, and that placeholder was
  // being shown to users as their app's thumbnail. A real screenshot or the
  // branded gradient tile — never someone else's logo.
  const params = new URLSearchParams({
    url: target,
    screenshot: "true",
    meta: "false",
    embed: "screenshot.url",
    "viewport.width": fit === "contain" ? "1200" : "1280",
    // 4:3 for contained hero cards so the whole page fits the box with no crop.
    "viewport.height": fit === "contain" ? "900" : "800",
    waitUntil: "networkidle0",
  });
  // Retry bypasses any cached failure without changing providers.
  if (attempt > 0) params.set("force", "true");
  return `https://api.microlink.io/?${params.toString()}`;
}


const PALETTES = [
  { gradient: "linear-gradient(135deg,#FFD8C2 0%,#F8B4A0 50%,#E59FB7 100%)", ink: "#5B2A3A" },
  { gradient: "linear-gradient(135deg,#C7E7FF 0%,#A8C5FF 50%,#9D9BFF 100%)", ink: "#1F2960" },
  { gradient: "linear-gradient(135deg,#FFE6A8 0%,#FFC176 50%,#F58A6A 100%)", ink: "#5A2B14" },
  { gradient: "linear-gradient(135deg,#D6F1D8 0%,#9DD9C0 50%,#5FB4B5 100%)", ink: "#173E3D" },
  { gradient: "linear-gradient(135deg,#F4E5FF 0%,#D9B8FF 50%,#A487E0 100%)", ink: "#3A1F66" },
  { gradient: "linear-gradient(135deg,#FFE5EC 0%,#FFB5C5 50%,#FF7E9D 100%)", ink: "#5C1B30" },
  { gradient: "linear-gradient(135deg,#E8E0D2 0%,#D6C4A1 50%,#B89C6A 100%)", ink: "#3F3115" },
  { gradient: "linear-gradient(135deg,#D4F1F4 0%,#75CFB8 50%,#3B7A8A 100%)", ink: "#0E2F38" },
];

function pickPalette(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTES[h % PALETTES.length];
}
