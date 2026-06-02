/**
 * CloudUsersView — list, search, paginate and manage auth users in
 * the project's managed backend. Mirrors what builders expect from
 * a Cloud → Users panel: per-user actions menu (reset, ban, delete).
 */
import { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Search,
  ShieldOff,
  ShieldX,
  Trash2,
  Users,
  Mail,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  listProjectUsers,
  deleteProjectUser,
  setProjectUserBan,
  sendProjectUserRecovery,
  type CloudAuthUser,
} from "@/lib/cloud-users.functions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { CloudEmptyState } from "./CloudEmptyState";

const PER_PAGE = 25;

export function CloudUsersView({ projectId }: { projectId: string }) {
  const listFn = useServerFn(listProjectUsers);
  const delFn = useServerFn(deleteProjectUser);
  const banFn = useServerFn(setProjectUserBan);
  const resetFn = useServerFn(sendProjectUserRecovery);

  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [users, setUsers] = useState<CloudAuthUser[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CloudAuthUser | null>(null);

  const load = useCallback(
    async (opts: { page: number; search: string }) => {
      setLoading(true);
      try {
        const r = await listFn({
          data: {
            projectId,
            page: opts.page,
            perPage: PER_PAGE,
            search: opts.search || undefined,
          },
        });
        setAvailable(r.available);
        setUsers(r.users);
        setHasMore(r.hasMore);
      } catch {
        setAvailable(false);
      } finally {
        setLoading(false);
      }
    },
    [listFn, projectId],
  );

  useEffect(() => {
    void load({ page, search });
  }, [load, page, search]);

  const onSearch = (term: string) => {
    setPage(1);
    setSearch(term);
  };

  const handleReset = async (u: CloudAuthUser) => {
    if (!u.email) return;
    setPendingId(u.id);
    try {
      await resetFn({ data: { projectId, email: u.email } });
      toast.success(`Recovery email sent to ${u.email}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send email");
    } finally {
      setPendingId(null);
    }
  };

  const handleBan = async (u: CloudAuthUser, ban: boolean) => {
    setPendingId(u.id);
    try {
      await banFn({ data: { projectId, userUid: u.id, ban } });
      toast.success(ban ? "User banned" : "User unbanned");
      await load({ page, search });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setPendingId(null);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const u = confirmDelete;
    setConfirmDelete(null);
    setPendingId(u.id);
    try {
      await delFn({ data: { projectId, userUid: u.id } });
      toast.success("User deleted");
      await load({ page, search });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setPendingId(null);
    }
  };

  if (!available && !loading) {
    return (
      <div className="p-4">
        <CloudEmptyState
          title="No backend yet"
          description="Enable Petal Cloud to see signups and configure how people sign in."
        />
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by email"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Users className="h-3.5 w-3.5" />
        <span>
          Page {page}
          {users.length > 0 ? ` · ${users.length} on this page` : ""}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : users.length === 0 ? (
        <CloudEmptyState
          title={search ? "No matches" : "No users yet"}
          description={
            search
              ? "Try a different search."
              : "Petal hasn't set up sign-up for this project yet. Ask Petal in chat — e.g. ‘add email + Google sign-in’ — then signups will appear here."
          }
        />
      ) : (
        <ul className="space-y-2">
          {users.map((u) => (
            <li
              key={u.id}
              className="flex items-center gap-3 rounded-xl bg-muted/40 px-4 py-3 text-sm"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">
                    {u.email ?? "(no email)"}
                  </span>
                  {u.banned && (
                    <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
                      Banned
                    </span>
                  )}
                </div>
                <div className="mt-0.5 truncate text-xs text-muted-foreground">
                  Joined {new Date(u.createdAt).toLocaleDateString()} ·{" "}
                  {u.provider ?? "email"}
                  {u.lastSignInAt &&
                    ` · last seen ${new Date(u.lastSignInAt).toLocaleDateString()}`}
                </div>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    disabled={pendingId === u.id}
                    aria-label="User actions"
                  >
                    {pendingId === u.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <MoreHorizontal className="h-4 w-4" />
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem
                    onClick={() => handleReset(u)}
                    disabled={!u.email}
                  >
                    <Mail className="mr-2 h-4 w-4" />
                    Send password reset
                  </DropdownMenuItem>
                  {u.banned ? (
                    <DropdownMenuItem onClick={() => handleBan(u, false)}>
                      <ShieldOff className="mr-2 h-4 w-4" />
                      Unban user
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={() => handleBan(u, true)}>
                      <ShieldX className="mr-2 h-4 w-4" />
                      Ban user
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setConfirmDelete(u)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete user
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between pt-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1 || loading}
        >
          <ChevronLeft className="mr-1 h-4 w-4" /> Prev
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPage((p) => p + 1)}
          disabled={!hasMore || loading}
        >
          Next <ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>

      <AlertDialog
        open={!!confirmDelete}
        onOpenChange={(v) => !v && setConfirmDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this user?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.email ?? "This account"} will be permanently
              removed from your app. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
