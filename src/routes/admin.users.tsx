import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Loader2,
  Users,
  Search,
  Coins,
  ChevronLeft,
  ChevronRight,
  Ban,
  ShieldCheck,
  Trash2,
  X,
  ExternalLink,
} from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { useAdminGuard } from "@/hooks/use-admin-guard";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
import { adminApi, fmtUsd, fmtDate, fmtRelative } from "@/lib/admin-api";

export const Route = createFileRoute("/admin/users")({
  head: () => ({
    meta: [
      { title: "Admin · Users" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminUsersPage,
});

type WalletInfo = {
  user_id: string;
  plan_code: string | null;
  monthly_credits_remaining: number | null;
  topup_credits_remaining: number | null;
} | null;

type UserRow = {
  id: string;
  email: string | null;
  created_at: string;
  banned_until: string | null;
  wallet: WalletInfo;
  project_count: number;
  lifetime_spend_usd_cents: number;
};

type UserDetail = {
  user: { id: string; email: string | null; created_at: string; last_sign_in_at: string | null; banned_until: string | null } | null;
  wallet: Record<string, unknown> | null;
  projects: Array<{
    id: string;
    title: string;
    slug: string;
    is_public: boolean;
    is_featured: boolean;
    published_visibility: string;
    updated_at: string;
    created_at: string;
    remix_count: number;
  }>;
  transactions: Array<{
    id: string;
    reference: string;
    status: string;
    amount_minor: number;
    currency_code: string;
    usd_amount_cents: number;
    purpose: string;
    item_code: string;
    created_at: string;
    paid_at: string | null;
  }>;
  ledger: Array<{
    id: string;
    delta: number;
    balance_after: number;
    reason: string;
    created_at: string;
    project_id: string | null;
  }>;
};

function AdminUsersPage() {
  const { ready } = useAdminGuard("/admin/users");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  async function load(p = page, q = query) {
    setLoading(true);
    try {
      const { users: rows, total: t } = await adminApi<{ users: UserRow[]; total: number }>({
        action: "list_users",
        page: p,
        page_size: pageSize,
        query: q || undefined,
      });
      setUsers(rows);
      setTotal(t);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!ready) return;
    void load(1, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  async function loadDetail(id: string) {
    setSelected(id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const d = await adminApi<UserDetail>({ action: "user_detail", user_id: id });
      setDetail(d);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load user");
    } finally {
      setDetailLoading(false);
    }
  }

  async function suspend(id: string, banned: boolean) {
    try {
      await adminApi({ action: "suspend_user", target_user_id: id, banned });
      toast.success(banned ? "User suspended" : "User reinstated");
      await load();
      if (selected === id) await loadDetail(id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  async function deleteUser(id: string) {
    try {
      await adminApi({ action: "delete_user", target_user_id: id });
      toast.success("User deleted");
      setConfirmDelete(null);
      setSelected(null);
      setDetail(null);
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
        <div className="flex items-center justify-center py-32 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="font-display text-3xl font-semibold tracking-tight">Users</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {total.toLocaleString()} total · click any row for full detail.
            </p>
          </div>
          <Link to="/admin" className="text-sm text-muted-foreground hover:text-foreground">
            ← Admin
          </Link>
        </div>

        <Card className="mb-4 border-border/60">
          <CardContent className="p-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setPage(1);
                void load(1, query);
              }}
              className="flex gap-2"
            >
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter by email or user id (leave blank for all)…"
                  className="pl-9"
                />
              </div>
              <Button type="submit" disabled={loading} variant="outline">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Filter"}
              </Button>
              {query && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setQuery("");
                    setPage(1);
                    void load(1, "");
                  }}
                >
                  Clear
                </Button>
              )}
            </form>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading users…
              </div>
            ) : users.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-muted-foreground">
                <Users className="mb-2 h-6 w-6" />
                <p className="text-sm">No users match.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">Email</th>
                      <th className="px-4 py-2">Plan</th>
                      <th className="px-4 py-2 text-right">Credits</th>
                      <th className="px-4 py-2 text-right">Projects</th>
                      <th className="px-4 py-2 text-right">Lifetime</th>
                      <th className="px-4 py-2">Joined</th>
                      <th className="px-4 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {users.map((u) => {
                      const monthly = Number(u.wallet?.monthly_credits_remaining ?? 0);
                      const topup = Number(u.wallet?.topup_credits_remaining ?? 0);
                      const banned = u.banned_until && new Date(u.banned_until) > new Date();
                      return (
                        <tr
                          key={u.id}
                          onClick={() => void loadDetail(u.id)}
                          className={`cursor-pointer transition hover:bg-muted/40 ${
                            selected === u.id ? "bg-muted/60" : ""
                          }`}
                        >
                          <td className="px-4 py-3">
                            <div className="truncate font-medium">{u.email ?? "(no email)"}</div>
                            <div className="truncate font-mono text-[11px] text-muted-foreground">{u.id}</div>
                          </td>
                          <td className="px-4 py-3 text-xs">{u.wallet?.plan_code ?? "free"}</td>
                          <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                            <span className="font-medium text-foreground">{topup.toFixed(0)}</span>
                            <span className="text-muted-foreground"> / {monthly.toFixed(0)}</span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">{u.project_count}</td>
                          <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                            {fmtUsd(u.lifetime_spend_usd_cents)}
                          </td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{fmtRelative(u.created_at)}</td>
                          <td className="px-4 py-3">
                            {banned ? (
                              <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-600">
                                Suspended
                              </span>
                            ) : (
                              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                                Active
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {/* Pagination */}
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

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="flex-1 bg-background/60 backdrop-blur-sm"
            onClick={() => {
              setSelected(null);
              setDetail(null);
            }}
          />
          <aside className="flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-border/60 bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
              <h2 className="text-sm font-medium tracking-tight">User detail</h2>
              <button
                onClick={() => {
                  setSelected(null);
                  setDetail(null);
                }}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {detailLoading || !detail ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : (
              <div className="space-y-6 p-5">
                <DetailHeader
                  detail={detail}
                  onSuspendToggle={(banned) => suspend(detail.user!.id, banned)}
                  onDelete={() => setConfirmDelete(detail.user!.id)}
                />
                <GrantSection userId={detail.user!.id} onDone={() => void loadDetail(detail.user!.id)} />
                <SectionList
                  title={`Projects (${detail.projects.length})`}
                  empty="No projects yet."
                  items={detail.projects.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{p.title}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {p.published_visibility === "public" ? "Published" : "Private"} ·{" "}
                          {fmtRelative(p.updated_at)} · {p.remix_count} remixes
                        </div>
                      </div>
                      <a
                        href={`/p/${p.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </li>
                  ))}
                />
                <SectionList
                  title={`Payments (${detail.transactions.length})`}
                  empty="No transactions yet."
                  items={detail.transactions.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate">
                          {t.purpose} <span className="text-muted-foreground">· {t.item_code}</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {fmtDate(t.created_at)} · {t.reference}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-xs tabular-nums">{fmtUsd(t.usd_amount_cents)}</div>
                        <div
                          className={`text-[10px] ${
                            t.status === "success"
                              ? "text-emerald-600"
                              : t.status === "failed"
                                ? "text-red-600"
                                : "text-muted-foreground"
                          }`}
                        >
                          {t.status}
                        </div>
                      </div>
                    </li>
                  ))}
                />
                <SectionList
                  title={`Credit ledger (${detail.ledger.length})`}
                  empty="No ledger activity yet."
                  items={detail.ledger.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate">{l.reason}</div>
                        <div className="text-[11px] text-muted-foreground">{fmtDate(l.created_at)}</div>
                      </div>
                      <div className="text-right">
                        <div
                          className={`font-mono text-xs tabular-nums ${
                            Number(l.delta) >= 0 ? "text-emerald-600" : "text-red-600"
                          }`}
                        >
                          {Number(l.delta) >= 0 ? "+" : ""}
                          {Number(l.delta).toFixed(2)}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          bal {Number(l.balance_after).toFixed(2)}
                        </div>
                      </div>
                    </li>
                  ))}
                />
              </div>
            )}
          </aside>
        </div>
      )}

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the auth account. Projects and ledger entries owned by this user will cascade where
              foreign keys allow. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-600/90"
              onClick={() => confirmDelete && deleteUser(confirmDelete)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DetailHeader({
  detail,
  onSuspendToggle,
  onDelete,
}: {
  detail: UserDetail;
  onSuspendToggle: (banned: boolean) => void;
  onDelete: () => void;
}) {
  const u = detail.user!;
  const banned = u.banned_until && new Date(u.banned_until) > new Date();
  const wallet = (detail.wallet ?? {}) as Record<string, unknown>;
  const plan = String(wallet.plan_code ?? "free");
  const monthly = Number(wallet.monthly_credits_remaining ?? 0);
  const topup = Number(wallet.topup_credits_remaining ?? 0);
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-medium">{u.email ?? "(no email)"}</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">{u.id}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Joined {fmtDate(u.created_at)} · Last seen {fmtRelative(u.last_sign_in_at)}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Button size="sm" variant="outline" onClick={() => onSuspendToggle(!banned)}>
            {banned ? (
              <>
                <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Reinstate
              </>
            ) : (
              <>
                <Ban className="mr-1 h-3.5 w-3.5" /> Suspend
              </>
            )}
          </Button>
          <Button size="sm" variant="outline" className="text-red-600 hover:text-red-600" onClick={onDelete}>
            <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-border/60 px-3 py-2">
          <div className="text-[10px] uppercase text-muted-foreground">Plan</div>
          <div className="text-sm font-medium">{plan}</div>
        </div>
        <div className="rounded-lg border border-border/60 px-3 py-2">
          <div className="text-[10px] uppercase text-muted-foreground">Top-up</div>
          <div className="text-sm font-medium tabular-nums">{topup.toFixed(0)}</div>
        </div>
        <div className="rounded-lg border border-border/60 px-3 py-2">
          <div className="text-[10px] uppercase text-muted-foreground">Monthly</div>
          <div className="text-sm font-medium tabular-nums">{monthly.toFixed(0)}</div>
        </div>
      </div>
    </div>
  );
}

function GrantSection({ userId, onDone }: { userId: string; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const amt = Number(amount);
        if (!Number.isFinite(amt) || amt === 0) return toast.error("Enter a non-zero amount");
        setBusy(true);
        try {
          await adminApi({ action: "grant", target_user_id: userId, amount: amt, note: note || undefined });
          toast.success(`${amt > 0 ? "Granted" : "Deducted"} ${Math.abs(amt)} credits`);
          setAmount("");
          setNote("");
          onDone();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Failed");
        } finally {
          setBusy(false);
        }
      }}
      className="rounded-xl border border-border/60 p-3"
    >
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <Coins className="h-3.5 w-3.5" /> Adjust credits
      </div>
      <div className="flex gap-2">
        <Input
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="50 or -10"
          className="flex-1"
        />
        <Button type="submit" disabled={busy} size="sm">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
        </Button>
      </div>
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note…"
        rows={2}
        className="mt-2"
      />
    </form>
  );
}

function SectionList({ title, items, empty }: { title: string; items: React.ReactNode[]; empty: string }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-lg border border-border/60 px-3">{items}</ul>
      )}
    </div>
  );
}
