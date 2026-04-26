import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Sparkles, GitFork, Star, Loader2, ArrowUpRight, Lock } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/SiteHeader";
import {
  listPublicProjects,
  loadProjectFiles,
  setProjectFeatured,
  type ProjectRow,
} from "@/lib/projects";
import { buildPreviewDoc } from "@/lib/preview";
import { useIsAdmin } from "@/hooks/use-is-admin";

export const Route = createFileRoute("/gallery")({
  head: () => ({
    meta: [
      { title: "Gallery · Petal" },
      {
        name: "description",
        content:
          "Discover apps the Petal community is building. Open any project, peek inside, and remix it as your own.",
      },
      { property: "og:title", content: "Petal Gallery" },
      {
        property: "og:description",
        content: "Discover and remix apps built on Petal.",
      },
    ],
  }),
  component: GalleryPage,
});

function GalleryPage() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const { isAdmin } = useIsAdmin();

  useEffect(() => {
    listPublicProjects()
      .then(setProjects)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load gallery"))
      .finally(() => setLoading(false));
  }, []);

  const featured = useMemo(() => projects.filter((p) => p.is_featured), [projects]);
  const rest = useMemo(() => projects.filter((p) => !p.is_featured), [projects]);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="max-w-2xl">
          <p className="text-sm font-medium uppercase tracking-wider text-primary">Community</p>
          <h1 className="mt-2 font-display text-4xl md:text-5xl">Gallery</h1>
          <p className="mt-3 text-muted-foreground">
            Apps built by the Petal community. Open one to see it live, or remix it
            and make it yours.
          </p>
        </div>

        {loading ? (
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-64 animate-pulse rounded-2xl border border-border bg-card" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {featured.length > 0 && (
              <section className="mt-10">
                <h2 className="mb-4 inline-flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
                  <Star className="h-3.5 w-3.5 text-primary" /> Featured
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {featured.map((p) => (
                    <GalleryCard key={p.id} project={p} isAdmin={isAdmin} onChange={refresh} />
                  ))}
                </div>
              </section>
            )}

            <section className="mt-12">
              {featured.length > 0 && (
                <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-muted-foreground">
                  Most remixed
                </h2>
              )}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {rest.map((p) => (
                  <GalleryCard key={p.id} project={p} isAdmin={isAdmin} onChange={refresh} />
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );

  function refresh() {
    listPublicProjects()
      .then(setProjects)
      .catch(() => {});
  }
}

function EmptyState() {
  return (
    <div className="mt-10 rounded-3xl border border-dashed border-border bg-card/60 p-12 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-butter">
        <Sparkles className="h-6 w-6 text-foreground/70" />
      </div>
      <h3 className="mt-4 font-display text-2xl">Nothing public yet</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        Be the first to share a project. Open any of your projects, flip the
        share toggle to public, and it will show up here.
      </p>
    </div>
  );
}

function GalleryCard({
  project,
  isAdmin,
  onChange,
}: {
  project: ProjectRow;
  isAdmin: boolean;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function toggleFeatured(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    try {
      await setProjectFeatured(project.id, !project.is_featured);
      toast.success(project.is_featured ? "Unfeatured" : "Featured");
      onChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Link
      to="/p/$slug"
      params={{ slug: project.slug }}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]"
    >
      <Thumbnail projectId={project.id} />

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="truncate font-semibold">{project.title}</h3>
          {project.is_featured && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
              <Star className="h-3 w-3" /> Featured
            </span>
          )}
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          {project.summary ?? "No description yet."}
        </p>
        <div className="mt-auto flex items-center justify-between pt-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <GitFork className="h-3 w-3" />
            {project.remix_count} {project.remix_count === 1 ? "remix" : "remixes"}
          </span>
          <span className="inline-flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
            Open <ArrowUpRight className="h-3 w-3" />
          </span>
        </div>
      </div>

      {isAdmin && (
        <button
          onClick={toggleFeatured}
          disabled={busy}
          aria-label={project.is_featured ? "Unfeature" : "Feature"}
          className="absolute right-3 top-3 z-10 grid h-7 w-7 place-items-center rounded-full bg-card/90 text-muted-foreground opacity-0 backdrop-blur transition hover:text-primary group-hover:opacity-100 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Star
              className={`h-3.5 w-3.5 ${project.is_featured ? "fill-primary text-primary" : ""}`}
            />
          )}
        </button>
      )}
    </Link>
  );
}

/**
 * Renders a tiny live iframe of the project, scaled down. Files are fetched
 * lazily, and the iframe only mounts when the card scrolls into view (and
 * unmounts when scrolled out) so we never run 60 model contexts at once.
 */
function Thumbnail({ projectId }: { projectId: string }) {
  const [doc, setDoc] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Observe visibility — only fetch + render when on screen.
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
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Fetch files only once, the first time we become visible.
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
    <div ref={ref} className="relative h-40 overflow-hidden bg-aurora">
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
