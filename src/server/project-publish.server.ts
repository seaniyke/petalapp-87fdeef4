/**
 * Put a project's latest ready build live on its addresses (subdomain and
 * custom domains). Same rules as /api/publish: only a ready build of the
 * CURRENT code revision, compare-and-set on the revision.
 */
export type PublishResult =
  | { ok: true; buildId: string; revision: number; publishedAt: string }
  | { ok: false; status: number; error: string };

export async function publishLatestBuild(projectId: string): Promise<PublishResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: p } = await supabaseAdmin
    .from("projects")
    .select("id, revision, latest_build_id, published_visibility")
    .eq("id", projectId)
    .maybeSingle();
  if (!p) return { ok: false, status: 404, error: "not_found" };
  if (!p.latest_build_id) return { ok: false, status: 409, error: "no_build" };
  const { data: b } = await supabaseAdmin
    .from("project_builds")
    .select("id, status, project_revision")
    .eq("id", p.latest_build_id)
    .maybeSingle();
  if (!b || b.status !== "ready") return { ok: false, status: 409, error: "build_not_ready" };
  if (Number(b.project_revision) !== Number(p.revision)) {
    return { ok: false, status: 409, error: "latest_changes_still_building" };
  }
  const publishedAt = new Date().toISOString();
  const updates: Record<string, unknown> = { published_build_id: b.id, published_at: publishedAt };
  if (p.published_visibility === "unpublished") updates.published_visibility = "public";
  const { data: updated } = await supabaseAdmin
    .from("projects")
    .update(updates as never)
    .eq("id", projectId)
    .eq("revision", Number(p.revision))
    .select("id")
    .maybeSingle();
  if (!updated) return { ok: false, status: 409, error: "project_changed_while_publishing" };
  // Publishing is the moment the address must answer: (re)request its
  // certificate if it is missing. Best-effort; never undoes the publish.
  try {
    const { ensureSubdomainCertificate } = await import("@/server/petal-subdomain.server");
    await ensureSubdomainCertificate(projectId);
  } catch (e) {
    console.error("[publish] address certificate check failed", projectId, e);
  }
  return { ok: true, buildId: b.id, revision: Number(p.revision), publishedAt };
}
