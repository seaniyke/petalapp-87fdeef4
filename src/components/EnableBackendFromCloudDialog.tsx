/**
 * EnableBackendFromCloudDialog — Cloud-balance gated backend enable.
 *
 * Replaces the legacy 30-day BuyBackendSlotDialog. There are no slots: a
 * managed backend is provisioned for free as long as the user has at least
 * $10 in their Cloud top-up balance. Hourly usage drains the wallet; if
 * the wallet hits $0 the project enters a 48-hour grace period before
 * being paused (handled server-side).
 *
 * Two states:
 *   - balance < $10 → show "Top up to enable" with the missing amount + a
 *     CTA that opens the Cloud top-up modal.
 *   - balance ≥ $10 → show the running cost estimate and an "Enable backend"
 *     button that POSTs to /api/backend?action=enable-managed.
 */
import { useEffect, useState } from "react";
import { Loader2, Database, Sparkles, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { fetchRuntimeWallet, formatUsdCents } from "@/lib/runtime-wallet";
import { enableManagedBackend } from "@/lib/projects";
import { RuntimeTopupModal } from "@/components/RuntimeTopupModal";

const PROVISIONING_FLOOR_CENTS = 1000; // keep in sync with /api/backend
const HOURLY_RATE_CENTS = 2; // keep in sync with cron/runtime-backend-hour

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  /** Called after the backend is successfully enabled (and provisioning starts). */
  onEnabled?: () => void;
};

export function EnableBackendFromCloudDialog({
  open,
  onOpenChange,
  projectId,
  onEnabled,
}: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);
  const [balanceCents, setBalanceCents] = useState<number>(0);

  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    setLoading(true);
    fetchRuntimeWallet(user.id)
      .then((w) => {
        if (cancelled) return;
        setBalanceCents(w.topupBalanceCents);
      })
      .catch(() => {
        if (!cancelled) setBalanceCents(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, user]);

  const enoughBalance = balanceCents >= PROVISIONING_FLOOR_CENTS;
  const shortfallCents = Math.max(0, PROVISIONING_FLOOR_CENTS - balanceCents);
  // Approx monthly cost at $0.02/hr × 24 × 30 ≈ $14.40
  const monthlyEstimateCents = HOURLY_RATE_CENTS * 24 * 30;

  async function handleEnable() {
    setSubmitting(true);
    try {
      await enableManagedBackend(projectId);
      toast.success("Setting up your backend…");
      onOpenChange(false);
      onEnabled?.();
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "topup_required") {
        // Race: balance dropped between fetch and click. Push to top-up.
        setTopupOpen(true);
      } else {
        toast.error(err.message || "Couldn't enable backend");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              Enable managed backend
            </DialogTitle>
            <DialogDescription>
              Petal Cloud will provision a database, auth and storage for this project
              and wire it in automatically. Costs are billed hourly from your Cloud
              balance — no separate fee.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking your balance…
            </div>
          ) : (
            <div className="space-y-4">
              {/* Balance card */}
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    Cloud balance
                  </span>
                  <span
                    className={`text-2xl font-semibold tabular-nums ${
                      enoughBalance ? "text-foreground" : "text-amber-600 dark:text-amber-400"
                    }`}
                  >
                    {formatUsdCents(balanceCents)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Backend costs ~{formatUsdCents(HOURLY_RATE_CENTS)}/hr (≈
                  {formatUsdCents(monthlyEstimateCents)}/mo).
                </p>
              </div>

              {!enoughBalance && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <div className="flex-1 text-xs leading-relaxed">
                      <p className="font-medium text-foreground">
                        Top up {formatUsdCents(shortfallCents)} more to enable
                      </p>
                      <p className="mt-0.5 text-muted-foreground">
                        We require at least{" "}
                        {formatUsdCents(PROVISIONING_FLOOR_CENTS)} in your Cloud
                        balance to provision a backend. After that, hourly usage drains
                        from the same balance.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <ul className="space-y-1.5 text-xs text-muted-foreground">
                <Bullet>Postgres database with Row Level Security</Bullet>
                <Bullet>Email + password and OAuth authentication</Bullet>
                <Bullet>File storage and edge functions, deployed automatically</Bullet>
                <Bullet>
                  48-hour grace period if your Cloud balance hits $0 — your data is
                  preserved.
                </Bullet>
              </ul>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            {enoughBalance ? (
              <Button
                type="button"
                size="sm"
                onClick={handleEnable}
                disabled={submitting || loading}
                className="inline-flex items-center gap-1.5"
              >
                {submitting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                Enable backend
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={() => setTopupOpen(true)}
                disabled={loading}
                className="inline-flex items-center gap-1.5"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Top up Cloud balance
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RuntimeTopupModal
        open={topupOpen}
        onOpenChange={(v) => {
          setTopupOpen(v);
          // Re-fetch balance when the top-up modal closes so the user can
          // try Enable again without reopening this dialog.
          if (!v && user) {
            fetchRuntimeWallet(user.id)
              .then((w) => setBalanceCents(w.topupBalanceCents))
              .catch(() => {});
          }
        }}
      />
    </>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
      <span>{children}</span>
    </li>
  );
}
