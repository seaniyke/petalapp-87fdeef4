import { createFileRoute, Link, useNavigate, notFound } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Sparkles, GitFork, ArrowUpRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  getProjectBySlug,
  loadProjectFiles,
  remixProjectBySlug,
  type ProjectRow,
} from "@/lib/projects";
import type { ProjectFile } from "@/server/generate.server";
import { buildPreviewDoc } from "@/lib/preview";
import { supabase } from "@/integrations/supabase/client";
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
    const files = await loadProjectFiles(project.id);
    return { project, files };
  },
  head: ({ loaderData }) => {
    const title = loaderData?.project?.title ?? "Petal project";
    const description = loaderData?.project?.summary ?? "Built with Petal.";
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
  const { project, files } = Route.useLoaderData() as {
    project: ProjectRow;
    files: ProjectFile[];
  };
  const navigate = useNavigate();
  const previewDoc = useMemo(() => buildPreviewDoc(files), [files]);
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
      navigate({ to: "/builder", search: { id: fresh.id, prompt: undefined } });
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
    <div className="relative h-screen w-screen overflow-hidden bg-background">
      {files.length > 0 ? (
        <iframe
          title={project.title}
          sandbox="allow-scripts allow-forms allow-modals"
          srcDoc={previewDoc}
          className="h-full w-full border-0"
        />
      ) : (
        <div className="grid h-full place-items-center text-sm text-muted-foreground">
          This project has no files yet.
        </div>
      )}

      {/* Floating footer */}
      <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
        <div className="pointer-events-auto flex max-w-[640px] items-center gap-3 rounded-full border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-muted-foreground transition hover:text-foreground"
            title="Made with Petal"
          >
            <span className="grid h-5 w-5 place-items-center rounded-md bg-primary text-primary-foreground">
              <Sparkles className="h-3 w-3" />
            </span>
            Made with Petal
          </Link>
          <div className="h-4 w-px bg-border" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium leading-tight">
              {project.title}
            </div>
            {project.summary && (
              <div className="truncate text-[11px] text-muted-foreground leading-tight">
                {project.summary}
              </div>
            )}
          </div>
          <button
            onClick={() => setConfirmOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background transition hover:brightness-110"
          >
            <GitFork className="h-3.5 w-3.5" />
            Remix
          </button>
        </div>
      </div>

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
