import { createFileRoute, Link, useNavigate, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { GitFork, ArrowUpRight, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import {
  getProjectBySlug,
  remixProjectBySlug,
  type ProjectRow,
} from "@/lib/projects";
import { resolvePublishedUrl, type PublishedUrlResult } from "@/lib/published-url";
import { toVisitorSummary } from "@/lib/visitor-summary";
import { supabase } from "@/integrations/supabase/client";
import { ProjectThumbnail } from "@/components/ProjectThumbnail";
import logo from "/petal-logo.png";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/p/$slug")({
  loader: async ({ params }) => {
    const project = await getProjectBySlug(params.slug);
    if (!project || !project.is_public) throw notFound();
    const published = await resolvePublishedUrl(
      project.id,
      project.primary_domain_id ?? null,
      project.published_build_id ?? null,
    );
    return { project, published };
  },
  head: ({ loaderData }) => {
    const title = loaderData?.project?.title ?? "Petal project";
    const description = toVisitorSummary(loaderData?.project?.summary, title);
    return {
      meta: [
        { title: `${title} · Petal` },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
      ],
    };
  },
  notFoundComponent: () => (
    <div className="grid min-h-screen place-items-center bg-background text-center">
      <div className="max-w-sm space-y-3 p-8">
        <h1 className="font-display text-3xl">Project not found</h1>
        <p className="text-sm text-muted-foreground">
          This project may be private or no longer exists.
        </p>
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Go home
        </Link>
      </div>
    </div>
  ),
  component: PublicPreview,
});

function PublicPreview() {
  const { project, published } = Route.useLoaderData() as {
    project: ProjectRow;
    published: PublishedUrlResult;
  };
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [remixing, setRemixing] = useState(false);

  async function doRemix() {
    setRemixing(true);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        navigate({
          to: "/auth",
          search: { mode: "signup", redirect: `/p/${project.slug}?remix=1` },
        });
        return;
      }
      const fresh = await remixProjectBySlug(project.slug);
      toast.success("Remixed! Opening your copy…");
      navigate({ to: "/builder", search: { id: fresh.id, prompt: undefined, mode: undefined, attachKey: undefined } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remix this project");
    } finally {
      setRemixing(false);
      setConfirmOpen(false);
    }
  }

  // Auto-trigger remix after returning from auth.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("remix") === "1") {
      url.searchParams.delete("remix");
      window.history.replaceState({}, "", url.toString());
      void doRemix();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold">
            <img src={logo} alt="" className="h-6 w-6" />
            <span className="font-display text-base tracking-tight">Petal</span>
          </Link>
          <Link
            to="/gallery"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Back to gallery
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12">
        <div className="grid gap-10 lg:grid-cols-[1fr,1.4fr] lg:items-start">
          {/* Left: project meta */}
          <div className="space-y-5">
            <p className="text-xs font-medium uppercase tracking-wider text-primary">
              Community project
            </p>
            <h1 className="font-display text-4xl leading-tight md:text-5xl">
              {project.title}
            </h1>
            {project.summary && (
              <p className="text-base text-muted-foreground">{project.summary}</p>
            )}

            <div className="flex flex-wrap gap-3 pt-2">
              {published.url ? (
                <a
                  href={published.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:brightness-110"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open live site
                </a>
              ) : null}
              <button
                onClick={() => setConfirmOpen(true)}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition hover:brightness-105"
              >
                <GitFork className="h-4 w-4" />
                Remix this app
              </button>
            </div>

            {published.display && (
              <p className="pt-1 text-xs text-muted-foreground">
                Live at{" "}
                <span className="font-mono text-foreground/80">
                  {published.display}
                </span>
              </p>
            )}

            <div className="rounded-2xl border border-border bg-card/50 p-4 text-xs text-muted-foreground">
              Remixing creates a fresh copy under your account. The original
              project is never modified.
            </div>
          </div>

          {/* Right: live thumbnail */}
          <a
            href={published.url ?? undefined}
            target={published.url ? "_blank" : undefined}
            rel="noopener noreferrer"
            className="group relative block overflow-hidden rounded-3xl border border-border bg-card aspect-[4/3] shadow-[var(--shadow-editorial)]"
            aria-label={published.url ? `Open ${project.title} in a new tab` : project.title}
          >
            <ProjectThumbnail
              projectId={project.id}
              title={project.title}
              subdomain={project.subdomain}
              publishedUrl={published.url}
              fit="contain"
              className="absolute inset-0 h-full w-full transition-transform duration-500 group-hover:scale-[1.03]"
            />
            {published.url && (
              <div className="absolute bottom-4 right-4 inline-flex items-center gap-1.5 rounded-full bg-foreground/90 px-3 py-1.5 text-xs font-medium text-background opacity-0 transition group-hover:opacity-100">
                Open <ArrowUpRight className="h-3 w-3" />
              </div>
            )}
          </a>
        </div>
      </main>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitFork className="h-4 w-4" />
              Remix “{project.title}”?
            </DialogTitle>
            <DialogDescription>
              We'll create a fresh copy of this project under your account so you can
              edit it freely. The original stays untouched.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <button
              onClick={() => setConfirmOpen(false)}
              disabled={remixing}
              className="rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => void doRemix()}
              disabled={remixing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:brightness-105 disabled:opacity-50"
            >
              {remixing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowUpRight className="h-3.5 w-3.5" />
              )}
              Yes, remix it
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
