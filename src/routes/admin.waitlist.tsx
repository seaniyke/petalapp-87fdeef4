import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Mail, Users, Send, Download, Search } from "lucide-react";
import { toast } from "sonner";
import { AdminTabs } from "@/components/AdminTabs";
import { SiteHeader } from "@/components/SiteHeader";
import { useAdminGuard } from "@/hooks/use-admin-guard";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { adminApi, fmtRelative, downloadCsv } from "@/lib/admin-api";

export const Route = createFileRoute("/admin/waitlist")({
  head: () => ({
    meta: [
      { title: "Admin · Waitlist" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminWaitlistPage,
});

type Entry = {
  id: string;
  name: string;
  email: string;
  source: string | null;
  notified_at: string | null;
  approved_at: string | null;
  created_at: string;
  referral_count?: number | null;
  referral_code?: string | null;
  first_signin_at?: string | null;
};

type Announcement = {
  id: string;
  subject: string;
  recipients_total: number;
  sent_count: number;
  failed_count: number;
  status: string;
  created_at: string;
};

function AdminWaitlistPage() {
  const { ready } = useAdminGuard("/admin/waitlist");

  const [enabled, setEnabled] = useState(false);
  const [total, setTotal] = useState(0);
  const [pending, setPending] = useState(0);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState<string | null>(null);

  const [subject, setSubject] = useState("Petal is open — your spot is ready");
  const [heading, setHeading] = useState("Your spot is ready");
  const [bodyText, setBodyText] = useState(
    "We're opening Petal to the waitlist today.\n\nSign in with this email address and start building — web apps, mobile apps, backends and Chrome extensions, all from a sentence.",
  );
  const [ctaLabel, setCtaLabel] = useState("Start building");
  const [ctaUrl, setCtaUrl] = useState("https://buildwithpetal.com/auth?mode=signup");
  const [onlyPending, setOnlyPending] = useState(true);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<{ sent: number; failed: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, l, a] = await Promise.all([
        adminApi<{ enabled: boolean; total: number; pending: number }>({
          action: "waitlist_settings",
        }),
        adminApi<{ entries: Entry[]; total: number }>({
          action: "waitlist_list",
          page_size: 100,
          query,
        }),
        adminApi<{ announcements: Announcement[] }>({ action: "waitlist_announcements" }),
      ]);
      setEnabled(s.enabled);
      setTotal(s.total);
      setPending(s.pending);
      setEntries(l.entries);
      setAnnouncements(a.announcements);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load the waitlist");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  async function setApproval(entry: Entry, approve: boolean) {
    setApproving(entry.id);
    try {
      const res = await adminApi<{ approved_at: string | null; emailed?: boolean }>({
        action: "waitlist_approve",
        id: entry.id,
        approve,
      });
      setEntries((prev) =>
        prev.map((e) => (e.id === entry.id ? { ...e, approved_at: res.approved_at } : e)),
      );
      toast.success(
        approve
          ? res.emailed
            ? `${entry.email} approved — invite email sent`
            : `${entry.email} approved (invite email could not be sent)`
          : `Access revoked for ${entry.email}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update access");
    } finally {
      setApproving(null);
    }
  }

  async function toggle(next: boolean) {
    setEnabled(next);
    try {
      await adminApi({ action: "waitlist_toggle", enabled: next });
      toast.success(next ? "Waitlist mode on — sign-up is hidden" : "Waitlist off — sign-up is live");
    } catch (e) {
      setEnabled(!next);
      toast.error(e instanceof Error ? e.message : "Could not update");
    }
  }

  async function sendAnnouncement() {
    if (!subject.trim() || !bodyText.trim()) {
      toast.error("Add a subject and a message first.");
      return;
    }
    const audience = onlyPending ? pending : total;
    if (audience === 0) {
      toast.error("Nobody to email yet.");
      return;
    }
    if (!confirm(`Send "${subject}" to ${audience} waitlist member${audience === 1 ? "" : "s"}?`)) {
      return;
    }

    setSending(true);
    setProgress({ sent: 0, failed: 0 });
    try {
      let announcementId: string | undefined;
      let done = false;
      let guard = 0;
      while (!done && guard < 500) {
        guard += 1;
        const res = await adminApi<{
          announcement_id: string;
          total_sent: number;
          total_failed: number;
          done: boolean;
        }>({
          action: "waitlist_announce",
          announcement_id: announcementId,
          subject,
          heading,
          body: bodyText,
          cta_label: ctaLabel,
          cta_url: ctaUrl,
          only_pending: onlyPending,
          batch_size: 25,
        });
        announcementId = res.announcement_id;
        setProgress({ sent: res.total_sent, failed: res.total_failed });
        done = res.done;
      }
      toast.success("Announcement queued — emails are on their way.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed partway — safe to retry.");
    } finally {
      setSending(false);
    }
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <AdminTabs />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Waitlist</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gate access, collect names and emails, and announce launch in one go.
          </p>
        </div>

        {/* Toggle + stats */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="sm:col-span-1">
            <CardContent className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="text-sm font-medium">Waitlist mode</p>
                <p className="text-xs text-muted-foreground">
                  {enabled ? "Sign-up hidden" : "Sign-up open"}
                </p>
              </div>
              <Switch checked={enabled} onCheckedChange={toggle} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Users className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-xl font-semibold tabular-nums">{total}</p>
                <p className="text-xs text-muted-foreground">On the list</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <Mail className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-xl font-semibold tabular-nums">{pending}</p>
                <p className="text-xs text-muted-foreground">Not yet announced to</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Composer */}
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm font-medium">Launch announcement</p>
            <Input
              value={subject}
              maxLength={200}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject line"
            />
            <Input
              value={heading}
              maxLength={200}
              onChange={(e) => setHeading(e.target.value)}
              placeholder="Heading inside the email"
            />
            <Textarea
              value={bodyText}
              maxLength={8000}
              rows={6}
              onChange={(e) => setBodyText(e.target.value)}
              placeholder="Message — blank lines start a new paragraph"
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                value={ctaLabel}
                maxLength={60}
                onChange={(e) => setCtaLabel(e.target.value)}
                placeholder="Button label"
              />
              <Input
                value={ctaUrl}
                maxLength={500}
                onChange={(e) => setCtaUrl(e.target.value)}
                placeholder="https://buildwithpetal.com/auth"
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={onlyPending}
                onChange={(e) => setOnlyPending(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              Only people who haven't received an announcement yet
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={sendAnnouncement} disabled={sending} className="gap-2">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {sending ? "Sending…" : `Send to ${onlyPending ? pending : total}`}
              </Button>
              {progress && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {progress.sent} sent · {progress.failed} failed
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Emails go out in small batches through the normal email queue, so a big
              list can't break anything. Re-running only picks up whoever is left.
            </p>
          </CardContent>
        </Card>

        {/* Members */}
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search name or email"
                  className="pl-8"
                />
              </div>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                Refresh
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() =>
                  downloadCsv(
                    "petal-waitlist.csv",
                    entries as unknown as Record<string, unknown>[],
                  )
                }
              >
                <Download className="h-3.5 w-3.5" /> CSV
              </Button>
            </div>

            {loading ? (
              <div className="py-8 text-center">
                <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : entries.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No signups yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-3 font-medium">Name</th>
                      <th className="py-2 pr-3 font-medium">Email</th>
                      <th className="py-2 pr-3 font-medium">Invites</th>
                      <th className="py-2 pr-3 font-medium">Joined</th>
                      <th className="py-2 pr-3 font-medium">Announced</th>
                      <th className="py-2 pr-3 font-medium">Account</th>
                      <th className="py-2 font-medium">Access</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((e) => (
                      <tr key={e.id} className="border-b border-border/40 last:border-0">
                        <td className="py-2 pr-3">{e.name}</td>
                        <td className="py-2 pr-3 font-mono text-xs">{e.email}</td>
                        <td className="py-2 pr-3 text-xs">
                          {e.referral_count ? (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                              {e.referral_count}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">
                          {fmtRelative(e.created_at)}
                        </td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">
                          {e.notified_at ? fmtRelative(e.notified_at) : "—"}
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          {e.first_signin_at ? (
                            <span className="rounded-full bg-mint px-2 py-0.5 text-[11px] font-medium text-foreground">
                              Active
                            </span>
                          ) : e.approved_at ? (
                            <span className="text-muted-foreground">Invited</span>
                          ) : (
                            <span className="text-muted-foreground">Waiting</span>
                          )}
                        </td>
                        <td className="py-2">
                          {e.approved_at ? (
                            <div className="flex items-center gap-2">
                              <span className="rounded-full bg-mint px-2 py-0.5 text-[11px] font-medium text-foreground">
                                Approved
                              </span>
                              <button
                                type="button"
                                disabled={approving === e.id}
                                onClick={() => void setApproval(e, false)}
                                className="text-[11px] text-muted-foreground underline-offset-4 hover:text-destructive hover:underline disabled:opacity-50"
                              >
                                Revoke
                              </button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1.5 px-2.5 text-xs"
                              disabled={approving === e.id}
                              onClick={() => void setApproval(e, true)}
                            >
                              {approving === e.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Mail className="h-3 w-3" />
                              )}
                              Approve &amp; invite
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Past sends */}
        {announcements.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <p className="mb-3 text-sm font-medium">Past announcements</p>
              <ul className="space-y-2 text-sm">
                {announcements.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="truncate">{a.subject}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {a.sent_count} sent
                      {a.failed_count ? ` · ${a.failed_count} failed` : ""} ·{" "}
                      {fmtRelative(a.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
