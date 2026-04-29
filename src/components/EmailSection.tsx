/**
 * EmailSection — Petal Email management UI inside the project settings sheet.
 * - Free tier: 100/day, 3,000/month from noreply@buildwithpetal.com
 * - Pro: $25/mo for 50,000 emails (custom domain optional)
 *
 * On enable, we issue a per-project bearer token shown ONCE. The user pastes
 * it into their generated app and POSTs to /api/public/email/send.
 */
import { useEffect, useState } from "react";
import { Mail, Copy, RotateCw, Check, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useServerFn } from "@tanstack/react-start";
import {
  getPetalEmailStatus,
  enablePetalEmailForProject,
  rotatePetalEmailToken,
  listPetalEmailOutbound,
} from "@/server/petal-email.functions";
import { toast } from "sonner";
import { emitServiceEnabled } from "@/lib/service-events";

type Status = Awaited<ReturnType<typeof getPetalEmailStatus>>;
type OutboundRows = Awaited<ReturnType<typeof listPetalEmailOutbound>>["rows"];

export function EmailSection({ projectId }: { projectId: string }) {
  const fnStatus = useServerFn(getPetalEmailStatus);
  const fnEnable = useServerFn(enablePetalEmailForProject);
  const fnRotate = useServerFn(rotatePetalEmailToken);
  const fnList = useServerFn(listPetalEmailOutbound);

  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [outbound, setOutbound] = useState<OutboundRows>([]);

  const refresh = async () => {
    try {
      setLoading(true);
      const s = await fnStatus({ data: { projectId } });
      setStatus(s);
      if (s.enabled) {
        const o = await fnList({ data: { projectId } });
        setOutbound(o.rows);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load email status");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handleEnable = async () => {
    try {
      setBusy(true);
      const r = await fnEnable({ data: { projectId } });
      // Optimistically flip to enabled so the CTA hides immediately, even
      // before the follow-up refresh resolves. The refresh fills in usage,
      // sender details, and outbound rows.
      setStatus({
        enabled: true,
        subscription: {
          id: r.subscriptionId,
          plan: "free",
          status: "active",
          monthly_cap: 3000,
          daily_cap: 100,
          sender_email: r.sender,
          reply_to: null,
          custom_domain: null,
          custom_domain_verified: false,
          api_token_prefix: r.token.slice(0, 8),
          current_period_start: new Date().toISOString(),
          current_period_end: new Date(Date.now() + 30 * 86_400_000).toISOString(),
          created_at: new Date().toISOString(),
        },
        usage: { monthly_used: 0, daily_used: 0 },
        pro: status?.pro ?? { monthly_cap: 50000, price_usd_cents: 2500 },
      } as Status);
      setRevealedToken(r.token);
      toast.success("Petal Email enabled");
      emitServiceEnabled({
        projectId,
        service: "email",
        label: "Petal Email",
        summary: `Sender ${r.sender} • 100/day, 3,000/month on the free tier. Your API token is shown once — copy it now.`,
      });
      // Background refresh — don't block the UI flip on it.
      void refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to enable");
    } finally {
      setBusy(false);
    }
  };

  const handleRotate = async () => {
    if (!confirm("Rotate the API token? Your existing token will stop working immediately.")) return;
    try {
      setBusy(true);
      const r = await fnRotate({ data: { projectId } });
      setRevealedToken(r.token);
      toast.success("New token issued");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to rotate");
    } finally {
      setBusy(false);
    }
  };

  const copyToken = async () => {
    if (!revealedToken) return;
    await navigator.clipboard.writeText(revealedToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="mt-8 scroll-mt-4 border-t border-border pt-6">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Mail className="h-4 w-4" /> Petal Email
      </h3>
      <p className="mb-4 text-xs text-muted-foreground">
        Send emails from your app with one POST. Free 3,000/month, then $25/mo for 50,000.
      </p>

      {loading ? (
        <Skeleton className="h-24 w-full rounded-lg" />
      ) : !status?.enabled ? (
        <div className="rounded-lg border border-border bg-muted/30 p-4">
          <p className="mb-3 text-xs text-muted-foreground">
            Sender: <code className="rounded bg-background px-1.5 py-0.5">noreply@buildwithpetal.com</code>
          </p>
          <Button size="sm" onClick={handleEnable} disabled={busy}>
            {busy ? "Enabling…" : "Enable Petal Email"}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Quota */}
          <div className="grid grid-cols-2 gap-3">
            <Stat
              label={`This month · ${status.subscription.plan === "pro" ? "Pro" : "Free"}`}
              value={`${status.usage.monthly_used.toLocaleString()} / ${status.subscription.monthly_cap.toLocaleString()}`}
            />
            <Stat
              label="Today"
              value={`${status.usage.daily_used.toLocaleString()} / ${status.subscription.daily_cap.toLocaleString()}`}
            />
          </div>

          {/* Sender */}
          <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
            <div className="mb-1 text-muted-foreground">From</div>
            <code className="block break-all rounded bg-background px-2 py-1 font-mono">
              {status.subscription.custom_domain_verified && status.subscription.custom_domain
                ? `noreply@${status.subscription.custom_domain}`
                : status.subscription.sender_email}
            </code>
          </div>

          {/* Token */}
          <div className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>API Token</span>
              <Button size="sm" variant="ghost" className="h-6 gap-1 px-2" onClick={handleRotate} disabled={busy}>
                <RotateCw className="h-3 w-3" /> Rotate
              </Button>
            </div>
            {revealedToken ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-background px-2 py-1 text-xs font-mono">
                    {revealedToken}
                  </code>
                  <Button size="sm" variant="outline" className="h-7 gap-1 px-2" onClick={copyToken}>
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  Save this now — you won't see it again. Rotate to issue a new one.
                </p>
              </div>
            ) : (
              <code className="block truncate rounded bg-background px-2 py-1 text-xs font-mono text-muted-foreground">
                {status.subscription.api_token_prefix}••••••••••••••••
              </code>
            )}
          </div>

          {/* Snippet */}
          <details className="rounded-lg border border-border bg-muted/30 p-3 text-xs">
            <summary className="cursor-pointer font-medium">How to use in your app</summary>
            <pre className="mt-2 overflow-x-auto rounded bg-background p-2 text-[11px] leading-relaxed">
{`await fetch("https://buildwithpetal.com/api/public/email/send", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer YOUR_PETAL_EMAIL_TOKEN",
  },
  body: JSON.stringify({
    to: "user@example.com",
    subject: "Hello from my app",
    html: "<p>Welcome!</p>",
  }),
});`}
            </pre>
          </details>

          {/* Recent activity */}
          {outbound.length > 0 && (
            <div>
              <div className="mb-2 text-xs font-medium text-muted-foreground">Recent</div>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <tbody>
                    {outbound.slice(0, 10).map((row) => (
                      <tr key={row.id} className="border-b border-border last:border-0">
                        <td className="truncate px-2 py-1.5 max-w-[140px]">{row.recipient_email}</td>
                        <td className="truncate px-2 py-1.5 text-muted-foreground max-w-[140px]">
                          {row.subject ?? "—"}
                        </td>
                        <td className="px-2 py-1.5">
                          <StatusBadge status={row.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Upgrade hint */}
          {status.subscription.plan === "free" && (
            <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs">
              <div>
                <div className="font-medium">Need more?</div>
                <div className="text-muted-foreground">$25/mo for 50,000 emails + custom domain.</div>
              </div>
              <Button size="sm" variant="outline" className="gap-1" disabled>
                Upgrade <ExternalLink className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-medium">{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "sent"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : status === "failed" || status === "bounced" || status === "complained"
      ? "bg-red-500/10 text-red-600 dark:text-red-400"
      : status === "suppressed"
      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
      : "bg-muted text-muted-foreground";
  return <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>{status}</span>;
}
