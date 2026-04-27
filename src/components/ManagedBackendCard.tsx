/**
 * ManagedBackendCard — UI for the Petal-managed Supabase backend.
 *
 * Renders one of these states:
 *   - not-purchased: pitch + "Auto-provision" CTA -> opens BuyBackendSlotDialog
 *   - provisioning: progress card, polls every 5s for status
 *   - ready: shows hostname, expiry date, "Renew" / "Download credentials"
 *   - paused: explains slot expired, "Renew" CTA
 *   - failed: shows error, "Retry" CTA
 *
 * This card is always visible alongside the BYO connector; the user picks
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
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  getProjectBackend,
  getManagedProvisionStatus,
  retryManagedProvision,
  getManagedCredentials,
  type ProjectBackend,
  type ManagedProvisionStatus,
} from "@/lib/projects";
import { BuyBackendSlotDialog } from "@/components/BuyBackendSlotDialog";

type Props = {
  projectId: string;
  /** Current backend row from parent; null = nothing connected. */
  backend: ProjectBackend;
  /** Called when state changes (so parent can re-fetch + hide the BYO option). */
  onChanged: () => void;
};

const POLL_MS = 5_000;

export function ManagedBackendCard({ projectId, backend, onChanged }: Props) {
  const [buyOpen, setBuyOpen] = useState(false);
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

  async function handleDownload() {
    setDownloading(true);
    try {
      const c = await getManagedCredentials(projectId);
      const text = [
        `# Petal-managed Supabase credentials for project ${projectId}`,
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

  const expiresAt = backend?.slot?.expires_at ? new Date(backend.slot.expires_at) : null;
  const daysLeft = expiresAt
    ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000))
    : null;
  const renewSoon = daysLeft !== null && daysLeft <= 7;

  /* ---------------- Not purchased ---------------- */
  if (!isManaged) {
    return (
      <>
        <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-medium">Auto-provision a backend</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Don't have a Supabase project? Petal can spin one up for you and wire it in
                automatically. Renews every 30 days.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => setBuyOpen(true)}
            className="mt-3 inline-flex items-center gap-1.5"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Auto-provision (paid)
          </Button>
        </div>
        <BuyBackendSlotDialog
          open={buyOpen}
          onOpenChange={setBuyOpen}
          projectId={projectId}
        />
      </>
    );
  }

  /* ---------------- Provisioning ---------------- */
  if (phase === "provisioning") {
    const upstream = status?.upstreamStatus;
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
          </div>
        </div>
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
              {backend.errorMessage || "Something went wrong while creating your Supabase project."}
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

  /* ---------------- Paused (slot expired) ---------------- */
  if (phase === "paused") {
    return (
      <>
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
          <div className="flex items-start gap-2">
            <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="flex-1 text-sm">
              <div className="font-medium">Backend paused</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Your backend slot expired. Renew to bring your data back online — your
                tables and rows are preserved.
              </div>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              size="sm"
              onClick={() => setBuyOpen(true)}
              className="inline-flex items-center gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Renew
            </Button>
          </div>
        </div>
        <BuyBackendSlotDialog
          open={buyOpen}
          onOpenChange={setBuyOpen}
          projectId={projectId}
          isRenewal
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
              <span className="font-medium">Managed backend ready</span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                Auto-provisioned
              </span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {backend.supabaseUrl ? (
                <>
                  Connected to{" "}
                  <code className="rounded bg-background px-1 py-0.5 text-[11px]">
                    {new URL(backend.supabaseUrl).hostname}
                  </code>
                </>
              ) : null}
            </div>
            {expiresAt && (
              <div
                className={`mt-1 text-[11px] ${
                  renewSoon ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
                }`}
              >
                Renews {expiresAt.toLocaleDateString()} ({daysLeft} day{daysLeft === 1 ? "" : "s"} left)
              </div>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleDownload}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 text-xs"
          >
            {downloading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            Download credentials
          </Button>
          {backend.supabaseProjectRef && (
            <a
              href={`https://supabase.com/dashboard/project/${backend.supabaseProjectRef}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <ExternalLink className="h-3 w-3" /> Open in Supabase
            </a>
          )}
          <Button
            size="sm"
            variant={renewSoon ? "default" : "outline"}
            onClick={() => setBuyOpen(true)}
            className="inline-flex items-center gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Renew
          </Button>
        </div>
      </div>
      <BuyBackendSlotDialog
        open={buyOpen}
        onOpenChange={setBuyOpen}
        projectId={projectId}
        isRenewal
      />
    </>
  );
}
