/**
 * Kimble PRD — the internal product requirements document.
 *
 * This is the single source of truth for a build. It is authored BEFORE any
 * planning, template selection, or file generation, and every later stage
 * reads it. Nothing downstream may contradict it, and the build is accepted
 * or rejected against its acceptance criteria.
 *
 * It is a machine-checkable contract, not prose for the user. The plain
 * English summary shown in chat is derived from it (see `summarizePrd`).
 *
 * Design rules baked into the type:
 *  - `requiredSurfaces` is a closed list. If a surface is not named here the
 *    builder may not invent it (that is what `excludedSurfaces` enforces).
 *  - `primaryWorkflow` is mandatory. A product with no workflow is not a
 *    product, it is a wallpaper.
 *  - `acceptance` criteria are testable statements, each of which becomes a
 *    real browser check before the build may be reported complete.
 */

/** Broad shape of the thing being built. Drives layout + surface defaults. */
export type ProductType =
  | "utility" // calculator, converter, generator, single-purpose tool
  | "content-site" // landing page, portfolio, blog, brochure
  | "workflow-app" // dashboard/CRUD/internal tool, real ongoing work
  | "marketplace" // two-sided, listings + transactions
  | "social" // feeds, profiles, interaction between users
  | "game"
  | "ai-tool" // chat/generation product with a model at the center
  | "storefront"; // selling goods, cart + checkout

/** Named product surfaces. Kept deliberately coarse and checkable. */
export type PrdSurface =
  | "landing"
  | "tool" // the primary interactive surface of a utility
  | "results"
  | "content" // educational / informational pages
  | "catalog"
  | "detail"
  | "dashboard"
  | "auth"
  | "account"
  | "admin"
  | "checkout"
  | "settings"
  | "about"
  | "contact";

export interface PrdWorkflowStep {
  /** entry | input | action | result | next */
  kind: "entry" | "input" | "action" | "result" | "next";
  /** Plain-English description of what happens at this step. */
  description: string;
}

export interface PrdWorkflow {
  /** Short name, e.g. "Estimate due date". */
  name: string;
  steps: PrdWorkflowStep[];
}

export interface PrdFormula {
  /** Short id, e.g. "naegele-due-date". */
  id: string;
  /** Human statement of the rule. */
  statement: string;
  /**
   * Worked example the acceptance gate can verify against.
   * `input` is a human-readable input, `expected` the expected output.
   */
  example?: { input: string; expected: string };
}

export interface PrdEntity {
  name: string;
  fields: string[];
  /** Operations the complete product must expose for this entity. */
  operations: Array<"create" | "read" | "update" | "delete">;
  /** How records are visible. Drives ownership and permission requirements. */
  visibility: "owner" | "role" | "public";
  ownerField?: string;
  allowedRoles?: string[];
  relationships: string[];
}

export interface PrdPermission {
  role: string;
  entity: string;
  operations: Array<"create" | "read" | "update" | "delete">;
}

export interface PrdAcceptanceCriterion {
  /** Stable id so repairs can target a specific failure. */
  id: string;
  /** Testable statement, phrased as an observable behaviour. */
  statement: string;
  /** How the gate checks it. */
  check: "surface-exists" | "interaction" | "computation" | "responsive" | "absence";
  /** Optional route the check applies to. */
  route?: string;
}

export interface Prd {
  /** Schema version so persisted PRDs can be migrated. */
  version: 1;
  /** Real product name. Never "My App". */
  productName: string;
  /** One sentence. What this product is. */
  purpose: string;
  /** Who it is for. */
  targetUser: string;
  /** The outcome the user came for, in their terms. */
  primaryOutcome: string;
  productType: ProductType;
  /** Domain label used for tone/content, e.g. "pregnancy & prenatal health". */
  domain: string;

  primaryWorkflow: PrdWorkflow;
  secondaryWorkflows: PrdWorkflow[];

  /** Explicit domain logic. Empty for products with no computation. */
  formulas: PrdFormula[];
  /** Only populated when the product genuinely needs persistence. */
  dataModel: PrdEntity[];
  /** True when the product needs a backend at all. */
  needsPersistence: boolean;
  needsAuth: boolean;
  /** Product roles and their entity-level capabilities. */
  roles: string[];
  permissions: PrdPermission[];

  requiredSurfaces: PrdSurface[];
  excludedSurfaces: PrdSurface[];

  /** Required UI states, e.g. "empty", "invalid date", "loading". */
  states: string[];
  /** Navigation model, e.g. "top nav, mobile drawer, no sidebar". */
  navigation: string;
  /** Tone/content requirements, e.g. "informative, never diagnostic". */
  contentTone: string;

  acceptance: PrdAcceptanceCriterion[];
  outOfScope: string[];

  /**
   * Every requirement the user named, with evidence-derived status and
   * dependencies. Optional so older persisted PRDs still load; derived from
   * the stored source prompt when absent. See `prd-requirements.ts`.
   */
  requirements?: import("./prd-requirements").PrdRequirement[];

  /** Provenance — how much of this came from rules vs the model. */
  source: "deterministic" | "model" | "hybrid";
  /** 0–1. Below 0.35 the caller may choose to ask a clarifying question. */
  confidence: number;
}

/** A PRD plus the turn it was authored/amended on. Persisted per project. */
export interface VersionedPrd {
  prd: Prd;
  /** Incrementing revision, starting at 1. */
  revision: number;
  /** ISO timestamp. */
  updatedAt: string;
  /** The user prompt that produced this revision. */
  sourcePrompt: string;
}

/** Short plain-English summary for chat. Derived, never authored by hand. */
export function summarizePrd(prd: Prd): string {
  const surfaces = prd.requiredSurfaces.join(", ");
  return [
    `${prd.productName} — ${prd.purpose}`,
    `Main thing it does: ${prd.primaryOutcome}`,
    `Screens: ${surfaces}`,
  ].join("\n");
}
