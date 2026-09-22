/**
 * PRD — prompt rendering.
 *
 * Turns the PRD into the block the model must build against. This replaces
 * the old CRUD-only "spec-first" block: it works for calculators, content
 * sites, games and workflow apps alike, and it is never empty.
 *
 * The wording is deliberately imperative. The PRD is a contract, not advice.
 */

import type { Prd, PrdWorkflow } from "./prd-types";

function renderWorkflow(w: PrdWorkflow, label: string): string {
  const lines = [`${label}: ${w.name}`];
  for (const s of w.steps) lines.push(`  ${s.kind.padEnd(6)} → ${s.description}`);
  return lines.join("\n");
}

export function renderPrdBlock(prd: Prd): string {
  const out: string[] = [];

  out.push("\n\n### Product Requirements (authored by Kimble — this is the contract for this build)");
  out.push(
    "This PRD is the single source of truth. Where any other instruction, template, or habit conflicts with it, the PRD wins. Do not add surfaces it does not list, and do not omit surfaces it does.",
  );
  out.push("");
  out.push(`Product: ${prd.productName}`);
  out.push(`Purpose: ${prd.purpose}`);
  out.push(`For: ${prd.targetUser}`);
  out.push(`Primary outcome: ${prd.primaryOutcome}`);
  out.push(`Product type: ${prd.productType}`);
  if (prd.domain) out.push(`Domain: ${prd.domain}`);

  out.push("");
  out.push(renderWorkflow(prd.primaryWorkflow, "Primary workflow"));
  for (const w of prd.secondaryWorkflows) {
    out.push("");
    out.push(renderWorkflow(w, "Secondary workflow"));
  }

  if (prd.formulas.length) {
    out.push("");
    out.push("Domain logic — implement these as real, typed, pure functions in `src/lib/`, unit-testable, never faked:");
    for (const f of prd.formulas) {
      out.push(`  - [${f.id}] ${f.statement}`);
      if (f.example) out.push(`      worked example: ${f.example.input} → ${f.example.expected}`);
    }
    out.push(
      "  Results must come from these functions. Do NOT hard-code, mock, randomise, or approximate a value the user can verify.",
    );
  }

  out.push("");
  out.push(`Surfaces you MUST build: ${prd.requiredSurfaces.join(", ")}`);
  if (prd.excludedSurfaces.length) {
    out.push(
      `Surfaces you MUST NOT build: ${prd.excludedSurfaces.join(", ")} — the user did not ask for them and they are out of scope for this product.`,
    );
  }
  out.push(`Navigation: ${prd.navigation}`);
  out.push(`Persistence: ${prd.needsPersistence ? "required" : "not required — keep it client-side"}`);
  out.push(`Accounts: ${prd.needsAuth ? "required" : "not required — do not scaffold auth"}`);
  if (prd.roles?.length) out.push(`Roles: ${prd.roles.join(", ")}`);

  if (prd.dataModel.length) {
    out.push("");
    out.push("Data model:");
    for (const e of prd.dataModel) {
      out.push(`  - ${e.name}: ${e.fields.join(", ")}`);
      out.push(`    operations: ${e.operations.join(", ")}; visibility: ${e.visibility}; relationships: ${e.relationships.join(", ") || "none"}`);
    }
    out.push("For the primary entity, build list + search/filter + detail + create + edit + delete-with-confirm. Every relationship must be navigable. Seed 8–20 relationally valid records.");
  }

  if (prd.permissions?.length) {
    out.push("");
    out.push("Permissions (enforce in data access and reflect in the UI):");
    for (const p of prd.permissions) out.push(`  - ${p.role} → ${p.entity}: ${p.operations.join(", ")}`);
  }

  out.push("");
  out.push("States that must be handled:");
  for (const s of prd.states) out.push(`  - ${s}`);

  out.push("");
  out.push(`Content and tone: ${prd.contentTone}`);

  out.push("");
  out.push("Acceptance — Kimble will check every one of these in a real browser before this build is reported complete:");
  for (const c of prd.acceptance) out.push(`  - [${c.id}] ${c.statement}`);

  if (prd.outOfScope.length) {
    out.push("");
    out.push(`Out of scope for this turn: ${prd.outOfScope.join("; ")}`);
  }

  out.push("");
  out.push(
    "Build in this order: domain logic first, then the primary workflow, then the supporting surfaces, then content and polish. A beautiful shell with no working primary workflow is a failed build.",
  );

  return out.join("\n");
}

/** Compact PRD block for follow-up turns — keeps the contract without the cost. */
export function renderPrdRecapBlock(prd: Prd): string {
  return [
    "\n\n### Product contract (established earlier — keep it)",
    `${prd.productName}: ${prd.purpose}`,
    `Primary workflow: ${prd.primaryWorkflow.name}`,
    `Surfaces: ${prd.requiredSurfaces.join(", ")}`,
    prd.excludedSurfaces.length ? `Never add: ${prd.excludedSurfaces.join(", ")}` : "",
    "Apply the user's new request without changing the product's type, navigation model, or existing working surfaces.",
  ]
    .filter(Boolean)
    .join("\n");
}
