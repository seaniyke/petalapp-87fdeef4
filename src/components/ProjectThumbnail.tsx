import { useEffect, useRef, useState } from "react";
import { Loader2, Lock } from "lucide-react";
import { loadProjectFiles } from "@/lib/projects";
import { buildPreviewDoc } from "@/lib/preview";

/**
 * Renders a tiny live iframe of the project, scaled down to act as a real
 * screenshot/thumbnail. Files are fetched lazily, and the iframe only mounts
 * when the card scrolls into view (and unmounts when scrolled out) so we
 * never run dozens of preview contexts at once.
 */
export function ProjectThumbnail({
  projectId,
  className = "h-28",
}: {
  projectId: string;
  className?: string;
}) {
  const [doc, setDoc] = useState<string | null>(null);
  const [error, setError] = useState(false);
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
        for (const entry of entries) setVisible(entry.isIntersecting);
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || doc !== null || error) return;
    let cancelled = false;
    loadProjectFiles(projectId)
      .then((files) => {
        if (cancelled) return;
        if (files.length === 0) {
          setError(true);
          return;
        }
        setDoc(buildPreviewDoc(files));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, projectId, doc, error]);

  return (
    <div
      ref={ref}
      className={`relative overflow-hidden bg-aurora ${className}`}
    >
      <div className="absolute inset-0 bg-grain opacity-30" aria-hidden />
      {visible && doc ? (
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
            srcDoc={doc}
            sandbox="allow-scripts"
            loading="lazy"
            className="h-full w-full border-0 bg-white"
          />
        </div>
      ) : error ? (
        <div className="grid h-full place-items-center text-xs text-muted-foreground">
          <Lock className="h-4 w-4" />
        </div>
      ) : (
        <div className="grid h-full place-items-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )}
    </div>
  );
}