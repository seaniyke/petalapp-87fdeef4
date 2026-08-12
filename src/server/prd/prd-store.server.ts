/**
 * PRD — persistence.
 *
 * The PRD is stored per project so follow-up turns build against the same
 * contract instead of re-deriving (and drifting) the product on every edit.
 *
 * It lives inside the existing `project_blueprints.blueprint` JSON column
 * under a `prd` key, so no schema migration is needed and older projects
 * simply read back `null`.
 *
 * Every function is best-effort: persistence must never fail a build.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Prd, VersionedPrd } from "./prd-types";

function upgradePrd(prd: Prd): Prd {
  const dataModel = Array.isArray(prd.dataModel)
    ? prd.dataModel.map((entity) => ({
        ...entity,
        operations: entity.operations ?? ["create", "read", "update", "delete"],
        visibility: entity.visibility ?? (prd.needsAuth ? "owner" : "public"),
        ownerField: entity.ownerField ?? (prd.needsAuth ? "user_id" : undefined),
        relationships: entity.relationships ?? [],
      }))
    : [];
  return {
    ...prd,
    dataModel,
    roles: prd.roles ?? (prd.needsAuth ? ["owner", "member"] : []),
    permissions: prd.permissions ?? [],
  };
}

export async function loadProjectPrd(projectId?: string | null): Promise<VersionedPrd | null> {
  if (!projectId) return null;
  try {
    const { data } = await (supabaseAdmin as any)
      .from("project_blueprints")
      .select("blueprint")
      .eq("project_id", projectId)
      .maybeSingle();
    const prd = data?.blueprint?.prd;
    if (!prd || typeof prd !== "object" || !prd.prd) return null;
    const versioned = prd as VersionedPrd;
    return { ...versioned, prd: upgradePrd(versioned.prd) };
  } catch (e) {
    console.warn("[prd] load skipped:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

export async function saveProjectPrd(
  projectId: string | undefined | null,
  prd: Prd,
  sourcePrompt: string,
  previous?: VersionedPrd | null,
): Promise<VersionedPrd | null> {
  const versioned: VersionedPrd = {
    prd,
    revision: (previous?.revision ?? 0) + 1,
    updatedAt: new Date().toISOString(),
    sourcePrompt: sourcePrompt.slice(0, 2000),
  };
  if (!projectId) return versioned;

  try {
    const { data } = await (supabaseAdmin as any)
      .from("project_blueprints")
      .select("blueprint")
      .eq("project_id", projectId)
      .maybeSingle();

    const blueprint = { ...(data?.blueprint ?? {}), prd: versioned };
    await (supabaseAdmin as any)
      .from("project_blueprints")
      .upsert({ project_id: projectId, blueprint }, { onConflict: "project_id" });
  } catch (e) {
    console.warn("[prd] save skipped:", e instanceof Error ? e.message : String(e));
  }
  return versioned;
}
