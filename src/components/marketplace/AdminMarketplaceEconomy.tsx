import { useCallback, useEffect, useState } from "react";
import { Banknote, Loader2, Percent } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  adminDecidePayout,
  adminListPayouts,
  adminSetConfig,
  getMarketplaceConfig,
  type AdminPayoutRow,
  type MarketplaceConfig,
} from "@/lib/marketplace";

function usd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
}

/** Admin-side commission config + payout approvals (Phase 4). */
export function AdminMarketplaceEconomy() {
  const [config, setConfig] = useState<MarketplaceConfig | null>(null);
  const [payouts, setPayouts] = useState<AdminPayoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [cfg, rows] = await Promise.all([getMarketplaceConfig(), adminListPayouts()]);
    setConfig(cfg);
    setPayouts(rows);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load marketplace economy");
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  async function saveConfig(next: MarketplaceConfig) {
    setBusy("config");
    try {
      await adminSetConfig(next);
      setConfig(next);
      toast.success("Marketplace settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save settings");
    } finally {
      setBusy(null);
    }
  }

  async function decide(id: string, decision: "approved" | "paid" | "rejected") {
    setBusy(id);
    try {
      await adminDecidePayout(id, decision, notes[id]?.trim() || undefined);
      toast.success(`Payout ${decision}`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update payout");
    } finally {
      setBusy(null);
    }
  }

  if (loading || !config) {
    return (
      <div className="mt-10 grid place-items-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  const open = payouts.filter((p) => p.status === "pending" || p.status === "approved");
  const closed = payouts.filter((p) => p.status !== "pending" && p.status !== "approved");

  return (
    <>
      <section className="mt-12">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Economy settings
        </h2>
        <Card className="mt-3">
          <CardContent className="grid gap-4 p-4 sm:grid-cols-3 sm:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor="commission">
                <Percent className="mr-1 inline h-3.5 w-3.5" aria-hidden /> Commission (%)
              </Label>
              <Input
                id="commission"
                type="number"
                min={0}
                max={50}
                step="1"
                defaultValue={(config.commission_bps / 100).toString()}
                onBlur={(e) => {
                  const bps = Math.round(Number(e.target.value || "0") * 100);
                  if (bps === config.commission_bps) return;
                  void saveConfig({ ...config, commission_bps: Math.min(5000, Math.max(0, bps)) });
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="min-payout">Minimum payout (USD)</Label>
              <Input
                id="min-payout"
                type="number"
                min={0}
                step="1"
                defaultValue={(config.min_payout_cents / 100).toString()}
                onBlur={(e) => {
                  const cents = Math.max(0, Math.round(Number(e.target.value || "0") * 100));
                  if (cents === config.min_payout_cents) return;
                  void saveConfig({ ...config, min_payout_cents: cents });
                }}
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="payouts-enabled"
                checked={config.payouts_enabled}
                disabled={busy === "config"}
                onCheckedChange={(v) => void saveConfig({ ...config, payouts_enabled: v })}
              />
              <Label htmlFor="payouts-enabled">Payout requests open</Label>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Payout requests ({open.length})
        </h2>
        <div className="mt-3 space-y-3">
          {open.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm font-medium text-muted-foreground">
              <Banknote className="mx-auto mb-2 h-6 w-6" aria-hidden />
              No payouts waiting on you.
            </div>
          ) : (
            open.map((p) => (
              <Card key={p.id}>
                <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold tabular-nums">{usd(Number(p.amount_cents))}</p>
                    <p className="mt-1 text-xs font-medium text-muted-foreground">
                      {p.creator_email ?? p.creator_id} · {p.method} · {p.destination}
                    </p>
                    <p className="mt-1 text-[11px] font-medium text-muted-foreground">
                      Requested {new Date(p.requested_at).toLocaleString()} · {p.status}
                    </p>
                  </div>
                  <div className="flex w-full flex-col gap-2 lg:w-96">
                    <Input
                      value={notes[p.id] ?? ""}
                      onChange={(e) => setNotes((n) => ({ ...n, [p.id]: e.target.value }))}
                      placeholder="Note to creator (optional)"
                      aria-label="Payout note"
                    />
                    <div className="flex flex-wrap gap-2">
                      {p.status === "pending" && (
                        <Button
                          size="sm"
                          disabled={busy === p.id}
                          onClick={() => decide(p.id, "approved")}
                        >
                          Approve
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === p.id}
                        onClick={() => decide(p.id, "paid")}
                      >
                        Mark paid
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === p.id}
                        onClick={() => decide(p.id, "rejected")}
                      >
                        Decline
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </section>

      {closed.length > 0 && (
        <section className="mt-8">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Payout history
          </h2>
          <ul className="mt-3 space-y-2">
            {closed.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold tabular-nums">{usd(Number(p.amount_cents))}</p>
                  <p className="text-xs font-medium text-muted-foreground">
                    {p.creator_email ?? p.creator_id} · {p.method}
                  </p>
                </div>
                <span className="text-xs font-bold capitalize">{p.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
