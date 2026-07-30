/**
 * EnableBackendFromCloudDialog — plan-gated backend enable.
 *
 * Rules (matches /api/backend?action=enable-managed):
 *   - Free plan → show upgrade CTA (opens BillingSheet). Backend not available
 *     until they upgrade.
 *   - Paid plan + balance > $0 → "Enable backend". Hourly usage drains the
 *     wallet; if it hits $0 the project enters a 48h grace period.
 *   - Paid plan + balance == $0 → "Top up Cloud balance".
 *
 * The first paid-plan upgrade auto-grants $5 of runtime credit, so a brand
 * new paying user lands here with money in the wallet and one click away.
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
import { useWallet } from "@/hooks/use-wallet";
import { fetchRuntimeWallet, formatUsdCents } from "@/lib/runtime-wallet";
import { enableManagedBackend, enableSharedBackend } from "@/lib/projects";
import { RuntimeTopupModal } from "@/components/RuntimeTopupModal";
import { BillingSheet } from "@/components/BillingSheet";

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
  const { plan } = useWallet();
  const isPaidPlan = !!plan && plan.code !== "free";

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);
  const [billingOpen, setBillingOpen] = useState(false);
  const [totalBalanceCents, setTotalBalanceCents] = useState<number>(0);

  useEffect(() => {
    if (!open || !user) return;
    let cancelled = false;
    setLoading(true);
    fetchRuntimeWallet(user.id)
      .then((w) => {
        if (cancelled) return;
        setTotalBalanceCents(w.topupBalanceCents + w.freeBalanceCents);
      })
      .catch(() => {
        if (!cancelled) setTotalBalanceCents(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, user]);

  const hasBalance = totalBalanceCents > 0;
  const canEnable = isPaidPlan && hasBalance;

  async function handleEnableShared() {
    setSubmitting(true);
    try {
      await enableSharedBackend(projectId);
      toast.success("Your free backend is live");
      onOpenChange(false);
      onEnabled?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't enable backend");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEnable() {
    setSubmitting(true);
    try {
      await enableManagedBackend(projectId);
      toast.success("Setting up your backend…");
      onOpenChange(false);
      onEnabled?.();
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "plan_upgrade_required") {
        onOpenChange(false);
        setBillingOpen(true);
      } else if (err.code === "balance_empty" || err.code === "topup_required") {
        setTopupOpen(true);
      } else if (err.code === "provision_failed") {
        toast.error(err.message || "Couldn't create your backend. Please try again.");
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
              {isPaidPlan ? "Enable dedicated backend" : "Enable backend"}
            </DialogTitle>
            <DialogDescription>
              A dedicated database, auth and storage project just for your app.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking your plan…
            </div>
          ) : !isPaidPlan ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
                <p className="font-medium text-foreground">
                  Free shared backend — no card, no waiting.
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Your app gets a real database, user sign-up/sign-in and a REST
                  API hosted inside Petal Cloud. Up to 5,000 rows and 25
                  collections.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
                <p className="font-medium text-foreground">Want a dedicated backend?</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Upgrade for your own isolated database project with unlimited
                  rows, storage and SQL access. We'll add $5 of runtime credit to
                  get you started.
                </p>
              </div>
            </div>

          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/30 p-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    Cloud balance
                  </span>
                  <span
                    className={`text-2xl font-semibold tabular-nums ${
                      hasBalance ? "text-foreground" : "text-amber-600 dark:text-amber-400"
                    }`}
                  >
                    {formatUsdCents(totalBalanceCents)}
                  </span>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Backends cost $0.04/hr while active. Idle dedicated projects
                  auto-pause after 7 days to save credits.
                </p>
              </div>

              {!hasBalance && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <p className="font-medium text-foreground">
                    Your Cloud balance is $0. Top up to enable Cloud on this project.
                  </p>
                </div>
              )}
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
            {!isPaidPlan ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onOpenChange(false);
                    setBillingOpen(true);
                  }}
                  disabled={loading || submitting}
                  className="inline-flex items-center gap-1.5"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Upgrade for dedicated
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleEnableShared}
                  disabled={loading || submitting}
                  className="inline-flex items-center gap-1.5"
                >
                  {submitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Database className="h-3.5 w-3.5" />
                  )}
                  Start free backend
                </Button>
              </>
            ) : canEnable ? (
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
        minUsdCents={500}
        minReason="to enable your backend"
        onOpenChange={(v) => {
          setTopupOpen(v);
          if (!v && user) {
            fetchRuntimeWallet(user.id)
              .then((w) =>
                setTotalBalanceCents(w.topupBalanceCents + w.freeBalanceCents),
              )
              .catch(() => {});
          }
        }}
      />

      <BillingSheet open={billingOpen} onOpenChange={setBillingOpen} />
    </>
  );
}
