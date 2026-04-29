import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Loader2, Receipt, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { useAdminGuard } from "@/hooks/use-admin-guard";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { adminApi, fmtUsd, fmtDate, downloadCsv } from "@/lib/admin-api";

export const Route = createFileRoute("/admin/ledgers")({
  head: () => ({
    meta: [
      { title: "Admin · Ledgers & transactions" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminLedgersPage,
});

type Tx = {
  id: string;
  user_id: string;
  user_email: string | null;
  reference: string;
  status: string;
  amount_minor: number;
  currency_code: string;
  usd_amount_cents: number;
  purpose: string;
  item_code: string;
  channel: string | null;
  created_at: string;
  paid_at: string | null;
};

type Ledger = {
  id: string;
  user_id: string;
  user_email: string | null;
  project_id: string | null;
  delta: number;
  balance_after: number;
  reason: string;
  created_at: string;
};

type Tab = "transactions" | "ledger";

function AdminLedgersPage() {
  const { ready } = useAdminGuard("/admin/ledgers");
  const [tab, setTab] = useState<Tab>("transactions");
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [sinceDays, setSinceDays] = useState(0);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [ledger, setLedger] = useState<Ledger[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  async function load(p = page) {
    setLoading(true);
    try {
      if (tab === "transactions") {
        const { transactions, total: t } = await adminApi<{ transactions: Tx[]; total: number }>({
          action: "list_transactions",
          page: p,
          page_size: pageSize,
          status: statusFilter || undefined,
          since_days: sinceDays || undefined,
        });
        setTxs(transactions);
        setTotal(t);
      } else {
        const { ledger: rows, total: t } = await adminApi<{ ledger: Ledger[]; total: number }>({
          action: "list_ledger",
          page: p,
          page_size: pageSize,
          since_days: sinceDays || undefined,
        });
        setLedger(rows);
        setTotal(t);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!ready) return;
    setPage(1);
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, tab, statusFilter, sinceDays]);

  async function exportCsv() {
    setLoading(true);
    try {
      if (tab === "transactions") {
        // Pull up to 1000 rows for export
        const { transactions } = await adminApi<{ transactions: Tx[] }>({
          action: "list_transactions",
          page: 1,
          page_size: 200,
          status: statusFilter || undefined,
          since_days: sinceDays || undefined,
        });
        downloadCsv(`transactions-${new Date().toISOString().slice(0, 10)}.csv`, transactions);
      } else {
        const { ledger: rows } = await adminApi<{ ledger: Ledger[] }>({
          action: "list_ledger",
          page: 1,
          page_size: 200,
          since_days: sinceDays || undefined,
        });
        downloadCsv(`ledger-${new Date().toISOString().slice(0, 10)}.csv`, rows);
      }
      toast.success("Exported");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setLoading(false);
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
            <h1 className="font-display text-3xl font-semibold tracking-tight">Ledgers & transactions</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {total.toLocaleString()} {tab === "transactions" ? "payments" : "ledger entries"} · CSV export.
            </p>
          </div>
          <Link to="/admin" className="text-sm text-muted-foreground hover:text-foreground">
            ← Admin
          </Link>
        </div>

        <Card className="mb-4 border-border/60">
          <CardContent className="flex flex-wrap items-center gap-2 p-3">
            <div className="flex gap-1 rounded-lg border border-border/60 p-1">
              {(["transactions", "ledger"] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition ${
                    tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {tab === "transactions" && (
              <div className="flex gap-1 rounded-lg border border-border/60 p-1">
                {["", "success", "failed", "pending"].map((s) => (
                  <button
                    key={s || "all"}
                    onClick={() => setStatusFilter(s)}
                    className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition ${
                      statusFilter === s
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s || "all"}
                  </button>
                ))}
              </div>
            )}

            <div className="flex gap-1 rounded-lg border border-border/60 p-1">
              {[
                { v: 0, l: "All" },
                { v: 7, l: "7d" },
                { v: 30, l: "30d" },
                { v: 90, l: "90d" },
              ].map(({ v, l }) => (
                <button
                  key={v}
                  onClick={() => setSinceDays(v)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                    sinceDays === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>

            <div className="ml-auto">
              <Button size="sm" variant="outline" onClick={exportCsv} disabled={loading}>
                <Download className="mr-1 h-4 w-4" /> Export CSV
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : (tab === "transactions" ? txs : ledger).length === 0 ? (
              <div className="flex flex-col items-center py-16 text-muted-foreground">
                <Receipt className="mb-2 h-6 w-6" />
                <p className="text-sm">No data.</p>
              </div>
            ) : tab === "transactions" ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">When</th>
                      <th className="px-4 py-2">User</th>
                      <th className="px-4 py-2">Purpose</th>
                      <th className="px-4 py-2 text-right">Amount</th>
                      <th className="px-4 py-2 text-right">USD</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2">Channel</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {txs.map((t) => (
                      <tr key={t.id} className="hover:bg-muted/40">
                        <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(t.created_at)}</td>
                        <td className="px-4 py-3">
                          <div className="truncate text-xs">{t.user_email ?? t.user_id.slice(0, 8)}</div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {t.purpose}
                          <div className="text-[10px] text-muted-foreground">{t.item_code}</div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                          {(Number(t.amount_minor) / 100).toFixed(2)} {t.currency_code}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">{fmtUsd(t.usd_amount_cents)}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              t.status === "success"
                                ? "bg-emerald-500/10 text-emerald-600"
                                : t.status === "failed"
                                  ? "bg-red-500/10 text-red-600"
                                  : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {t.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{t.channel ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2">When</th>
                      <th className="px-4 py-2">User</th>
                      <th className="px-4 py-2">Reason</th>
                      <th className="px-4 py-2 text-right">Delta</th>
                      <th className="px-4 py-2 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {ledger.map((l) => (
                      <tr key={l.id} className="hover:bg-muted/40">
                        <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(l.created_at)}</td>
                        <td className="px-4 py-3 text-xs">{l.user_email ?? l.user_id.slice(0, 8)}</td>
                        <td className="px-4 py-3 text-xs">{l.reason}</td>
                        <td
                          className={`px-4 py-3 text-right font-mono text-xs tabular-nums ${
                            Number(l.delta) >= 0 ? "text-emerald-600" : "text-red-600"
                          }`}
                        >
                          {Number(l.delta) >= 0 ? "+" : ""}
                          {Number(l.delta).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                          {Number(l.balance_after).toFixed(2)}
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
    </div>
  );
}
