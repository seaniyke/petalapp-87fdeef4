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
  type ProjectRow,
} from "@/lib/projects";
import { toast } from "sonner";

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

  const recents = useMemo(() => {
    let list = projects ?? [];
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          (p.summary ?? "").toLowerCase().includes(q),
      );
    }
    return list.slice(0, 4);
  }, [projects, query]);

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
              active={false}
              onClick={() => {
                onOpenChange(false);
                navigate({ to: "/projects" });
              }}
            />
            <SectionRow
              icon={<Star className="h-4 w-4" />}
              label="Starred"
              active={false}
              onClick={() => {
                onOpenChange(false);
                navigate({ to: "/projects" });
              }}
            />
            <SectionRow
              icon={<UserIcon className="h-4 w-4" />}
              label="Created by me"
              active={false}
              onClick={() => {
                onOpenChange(false);
                navigate({ to: "/projects" });
              }}
            />

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
