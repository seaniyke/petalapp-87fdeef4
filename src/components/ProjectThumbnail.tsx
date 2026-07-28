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
import { useState } from "react";
import { PETAL_ROOT_DOMAIN } from "@/lib/petal-subdomain";
import { PetalLoader } from "@/components/PetalLoader";

export function ProjectThumbnail({
  projectId,
  className = "h-28",
  title,
  subdomain,
  customDomain,
  publishedUrl,
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
  /** "cover" crops to fill (grid tiles); "contain" shows the whole page (detail hero). */
  fit?: "cover" | "contain";
}) {
  const url = resolveLiveUrl({ projectId, subdomain, customDomain, publishedUrl });
  const contain = fit === "contain";
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const showImage = url && !failed;

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
            src={screenshotUrl(url, fit)}
            alt=""
            loading="eager"
            decoding="async"
            fetchPriority="high"
            className={`absolute inset-0 h-full w-full ${contain ? "object-contain object-center" : "object-cover object-top"} transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
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
          className="grid h-14 w-14 place-items-center rounded-2xl bg-white/85 text-lg font-display text-foreground shadow-md backdrop-blur"
          style={{ color: palette.ink }}
        >
          {initials}
        </div>
      </div>
    </div>
  );
}

function resolveLiveUrl({
  subdomain,
  customDomain,
  publishedUrl,
}: {
  subdomain?: string | null;
  customDomain?: string | null;
  publishedUrl?: string | null;
}): string | null {
  if (publishedUrl) return publishedUrl;
  if (customDomain) return `https://${customDomain}`;
  if (subdomain) return `https://${subdomain}.${PETAL_ROOT_DOMAIN}`;
  return null;
}

function screenshotUrl(target: string, fit: "cover" | "contain" = "cover"): string {
  // Microlink free endpoint — returns the screenshot image directly. We pass
  // viewport sized for a nice card crop and a short waitUntil so SPAs render
  // before the snapshot is taken.
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
