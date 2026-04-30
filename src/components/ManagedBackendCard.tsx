/**
 * ManagedBackendCard — UI for the Petal-managed Supabase backend.
 *
 * Renders one of these states:
 *   - not-purchased: pitch + "Enable backend" CTA -> opens
 *     EnableBackendFromCloudDialog (Cloud-balance gated, no slots).
 *   - provisioning: progress card, polls every 5s for status.
 *   - ready: shows hostname, optional grace-period warning if Cloud balance
 *     ran out, "Download credentials".
 *   - paused: explains the project ran out of Cloud balance through the 48h
 *     grace window — top up to bring it back online.
 *   - failed: shows error, "Retry" CTA.
 *
 * The card is always visible alongside the BYO connector; the user picks
 * whichever path they want. Once one is connected, the other is hidden.
 */
import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Loader2,
  Sparkles,
  AlertTriangle,
  PauseCircle,
  RefreshCw,
  Download,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  getManagedProvisionStatus,
  retryManagedProvision,
  getManagedCredentials,
  type ProjectBackend,
  type ManagedProvisionStatus,
} from "@/lib/projects";
import { EnableBackendFromCloudDialog } from "@/components/EnableBackendFromCloudDialog";
import { RuntimeTopupModal } from "@/components/RuntimeTopupModal";

type Props = {
  projectId: string;
  /** Current backend row from parent; null = nothing connected. */
  backend: ProjectBackend;
  /** Called when state changes (so parent can re-fetch + hide the BYO option). */
  onChanged: () => void;
};

const POLL_MS = 5_000;

export function ManagedBackendCard({ projectId, backend, onChanged }: Props) {
  const [enableOpen, setEnableOpen] = useState(false);
  const [topupOpen, setTopupOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [status, setStatus] = useState<ManagedProvisionStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isManaged = backend?.provider === "managed_petal";
  const phase: ManagedProvisionStatus["status"] = isManaged
    ? (backend!.status as ManagedProvisionStatus["status"])
    : "missing";

  // Poll while the backend is provisioning.
  useEffect(() => {
    if (!isManaged) return;
    if (phase !== "provisioning") return;

    let cancelled = false;
    async function tick() {
      try {
        const next = await getManagedProvisionStatus(projectId);
        if (cancelled) return;
        setStatus(next);
        if (next.status !== "provisioning") {
          onChanged();
          return;
        }
      } catch {
        /* ignore transient errors, keep polling */
      }
      if (!cancelled) {
        pollTimerRef.current = setTimeout(tick, POLL_MS);
      }
    }
    tick();
    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [isManaged, phase, projectId, onChanged]);

  async function handleRetry() {
    setRetrying(true);
    try {
      await retryManagedProvision(projectId);
      toast.success("Restarting…");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't retry");
    } finally {
      setRetrying(false);
    }
  }

  async function handleCheckNow() {
    setRetrying(true);
    try {
      const next = await getManagedProvisionStatus(projectId);
      setStatus(next);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't check status");
    } finally {
      setRetrying(false);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const c = await getManagedCredentials(projectId);
      const text = [
        `# Petal Cloud backend credentials for project ${projectId}`,
        `# Generated ${new Date().toISOString()}`,
        ``,
        `SUPABASE_URL=${c.supabaseUrl}`,
        `SUPABASE_ANON_KEY=${c.anonKey}`,
        c.serviceRoleKey ? `SUPABASE_SERVICE_ROLE_KEY=${c.serviceRoleKey}` : "# SUPABASE_SERVICE_ROLE_KEY=(not available)",
        c.supabaseProjectRef ? `SUPABASE_PROJECT_REF=${c.supabaseProjectRef}` : "",
      ].filter(Boolean).join("\n");
      const blob = new Blob([text], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `petal-backend-${projectId.slice(0, 8)}.env`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Credentials downloaded");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't download");
    } finally {
      setDownloading(false);
    }
  }

  // Grace-period countdown (only shown when ready + balance ran out).
  const graceUntil = backend?.graceUntil ? new Date(backend.graceUntil) : null;
  const inGrace =
    graceUntil != null && graceUntil.getTime() > Date.now() && phase === "ready";
  const graceHoursLeft = inGrace
    ? Math.max(0, Math.ceil((graceUntil!.getTime() - Date.now()) / (60 * 60 * 1000)))
    : 0;

  /* ---------------- Not purchased ---------------- */
  if (!isManaged) {
    return (
      <>
        <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-medium">Add Petal Cloud backend</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Auth, database and file storage — fully managed by Petal. Funded by
                your Cloud balance, no separate fee.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => setEnableOpen(true)}
            className="mt-3 inline-flex items-center gap-1.5"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Enable Petal Cloud
          </Button>
        </div>
        <EnableBackendFromCloudDialog
          open={enableOpen}
          onOpenChange={setEnableOpen}
          projectId={projectId}
          onEnabled={onChanged}
        />
      </>
    );
  }

  /* ---------------- Provisioning ---------------- */
  if (phase === "provisioning") {
    const upstream = status?.upstreamStatus;
    // After 3 minutes of provisioning the row is likely stuck — show a Retry
    // affordance instead of leaving the user staring at a spinner.
    const startedAt = backend?.provisioningStartedAt
      ? new Date(backend.provisioningStartedAt).getTime()
      : 0;
    const stuckMs = 3 * 60 * 1000;
    const looksStuck = startedAt > 0 && Date.now() - startedAt > stuckMs;
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex items-start gap-2">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
          <div className="flex-1 text-sm">
            <div className="font-medium">Setting up your backend…</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              This usually takes 1–3 minutes.{" "}
              {upstream && upstream !== "ACTIVE_HEALTHY" ? (
                <span>
                  Status:{" "}
                  <code className="rounded bg-background px-1 py-0.5 text-[10px]">
                    {upstream}
                  </code>
                </span>
              ) : null}
            </div>
            {looksStuck && (
              <div className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                Taking longer than usual. You can safely retry.
              </div>
            )}
          </div>
        </div>
        {looksStuck && (
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={handleCheckNow}
              disabled={retrying}
              className="inline-flex items-center gap-1.5"
            >
              {retrying ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Check now
            </Button>
          </div>
        )}
      </div>
    );
  }

  /* ---------------- Failed ---------------- */
  if (phase === "failed") {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="flex-1 text-sm">
            <div className="font-medium">Provisioning failed</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {backend.errorMessage || "Something went wrong while setting up your backend."}
            </div>
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <Button
            size="sm"
            variant="outline"
            onClick={handleRetry}
            disabled={retrying}
            className="inline-flex items-center gap-1.5"
          >
            {retrying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Retry
          </Button>
        </div>
      </div>
    );
  }

  /* ---------------- Paused (Cloud balance ran out) ---------------- */
  if (phase === "paused") {
    return (
      <>
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <div className="flex items-start gap-2">
            <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="flex-1 text-sm">
              <div className="font-medium">Backend paused</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Your Cloud balance ran out and the 48-hour grace period ended. Top up
                to bring your data back online — your tables and rows are preserved.
              </div>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              onClick={() => setTopupOpen(true)}
              className="inline-flex items-center gap-1.5"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Top up Cloud balance
            </Button>
          </div>
        </div>
        <RuntimeTopupModal
          open={topupOpen}
          onOpenChange={(v) => {
            setTopupOpen(v);
            if (!v) onChanged();
          }}
        />
      </>
    );
  }

  /* ---------------- Ready ---------------- */
  return (
    <>
      <div className="rounded-lg border border-border bg-muted/30 p-3">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
          <div className="flex-1 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium">Petal Cloud connected</span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Auth, database and file storage are live and wired into your app.
            </div>
          </div>
        </div>

        {inGrace && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-2">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="flex-1 text-[11px] leading-snug">
              <span className="font-medium text-foreground">
                Cloud balance is empty
              </span>{" "}
              <span className="text-muted-foreground">
                — backend pauses in {graceHoursLeft}{" "}
                {graceHoursLeft === 1 ? "hour" : "hours"} unless you top up.
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px]"
              onClick={() => setTopupOpen(true)}
            >
              Top up
            </Button>
          </div>
        )}
      </div>
      <RuntimeTopupModal
        open={topupOpen}
        onOpenChange={(v) => {
          setTopupOpen(v);
          if (!v) onChanged();
        }}
      />
    </>
  );
}
