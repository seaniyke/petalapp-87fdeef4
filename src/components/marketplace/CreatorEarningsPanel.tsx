import { useCallback, useEffect, useState } from "react";
import { Banknote, Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  cancelPayout,
  getCreatorSummary,
  listMyPayouts,
  requestPayout,
  type CreatorSummary,
  type PayoutMethod,
  type PayoutRow,
} from "@/lib/marketplace";

function usd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
}

const PAYOUT_STATUS: Record<string, string> = {
  pending: "Awaiting review",
  approved: "Approved — sending",
  paid: "Paid",
  rejected: "Declined",
  cancelled: "Cancelled",
};

/** Creator earnings ledger + payout requests. Reads real rows only. */
export function CreatorEarningsPanel() {
  const [summary, setSummary] = useState<CreatorSummary | null>(null);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<PayoutMethod>("bank");
  const [destination, setDestination] = useState("");

  const load = useCallback(async () => {
    const [s, p] = await Promise.all([getCreatorSummary(), listMyPayouts()]);
    setSummary(s);
    setPayouts(p);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (e) {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "Failed to load earnings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function handleRequest() {
    if (!destination.trim()) {
      toast.error("Tell us where to send the money");
      return;
    }
    setBusy(true);
    try {
      await requestPayout(method, destination.trim());
      toast.success("Payout requested — we'll review it shortly");
      setDestination("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not request a payout");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel(id: string) {
    setBusy(true);
    try {
      await cancelPayout(id);
      toast.success("Payout request cancelled");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not cancel");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="mt-4 grid place-items-center rounded-2xl border border-border py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  const s = summary;
  if (!s) return null;

  const open = payouts.find((p) => p.status === "pending" || p.status === "approved");
  const canRequest =
    s.payouts_enabled && !open && s.available_cents >= s.min_payout_cents;

  return (
    <div className="mt-4 space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Lifetime sales" value={String(s.sales_count)} />
        <Stat label="Gross" value={usd(s.gross_cents)} />
        <Stat label="Petal fee" value={usd(s.commission_cents)} />
        <Stat label="Your earnings" value={usd(s.net_cents)} highlight />
      </div>

      <div className="rounded-2xl border border-border bg-card p-5">
        <p className="inline-flex items-center gap-2 text-sm font-bold">
          <Wallet className="h-4 w-4 text-primary" aria-hidden /> Available to pay out
        </p>
        <p className="mt-2 text-3xl font-bold tabular-nums">{usd(s.available_cents)}</p>
        <p className="mt-1 text-xs font-medium text-muted-foreground">
          {usd(s.requested_cents)} in progress · {usd(s.paid_cents)} paid out · minimum payout{" "}
          {usd(s.min_payout_cents)}
        </p>

        {!s.payouts_enabled ? (
          <p className="mt-4 rounded-xl bg-muted px-4 py-3 text-xs font-medium text-muted-foreground">
            Payouts open soon. Your balance keeps accruing in the meantime — nothing expires.
          </p>
        ) : open ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-muted px-4 py-3">
            <p className="text-xs font-semibold">
              {usd(Number(open.amount_cents))} · {PAYOUT_STATUS[open.status] ?? open.status}
            </p>
            {open.status === "pending" && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => handleCancel(open.id)}
              >
                Cancel request
              </Button>
            )}
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor="payout-method">Method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as PayoutMethod)}>
                <SelectTrigger id="payout-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank">Bank transfer</SelectItem>
                  <SelectItem value="paystack">Paystack</SelectItem>
                  <SelectItem value="crypto">Crypto (USDT)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="payout-destination">Where should it go?</Label>
              <Input
                id="payout-destination"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder={
                  method === "crypto" ? "USDT (TRC20) wallet address" : "Account number and bank"
                }
                maxLength={200}
              />
            </div>
            <Button disabled={!canRequest || busy} onClick={handleRequest}>
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Requesting…
                </>
              ) : (
                <>
                  <Banknote className="mr-2 h-4 w-4" aria-hidden /> Request payout
                </>
              )}
            </Button>
            {!canRequest && s.available_cents < s.min_payout_cents && (
              <p className="text-xs font-medium text-muted-foreground sm:col-span-3">
                You need {usd(s.min_payout_cents)} available before requesting a payout.
              </p>
            )}
          </div>
        )}
      </div>

      {payouts.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Payout history
          </h3>
          <ul className="mt-3 space-y-2">
            {payouts.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold tabular-nums">{usd(Number(p.amount_cents))}</p>
                  <p className="text-xs font-medium text-muted-foreground">
                    {new Date(p.requested_at).toLocaleDateString()} · {p.method}
                    {p.admin_note ? ` · ${p.admin_note}` : ""}
                  </p>
                </div>
                <span className="text-xs font-bold">{PAYOUT_STATUS[p.status] ?? p.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${highlight ? "text-primary" : ""}`}>
        {value}
      </p>
    </div>
  );
}
