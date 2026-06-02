/**
 * Admin → Mobile Signing.
 *
 * Lists every project with stored Apple/Android signing creds plus the
 * Apple provisioning-profile expiry we captured at upload time
 * (`apple_provisioning_profile_not_after`). Rows are sorted by soonest
 * expiry so anything red shows up first.
 *
 * Backs P2-10 ("Apple cert expiry warning") — the daily cron at
 * /api/public/cron/mobile-cert-expiry already logs warnings; this view
 * gives ops a one-glance dashboard to act on them.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, ExternalLink } from "lucide-react";
import { createServerFn } from "@tanstack/react-start";
import { useServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { AdminTabs } from "@/components/AdminTabs";
import { SiteHeader } from "@/components/SiteHeader";
import { Card, CardContent } from "@/components/ui/card";
import { useAdminGuard } from "@/hooks/use-admin-guard";

type Row = {
  project_id: string;
  project_title: string | null;
  owner_email: string | null;
  apple_team_id: string | null;
  apple_bundle_id: string | null;
  apple_provisioning_profile_not_after: string | null;
  apple_p12_not_after: string | null;
  has_android: boolean;
  updated_at: string;
};

const listMobileSigningProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) {
      return { rows: [] as Row[], unauthorized: true as const };
    }

    const { data: profiles, error } = await supabaseAdmin
      .from("mobile_signing_profiles")
      .select(
        "project_id, apple_team_id, apple_bundle_id, apple_provisioning_profile_not_after, apple_p12_not_after, android_keystore_ciphertext, updated_at",
      );
    if (error) throw new Error(error.message);

    const ids = (profiles ?? []).map((p) => p.project_id);
    if (!ids.length) return { rows: [] as Row[] };

    const { data: projects } = await supabaseAdmin
      .from("projects")
      .select("id, title, owner_id")
      .in("id", ids);
    const projById = new Map((projects ?? []).map((p) => [p.id, p]));

    const ownerIds = Array.from(
      new Set((projects ?? []).map((p) => p.owner_id).filter(Boolean) as string[]),
    );
    const ownerEmailById = new Map<string, string>();
    if (ownerIds.length) {
      // Pull a page that covers our owner ids. 1000 is the SDK cap; users with
      // signing profiles are a tiny slice so this is comfortably enough.
      const { data: usersPage } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      for (const u of usersPage?.users ?? []) {
        if (u.id && u.email && ownerIds.includes(u.id)) {
          ownerEmailById.set(u.id, u.email);
        }
      }
    }

    const rows: Row[] = (profiles ?? []).map((p) => {
      const proj = projById.get(p.project_id);
      return {
        project_id: p.project_id,
        project_title: proj?.title ?? null,
        owner_email: proj?.owner_id ? ownerEmailById.get(proj.owner_id) ?? null : null,
        apple_team_id: p.apple_team_id,
        apple_bundle_id: p.apple_bundle_id,
        apple_provisioning_profile_not_after: p.apple_provisioning_profile_not_after,
        apple_p12_not_after: p.apple_p12_not_after,
        has_android: !!p.android_keystore_ciphertext,
        updated_at: p.updated_at,
      };
    });

    // Sort: expiring soonest first; rows with no expiry recorded sink to the bottom.
    rows.sort((a, b) => {
      const av = a.apple_provisioning_profile_not_after
        ? new Date(a.apple_provisioning_profile_not_after).getTime()
        : Number.POSITIVE_INFINITY;
      const bv = b.apple_provisioning_profile_not_after
        ? new Date(b.apple_provisioning_profile_not_after).getTime()
        : Number.POSITIVE_INFINITY;
      return av - bv;
    });

    return { rows };
  });

export const Route = createFileRoute("/admin/mobile-signing")({
  head: () => ({
    meta: [
      { title: "Admin · Mobile Signing" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: AdminMobileSigningPage,
});

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function expiryBadge(iso: string | null): { text: string; tone: string } {
  const d = daysUntil(iso);
  if (d === null) return { text: "—", tone: "text-muted-foreground" };
  if (d < 0) return { text: `expired ${-d}d ago`, tone: "text-destructive font-semibold" };
  if (d <= 14) return { text: `${d}d`, tone: "text-destructive font-semibold" };
  if (d <= 30) return { text: `${d}d`, tone: "text-amber-500 font-medium" };
  return { text: `${d}d`, tone: "text-muted-foreground" };
}

function AdminMobileSigningPage() {
  const { ready } = useAdminGuard("/admin/mobile-signing");
  const fetchRows = useServerFn(listMobileSigningProfiles);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    fetchRows()
      .then((res) => {
        if (cancelled) return;
        if ("unauthorized" in res && res.unauthorized) {
          setError("Admin access required");
          return;
        }
        setRows(res.rows);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [ready, fetchRows]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-background">
        <SiteHeader />
        <AdminTabs />
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <AdminTabs />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="mb-6 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Mobile Signing</h1>
          <p className="text-sm text-muted-foreground">
            Apple provisioning profile expiry surfaced for every project with
            stored signing creds. The daily{" "}
            <code className="rounded bg-muted px-1 text-xs">
              mobile-cert-expiry
            </code>{" "}
            cron logs warnings 30 days out.
          </p>
        </div>

        {error ? (
          <Card>
            <CardContent className="p-6 text-sm text-destructive">{error}</CardContent>
          </Card>
        ) : !rows ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              No mobile signing profiles configured.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead className="border-b border-border/60 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 text-left">Project</th>
                    <th className="px-4 py-2 text-left">Owner</th>
                    <th className="px-4 py-2 text-left">Bundle</th>
                    <th className="px-4 py-2 text-left">Profile expiry</th>
                    <th className="px-4 py-2 text-left">P12 expiry</th>
                    <th className="px-4 py-2 text-left">Android</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const profileBadge = expiryBadge(r.apple_provisioning_profile_not_after);
                    const p12Badge = expiryBadge(r.apple_p12_not_after);
                    return (
                      <tr key={r.project_id} className="border-b border-border/40">
                        <td className="px-4 py-2">
                          <div className="font-medium">{r.project_title ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{r.project_id.slice(0, 8)}</div>
                        </td>
                        <td className="px-4 py-2 text-muted-foreground">{r.owner_email ?? "—"}</td>
                        <td className="px-4 py-2">
                          <div className="text-xs">{r.apple_bundle_id ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{r.apple_team_id ?? ""}</div>
                        </td>
                        <td className={`px-4 py-2 text-xs ${profileBadge.tone}`}>{profileBadge.text}</td>
                        <td className={`px-4 py-2 text-xs ${p12Badge.tone}`}>{p12Badge.text}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {r.has_android ? "yes" : "—"}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Link
                            to="/admin/projects"
                            search={{ q: r.project_id }}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          >
                            open <ExternalLink className="h-3 w-3" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
