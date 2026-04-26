import { createFileRoute, Link, useNavigate, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Loader2, Trash2, ExternalLink, Sparkles, Globe, Lock } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { useAuth } from "@/lib/auth";
import {
  listProjects,
  createProject,
  deleteProject,
  type ProjectRow,
} from "@/lib/projects";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/projects")({
  beforeLoad: async () => {
    // Auth gate
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/auth", search: { mode: "signin", redirect: "/projects" } });
    }
  },
  head: () => ({
    meta: [
      { title: "My projects · Petal" },
      { name: "description", content: "All your Petal projects in one place." },
    ],
  }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!user) return;
    listProjects()
      .then(setProjects)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [user]);

  async function handleCreate() {
    setCreating(true);
    try {
      const p = await createProject();
      navigate({ to: "/builder", search: { id: p.id, prompt: undefined } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create project");
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this project? This can't be undone.")) return;
    try {
      await deleteProject(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      toast.success("Project deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not delete");
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
            disabled={creating}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition hover:brightness-105 disabled:opacity-60"
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            New project
          </button>
        </div>

        <div className="mt-10">
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-44 animate-pulse rounded-2xl border border-border bg-card" />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <EmptyState onCreate={handleCreate} creating={creating} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((p) => (
                <ProjectCard key={p.id} project={p} onDelete={() => handleDelete(p.id)} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function ProjectCard({ project, onDelete }: { project: ProjectRow; onDelete: () => void }) {
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)]">
      <Link
        to="/builder"
        search={{ id: project.id, prompt: undefined }}
        className="flex flex-1 flex-col"
      >
        <div className="relative h-28 bg-aurora">
          <div className="absolute inset-0 bg-grain opacity-30" />
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
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {project.summary ?? "No description yet."}
          </p>
          <div className="mt-auto pt-3 text-[11px] text-muted-foreground">
            Updated {new Date(project.updated_at).toLocaleDateString()}
          </div>
        </div>
      </Link>
      <button
        onClick={onDelete}
        className="absolute right-3 bottom-3 grid h-7 w-7 place-items-center rounded-full bg-card/0 text-muted-foreground opacity-0 transition group-hover:bg-card group-hover:opacity-100 hover:text-destructive"
        aria-label="Delete project"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function EmptyState({ onCreate, creating }: { onCreate: () => void; creating: boolean }) {
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
        disabled={creating}
        className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground transition hover:brightness-105 disabled:opacity-60"
      >
        {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Create your first project
      </button>
    </div>
  );
}
