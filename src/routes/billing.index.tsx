/**
 * /billing — the money dashboard.
 *
 * One place to see the current plan, when it renews, build credits, the
 * Cloud + AI balance, and every card or crypto payment with a downloadable
 * PDF receipt.
 */
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Bitcoin,
  CreditCard,
  Download,
  Loader2,
  RefreshCw,
  Sparkles,
  Wallet as WalletIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { BillingSheet } from "@/components/BillingSheet";
import { RuntimeTopupModal } from "@/components/RuntimeTopupModal";
import { renderReceiptPdf, downloadBlob } from "@/lib/receipt-pdf";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/billing/")({
  component: BillingDashboard,
  head: () => ({
    meta: [
      { title: "Billing & receipts · Petal" },
      {
        name: "description",
        content:
          "See your Petal plan, renewal date, build credits and Cloud + AI balance, and download receipts for every card or crypto payment.",
      },
      { property: "og:title", content: "Billing & receipts · Petal" },
      {
        property: "og:description",
        content: "Your plan, credits and payment receipts in one place.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

type HistoryItem = {
  id: string;
  method: "card" | "crypto";
  reference: string;
  purpose: string;
  itemCode: string;
  usdAmountCents: number;
  displayAmountMinor: number | null;
  currencyCode: string;
  status: string;
  asset: string | null;
  chain: string | null;
  txHash: string | null;
  confirmations: number | null;
  note: string | null;
  createdAt: string;
  paidAt: string | null;
};

type Payload = {
  email: string | null;
  wallet: {
    plan_code: string;
    monthly_credits_remaining: number;
    topup_credits_remaining: number;
    subscription_status: string | null;
    current_period_end: string | null;
    runtime_free_balance_cents: number;
    runtime_topup_balance_cents: number;
  } | null;
  subscription: {
    status: string | null;
    cancel_at_period_end: boolean | null;
    next_payment_date: string | null;
    plan_code: string | null;
  } | null;
  items: HistoryItem[];
};

const PLAN_LABEL: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  business: "Business",
};

const STATUS_STYLE: Record<string, string> = {
  success: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  confirmed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  needs_review: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  failed: "bg-destructive/15 text-destructive",
  rejected: "bg-destructive/15 text-destructive",
  abandoned: "bg-muted text-muted-foreground",
};

const STATUS_LABEL: Record<string, string> = {
  success: "Paid",
  confirmed: "Confirmed",
  pending: "Pending",
  needs_review: "Checking",
  failed: "Failed",
  rejected: "Rejected",
  abandoned: "Abandoned",
};

function usd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function purposeLabel(item: HistoryItem) {
  if (item.purpose === "plan") return `${PLAN_LABEL[item.itemCode] ?? item.itemCode} plan`;
  if (item.purpose === "pack") return `Credit pack · ${item.itemCode}`;
  if (item.purpose === "runtime_topup") return "Cloud + AI top-up";
  return item.itemCode || item.purpose;
}

function BillingDashboard() {
  const { user, isReady } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);

  const load = useCallback(async () => {
    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (!token) return;
    const res = await fetch("/api/billing/history", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Could not load billing");
    setData((await res.json()) as Payload);
  }, []);

  useEffect(() => {
    if (!isReady) return;
    if (!user) {
      navigate({ to: "/auth", search: { mode: "signin", redirect: "/billing" } });
      return;
    }
    load()
      .catch(() => toast.error("Could not load your billing details."))
      .finally(() => setLoading(false));
  }, [isReady, user, navigate, load]);

  // Live-update when a crypto payment clears while the page is open.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`billing:${user.id}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "crypto_payments",
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          load().catch(() => {});
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, load]);

  async function refresh() {
    setRefreshing(true);
    await load().catch(() => toast.error("Refresh failed."));
    setRefreshing(false);
  }

  function downloadReceipt(item: HistoryItem) {
    const paid = item.status === "success" || item.status === "confirmed";
    const meta = [
      { label: "Reference", value: item.reference },
      { label: "Method", value: item.method === "crypto" ? "Crypto transfer" : "Card (Paystack)" },
    ];
    if (item.method === "crypto") {
      meta.push({ label: "Asset", value: `${item.asset ?? ""} on ${item.chain ?? ""}` });
      if (item.txHash) meta.push({ label: "Transaction hash", value: item.txHash });
      if (item.confirmations != null)
        meta.push({ label: "Confirmations", value: String(item.confirmations) });
    } else if (item.displayAmountMinor != null) {
      meta.push({
        label: "Charged",
        value: `${item.currencyCode} ${(item.displayAmountMinor / 100).toFixed(2)}`,
      });
    }
    meta.push({ label: "Created", value: new Date(item.createdAt).toISOString() });
    if (item.paidAt) meta.push({ label: "Confirmed", value: new Date(item.paidAt).toISOString() });

    const blob = renderReceiptPdf({
      kind: paid ? "RECEIPT" : "INVOICE",
      number: item.reference.slice(-16).toUpperCase(),
      issuedAt: item.paidAt ?? item.createdAt,
      billedTo: data?.email ?? "Petal customer",
      status: STATUS_LABEL[item.status] ?? item.status,
      meta,
      lineItem: {
        description: purposeLabel(item),
        detail:
          item.method === "crypto"
            ? `Paid in ${item.asset ?? "crypto"} on ${item.chain ?? "chain"}`
            : "Card payment via Paystack",
        amount: usd(item.usdAmountCents),
      },
      total: usd(item.usdAmountCents),
      note: paid
        ? undefined
        : "This payment has not been confirmed yet. This document is a provisional invoice.",
    });
    downloadBlob(blob, `petal-${paid ? "receipt" : "invoice"}-${item.reference}.pdf`);
  }

  if (loading) {
    return (
      <div className="min-h-dvh bg-background">
        <SiteHeader />
        <div className="grid place-items-center py-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  const w = data?.wallet;
  const planCode = w?.plan_code ?? "free";
  const credits = Number(w?.monthly_credits_remaining ?? 0) + Number(w?.topup_credits_remaining ?? 0);
  const runtimeCents =
    Number(w?.runtime_free_balance_cents ?? 0) + Number(w?.runtime_topup_balance_cents ?? 0);
  const renewal = data?.subscription?.next_payment_date ?? w?.current_period_end ?? null;

  return (
    <div className="min-h-dvh bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <Link
          to="/projects"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to projects
        </Link>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Billing</h1>
            <p className="mt-1 text-sm font-medium text-muted-foreground">
              Your plan, balances and every receipt — card or crypto.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
            <RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              Plan
            </div>
            <div className="mt-2 text-2xl font-bold">{PLAN_LABEL[planCode] ?? planCode}</div>
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              {data?.subscription?.cancel_at_period_end
                ? `Ends ${renewal ? new Date(renewal).toLocaleDateString() : "at period end"}`
                : renewal
                  ? `Renews ${new Date(renewal).toLocaleDateString()}`
                  : "No renewal scheduled"}
            </p>
            <Button size="sm" className="mt-3 w-full" onClick={() => setPlanOpen(true)}>
              {planCode === "free" ? "Upgrade" : "Manage plan"}
            </Button>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              <WalletIcon className="h-3.5 w-3.5" />
              Build credits
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">{credits}</div>
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              {Number(w?.topup_credits_remaining ?? 0)} from top-ups · never expire
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3 w-full"
              onClick={() => setPlanOpen(true)}
            >
              Buy credits
            </Button>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              <Bitcoin className="h-3.5 w-3.5" />
              Cloud + AI
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums">{usd(runtimeCents)}</div>
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              {usd(Number(w?.runtime_topup_balance_cents ?? 0))} topped up
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3 w-full"
              onClick={() => setTopupOpen(true)}
            >
              Top up
            </Button>
          </div>
        </div>

        <h2 className="mt-10 text-lg font-bold">Payments & receipts</h2>
        <div className="mt-3 overflow-hidden rounded-2xl border border-border">
          {!data?.items.length ? (
            <div className="p-10 text-center text-sm font-medium text-muted-foreground">
              No payments yet. Your receipts will show up here.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {data.items.map((item) => (
                <li
                  key={`${item.method}-${item.id}`}
                  className="flex flex-wrap items-center gap-3 p-4"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-muted">
                    {item.method === "crypto" ? (
                      <Bitcoin className="h-4 w-4" />
                    ) : (
                      <CreditCard className="h-4 w-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold">{purposeLabel(item)}</span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px] font-bold",
                          STATUS_STYLE[item.status] ?? "bg-muted text-muted-foreground",
                        )}
                      >
                        {STATUS_LABEL[item.status] ?? item.status}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground">
                      {new Date(item.createdAt).toLocaleString()} ·{" "}
                      {item.method === "crypto"
                        ? `${item.asset} on ${item.chain}`
                        : item.currencyCode}
                      {item.note ? ` · ${item.note}` : ""}
                    </p>
                  </div>
                  <div className="ml-auto flex items-center gap-3">
                    <span className="text-sm font-bold tabular-nums">
                      {usd(item.usdAmountCents)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => downloadReceipt(item)}
                      title="Download PDF"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      <BillingSheet open={planOpen} onOpenChange={setPlanOpen} />
      <RuntimeTopupModal open={topupOpen} onOpenChange={setTopupOpen} />
    </div>
  );
}
