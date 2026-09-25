/**
 * Compact list of the user's latest credit purchases, shown on the Credits
 * sheet. Full history + PDF receipts live on /billing.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bitcoin, ChevronRight, CreditCard } from "lucide-react";
import { getSupabaseAccessToken } from "@/lib/auth-token";
import { cn } from "@/lib/utils";

type Item = {
  id: string;
  method: "card" | "crypto";
  purpose: string;
  itemCode: string;
  usdAmountCents: number;
  status: string;
  createdAt: string;
};

const STATUS: Record<string, { label: string; cls: string }> = {
  success: { label: "Paid", cls: "text-primary" },
  confirmed: { label: "Paid", cls: "text-primary" },
  pending: { label: "Pending", cls: "text-muted-foreground" },
  needs_review: { label: "Checking", cls: "text-muted-foreground" },
  failed: { label: "Failed", cls: "text-destructive" },
  rejected: { label: "Rejected", cls: "text-destructive" },
  abandoned: { label: "Not completed", cls: "text-muted-foreground" },
};

function label(i: Item) {
  if (i.purpose === "pack") return i.itemCode === "custom" ? "Custom credits" : "Credit pack";
  if (i.purpose === "runtime_topup") return "Top-up";
  if (i.purpose === "plan") return "Earlier payment";
  return "Purchase";
}

export function RecentPurchases({ open }: { open: boolean }) {
  const [items, setItems] = useState<Item[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const token = await getSupabaseAccessToken();
      if (!token) return;
      const res = await fetch("/api/billing/history", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok || cancelled) return;
      const json = (await res.json()) as { items: Item[] };
      // Abandoned checkouts are noise here; they still show on the full page.
      if (!cancelled) setItems(json.items.filter((i) => i.status !== "abandoned").slice(0, 5));
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Recent purchases</h3>
        <Link
          to="/billing"
          className="inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          All & receipts <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      {items === null ? (
        <div className="h-12 animate-pulse rounded-xl bg-muted" />
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No purchases yet. Credits you buy will show here.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {items.map((i) => {
            const s = STATUS[i.status] ?? { label: i.status, cls: "text-muted-foreground" };
            return (
              <li key={`${i.method}-${i.id}`} className="flex items-center gap-3 px-3 py-2.5">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted">
                  {i.method === "crypto" ? (
                    <Bitcoin className="h-3.5 w-3.5" />
                  ) : (
                    <CreditCard className="h-3.5 w-3.5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{label(i)}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(i.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums">
                    ${(i.usdAmountCents / 100).toFixed(2)}
                  </p>
                  <p className={cn("text-[11px] font-medium", s.cls)}>{s.label}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
