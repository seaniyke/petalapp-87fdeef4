/**
 * PRD Engine — the entry point the generation pipeline calls.
 *
 * One function, `resolvePrdForTurn`, answers the only question the pipeline
 * needs answered before it writes a single line of code:
 *
 *   "What product are we building this turn, and how will we know we built it?"
 *
 * Turn 1 authors a PRD (rules first, model refinement second) and persists it.
 * Later turns load the stored PRD and amend it only when the request actually
 * changes the product's shape. Style and copy edits leave the contract alone.
 *
 * The PRD also carries the full requirement list with evidence-derived status
 * (`prd-requirements.ts`). Every turn sees the whole product, what is already
 * verified, and the coherent stage this turn should build.
 *
 * Nothing here can fail a build: every path has a deterministic fallback.
 */

import { deterministicPrd } from "./prd-deterministic";
import { modelPrd } from "./prd-model.server";
import { amendPrd, type AmendmentKind } from "./prd-amend";
import { loadProjectPrd, saveProjectPrd } from "./prd-store.server";
import { renderPrdBlock } from "./prd-render";
import { renderSubtypeOverrideBlock, subtypeFromPrd } from "./prd-reconcile";
import { renderPrdScenarioBlock } from "./prd-acceptance.server";
import {
  deriveRequirements,
  mergeRequirements,
  renderRequirementsBlock,
  stageForTurn,
  type PrdRequirement,
  type StageMode,
} from "./prd-requirements";
import type { Prd, VersionedPrd } from "./prd-types";
import type { WebSubtype } from "@/lib/web-subtype";

export interface ResolvedPrd {
  prd: Prd;
  versioned: VersionedPrd | null;
  /** True when this turn authored the PRD for the first time. */
  authored: boolean;
  amendment: AmendmentKind | "none";
  /** One sentence to surface to the user when the contract changed. */
  note: string;
  /** Subtype the PRD implies — overrides the keyword router. */
  subtype: WebSubtype;
  /** Prompt block for the generation model. */
  promptBlock: string;
  /** Prompt block for the verifier. */
  scenarioBlock: string;
  /** Requirements this turn is meant to implement. */
  stage: PrdRequirement[];
  stageMode: StageMode;
}

export interface ResolvePrdArgs {
  brief: string;
  projectId?: string | null;
  userId?: string | null;
  /** Skip the model pass (used by tests and by cheap retry paths). */
  deterministicOnly?: boolean;
}

/** Pure core, shared by the engine and tests. */
export function attachRequirements(
  prd: Prd,
  brief: string,
  stored: VersionedPrd | null,
): { prd: Prd; changed: boolean } {
  if (!stored) return { prd: { ...prd, requirements: deriveRequirements(brief) }, changed: true };
  const base = stored.prd.requirements ?? deriveRequirements(stored.sourcePrompt || "");
  const merged = mergeRequirements(base, brief);
  const changed =
    !stored.prd.requirements || merged.added.length > 0 || merged.rejected.length > 0;
  return { prd: { ...prd, requirements: merged.requirements }, changed };
}

export async function resolvePrdForTurn(args: ResolvePrdArgs): Promise<ResolvedPrd> {
  const brief = (args.brief || "").trim();
  const stored = await loadProjectPrd(args.projectId);

  let prd: Prd;
  let versioned: VersionedPrd | null = stored;
  let authored = false;
  let amendment: AmendmentKind | "none" = "none";
  let note = "";

  if (!stored) {
    const authoredPrd = args.deterministicOnly ? deterministicPrd(brief) : await modelPrd(brief, args.userId ?? undefined);
    prd = attachRequirements(authoredPrd, brief, null).prd;
    versioned = await saveProjectPrd(args.projectId, prd, brief, null);
    authored = true;
  } else {
    const result = amendPrd(stored.prd, brief);
    amendment = result.kind;
    note = result.note;
    const withReqs = attachRequirements(result.prd, brief, stored);
    prd = withReqs.prd;
    if (result.changed || withReqs.changed) {
      versioned = await saveProjectPrd(args.projectId, prd, brief, stored);
    }
  }

  const subtype = subtypeFromPrd(prd);
  const requirements = prd.requirements ?? [];
  const plan = stageForTurn(requirements, brief, authored);

  return {
    prd,
    versioned,
    authored,
    amendment,
    note,
    subtype,
    promptBlock: [
      renderPrdBlock(prd),
      renderSubtypeOverrideBlock(prd, subtype),
      renderRequirementsBlock(requirements, plan),
    ]
      .filter(Boolean)
      .join("\n"),
    scenarioBlock: renderPrdScenarioBlock(prd),
    stage: plan.stage,
    stageMode: plan.mode,
  };
}
