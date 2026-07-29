import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { GitFork, Star, ArrowUpRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/SiteHeader";
import { ProjectThumbnail } from "@/components/ProjectThumbnail";
import { PetalLoader } from "@/components/PetalLoader";
import {
  listPublicProjects,
  setProjectFeatured,
  type ProjectRow,
} from "@/lib/projects";
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
      <main>
        {/* Editorial hero band */}
        <section className="relative overflow-hidden border-b border-border">
          <div className="absolute inset-0 bg-aurora opacity-70" aria-hidden />
          <div className="absolute inset-0 bg-grain opacity-30" aria-hidden />
          <div className="relative mx-auto max-w-6xl px-6 pb-16 pt-16 sm:pt-24">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Built by the community
            </p>
            <h1 className="heading-editorial mt-4 text-5xl sm:text-6xl md:text-7xl">
              The <em>Petal</em> Gallery.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Real apps shipped by real people — from a single sentence. Open one to
              see it live, or remix it and make it yours in a click.
            </p>
          </div>
        </section>

        <div className="mx-auto max-w-6xl px-6 py-14">
          {loading ? (
            <div className="grid place-items-center py-24">
              <PetalLoader size={56} label="Loading gallery…" />
            </div>
          ) : projects.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              {featured.length > 0 && (
                <section>
                  <h2 className="mb-5 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    <Star className="h-3.5 w-3.5 text-primary" /> Featured
                  </h2>
                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {featured.map((p) => (
                      <GalleryCard key={p.id} project={p} isAdmin={isAdmin} onChange={refresh} />
                    ))}
                  </div>
                </section>
              )}

              <section className="mt-14">
                {featured.length > 0 && (
                  <h2 className="mb-5 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Most remixed
                  </h2>
                )}
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {rest.map((p) => (
                    <GalleryCard key={p.id} project={p} isAdmin={isAdmin} onChange={refresh} />
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
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
      <PetalLoader size={56} />
      <h3 className="mt-6 font-display text-2xl">Nothing public yet</h3>
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
      className="group relative flex flex-col overflow-hidden rounded-3xl border border-border bg-card transition duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-editorial)]"
    >
      <div className="relative overflow-hidden">
        <ProjectThumbnail
          projectId={project.id}
          title={project.title}
          subdomain={project.subdomain}
          buildId={project.published_build_id ?? project.latest_build_id}
          className="h-48 transition-transform duration-500 group-hover:scale-[1.03]"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="truncate font-display text-lg font-semibold tracking-tight">
            {project.title}
          </h3>
          {project.is_featured && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              <Star className="h-3 w-3" /> Featured
            </span>
          )}
        </div>
        <div className="mt-auto flex items-center justify-between pt-4 text-[11px] font-medium text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <GitFork className="h-3 w-3" />
            {project.remix_count} {project.remix_count === 1 ? "remix" : "remixes"}
          </span>
          <span className="inline-flex items-center gap-1 text-foreground opacity-0 transition-opacity group-hover:opacity-100">
            Open <ArrowUpRight className="h-3 w-3" />
          </span>
        </div>
      </div>

      {isAdmin && (
        <button
          onClick={toggleFeatured}
          disabled={busy}
          aria-label={project.is_featured ? "Unfeature" : "Feature"}
          className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full bg-card/90 text-muted-foreground opacity-0 backdrop-blur transition hover:text-primary group-hover:opacity-100 disabled:opacity-50"
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

