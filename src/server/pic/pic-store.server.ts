/**
 * PIC — persistence.
 *
 * One canonical row per project in `project_intelligence`, plus an
 * append-only `project_intelligence_history` trail so we can see how the
 * understanding of a product evolved (and roll back a bad turn).
 *
 * Every function is best-effort: persistence must never fail a build.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PIC_HISTORY_CAP, type ProjectIntelligenceContext, type VersionedPic } from "./pic-types";

function upgrade(pic: ProjectIntelligenceContext): ProjectIntelligenceContext {
  return {
    ...pic,
    schema: 1,
    userJourneys: pic.userJourneys ?? [],
    features: pic.features ?? [],
    uxDecisions: pic.uxDecisions ?? [],
    acceptanceCriteria: pic.acceptanceCriteria ?? [],
    decisions: pic.decisions ?? [],
    protectedDecisions: pic.protectedDecisions ?? [],
    protectedFiles: pic.protectedFiles ?? [],
    unresolved: pic.unresolved ?? [],
    history: pic.history ?? [],
  };
}

export async function loadPic(projectId?: string | null): Promise<VersionedPic | null> {
  if (!projectId) return null;
  try {
    const { data } = await (supabaseAdmin as any)
      .from("project_intelligence")
      .select("context, revision, updated_at")
      .eq("project_id", projectId)
      .maybeSingle();
    const ctx = data?.context;
    if (!ctx || typeof ctx !== "object") return null;
    return {
      pic: upgrade(ctx as ProjectIntelligenceContext),
      revision: data.revision ?? 0,
      updatedAt: data.updated_at ?? new Date().toISOString(),
    };
  } catch (e) {
    console.warn("[pic] load skipped:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

export async function savePic(
  projectId: string | undefined | null,
  pic: ProjectIntelligenceContext,
  opts: { turnId?: string; summary?: string } = {},
): Promise<VersionedPic> {
  const revision = (pic.revision ?? 0) + 1;
  const updatedAt = new Date().toISOString();
  const history = [
    ...(pic.history ?? []),
    { at: updatedAt, turnId: opts.turnId, summary: opts.summary ?? "Context updated" },
  ].slice(-PIC_HISTORY_CAP);

  const next: ProjectIntelligenceContext = { ...pic, projectId: projectId ?? null, revision, updatedAt, history };
  if (!projectId) return { pic: next, revision, updatedAt };

  try {
    await (supabaseAdmin as any)
      .from("project_intelligence")
      .upsert(
        { project_id: projectId, context: next, revision, updated_at: updatedAt },
        { onConflict: "project_id" },
      );
    await (supabaseAdmin as any).from("project_intelligence_history").insert({
      project_id: projectId,
      revision,
      turn_id: opts.turnId ?? null,
      summary: opts.summary ?? "Context updated",
      context: next,
    });
  } catch (e) {
    console.warn("[pic] save skipped:", e instanceof Error ? e.message : String(e));
  }
  return { pic: next, revision, updatedAt };
}
