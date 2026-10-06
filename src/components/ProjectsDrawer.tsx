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
  ChevronRight,
  Check,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ProjectThumbnail } from "@/components/ProjectThumbnail";
import { useAuth } from "@/lib/auth";
import {
  listProjects,
  type ProjectRow,
} from "@/lib/projects";
import { toast } from "@/lib/notify";

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
        side="bottom"
        className="inset-x-3 bottom-3 mx-auto flex max-h-[90dvh] w-auto max-w-md flex-col gap-0 overflow-hidden rounded-[1.75rem] border border-border/60 bg-background/95 p-0 pt-7 shadow-[var(--shadow-editorial)] backdrop-blur-2xl [&>button]:hidden motion-reduce:animate-none"
      >
        <header className="flex items-center justify-between px-5 pb-4 pt-2">
          <div>
            <SheetTitle className="text-2xl font-bold tracking-normal">Projects</SheetTitle>
            <SheetDescription className="mt-1 text-xs">Your workspace</SheetDescription>
          </div>
          <SheetClose asChild>
            <Button variant="secondary" size="icon" className="h-8 w-8 rounded-md" aria-label="Close projects menu" title="Close projects menu">
              <X />
            </Button>
          </SheetClose>
        </header>

        <div className="px-5 pb-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects"
              aria-label="Search projects"
              className="h-10 w-full rounded-md border border-border/40 bg-muted/60 pl-9 pr-10 text-sm outline-none transition focus:ring-2 focus:ring-ring/30"
            />
            {query && (
              <Button variant="ghost" size="icon" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 rounded-md">
                <X />
              </Button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
          <SectionRow icon={<Home className="h-4 w-4" />} label="Home" active={false} onClick={() => go("/")} />

          <div className="mt-5 flex items-center justify-between border-t border-border/50 pb-3 pt-5">
            <h2 className="text-xs font-medium text-muted-foreground">Recent projects</h2>
            <Button variant="secondary" size="sm" onClick={() => go("/")} className="h-8 gap-1.5 rounded-md px-2.5 text-xs">
              <Plus /> New project
            </Button>
          </div>
          <div aria-busy={loading}>
            {loading && projects === null
              ? Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex h-[68px] items-center gap-3 border-b border-border/40">
                    <div className="h-11 w-11 shrink-0 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
                    <div className="h-3 w-32 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                  </div>
                ))
              : recents.map((p) => (
                  <Button
                    variant="ghost"
                    key={p.id}
                    onClick={() => openProject(p.id)}
                    aria-current={currentProjectId === p.id ? "page" : undefined}
                    className={`h-[68px] w-full justify-start gap-3 rounded-md border-b border-border/40 px-2 text-left ${currentProjectId === p.id ? "bg-muted/70" : ""}`}
                  >
                    <ProjectThumbnail
                      projectId={p.id}
                      title={p.title}
                      subdomain={p.subdomain}
                      buildId={p.published_build_id ?? p.latest_build_id}
                      className="h-11 w-11 shrink-0 overflow-hidden rounded-lg"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{p.title}</div>
                      <div className="mt-1 truncate text-[11px] font-normal text-muted-foreground">{timeAgo(p.updated_at)}</div>
                    </div>
                    {currentProjectId === p.id ? <Check className="text-primary" /> : <ChevronRight className="text-muted-foreground/60" />}
                  </Button>
                ))}
            {!loading && recents.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">{query ? "No matching projects" : "No recent projects"}</p>
            )}
          </div>

          <h2 className="pb-2 pt-5 text-xs font-medium text-muted-foreground">Library</h2>
          <div className="divide-y divide-border/40">
            <SectionRow icon={<LayoutGrid className="h-4 w-4" />} label="All projects" active={false} onClick={() => go("/projects")} />
            <SectionRow icon={<Star className="h-4 w-4" />} label="Starred" active={false} onClick={() => go("/projects")} />
            <SectionRow icon={<UserIcon className="h-4 w-4" />} label="Created by me" active={false} onClick={() => go("/projects")} />
          </div>
        </div>

        {/* Workspace footer */}
        {user && (
          <div className="safe-bottom shrink-0 border-t border-border/50 bg-muted/30 px-5 py-3">
            <div className="flex items-center gap-3 py-1">
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
              <Button
                variant="ghost"
                size="icon"
                title="Sign out"
                onClick={async () => {
                  await signOut();
                  onOpenChange(false);
                  navigate({ to: "/" });
                }}
                aria-label="Sign out"
                className="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground"
              >
                <LogOut className="h-4 w-4" />
              </Button>
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
    <Button
      variant="ghost"
      onClick={onClick}
      className={`h-11 w-full justify-start gap-3 rounded-md px-2 text-left text-sm ${
        active ? "bg-muted font-semibold" : "hover:bg-muted"
      }`}
    >
      <span className="text-foreground/70">{icon}</span>
      <span className="flex-1 font-medium">{label}</span>
      <ChevronRight className="text-muted-foreground/60" />
    </Button>
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
