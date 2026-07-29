import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Search,
  X,
  Home,
  Plus,
  LayoutGrid,
  Star,
  User as UserIcon,
  LogOut,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { ProjectThumbnail } from "@/components/ProjectThumbnail";
import { useAuth } from "@/lib/auth";
import {
  listProjects,
  setProjectStarred,
  type ProjectRow,
} from "@/lib/projects";
import { toast } from "sonner";

type Section = "all" | "starred" | "mine";

interface ProjectsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional: project id to highlight as "current". */
  currentProjectId?: string | null;
}

export function ProjectsDrawer({ open, onOpenChange, currentProjectId }: ProjectsDrawerProps) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [section, setSection] = useState<Section>("all");

  // Lazy-load on first open. Refetch silently each open so recent activity stays fresh.
  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    setLoading(projects === null);
    listProjects()
      .then((rows) => {
        if (!cancelled) setProjects(rows);
      })
      .catch((e) => {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Could not load projects");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user]);

  const filtered = useMemo(() => {
    if (!projects) return [] as ProjectRow[];
    const q = query.trim().toLowerCase();
    let list = projects;
    if (section === "starred") list = list.filter((p) => (p as { is_starred?: boolean }).is_starred);
    if (section === "mine" && user) list = list.filter((p) => p.owner_id === user.id);
    if (q) {
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          (p.summary ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [projects, query, section, user]);

  const recents = useMemo(() => (projects ?? []).slice(0, 4), [projects]);

  function go(to: string, search?: Record<string, unknown>) {
    onOpenChange(false);
    if (to === "/builder") {
      navigate({ to: "/builder", search: { id: undefined, prompt: undefined, mode: undefined, attachKey: undefined, ...search } });
    } else if (to === "/") {
      navigate({ to: "/", search: { focus: undefined } });
    } else if (to === "/projects") {
      navigate({ to: "/projects" });
    } else if (to === "/profile") {
      navigate({ to: "/profile" });
    }
  }

  function openProject(id: string) {
    onOpenChange(false);
    navigate({ to: "/builder", search: { id, prompt: undefined, mode: undefined, attachKey: undefined } });
  }

  async function toggleStar(p: ProjectRow, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const cur = (p as { is_starred?: boolean }).is_starred ?? false;
    // optimistic
    setProjects((prev) =>
      prev ? prev.map((x) => (x.id === p.id ? ({ ...x, is_starred: !cur } as ProjectRow) : x)) : prev,
    );
    try {
      await setProjectStarred(p.id, !cur);
    } catch (err) {
      setProjects((prev) =>
        prev ? prev.map((x) => (x.id === p.id ? ({ ...x, is_starred: cur } as ProjectRow) : x)) : prev,
      );
      toast.error(err instanceof Error ? err.message : "Could not update");
    }
  }

  const initial = (user?.email ?? "?")[0]?.toUpperCase() ?? "?";
  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ??
    (user?.user_metadata?.name as string | undefined) ??
    user?.email ??
    "Workspace";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="flex w-[88vw] max-w-md flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetTitle className="sr-only">Projects</SheetTitle>

        {/* Search */}
        <div className="safe-top px-4 pt-4 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects"
              className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-9 text-sm outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Scroll body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {/* Home */}
          <button
            onClick={() => go("/")}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition hover:bg-muted"
          >
            <Home className="h-4.5 w-4.5 text-foreground/80" />
            <span className="font-medium">Home</span>
          </button>

          {/* Recent projects */}
          <div className="mt-4 px-3 pb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Recent projects
          </div>
          <div className="space-y-1">
            <button
              onClick={() => go("/")}
              className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-muted"
            >
              <span className="grid h-12 w-16 shrink-0 place-items-center rounded-lg border border-dashed border-border bg-muted/40">
                <Plus className="h-4 w-4 text-muted-foreground" />
              </span>
              <span className="text-sm font-semibold">Create new project</span>
            </button>

            {loading && projects === null
              ? Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-xl p-2">
                    <div className="h-12 w-16 shrink-0 animate-pulse rounded-lg bg-muted" />
                    <div className="h-3 w-32 animate-pulse rounded bg-muted" />
                  </div>
                ))
              : recents.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => openProject(p.id)}
                    className={`flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-muted ${
                      currentProjectId === p.id ? "bg-muted" : ""
                    }`}
                  >
                    <ProjectThumbnail
                      projectId={p.id}
                      title={p.title}
                      subdomain={p.subdomain}
                      buildId={p.published_build_id ?? p.latest_build_id}
                      className="h-12 w-16 shrink-0 overflow-hidden rounded-lg"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{p.title}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {timeAgo(p.updated_at)}
                      </div>
                    </div>
                  </button>
                ))}
          </div>

          {/* Section switcher */}
          <div className="mt-5 px-3 pb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Projects
          </div>
          <div className="space-y-0.5">
            <SectionRow
              icon={<LayoutGrid className="h-4 w-4" />}
              label="All projects"
              active={section === "all"}
              onClick={() => {
                onOpenChange(false);
                navigate({ to: "/projects" });
              }}
            />
            <SectionRow
              icon={<Star className="h-4 w-4" />}
              label="Starred"
              active={section === "starred"}
              onClick={() => setSection("starred")}
            />
            <SectionRow
              icon={<UserIcon className="h-4 w-4" />}
              label="Created by me"
              active={section === "mine"}
              onClick={() => setSection("mine")}
            />
          </div>

          {/* Filtered list */}
          <div className="mt-2 space-y-0.5">
            {filtered.length === 0 && !loading && (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                {query ? "No matches." : section === "starred" ? "Star a project to pin it here." : "No projects yet."}
              </div>
            )}
            {filtered.map((p) => {
              const starred = (p as { is_starred?: boolean }).is_starred ?? false;
              return (
                <button
                  key={p.id}
                  onClick={() => openProject(p.id)}
                  className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-muted ${
                    currentProjectId === p.id ? "bg-muted" : ""
                  }`}
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/10 text-[11px] font-semibold text-primary">
                    {(p.title || "?")[0]?.toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{p.title}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => toggleStar(p, e)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") toggleStar(p, e as unknown as React.MouseEvent);
                    }}
                    aria-label={starred ? "Unstar" : "Star"}
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition ${
                      starred ? "text-amber-500 opacity-100" : "opacity-0 group-hover:opacity-100"
                    } hover:bg-background hover:text-amber-500`}
                  >
                    <Star className={`h-3.5 w-3.5 ${starred ? "fill-current" : ""}`} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Workspace footer */}
        {user && (
          <div className="safe-bottom border-t border-border bg-card/60 px-3 py-3">
            <div className="flex items-center gap-3 rounded-xl px-2 py-1.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-foreground text-sm font-medium text-background">
                {initial}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{displayName}</div>
                <Link
                  to="/profile"
                  onClick={() => onOpenChange(false)}
                  className="text-[11px] text-muted-foreground hover:underline"
                >
                  View profile
                </Link>
              </div>
              <button
                onClick={async () => {
                  await signOut();
                  onOpenChange(false);
                  navigate({ to: "/" });
                }}
                aria-label="Sign out"
                className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SectionRow({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition ${
        active ? "bg-muted font-semibold" : "hover:bg-muted"
      }`}
    >
      <span className="text-foreground/70">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}
