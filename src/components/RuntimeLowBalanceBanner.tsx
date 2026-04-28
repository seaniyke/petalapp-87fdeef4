/**
 * Low-balance banner shown inside the builder when the active project's
 * runtime wallet is running low or when the project has been auto-paused
 * because of a spend cap. One-line, dismissible, opens the top-up modal.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { fetchRuntimeWallet, fetchProjectUsage } from "@/lib/runtime-wallet";
import { RuntimeTopupModal } from "@/components/RuntimeTopupModal";

type Props = {
  projectId?: string | null;
};

const LOW_THRESHOLD_CENTS = 100; // $1 — show a heads-up well before zero.

export function RuntimeLowBalanceBanner({ projectId }: Props) {
  const { user } = useAuth();
  const [paused, setPaused] = useState(false);
  const [totalCents, setTotalCents] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const [wallet, projects] = await Promise.all([
          fetchRuntimeWallet(user.id),
          fetchProjectUsage(user.id),
        ]);
        if (cancelled) return;
        setTotalCents(wallet.freeBalanceCents + wallet.topupBalanceCents);
        const proj = projectId
          ? projects.find((p) => p.projectId === projectId)
          : undefined;
        setPaused(!!proj?.paused);
      } catch {
        /* ignore — banner is cosmetic */
      }
    };
    tick();
    const interval = setInterval(tick, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user?.id, projectId]);

  if (!user?.id || dismissed) return null;
  if (totalCents === null) return null;

  const isLow = totalCents < LOW_THRESHOLD_CENTS;
  if (!isLow && !paused) return null;

  return (
    <>
      <div
        role="status"
        className={`flex items-center gap-2 border-b px-3 py-1.5 text-xs sm:px-4 ${
          paused
            ? "border-destructive/40 bg-destructive/10 text-destructive-foreground"
            : "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200"
        }`}
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {paused
            ? "Runtime paused — your project hit its spend cap. Top up to bring it back online."
            : `Cloud + AI balance is low (${formatCents(totalCents)}). Top up to keep your apps running.`}
        </span>
        <button
          type="button"
          onClick={() => setTopupOpen(true)}
          className="rounded-full border border-current/40 px-2 py-0.5 text-[11px] font-medium hover:bg-background/40"
        >
          Top up
        </button>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissed(true)}
          className="rounded-full p-0.5 hover:bg-background/40"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <RuntimeTopupModal open={topupOpen} onOpenChange={setTopupOpen} />
    </>
  );
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
