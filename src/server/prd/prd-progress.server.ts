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
  build: RequirementEvidence["build"];
  files?: Array<{ path: string; content: string }>;
  projectRevision?: number;
}): Promise<PrdRequirement[] | null> {
  try {
    const db = supabaseAdmin as any;
    const { data: bp } = await db
      .from("project_blueprints")
      .select("blueprint")
      .eq("project_id", args.projectId)
      .maybeSingle();
    const versioned = bp?.blueprint?.prd;
    const reqs: PrdRequirement[] | undefined = versioned?.prd?.requirements;
    if (!reqs?.length) return null;

    let revision = args.projectRevision;
    if (typeof revision !== "number") {
      const { data: p } = await db.from("projects").select("revision").eq("id", args.projectId).maybeSingle();
      revision = Number(p?.revision ?? 0);
    }
    let files = args.files;
    if (!files) {
      const { data: rows } = await db.from("project_files").select("path, content").eq("project_id", args.projectId);
      files = (rows ?? []) as Array<{ path: string; content: string }>;
    }
    const { data: secrets } = await db.from("project_secrets").select("name").eq("project_id", args.projectId);
    const configured = integrationsFromSecretNames(((secrets ?? []) as Array<{ name: string }>).map((s) => s.name));

    const next = evaluateRequirements(reqs, evidenceFromFiles(files, revision, args.build, configured));
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
