/**
 * PRD requirement progress — gathers authoritative project evidence and
 * re-evaluates requirement status on the stored PRD. No new store: statuses
 * are written back into `project_blueprints.blueprint.prd.prd.requirements`
 * without bumping the PRD revision (the product contract did not change).
 *
 * Best-effort: never fails a turn or a build callback.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  evaluateRequirements,
  hashContent,
  type PrdRequirement,
  type RequirementEvidence,
} from "./prd-requirements";

export function routesFromFiles(files: Array<{ path: string; content: string }>): string[] {
  const out = new Set<string>();
  for (const f of files) {
    if (!/^src\/(App|main|router|routes)/.test(f.path) && !/src\/routes\//.test(f.path)) continue;
    for (const m of f.content.matchAll(/\bpath\s*[=:]\s*["'`]([^"'`]+)["'`]/g)) out.add(m[1]);
    for (const m of f.content.matchAll(/createFileRoute\(\s*["'`]([^"'`]+)["'`]/g)) out.add(m[1]);
  }
  return [...out];
}

export function integrationsFromSecretNames(names: string[]): string[] {
  const out: string[] = [];
  if (names.some((n) => /STRIPE/i.test(n))) out.push("stripe");
  if (names.some((n) => /(RESEND|SENDGRID|POSTMARK|MAILGUN|SMTP)/i.test(n))) out.push("email");
  return out;
}

/**
 * Evidence from the project's current build row. Only a ready build of the
 * CURRENT revision with a stored verification counts; anything else is
 * reported as stale/unverified so nothing is promoted to COMPLETED.
 */
export function buildEvidenceFromRow(
  row: { status?: string | null; project_revision?: number | string | null; verification?: any } | null,
  projectRevision: number,
): RequirementEvidence["build"] {
  if (!row) return null;
  const revision = row.project_revision == null ? null : Number(row.project_revision);
  const visual = Array.isArray(row.verification?.visual) ? row.verification.visual : [];
  const status =
    row.status === "ready" ? (revision === projectRevision ? "ready" : "stale")
    : row.status === "failed" ? "failed"
    : row.status === "cancelled" ? "cancelled"
    : "building";
  return {
    revision,
    status,
    verified: row.status === "ready" && !!row.verification,
    phoneChecked:
      visual.some((v: { width?: number }) => typeof v?.width === "number" && v.width <= 480) ||
      row.verification?.phoneChecked === true,
  };
}

export function evidenceFromFiles(
  files: Array<{ path: string; content: string }>,
  projectRevision: number,
  build: RequirementEvidence["build"],
  configuredIntegrations: string[],
): RequirementEvidence {
  return {
    projectRevision,
    files: files.map((f) => ({ path: f.path, hash: hashContent(f.content) })),
    routes: routesFromFiles(files),
    build,
    configuredIntegrations,
  };
}

/**
 * Re-evaluate and persist. `files` may be passed by callers that already
 * hold them (generation); otherwise they are loaded.
 */
export async function recordRequirementEvidence(args: {
  projectId: string;
  /** "latest" reconciles against the project's current build row. */
  build: RequirementEvidence["build"] | "latest";
  /** Requirements to evaluate instead of the stored ones (e.g. freshly derived). */
  requirements?: PrdRequirement[];
  files?: Array<{ path: string; content: string }>;
  projectRevision?: number;
  /** The committed turn, so blocked parts of it keep requirements open. */
  turn?: RequirementEvidence["turn"];
}): Promise<PrdRequirement[] | null> {
  try {
    const db = supabaseAdmin as any;
    const { data: bp } = await db
      .from("project_blueprints")
      .select("blueprint")
      .eq("project_id", args.projectId)
      .maybeSingle();
    const versioned = bp?.blueprint?.prd;
    const reqs: PrdRequirement[] | undefined = args.requirements ?? versioned?.prd?.requirements;
    if (!reqs?.length) return null;

    let revision = args.projectRevision;
    let latestBuildId: string | null = null;
    if (typeof revision !== "number" || args.build === "latest") {
      const { data: p } = await db.from("projects").select("revision, latest_build_id").eq("id", args.projectId).maybeSingle();
      if (typeof revision !== "number") revision = Number(p?.revision ?? 0);
      latestBuildId = p?.latest_build_id ?? null;
    }
    let build: RequirementEvidence["build"] = null;
    if (args.build === "latest") {
      if (latestBuildId) {
        const { data: b } = await db
          .from("project_builds")
          .select("status, project_revision, verification")
          .eq("id", latestBuildId)
          .maybeSingle();
        build = buildEvidenceFromRow(b ?? null, revision);
      }
    } else build = args.build;
    let files = args.files;
    if (!files) {
      const { data: rows } = await db.from("project_files").select("path, content").eq("project_id", args.projectId);
      files = (rows ?? []) as Array<{ path: string; content: string }>;
    }
    const { data: secrets } = await db.from("project_secrets").select("name").eq("project_id", args.projectId);
    const configured = integrationsFromSecretNames(((secrets ?? []) as Array<{ name: string }>).map((s) => s.name));

    const next = evaluateRequirements(reqs, { ...evidenceFromFiles(files, revision, build, configured), ...(args.turn ? { turn: args.turn } : {}) });
    if (!versioned?.prd) return next;
    const unchanged = versioned.prd.requirements && next.every((r, i) => r === versioned.prd.requirements[i]) && next.length === versioned.prd.requirements.length;
    if (unchanged) return next;
    const blueprint = {
      ...bp.blueprint,
      prd: { ...versioned, prd: { ...versioned.prd, requirements: next } },
    };
    await db.from("project_blueprints").update({ blueprint }).eq("project_id", args.projectId);
    return next;
  } catch (e) {
    console.warn("[prd-progress] skipped:", e instanceof Error ? e.message : String(e));
    return null;
  }
}
