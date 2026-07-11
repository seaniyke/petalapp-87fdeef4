import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Trash2, Sparkles, Globe, Lock } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { ProjectThumbnail } from "@/components/ProjectThumbnail";
import { useAuth } from "@/lib/auth";
import {
  listProjects,
  deleteProject,
  type ProjectRow,
} from "@/lib/projects";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/projects")({
  head: () => ({
    meta: [
      { title: "My projects · Petal" },
      { name: "description", content: "All your Petal projects in one place." },
    ],
  }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const { user, isReady } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<ProjectRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Prewarm the in-browser preview container as soon as the user reaches the
  // projects list. Opening ANY project from here will then skip the "installing
  // dependencies…" wait because node_modules is already populated in the
  // shared WebContainer instance. Best-effort — swallow all errors.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (typeof window === "undefined") return;
        if ((window as Window).crossOriginIsolated !== true) return;
        const mod = await import("@/lib/webcontainer");
        if (cancelled) return;
        void mod.prewarmContainer();
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!isReady) return;

    if (!user) {
      setProjects([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    listProjects()
      .then((rows) => {
        if (!cancelled) setProjects(rows);
      })
      .catch((e) => {
        if (!cancelled) toast.error(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isReady, user]);

  // Send the user to the landing page composer instead of straight to /builder.
  // This way, by the time they arrive at /builder, the prompt is already in flight
  // and a real project title can be inferred from it — no more "Loading…" header
  // sitting over an empty composer. Mirrors the Lovable / v0 / Bolt flow.
  function handleCreate() {
    navigate({ to: "/", search: { focus: "composer" } });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setDeleting(true);
    try {
      await deleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      toast.success("Project deleted");
      setPendingDelete(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-wider text-primary">Workspace</p>
            <h1 className="mt-2 font-display text-4xl">My projects</h1>
            <p className="mt-2 text-muted-foreground">
              Pick up where you left off, or start something new.
            </p>
          </div>
          <button
            onClick={handleCreate}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition hover:brightness-105"
          >
            <Plus className="h-4 w-4" />
            New project
          </button>
        </div>

        <div className="mt-10">
          {loading ? (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-44 animate-pulse rounded-2xl border border-border bg-card" />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <EmptyState onCreate={handleCreate} />
          ) : (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-2">
              {projects.map((p) => (
                <ProjectCard key={p.id} project={p} onDelete={() => setPendingDelete(p)} />
              ))}
            </div>
          )}
        </div>
      </main>

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? (
                <>
                  <span className="font-medium text-foreground">{pendingDelete.title}</span>{" "}
                  and all of its files, messages, and versions will be permanently
                  removed. This can't be undone.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete project"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ProjectCard({ project, onDelete }: { project: ProjectRow; onDelete: () => void }) {
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]">
      <Link
        to="/builder"
        search={{ id: project.id, prompt: undefined, mode: undefined, attachKey: undefined }}
        className="flex flex-1 flex-col"
      >
        <div className="relative">
          <ProjectThumbnail
            projectId={project.id}
            title={project.title}
            subdomain={project.subdomain}
            className="h-28"
          />
          <div className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-card/90 px-2 py-0.5 text-[10px] font-medium text-muted-foreground backdrop-blur">
            {project.is_public ? (
              <>
                <Globe className="h-3 w-3" /> Public
              </>
            ) : (
              <>
                <Lock className="h-3 w-3" /> Private
              </>
            )}
          </div>
        </div>
        <div className="flex flex-1 flex-col p-4">
          <h3 className="truncate font-semibold">{project.title}</h3>
          <div className="mt-auto pt-3 text-[11px] text-muted-foreground">
            Updated {new Date(project.updated_at).toLocaleDateString()}
          </div>
        </div>
      </Link>
      <button
        onClick={onDelete}
        className="absolute right-3 bottom-3 grid h-7 w-7 place-items-center rounded-full bg-card text-muted-foreground shadow-sm transition hover:text-destructive md:bg-card/0 md:opacity-0 md:shadow-none md:group-hover:bg-card md:group-hover:opacity-100"
        aria-label="Delete project"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-3xl border border-dashed border-border bg-card/60 p-12 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-butter">
        <Sparkles className="h-6 w-6 text-foreground/70" />
      </div>
      <h3 className="mt-4 font-display text-2xl">No projects yet</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
        Spin up your first one and describe what you want to build. Petal will write the
        files for you.
      </p>
      <button
        onClick={onCreate}
        className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition hover:brightness-105"
      >
        <Plus className="h-4 w-4" />
        Create your first project
      </button>
    </div>
  );
}
