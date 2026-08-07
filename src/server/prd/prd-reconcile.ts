/**
 * PRD — reconciliation.
 *
 * The old pipeline let four stages disagree: the shape classifier said
 * "landing", the web-subtype router said "app" (which injects a hard
 * dashboard-shell constraint), the archetype matcher said nothing, and the
 * spec pass returned "". The model received contradictory instructions and
 * picked one at random. That is how a pregnancy calculator became a dashboard.
 *
 * This module settles those conflicts ONCE, with the PRD as the authority.
 *
 * Pure functions. No I/O.
 */

import type { WebSubtype } from "@/lib/web-subtype";
import type { Prd, PrdSurface, ProductType } from "./prd-types";

/**
 * The PRD decides the web subtype. `app` is only ever chosen when the PRD
 * actually calls for a dashboard — never as a fallback for "we don't know".
 */
export function subtypeFromPrd(prd: Prd): WebSubtype {
  const hasDashboard = prd.requiredSurfaces.includes("dashboard");
  const hasAuth = prd.requiredSurfaces.includes("auth");

  switch (prd.productType) {
    case "marketplace":
    case "social":
      return "fullstack";
    case "workflow-app":
      return hasAuth && prd.needsPersistence ? "fullstack" : "app";
    case "storefront":
      return hasDashboard ? "fullstack" : "marketing";
    case "utility":
    case "game":
    case "ai-tool":
    case "content-site":
    default:
      // A public single-purpose product is a public page with a working tool
      // on it. It is emphatically not a sidebar app shell.
      return hasDashboard ? "app" : "marketing";
  }
}

/**
 * Surfaces the utility/content path needs that the plain "marketing" addendum
 * would otherwise forbid. Returned as an override block appended after the
 * subtype addendum so the model is not told "no interactive app UI" when the
 * whole product IS an interactive tool.
 */
export function renderSubtypeOverrideBlock(prd: Prd, subtype: WebSubtype): string {
  const isToolOnPage =
    subtype === "marketing" && (prd.requiredSurfaces.includes("tool") || prd.productType === "game");
  if (!isToolOnPage) return "";

  return [
    "",
    "### Override — this is a public page WITH a working tool on it",
    "The marketing rules above govern the page's craft and structure. They do NOT mean the page is static.",
    "  - The product's primary tool is a real, interactive, working component and it sits above the fold on `/`.",
    "  - Interactive form controls, live results, and state on the home route are REQUIRED here, not forbidden.",
    "  - The marketing sections (explanation, trust, FAQ, footer) sit BELOW the tool, supporting it.",
    "  - Still no sidebar shell, no auth, no dashboard.",
  ].join("\n");
}

/**
 * Reconcile classifier-predicted surfaces against the PRD. The PRD wins; the
 * classifier's extras are dropped rather than merged, because a merged list is
 * how scope creep gets in.
 */
export function reconcileSurfaces(prd: Prd, predicted: string[]): PrdSurface[] {
  const allowed = new Set<string>(prd.requiredSurfaces);
  const kept = predicted.filter((s) => allowed.has(s)) as PrdSurface[];
  // Anything required but unpredicted is still required.
  for (const s of prd.requiredSurfaces) if (!kept.includes(s)) kept.push(s);
  return kept;
}

/** Templates may satisfy the PRD; they may never widen it. */
export function filterTemplateRoutes(prd: Prd, routes: string[]): string[] {
  const banned: Array<[PrdSurface, RegExp]> = [
    ["auth", /^\/(auth|login|signin|sign-in|signup|sign-up|register)/i],
    ["dashboard", /^\/(dashboard|app)(\/|$)/i],
    ["admin", /^\/admin(\/|$)/i],
    ["account", /^\/(account|profile|settings\/account)(\/|$)/i],
    ["checkout", /^\/(checkout|cart|billing)(\/|$)/i],
  ];
  const excluded = new Set(prd.excludedSurfaces);
  return routes.filter((r) => !banned.some(([surface, rx]) => excluded.has(surface) && rx.test(r)));
}

/** True when the PRD describes a product whose core value is computation. */
export function isComputationProduct(prd: Prd): boolean {
  return prd.formulas.length > 0;
}

/** Product types that must never render a sidebar app shell. */
export const PUBLIC_PRODUCT_TYPES: ProductType[] = ["utility", "content-site", "game"];
