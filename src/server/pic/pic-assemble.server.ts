/**
 * PIC — assembly.
 *
 * Builds (or refreshes) the canonical context for a turn by combining:
 *  - the stored PIC, if any (so follow-up turns refine instead of re-deriving),
 *  - a semantic understanding pass over the request,
 *  - the committed design system contract,
 *  - the existing PRD, blueprint and project memory.
 *
 * Fail-open by construction: every dependency is best-effort and the function
 * always resolves with a usable context.
 */

import { understandRequest } from "@/server/understanding.server";
import { commitDesignSystem } from "@/server/design/design-system.server";
import { loadProjectPrd } from "@/server/prd/prd-store.server";
import { loadPic, savePic } from "./pic-store.server";
import { preserveDesignPackage } from "@/server/design-systems/context";
import type { MemoryEntry } from "@/server/project-memory.server";
import type { ProjectIntelligenceContext, PicUnderstanding } from "./pic-types";
import type { DesignDirection } from "@/server/design-director.server";

const LOCK_KEYS = new Set(["dont_do", "must_have", "locked", "always"]);

function emptyContext(projectId: string | null, understanding: PicUnderstanding): ProjectIntelligenceContext {
  return {
    schema: 1,
    projectId,
    productVision: understanding.summary,
    understanding,
    prd: null,
    userJourneys: [],
    features: [...understanding.firstVersion],
    uxDecisions: [],
    design: null,
    architecture: null,
    security: null,
    acceptanceCriteria: [],
    decisions: [],
    protectedDecisions: [],
    protectedFiles: [],
    unresolved: [],
    history: [],
    updatedAt: new Date().toISOString(),
    revision: 0,
  };
}

export interface AssemblePicArgs {
  projectId: string | null | undefined;
  brief: string;
  /** True on the first build of a project. */
  isInitial: boolean;
  /** True when this turn changes structure (new feature, redesign, new page). */
  isStructural: boolean;
  memoryEntries?: MemoryEntry[];
  userId?: string;
  turnId?: string;
  signal?: AbortSignal;
  /** Canonical visual decision authored before PIC assembly. */
  designDirection?: DesignDirection | null;
  /**
   * Understanding pass already started for this brief (first-build setup
   * fan-out runs it concurrently with the PRD and design direction). Used
   * only when there is no stored understanding to refine.
   */
  understanding?: Promise<PicUnderstanding> | null;
}

export interface AssembledPic {
  pic: ProjectIntelligenceContext;
  /** True when this turn recomputed understanding or design. */
  refreshed: boolean;
}

/**
 * Assemble the context for this turn. Persists when anything changed.
 *
 * Cost control: the model passes run on initial and structural turns only.
 * A small edit reuses the stored context verbatim.
 */
export async function assemblePic(args: AssemblePicArgs): Promise<AssembledPic> {
  const projectId = args.projectId ?? null;
  const stored = await loadPic(projectId);

  const needsUnderstanding = args.isInitial || args.isStructural || !stored;
  if (!needsUnderstanding && stored) {
    return { pic: stored.pic, refreshed: false };
  }

  const understanding =
    args.understanding && !stored?.pic.understanding
      ? await args.understanding
      : await understandRequest(args.brief, {
          userId: args.userId,
          projectId,
          prior: stored?.pic.understanding ?? null,
          signal: args.signal,
        });

  const base = stored?.pic ?? emptyContext(projectId, understanding);

  // Design is committed once. Later turns inherit it so the product does not
  // drift; a redesign request is handled by clearing it upstream.
  const committed =
    args.designDirection || !base.design
      ? await commitDesignSystem({
      brief: args.brief,
      understanding,
      seed: projectId ?? args.brief,
      userId: args.userId,
      projectId,
      signal: args.signal,
      direction: args.designDirection,
        })
      : base.design;
  // The selected design-system package is changed only by the deterministic
  // re-theme path, never by a generation.
  const design = preserveDesignPackage(base.design, committed);

  const prd = (await loadProjectPrd(projectId))?.prd ?? base.prd;

  const memoryLocks = (args.memoryEntries ?? [])
    .filter((e) => LOCK_KEYS.has(e.key))
    .map((e) => `${e.key}: ${e.value}`);

  const features = Array.from(new Set([...base.features, ...understanding.firstVersion])).slice(0, 24);
  const acceptance = prd?.acceptance?.length
    ? prd.acceptance.map((a) => a.statement)
    : base.acceptanceCriteria;

  const next: ProjectIntelligenceContext = {
    ...base,
    projectId,
    productVision: understanding.summary || base.productVision,
    understanding,
    prd,
    design,
    features,
    acceptanceCriteria: acceptance,
    protectedDecisions: Array.from(new Set([...base.protectedDecisions, ...memoryLocks])).slice(0, 24),
    decisions: [
      ...base.decisions,
      {
        key: "platform",
        value: understanding.platforms.join(", "),
        confidence: understanding.confidence.platform ?? "inferred",
        turnId: args.turnId,
        at: new Date().toISOString(),
      },
      {
        key: "backend",
        value: understanding.needsBackend ? "backend required" : "frontend only",
        confidence: understanding.confidence.backend ?? "inferred",
        turnId: args.turnId,
        at: new Date().toISOString(),
      },
    ].slice(-40),
    unresolved: understanding.needsClarification && understanding.clarifyingQuestion
      ? Array.from(new Set([...base.unresolved, understanding.clarifyingQuestion])).slice(0, 10)
      : base.unresolved,
  };

  const saved = await savePic(projectId, next, {
    turnId: args.turnId,
    summary: args.isInitial ? "Initial project intelligence committed" : "Understanding refreshed",
  });

  return { pic: saved.pic, refreshed: true };
}
