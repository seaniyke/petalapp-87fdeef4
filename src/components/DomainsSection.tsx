/**
 * DomainsSection — manage custom domains for a project inside ProjectSettingsSheet.
 *
 * UX mirrors what every major builder (Lovable, Vercel/v0, Bolt) ships:
 *   - empty state explains what a custom domain does
 *   - add a hostname → backend stores the request and returns DNS records
 *   - DNS records modal shows A + TXT to copy into the user's registrar
 *   - row list shows status pill, primary badge, and a ⋯ menu
 *   - realtime subscription so status flips appear without refresh
 */
import { useEffect, useMemo, useState } from "react";
import {
  Globe,
  Loader2,
  Plus,
  Copy,
  Check,
  MoreHorizontal,
  Star,
  Trash2,
  RefreshCw,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  listDomains,
  addDomain,
  verifyDomain,
  setPrimaryDomain,
  removeDomain,
  PETAL_DOMAIN_A_RECORD,
  type ProjectDomain,
} from "@/lib/domains";
import { supabase } from "@/integrations/supabase/client";

type Props = {
  projectId: string;
  /** Whether the project has a published deployment yet. */
  hasPublishedBuild: boolean;
};

export function DomainsSection({ projectId, hasPublishedBuild }: Props) {
  const [loading, setLoading] = useState(true);
  const [domains, setDomains] = useState<ProjectDomain[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [recordsFor, setRecordsFor] = useState<ProjectDomain | null>(null);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listDomains(projectId)
      .then((rows) => {
        if (!cancelled) setDomains(rows);
      })
      .catch(() => {
        if (!cancelled) setDomains([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Realtime: flip status pills as the verification job runs
  useEffect(() => {
    const channel = supabase
      .channel(`project_domains:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "project_domains",
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          listDomains(projectId)
            .then(setDomains)
            .catch(() => {});
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId]);

  function upsertLocal(next: ProjectDomain) {
    setDomains((prev) => {
      const idx = prev.findIndex((d) => d.id === next.id);
      if (idx === -1) return [...prev, next];
      const copy = prev.slice();
      copy[idx] = next;
      return copy;
    });
  }

  async function handleVerify(d: ProjectDomain) {
    try {
      const next = await verifyDomain(projectId, d.id);
      upsertLocal(next);
      toast.success("Re-checking DNS…");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't check status");
    }
  }

  async function handleSetPrimary(d: ProjectDomain) {
    try {
      const next = await setPrimaryDomain(projectId, d.id);
      // Server only returns the row that was promoted; refetch to clear other primaries
      const fresh = await listDomains(projectId);
      setDomains(fresh);
      void next;
      toast.success(`${d.hostname} is now the primary domain`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't set primary");
    }
  }

  async function handleRemove(d: ProjectDomain) {
    if (
      !confirm(
        `Remove ${d.hostname}? Your site will stop being served on this domain.`,
      )
    ) {
      return;
    }
    try {
      await removeDomain(projectId, d.id);
      setDomains((prev) => prev.filter((x) => x.id !== d.id));
      toast.success("Domain removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove");
    }
  }

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Globe className="h-4 w-4" /> Domains
        </h3>
        {domains.length > 0 && hasPublishedBuild && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </Button>
        )}
      </div>

      {!hasPublishedBuild && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            Publish your project first. Once it's live on the Petal subdomain,
            you can connect your own domain here.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      ) : domains.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-3">
          <p className="text-xs text-muted-foreground">
            Use your own domain like{" "}
            <code className="rounded bg-background px-1 py-0.5 text-[11px]">
              acme.com
            </code>{" "}
            instead of the default Petal subdomain. Petal issues a free SSL
            certificate automatically.
          </p>
          <Button
            size="sm"
            disabled={!hasPublishedBuild}
            onClick={() => setShowAdd(true)}
            className="mt-3 inline-flex items-center gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Connect a domain
          </Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {domains.map((d) => (
            <DomainRow
              key={d.id}
              domain={d}
              onShowRecords={() => setRecordsFor(d)}
              onVerify={() => handleVerify(d)}
              onSetPrimary={() => handleSetPrimary(d)}
              onRemove={() => handleRemove(d)}
            />
          ))}
        </ul>
      )}

      <AddDomainDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        projectId={projectId}
        onAdded={(d) => {
          upsertLocal(d);
          setShowAdd(false);
          setRecordsFor(d);
        }}
      />

      <DnsRecordsDialog
        domain={recordsFor}
        onClose={() => setRecordsFor(null)}
        onVerify={async () => {
          if (!recordsFor) return;
          await handleVerify(recordsFor);
        }}
      />
    </div>
  );
}

/* ---------------- row ---------------- */

function DomainRow({
  domain,
  onShowRecords,
  onVerify,
  onSetPrimary,
  onRemove,
}: {
  domain: ProjectDomain;
  onShowRecords: () => void;
  onVerify: () => void;
  onSetPrimary: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="rounded-lg border border-border bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="break-all text-sm font-medium">{domain.hostname}</span>
            {domain.is_primary && (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-foreground">
                <Star className="h-2.5 w-2.5" />
                Primary
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StatusPill status={domain.status} />
            {domain.status === "active" && (
              <a
                href={`https://${domain.hostname}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                Visit
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          {domain.error_message && (
            <p className="mt-1 text-[11px] text-destructive">{domain.error_message}</p>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Domain actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={onShowRecords}>
              <Globe className="mr-2 h-3.5 w-3.5" />
              View DNS records
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onVerify}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
              Check status
            </DropdownMenuItem>
            {!domain.is_primary && domain.status === "active" && (
              <DropdownMenuItem onClick={onSetPrimary}>
                <Star className="mr-2 h-3.5 w-3.5" />
                Set as primary
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onRemove}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

function StatusPill({ status }: { status: ProjectDomain["status"] }) {
  const styles = useMemo(() => {
    switch (status) {
      case "active":
        return "border-green-600/40 bg-green-600/10 text-green-700 dark:text-green-400";
      case "verifying":
      case "pending":
        return "border-amber-600/40 bg-amber-600/10 text-amber-700 dark:text-amber-400";
      case "failed":
      case "offline":
        return "border-destructive/40 bg-destructive/10 text-destructive";
      default:
        return "border-border bg-muted text-muted-foreground";
    }
  }, [status]);
  const label = useMemo(() => {
    switch (status) {
      case "pending":
        return "Pending DNS";
      case "verifying":
        return "Verifying…";
      case "active":
        return "Active";
      case "failed":
        return "Failed";
      case "offline":
        return "Offline";
      case "removed":
        return "Removed";
      default:
        return status;
    }
  }, [status]);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${styles}`}
    >
      {(status === "verifying" || status === "pending") && (
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
      )}
      {label}
    </span>
  );
}

/* ---------------- add dialog ---------------- */

function AddDomainDialog({
  open,
  onOpenChange,
  projectId,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  onAdded: (d: ProjectDomain) => void;
}) {
  const [hostname, setHostname] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setHostname("");
      setSubmitting(false);
    }
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const cleaned = hostname.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      const d = await addDomain(projectId, cleaned);
      onAdded(d);
      toast.success("Domain added — now point your DNS at Petal");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add domain");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect a custom domain</DialogTitle>
          <DialogDescription>
            Enter a domain you own. We'll show you the DNS records to add at
            your registrar next.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="d-host" className="text-xs">
              Domain
            </Label>
            <Input
              id="d-host"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="acme.com or blog.acme.com"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              required
              className="text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              For the root domain we suggest also adding{" "}
              <code className="rounded bg-muted px-1 py-0.5">www.acme.com</code>{" "}
              as a separate entry.
            </p>
          </div>
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
            <Button
              type="submit"
              size="sm"
              disabled={submitting || !hostname.trim()}
              className="inline-flex items-center gap-1.5"
            >
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Add domain
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- DNS records dialog ---------------- */

function DnsRecordsDialog({
  domain,
  onClose,
  onVerify,
}: {
  domain: ProjectDomain | null;
  onClose: () => void;
  onVerify: () => Promise<void>;
}) {
  const [checking, setChecking] = useState(false);

  async function handleCheck() {
    setChecking(true);
    try {
      await onVerify();
    } finally {
      setChecking(false);
    }
  }

  if (!domain) return null;

  // For apex domains (no leading subdomain like "www") we recommend `@`.
  // For subdomains we show the leftmost label as the host.
  const labels = domain.hostname.split(".");
  const isApex = labels.length === 2; // crude but matches common .com/.net cases
  const aHost = isApex ? "@" : labels[0];

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[calc(100vw-1.5rem)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="break-all">DNS records for {domain.hostname}</DialogTitle>
          <DialogDescription>
            Add these two records at your domain registrar (GoDaddy, Namecheap,
            Cloudflare, etc.). DNS changes can take a few minutes — sometimes up
            to 72 hours.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <RecordCard
            type="A"
            host={aHost}
            value={PETAL_DOMAIN_A_RECORD}
            note="Points your domain at Petal."
          />
          <RecordCard
            type="TXT"
            host={domain.verification_txt_name}
            value={domain.verification_txt_value}
            note="Proves you own this domain."
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button
            size="sm"
            onClick={handleCheck}
            disabled={checking}
            className="inline-flex items-center gap-1.5"
          >
            {checking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Check status
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecordCard({
  type,
  host,
  value,
  note,
}: {
  type: "A" | "TXT";
  host: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between">
        <span className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
          {type}
        </span>
        <span className="text-[11px] text-muted-foreground">{note}</span>
      </div>
      <div className="mt-2 grid grid-cols-[auto_1fr_auto] items-center gap-2 text-xs">
        <span className="text-muted-foreground">Host</span>
        <code className="break-all rounded bg-background px-2 py-1 font-mono text-[11px]">
          {host}
        </code>
        <CopyButton value={host} label="host" />

        <span className="text-muted-foreground">Value</span>
        <code className="break-all rounded bg-background px-2 py-1 font-mono text-[11px]">
          {value}
        </code>
        <CopyButton value={value} label="value" />
      </div>
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Couldn't copy");
        }
      }}
      aria-label={`Copy ${label}`}
      className="grid h-7 w-7 place-items-center rounded-md border border-border text-muted-foreground transition hover:bg-muted"
    >
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}
