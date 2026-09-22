/**
 * Project thumbnail used by the gallery, project pages, the projects drawer
 * and the homepage showcase.
 *
 * Previews are captured ONCE per build and stored as a real image file in
 * Kimble's own storage (see `src/server/project-thumbnail.server.ts`). This
 * component only ever renders that saved image, so tiles appear instantly on
 * every visit instead of asking a screenshot service to re-render the app
 * live while the user waits.
 *
 * When no saved preview exists yet, we show the branded gradient tile and
 * quietly ask the server to capture one; it swaps in as soon as it lands
 * (and is instant for everyone afterwards).
 */
import { useEffect, useState } from "react";
import {
  getSavedThumbnails,
  ensureSavedThumbnail,
} from "@/lib/project-thumbnail.functions";

/** projectId -> saved image URL (or null when we know there isn't one yet). */
const savedCache = new Map<string, string | null>();
/** Projects we've already asked the server to capture this session. */
const captureRequested = new Set<string>();

type Waiter = { id: string; resolve: (url: string | null) => void };
let queue: Waiter[] = [];
let queueTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Micro-batch the lookups: a 60-card gallery makes ONE request for all its
 * saved previews instead of sixty.
 */
function lookupSaved(projectId: string): Promise<string | null> {
  if (savedCache.has(projectId)) {
    return Promise.resolve(savedCache.get(projectId) ?? null);
  }
  return new Promise((resolve) => {
    queue.push({ id: projectId, resolve });
    if (queueTimer) return;
    queueTimer = setTimeout(() => {
      const batch = queue;
      queue = [];
      queueTimer = null;
      const ids = [...new Set(batch.map((w) => w.id))];
      void getSavedThumbnails({ data: { projectIds: ids } })
        .then((res) => {
          const map = res?.thumbnails ?? {};
          for (const id of ids) savedCache.set(id, map[id]?.url ?? null);
          for (const w of batch) w.resolve(savedCache.get(w.id) ?? null);
        })
        .catch(() => {
          for (const w of batch) w.resolve(null);
        });
    }, 40);
  });
}

/**
 * Ask the server to capture a preview for a project that doesn't have one.
 * Best-effort and at most once per project per session.
 */
async function requestCapture(
  projectId: string,
  buildId?: string | null,
): Promise<string | null> {
  if (captureRequested.has(projectId)) return null;
  captureRequested.add(projectId);
  try {
    const res = await ensureSavedThumbnail({
      data: { projectId, buildId: buildId ?? null },
    });
    const url = res?.url ?? null;
    if (url) savedCache.set(projectId, url);
    return url;
  } catch {
    return null;
  }
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
  /** The project's claimed Kimble subdomain slug, e.g. "my-app". */
  subdomain?: string | null;
  /** An active custom domain hostname, e.g. "example.com". */
  customDomain?: string | null;
  /** Explicit override — used by callers that already resolved the URL. */
  publishedUrl?: string | null;
  /** The project's published (or latest) build id, so a fresh deploy re-captures. */
  buildId?: string | null;
  /** "cover" crops to fill (grid tiles); "contain" shows the whole page (detail hero). */
  fit?: "cover" | "contain";
}) {
  // These stay in the public API because every call site passes them; the
  // server resolves the live URL itself when it captures.
  void subdomain;
  void customDomain;
  void publishedUrl;

  const [src, setSrc] = useState<string | null>(
    () => savedCache.get(projectId) ?? null,
  );
  const [loaded, setLoaded] = useState(false);
  const contain = fit === "contain";

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    setLoaded(false);
    setSrc(savedCache.get(projectId) ?? null);

    void (async () => {
      const found = await lookupSaved(projectId);
      if (!alive) return;
      if (found) {
        setSrc(found);
        return;
      }
      // Nothing saved yet — capture in the background and swap it in.
      const captured = await requestCapture(projectId, buildId);
      if (alive && captured) setSrc(captured);
    })();

    return () => {
      alive = false;
    };
  }, [projectId, buildId]);

  return (
    <div
      className={`relative overflow-hidden ${contain ? "bg-muted/30" : ""} ${className}`}
      aria-hidden
    >
      {/* The branded tile sits underneath, so there is never a blank box or a
          spinner — the saved image simply fades over it once decoded. */}
      <Fallback projectId={projectId} title={title} />
      {src && (
        <img
          // A saved image may already be in the browser cache before React
          // hydrates, in which case onLoad never fires.
          ref={(el) => {
            if (el && el.complete && el.naturalWidth > 0) setLoaded(true);
          }}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className={`absolute inset-0 h-full w-full ${contain ? "object-contain object-center bg-muted/30" : "object-cover object-top"} transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(false)}
        />
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
