import { useEffect, useRef, useState } from "react";
import { Loader2, ImageOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Renders a real screenshot of the project by mounting a scaled-down iframe
 * pointing at the latest deployed CDN preview (`project_builds.dist_path`).
 * The iframe only mounts once the card scrolls into view so we never run
 * dozens of preview contexts at once.
 */
export function ProjectThumbnail({
  projectId,
  className = "h-28",
}: {
  projectId: string;
  className?: string;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty">("loading");
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setVisible(true);
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || previewUrl !== null || state !== "loading") return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("project_builds")
        .select("dist_path")
        .eq("project_id", projectId)
        .eq("status", "ready")
        .not("dist_path", "is", null)
        .order("ready_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (data?.dist_path) {
        setPreviewUrl(data.dist_path);
        setState("ready");
      } else {
        setState("empty");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, projectId, previewUrl, state]);

  return (
    <div ref={ref} className={`relative overflow-hidden bg-aurora ${className}`}>
      <div className="absolute inset-0 bg-grain opacity-30" aria-hidden />
      {visible && previewUrl ? (
        <div
          className="pointer-events-none absolute left-0 top-0"
          style={{
            width: "1280px",
            height: "800px",
            transform: "scale(0.25)",
            transformOrigin: "top left",
          }}
        >
          <iframe
            title="preview"
            src={previewUrl}
            sandbox="allow-scripts allow-same-origin"
            loading="lazy"
            className="h-full w-full border-0 bg-white"
          />
        </div>
      ) : state === "empty" ? (
        <div className="grid h-full place-items-center text-muted-foreground">
          <ImageOff className="h-4 w-4" />
        </div>
      ) : (
        <div className="grid h-full place-items-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
