/**
 * PRD — turn amendment.
 *
 * A PRD authored on turn 1 is only half the value. The other half is stopping
 * later edits from quietly drifting the product away from what it was meant
 * to be, or from re-architecting it because one turn's classifier disagreed
 * with the last one's.
 *
 * On every follow-up turn we classify the request against the stored PRD:
 *
 *   cosmetic   → no PRD change at all. Style/copy/spacing edits.
 *   additive   → amend the PRD (new surface, new workflow), then build it.
 *   contradiction → the user changed their mind. Newer intent wins, the change
 *                   is recorded, and Petal says so in one sentence.
 *
 * Pure functions; no I/O. Deterministic and testable.
 */

import type { Prd, PrdSurface } from "./prd-types";

export type AmendmentKind = "cosmetic" | "additive" | "contradiction";

export interface PrdAmendment {
  kind: AmendmentKind;
  /** The PRD to build against this turn. */
  prd: Prd;
  /** True when the stored PRD actually changed and should be re-saved. */
  changed: boolean;
  /** One sentence for the user. Empty for cosmetic turns. */
  note: string;
}

const COSMETIC = [
  /\b(colou?r|palette|theme|font|typography|spacing|padding|margin|shadow|rounded|animation)\b/i,
  /\bmake it (bigger|smaller|darker|lighter|bolder|cleaner|prettier|modern)\b/i,
  /\b(move|align|center|centre|resize)\b/i,
  /\b(copy|wording|text|headline|title|label)\b.*\b(change|update|fix|reword)\b/i,
  /\b(change|update|fix|reword)\b.*\b(copy|wording|text|headline|title|label)\b/i,
];

/** Phrases that add a named surface to the product. */
const SURFACE_REQUESTS: Array<[PrdSurface, RegExp]> = [
  ["auth", /\b(?:add|create|build|include|make|need|want|wire)\b[^.]*\b(log ?in|sign ?in|sign ?up|auth|accounts?)\b/i],
  ["account", /\b(?:add|create|build|include|make|need|want|wire)\b[^.]*\b(profile|my account|saved (results|history))\b/i],
  ["dashboard", /\b(?:add|create|build|include|make|need|want|wire)\b[^.]*\b(dashboard|admin view|overview screen)\b/i],
  ["admin", /\b(?:add|create|build|include|make|need|want|wire)\b[^.]*\badmin (panel|area|console)\b/i],
  ["checkout", /\b(?:add|create|build|include|make|need|want|wire)\b[^.]*\b(checkout|cart|payments?|stripe|subscriptions?)\b/i],
  ["content", /\b(?:add|create|build|include|make|need|want|wire)\b[^.]*\b(blog|articles?|guides?|faq|resources?)\b/i],
  ["catalog", /\b(?:add|create|build|include|make|need|want|wire)\b[^.]*\b(listings?|catalog|products? page|browse)\b/i],
  ["contact", /\b(?:add|create|build|include|make|need|want|wire)\b[^.]*\bcontact (page|form)\b/i],
  ["about", /\b(?:add|create|build|include|make|need|want|wire)\b[^.]*\babout(?: page| us)?\b/i],
  ["settings", /\b(?:add|create|build|include|make|need|want|wire)\b[^.]*\bsettings\b/i],
  ["results", /\b(?:add|create|build|include|make|need|want|wire)\b[^.]*\b(results? (page|view)|history)\b/i],
];

const REMOVAL = /\b(remove|delete|drop|get rid of|take out|don'?t want|no longer want)\b/i;

const PERSISTENCE_REQUEST = /\b(save|persist|store)\b[^.]*\b(results?|history|data|entries)\b/i;

function requestedSurfaces(text: string): PrdSurface[] {
  const out: PrdSurface[] = [];
  for (const [surface, rx] of SURFACE_REQUESTS) if (rx.test(text) && !out.includes(surface)) out.push(surface);
  return out;
}

function removedSurfaces(text: string): PrdSurface[] {
  if (!REMOVAL.test(text)) return [];
  const out: PrdSurface[] = [];
  const map: Array<[PrdSurface, RegExp]> = [
    ["auth", /\b(log ?in|sign ?in|sign ?up|auth|accounts?)\b/i],
    ["dashboard", /\bdashboard\b/i],
    ["admin", /\badmin\b/i],
    ["checkout", /\b(checkout|cart|payments?)\b/i],
    ["content", /\b(blog|articles?|guides?|faq)\b/i],
    ["catalog", /\b(listings?|catalog)\b/i],
    ["contact", /\bcontact\b/i],
    ["about", /\babout\b/i],
    ["settings", /\bsettings\b/i],
  ];
  for (const [surface, rx] of map) if (rx.test(text) && !out.includes(surface)) out.push(surface);
  return out;
}

export function amendPrd(stored: Prd, request: string): PrdAmendment {
  const text = (request || "").slice(0, 4000);
  const added = requestedSurfaces(text);
  const removed = removedSurfaces(text);
  const wantsPersistence = PERSISTENCE_REQUEST.test(text);

  // A pure style/copy edit must not touch the contract. This is the guard that
  // stops "make the button blue" from re-architecting the app.
  if (!added.length && !removed.length && !wantsPersistence && COSMETIC.some((p) => p.test(text))) {
    return { kind: "cosmetic", prd: stored, changed: false, note: "" };
  }

  if (!added.length && !removed.length && !wantsPersistence) {
    return { kind: "cosmetic", prd: stored, changed: false, note: "" };
  }

  const next: Prd = {
    ...stored,
    requiredSurfaces: [...stored.requiredSurfaces],
    excludedSurfaces: [...stored.excludedSurfaces],
  };

  const contradictions: string[] = [];

  for (const s of added) {
    if (next.excludedSurfaces.includes(s)) {
      // The user is overriding an earlier exclusion. Newer intent wins.
      next.excludedSurfaces = next.excludedSurfaces.filter((x) => x !== s);
      contradictions.push(s);
    }
    if (!next.requiredSurfaces.includes(s)) next.requiredSurfaces.push(s);
    if (s === "auth" || s === "account") {
      next.needsAuth = true;
      next.needsPersistence = true;
    }
    if (s === "checkout") next.needsPersistence = true;
  }

  for (const s of removed) {
    next.requiredSurfaces = next.requiredSurfaces.filter((x) => x !== s);
    if (!next.excludedSurfaces.includes(s)) next.excludedSurfaces.push(s);
    if (s === "auth") next.needsAuth = false;
  }

  if (wantsPersistence) next.needsPersistence = true;

  // Keep acceptance in step with the contract.
  next.acceptance = [
    ...stored.acceptance.filter((c) => !removed.some((s) => c.id === `surface-${s}`)),
    ...added
      .filter((s) => !stored.acceptance.some((c) => c.id === `surface-${s}`))
      .map((s) => ({
        id: `surface-${s}`,
        statement: `The ${s} surface exists and is reachable from the app's navigation.`,
        check: "surface-exists" as const,
      })),
    ...removed
      .filter((s) => !stored.acceptance.some((c) => c.id === `no-${s}`))
      .map((s) => ({
        id: `no-${s}`,
        statement: `No ${s} surface is present — the user asked for it to be removed.`,
        check: "absence" as const,
      })),
  ];

  const kind: AmendmentKind = contradictions.length || removed.length ? "contradiction" : "additive";
  const note =
    kind === "contradiction"
      ? `Updating the product's shape: ${[...contradictions.map((s) => `adding ${s}`), ...removed.map((s) => `removing ${s}`)].join(", ")}.`
      : `Extending the product with: ${added.join(", ")}.`;

  return { kind, prd: next, changed: true, note };
}
