/**
 * Partner dashboard overview — one read that gives a partner (Custard) everything
 * its founder dashboard shows: live address, domains + renewal, badge, chat widget,
 * and what visitors sent (record counts per collection, visitor accounts).
 * Read-only; never returns visitor content or emails, only counts and dates.
 */

export const RECORD_SCAN_LIMIT = 5000;
const DAY_MS = 86_400_000;

export type CollectionCount = { collection: string; count: number; latestAt: string | null };

/** Pure: aggregate (collection, created_at) rows into counts per collection. */
export function aggregateCollections(rows: { collection: string; created_at: string }[]): CollectionCount[] {
  const map = new Map<string, CollectionCount>();
  for (const r of rows) {
    const c = map.get(r.collection) ?? { collection: r.collection, count: 0, latestAt: null };
    c.count += 1;
    if (!c.latestAt || r.created_at > c.latestAt) c.latestAt = r.created_at;
    map.set(r.collection, c);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.collection.localeCompare(b.collection));
}

/** Pure: whole days from now until expiry (negative when expired); null when unknown. */
export function daysUntil(expiresAt: string | null, now = Date.now()): number | null {
  if (!expiresAt) return null;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return null;
  return Math.floor((t - now) / DAY_MS);
}

export async function buildPartnerOverview(projectId: string) {
  const { supabaseAdmin: sb } = await import("@/integrations/supabase/client.server");
  const { PETAL_ROOT_DOMAIN } = await import("@/server/petal-subdomain.server");
  const { listProjectBuilds } = await import("@/server/service-api.server");

  const [projectQ, domainsQ, recordsQ, recordsCountQ, usersQ, builds] = await Promise.all([
    sb
      .from("projects")
      .select("id, title, revision, subdomain, published_at, hide_petal_badge, custard_widget_tag, updated_at")
      .eq("id", projectId)
      .maybeSingle(),
    sb
      .from("purchased_domains")
      .select("hostname, status, expires_at, auto_renew, renewal_status, renewal_error, term_years, registered_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),
    sb
      .from("shared_app_records")
      .select("collection, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(RECORD_SCAN_LIMIT),
    sb.from("shared_app_records").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    sb.from("shared_app_users").select("id", { count: "exact", head: true }).eq("project_id", projectId),
    listProjectBuilds(projectId, 10).catch(() => []),
  ]);

  const p = projectQ.data;
  if (!p) return null;
  const rows = (recordsQ.data ?? []) as { collection: string; created_at: string }[];
  const totalRecords = recordsCountQ.count ?? rows.length;
  const live = builds.find((b: { status: string }) => b.status === "ready") ?? null;
  const widgetTag = p.custard_widget_tag ?? null;
  const agentMatch = widgetTag?.match(/data-agent="([^"]+)"/) ?? widgetTag?.match(/[?&]agent=([^&"]+)/);

  return {
    project: { id: p.id, title: p.title, revision: p.revision, updatedAt: p.updated_at },
    deployment: {
      subdomainUrl: p.subdomain ? `https://${p.subdomain}.${PETAL_ROOT_DOMAIN}` : null,
      publishedAt: p.published_at,
      liveBuild: live,
      latestBuild: builds[0] ?? null,
    },
    domains: (domainsQ.data ?? []).map((d) => ({
      hostname: d.hostname,
      status: d.status,
      registeredAt: d.registered_at,
      expiresAt: d.expires_at,
      daysUntilExpiry: daysUntil(d.expires_at),
      termYears: d.term_years,
      autoRenew: d.auto_renew,
      renewalStatus: d.renewal_status,
      renewalError: d.renewal_error,
    })),
    branding: { badge: p.hide_petal_badge ? "removed" : "shown" },
    chatWidget: { attached: !!widgetTag, agentId: agentMatch ? decodeURIComponent(agentMatch[1]) : null },
    activity: {
      totalRecords,
      visitorAccounts: usersQ.count ?? 0,
      latestActivityAt: rows[0]?.created_at ?? null,
      collections: aggregateCollections(rows),
      countsPartial: totalRecords > rows.length,
    },
  };
}
