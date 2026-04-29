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
  const [qualified, setQualified] = useState<boolean>(true);
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
        setQualified(wallet.qualifiedForFreeGrant);
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

  const isEmpty = totalCents === 0 && !qualified;
  const isLow = totalCents > 0 && totalCents < LOW_THRESHOLD_CENTS;
  if (!isLow && !paused && !isEmpty) return null;

  let message: string;
  if (paused) {
    message = "Runtime paused — your project hit its spend cap. Top up to bring it back online.";
  } else if (isEmpty) {
    message = "Top up to start using Cloud + AI. First top-up unlocks $5/mo free Cloud credit.";
  } else {
    message = `Cloud + AI balance is low (${formatCents(totalCents)}). Top up to keep your apps running.`;
  }

  // Paused = blocking. Keep the full-width banner so users can't miss it.
  if (paused) {
    return (
      <>
        <div
          role="status"
          className="flex items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive-foreground sm:px-4"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{message}</span>
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

  // Low / empty = informational. Render as a floating pill chip in the
  // bottom-right so it doesn't shove the chat down or feel alarmist.
  const tone = isEmpty
    ? "border-foreground/15 bg-background text-foreground"
    : "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200";
  return (
    <>
      <div className="pointer-events-none fixed bottom-3 right-3 z-40 sm:bottom-4 sm:right-4">
        <div
          role="status"
          className={`pointer-events-auto flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] shadow-sm backdrop-blur ${tone}`}
        >
          <AlertTriangle className="h-3 w-3 shrink-0 opacity-70" />
          <span className="max-w-[60vw] truncate sm:max-w-xs">{message}</span>
          <button
            type="button"
            onClick={() => setTopupOpen(true)}
            className="rounded-full border border-current/40 px-1.5 py-0.5 text-[10.5px] font-medium hover:bg-background/40"
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
      </div>
      <RuntimeTopupModal open={topupOpen} onOpenChange={setTopupOpen} />
    </>
  );
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
