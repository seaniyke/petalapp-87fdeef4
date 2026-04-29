import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Loader2,
  FolderKanban,
  Search,
  ChevronLeft,
  ChevronRight,
  Star,
  Trash2,
  ExternalLink,
} from "lucide-react";
import { AdminTabs } from "@/components/AdminTabs";
import { SiteHeader } from "@/components/SiteHeader";
import { useAdminGuard } from "@/hooks/use-admin-guard";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { toast } from "sonner";
import { adminApi, fmtRelative } from "@/lib/admin-api";

export const Route = createFileRoute("/admin/projects")({
  head: () => ({
    meta: [
      { title: "Admin · Projects" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminProjectsPage,
});

type ProjectRow = {
  id: string;
  title: string;
  slug: string;
  owner_id: string;
  owner_email: string | null;
  is_public: boolean;
  is_featured: boolean;
  published_visibility: string;
  published_at: string | null;
  updated_at: string;
  created_at: string;
  remix_count: number;
};

type Filter = "all" | "published" | "featured" | "private";

function AdminProjectsPage() {
  const { ready } = useAdminGuard("/admin/projects");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ProjectRow | null>(null);

  async function load(p = page, q = query, f = filter) {
    setLoading(true);
    try {
      const { projects, total: t } = await adminApi<{ projects: ProjectRow[]; total: number }>({
        action: "list_projects",
        page: p,
        page_size: pageSize,
        query: q || undefined,
        filter: f,
      });
      setRows(projects);
      setTotal(t);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!ready) return;
    void load(1, "", "all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  async function toggleFeature(p: ProjectRow) {
    try {
      await adminApi({ action: "feature_project", project_id: p.id, is_featured: !p.is_featured });
      toast.success(p.is_featured ? "Removed from featured" : "Featured");
      setRows((prev) => prev.map((x) => (x.id === p.id ? { ...x, is_featured: !p.is_featured } : x)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  async function deleteProject(id: string) {
    try {
      await adminApi({ action: "delete_project", project_id: id });
      toast.success("Project deleted");
      setConfirmDelete(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (!ready) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <AdminTabs />
        <div className="flex items-center justify-center py-32 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <AdminTabs />
      <main className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Projects</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {total.toLocaleString()} matching · feature picks and moderate.
            </p>
          </div>
          <Link to="/admin" className="text-sm text-muted-foreground hover:text-foreground">
            ← Admin
          </Link>
        </div>

        <Card className="mb-4 border-border/60">
          <CardContent className="flex flex-col gap-2 p-3 sm:flex-row">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setPage(1);
                void load(1, query, filter);
              }}
              className="flex flex-1 gap-2"
            >
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter by title…"
                  className="pl-9"
                />
              </div>
              <Button type="submit" variant="outline" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Filter"}
              </Button>
            </form>
            <div className="flex gap-1 rounded-lg border border-border/60 p-1">
              {(["all", "published", "featured", "private"] as Filter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => {
                    setFilter(f);
                    setPage(1);
                    void load(1, query, f);
                  }}
                  className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition ${
                    filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-muted-foreground">
                <FolderKanban className="mb-2 h-6 w-6" />
                <p className="text-sm">No projects.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">Title</th>
                      <th className="px-4 py-2">Owner</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2 text-right">Remixes</th>
                      <th className="px-4 py-2">Updated</th>
                      <th className="px-4 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {rows.map((p) => (
                      <tr key={p.id} className="hover:bg-muted/40">
                        <td className="max-w-xs px-4 py-3">
                          <div className="flex items-center gap-2">
                            {p.is_featured && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />}
                            <span className="truncate font-medium">{p.title}</span>
                          </div>
                          <div className="truncate font-mono text-[11px] text-muted-foreground">{p.slug}</div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <div className="truncate">{p.owner_email ?? "—"}</div>
                          <div className="truncate font-mono text-[10px] text-muted-foreground">
                            {p.owner_id.slice(0, 8)}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {p.published_visibility === "public" ? (
                            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                              Published
                            </span>
                          ) : (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {p.published_visibility}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{p.remix_count}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{fmtRelative(p.updated_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              title={p.is_featured ? "Unfeature" : "Feature"}
                              onClick={() => toggleFeature(p)}
                            >
                              <Star
                                className={`h-4 w-4 ${
                                  p.is_featured ? "fill-amber-400 text-amber-400" : "text-muted-foreground"
                                }`}
                              />
                            </Button>
                            <a
                              href={`/p/${p.slug}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                              title="Open"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Delete"
                              onClick={() => setConfirmDelete(p)}
                            >
                              <Trash2 className="h-4 w-4 text-red-600" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
              <span>
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1 || loading}
                  onClick={() => {
                    const np = page - 1;
                    setPage(np);
                    void load(np);
                  }}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages || loading}
                  onClick={() => {
                    const np = page + 1;
                    setPage(np);
                    void load(np);
                  }}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project?</AlertDialogTitle>
            <AlertDialogDescription>
              "{confirmDelete?.title}" and all its files, messages and builds will be removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-600/90"
              onClick={() => confirmDelete && deleteProject(confirmDelete.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
