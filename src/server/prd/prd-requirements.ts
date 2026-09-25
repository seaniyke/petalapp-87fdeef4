/**
 * PRD — requirement-level status.
 *
 * An extension of the existing PRD, not a second requirements store. The list
 * lives on `Prd.requirements` and is persisted with the PRD in
 * `project_blueprints.blueprint.prd`.
 *
 * Two rules the rest of this file enforces:
 *  1. The user's requested scope is authoritative. Every item they named
 *     becomes a requirement and is never silently dropped.
 *  2. Status comes from project evidence, never from the model's claims.
 *     COMPLETED needs a ready, verified build of the CURRENT revision whose
 *     files contain the requirement's implementation. A requirement stays
 *     COMPLETED at later revisions only while the files it was verified
 *     against are unchanged.
 *
 * Pure; no I/O. Callers gather the evidence.
 */

export type RequirementStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "BLOCKED"
  | "REJECTED"
  | "SUPERSEDED";

export type RequirementCategory = "page" | "feature" | "integration" | "quality";

export interface PrdRequirement {
  id: string;
  description: string;
  category: RequirementCategory;
  status: RequirementStatus;
  /** Requirement ids that must be COMPLETED first. Only where meaningful. */
  dependsOn: string[];
  /** Human-readable proof lines (files, routes, verification). */
  evidence: string[];
  lastVerifiedRevision: number | null;
  updatedAt: string;
  /** Fingerprint of the files this requirement was verified against. */
  evidenceFingerprint?: string | null;
  /** Outside account this requirement needs before it can be live. */
  integration?: "stripe" | "email" | null;
  /** Short action phrase used for continuation suggestions. */
  nextAction: string;
}

// ---------------------------------------------------------------------------
// Concept table — generic product concepts, not tied to any one domain.
// ---------------------------------------------------------------------------

interface Concept {
  id: string;
  label: string;
  category: RequirementCategory;
  match: RegExp;
  /** Path/route evidence. Tested against lower-cased file paths and routes. */
  evidence: RegExp;
  dependsOn: string[];
  integration?: "stripe" | "email";
  nextAction: string;
}

const CONCEPTS: Concept[] = [
  { id: "home", label: "Home", category: "page", match: /\b(home ?page|home|landing)\b/i, evidence: /^\/$|(^|\/)(home|index|landing)\.tsx$/, dependsOn: [], nextAction: "Polish the home page" },
  { id: "auth", label: "Customer accounts", category: "feature", match: /\b(customer accounts?|user accounts?|accounts?|log ?in|sign ?in|sign ?up|auth(entication)?)\b/i, evidence: /(^|\/)(auth|login|signin|sign-in|signup|sign-up|register|account)(\.tsx|$|\/)/, dependsOn: [], nextAction: "Add customer accounts" },
  { id: "catalog", label: "Catalogue", category: "page", match: /\b(rooms|listings?|catalog(ue)?|products|menu|properties|courses|services|browse|inventory)\b/i, evidence: /(^|\/)(rooms|listings?|catalog(ue)?|products|menu|properties|courses|services|browse|shop|inventory)(\.tsx|$|\/)/, dependsOn: [], nextAction: "Build the catalogue" },
  { id: "detail", label: "Detail pages", category: "page", match: /\b((room|product|listing|property|course|item|service)s? details?|details? pages?|detail view)\b/i, evidence: /(\$|:)[a-z]*id|(^|\/)[a-z-]*detail[a-z-]*(\.tsx|$|\/)|\/rooms\/|\/products\/|\/listings\//, dependsOn: ["catalog"], nextAction: "Build the detail pages" },
  { id: "booking", label: "Booking", category: "feature", match: /\b(book(ing|ings)?|reservations?|appointments?|schedul(e|ing))\b(?!\s+management)/i, evidence: /(^|\/)(book|booking|reserve|reservation|appointment|schedule)[a-z-]*(\.tsx|$|\/)/, dependsOn: ["catalog"], nextAction: "Build the booking flow" },
  { id: "cart", label: "Cart and checkout", category: "feature", match: /\b(cart|checkout)\b/i, evidence: /(^|\/)(cart|checkout)(\.tsx|$|\/)/, dependsOn: ["catalog"], nextAction: "Build cart and checkout" },
  { id: "payments", label: "Payments", category: "integration", match: /\b(stripe|payments?|pay online|paystack|paddle)\b/i, evidence: /(^|\/)(checkout|payment|payments|pay|stripe|billing)[a-z-]*(\.tsx|\.ts|$|\/)/, dependsOn: ["booking", "cart"], integration: "stripe", nextAction: "Wire Stripe payments" },
  { id: "admin", label: "Admin dashboard", category: "page", match: /\b(admin( dashboard| panel| area)?|dashboard|back ?office)\b/i, evidence: /(^|\/)(admin|dashboard)(\.tsx|$|\/)/, dependsOn: ["auth"], nextAction: "Build the admin dashboard" },
  { id: "management", label: "Management", category: "feature", match: /\b(bookings? management|order management|manage (bookings|orders|reservations)|(booking|order|reservation)s? management)\b/i, evidence: /(^|\/)(admin\/[a-z-]*(bookings|orders|reservations)|manage[a-z-]*|(admin)?-?(bookings|orders|reservations))(\.tsx|$|\/)/, dependsOn: ["admin", "booking"], nextAction: "Build bookings management" },
  { id: "notifications", label: "Email notifications", category: "integration", match: /\b(email notifications?|emails?|notifications?|confirmation emails?)\b/i, evidence: /(^|\/)(email|emails|notify|notification|notifications|mailer)[a-z-]*(\.tsx|\.ts|$|\/)/, dependsOn: ["booking"], integration: "email", nextAction: "Set up booking notifications" },
  { id: "analytics", label: "Analytics", category: "feature", match: /\b(analytics|reports?|insights|metrics)\b/i, evidence: /(^|\/)(analytics|reports?|insights|metrics)(\.tsx|\.ts|$|\/)/, dependsOn: ["admin"], nextAction: "Add analytics" },
  { id: "search", label: "Search", category: "feature", match: /\b(search|filters?)\b/i, evidence: /(^|\/)(search)(\.tsx|$|\/)/, dependsOn: ["catalog"], nextAction: "Add search" },
  { id: "blog", label: "Blog", category: "page", match: /\b(blog|articles?|journal|news)\b/i, evidence: /(^|\/)(blog|articles?|journal|news)(\.tsx|$|\/)/, dependsOn: [], nextAction: "Build the blog" },
  { id: "about", label: "About", category: "page", match: /\babout( us| page)?\b/i, evidence: /(^|\/)about(\.tsx|$|\/)/, dependsOn: [], nextAction: "Build the about page" },
  { id: "contact", label: "Contact", category: "page", match: /\bcontact( us| page| form)?\b/i, evidence: /(^|\/)contact(\.tsx|$|\/)/, dependsOn: [], nextAction: "Build the contact page" },
  { id: "responsive", label: "Responsive design", category: "quality", match: /\b(responsive|mobile[- ]friendly|works on (phones?|mobile)|mobile layout)\b/i, evidence: /$^/, dependsOn: [], nextAction: "Check the phone layout" },
];

const CONCEPT_BY_ID = new Map(CONCEPTS.map((c) => [c.id, c]));

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

/** Split "with A, B, C and D" style enumerations into items. */
export function splitRequestedItems(brief: string): string[] {
  const text = brief.replace(/\s+/g, " ");
  const m = text.match(/\b(?:with|including|includes|featuring|that has|needs?)\b(.+)$/i);
  const tail = m ? m[1] : text;
  return tail
    .split(/,|;|\band\b|\bplus\b|\+/i)
    .map((s) => s.replace(/[.!?]+$/g, "").trim())
    .filter((s) => s.length >= 3 && s.split(" ").length <= 6);
}

function conceptFor(item: string): Concept | null {
  // Most specific first: management and detail before booking/catalog.
  const order = ["management", "detail", "payments", "notifications", "responsive", "analytics", "admin", "auth", "cart", "booking", "catalog", "search", "blog", "about", "contact", "home"];
  for (const id of order) {
    const c = CONCEPT_BY_ID.get(id)!;
    if (c.match.test(item)) return c;
  }
  return null;
}

function fromConcept(c: Concept, now: string): PrdRequirement {
  return {
    id: c.id,
    description: c.label,
    category: c.category,
    status: "NOT_STARTED",
    dependsOn: [...c.dependsOn],
    evidence: [],
    lastVerifiedRevision: null,
    updatedAt: now,
    evidenceFingerprint: null,
    integration: c.integration ?? null,
    nextAction: c.nextAction,
  };
}

/**
 * Derive the complete requirement list from the user's brief. Every named
 * item survives: known concepts get evidence rules, anything else becomes a
 * generic feature requirement keyed by its own words.
 */
export function deriveRequirements(brief: string, now = new Date().toISOString()): PrdRequirement[] {
  const out = new Map<string, PrdRequirement>();
  for (const item of splitRequestedItems(brief)) {
    const c = conceptFor(item);
    if (c) {
      if (!out.has(c.id)) out.set(c.id, { ...fromConcept(c, now), description: titleCase(item) });
      continue;
    }
    const id = `feature-${slug(item)}`;
    if (!id.endsWith("-") && !out.has(id)) {
      const words = slug(item).split("-").filter((w) => w.length > 2);
      out.set(id, {
        id,
        description: titleCase(item),
        category: "feature",
        status: "NOT_STARTED",
        dependsOn: [],
        evidence: [],
        lastVerifiedRevision: null,
        updatedAt: now,
        evidenceFingerprint: null,
        integration: null,
        nextAction: `Build ${item.toLowerCase()}`,
        ...(words.length ? {} : {}),
      });
    }
  }
  // Every product has a home surface; add it when the brief is not a list.
  if (out.size > 0 && !out.has("home") && !/\b(api|cli|script)\b/i.test(brief)) {
    out.set("home", fromConcept(CONCEPT_BY_ID.get("home")!, now));
  }
  // Keep only dependencies that exist in this product.
  const reqs = [...out.values()];
  const ids = new Set(reqs.map((r) => r.id));
  for (const r of reqs) r.dependsOn = r.dependsOn.filter((d) => ids.has(d));
  // "payments" depends on booking OR cart — whichever exists.
  return orderByDependencies(reqs);
}

function titleCase(s: string): string {
  const t = s.trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Stable topological order; ties keep original order. */
export function orderByDependencies(reqs: PrdRequirement[]): PrdRequirement[] {
  const byId = new Map(reqs.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const out: PrdRequirement[] = [];
  const visit = (r: PrdRequirement, stack: Set<string>) => {
    if (seen.has(r.id) || stack.has(r.id)) return;
    stack.add(r.id);
    for (const d of r.dependsOn) {
      const dep = byId.get(d);
      if (dep) visit(dep, stack);
    }
    seen.add(r.id);
    out.push(r);
  };
  // Home first, then brief order.
  const home = byId.get("home");
  if (home) visit(home, new Set());
  for (const r of reqs) visit(r, new Set());
  return out;
}

/**
 * Merge a new brief's requirements into the stored list. Existing statuses
 * and evidence are never reset; new items are appended; items the user
 * explicitly removes become REJECTED.
 */
export function mergeRequirements(
  existing: PrdRequirement[],
  brief: string,
  now = new Date().toISOString(),
): { requirements: PrdRequirement[]; added: string[]; rejected: string[] } {
  const byId = new Map(existing.map((r) => [r.id, { ...r }]));
  const added: string[] = [];
  const rejected: string[] = [];
  const removal = /\b(remove|delete|drop|get rid of|take out|don'?t want|no longer want)\b/i.test(brief);

  const isAddRequest = /\b(add|build|create|include|need|want|wire|set up|integrate)\b/i.test(brief);
  // Generic (non-concept) items only come from an explicit "add/build X"
  // request, so a style edit like "…with softer colours" never invents one.
  const explicitAdd = /^\s*(please\s+)?(add|build|create|include|integrate|set up|wire)\b/i.test(brief);
  const fresh = isAddRequest || removal
    ? deriveRequirements(brief, now).filter(
        (r) => r.id !== "home" && (CONCEPT_BY_ID.has(r.id) ? true : explicitAdd && !removal),
      )
    : [];
  for (const r of fresh) {
    const current = byId.get(r.id);
    if (removal) {
      if (current && current.status !== "REJECTED") {
        byId.set(r.id, { ...current, status: "REJECTED", updatedAt: now });
        rejected.push(r.id);
      }
      continue;
    }
    if (!current) {
      byId.set(r.id, r);
      added.push(r.id);
    } else if (current.status === "REJECTED" || current.status === "SUPERSEDED") {
      byId.set(r.id, { ...current, status: "NOT_STARTED", updatedAt: now });
      added.push(r.id);
    }
  }
  const all = [...byId.values()];
  const ids = new Set(all.map((r) => r.id));
  for (const r of all) {
    const c = CONCEPT_BY_ID.get(r.id);
    if (c) r.dependsOn = c.dependsOn.filter((d) => ids.has(d));
  }
  return { requirements: orderByDependencies(all), added, rejected };
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export interface RequirementEvidence {
  /** Current authoritative code revision (`projects.revision`). */
  projectRevision: number;
  /** Files at the current revision with a content fingerprint each. */
  files: Array<{ path: string; hash: string }>;
  /** Routes registered at the current revision. */
  routes: string[];
  /**
   * The build this evidence comes from. Null when only source exists (e.g.
   * right after generation, before any build finished).
   */
  build: {
    revision: number | null;
    status: "ready" | "failed" | "cancelled" | "building" | "stale";
    /** True when the browser/runtime verification ran and passed. */
    verified: boolean;
    /** True when verification included a phone-width check. */
    phoneChecked?: boolean;
  } | null;
  /** Integrations with real account credentials configured. */
  configuredIntegrations: string[];
}

export function hashContent(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function matchEvidence(req: PrdRequirement, ev: RequirementEvidence): { files: string[]; routes: string[] } {
  const c = CONCEPT_BY_ID.get(req.id);
  let test: RegExp;
  if (c) test = c.evidence;
  else {
    // Generic requirement: every meaningful word of its id must appear in a path.
    const words = req.id.replace(/^feature-/, "").split("-").filter((w) => w.length > 2);
    if (!words.length) return { files: [], routes: [] };
    const re = new RegExp(words.map((w) => `(?=.*${w.replace(/s$/, "")})`).join(""));
    test = re;
  }
  const files = ev.files
    .map((f) => f.path)
    .filter((p) => /^src\//.test(p) && !/\.(test|spec)\./.test(p) && !/components\/ui\//.test(p))
    .filter((p) => test.test(p.toLowerCase()));
  const routes = ev.routes.filter((r) => test.test(r.toLowerCase()));
  return { files, routes };
}

function fingerprint(paths: string[], ev: RequirementEvidence): string {
  const byPath = new Map(ev.files.map((f) => [f.path, f.hash]));
  return hashContent(
    [...paths].sort().map((p) => `${p}:${byPath.get(p) ?? "missing"}`).join("|"),
  );
}

/**
 * Recompute every requirement's status from evidence. Never promotes to
 * COMPLETED without a ready, verified build of the current revision.
 */
export function evaluateRequirements(
  reqs: PrdRequirement[],
  ev: RequirementEvidence,
  now = new Date().toISOString(),
): PrdRequirement[] {
  const buildCurrent =
    !!ev.build &&
    ev.build.status === "ready" &&
    ev.build.verified &&
    ev.build.revision !== null &&
    ev.build.revision === ev.projectRevision;

  const next = reqs.map((r) => {
    if (r.status === "REJECTED" || r.status === "SUPERSEDED") return r;

    // Quality requirement: complete only when the verified build checked a
    // phone-width layout. File existence is never proof.
    if (r.category === "quality") {
      if (buildCurrent && ev.build?.phoneChecked) {
        return { ...r, status: "COMPLETED" as const, evidence: [`Phone-width check passed at revision ${ev.projectRevision}`], lastVerifiedRevision: ev.projectRevision, updatedAt: now };
      }
      if (r.status === "COMPLETED") return r;
      const hasPages = ev.routes.length > 0;
      return hasPages && r.status === "NOT_STARTED" ? { ...r, status: "IN_PROGRESS" as const, updatedAt: now } : r;
    }

    const m = matchEvidence(r, ev);
    const found = m.files.length > 0 || m.routes.length > 0;
    const proof = [...m.routes.map((x) => `route ${x}`), ...m.files.slice(0, 4)];
    const fp = found ? fingerprint(m.files, ev) : null;

    if (!found) {
      if (r.status === "COMPLETED" || r.status === "IN_PROGRESS") {
        return { ...r, status: "NOT_STARTED" as const, evidence: ["Implementation no longer found"], evidenceFingerprint: null, updatedAt: now };
      }
      return r;
    }

    // External account needed and not connected: the code may exist but the
    // feature cannot be live. BLOCKED, never COMPLETED.
    if (r.integration && !ev.configuredIntegrations.includes(r.integration)) {
      return { ...r, status: "BLOCKED" as const, evidence: [...proof, `Needs a connected ${r.integration === "stripe" ? "Stripe" : "email"} account`], updatedAt: now };
    }

    if (buildCurrent) {
      return { ...r, status: "COMPLETED" as const, evidence: [...proof, `Verified build at revision ${ev.projectRevision}`], lastVerifiedRevision: ev.projectRevision, evidenceFingerprint: fp, updatedAt: now };
    }

    // No current verified build. A prior completion stays valid only while
    // the files it was verified against are byte-identical.
    if (r.status === "COMPLETED" && r.evidenceFingerprint && r.evidenceFingerprint === fp) return r;
    if (r.status === "IN_PROGRESS" && r.evidence.join("|") === proof.join("|")) return r;
    return { ...r, status: "IN_PROGRESS" as const, evidence: proof, updatedAt: now };
  });
  return next;
}

// ---------------------------------------------------------------------------
// Stages, continuation, summaries
// ---------------------------------------------------------------------------

const OPEN: RequirementStatus[] = ["NOT_STARTED", "IN_PROGRESS"];

/**
 * The next coherent bounded group of work: open requirements whose
 * prerequisites are complete or included in the same stage, in dependency
 * order, capped so one turn stays bounded.
 */
export function selectNextStage(reqs: PrdRequirement[], max = 5): PrdRequirement[] {
  const byId = new Map(reqs.map((r) => [r.id, r]));
  const stage: PrdRequirement[] = [];
  const inStage = new Set<string>();
  for (const r of orderByDependencies(reqs)) {
    if (stage.length >= max) break;
    if (!OPEN.includes(r.status)) continue;
    if (r.category === "quality") continue;
    const ready = r.dependsOn.every((d) => {
      const dep = byId.get(d);
      return !dep || dep.status === "COMPLETED" || dep.status === "REJECTED" || inStage.has(d);
    });
    if (!ready) continue;
    stage.push(r);
    inStage.add(r.id);
  }
  return stage;
}

export const CONTINUE_RE = /^\s*(continue|keep going|keep building|next( stage| step)?|go on|carry on|proceed|finish (it|the rest)|build the rest|do the rest|all)\b/i;

/** Requirements the brief targets directly ("Add Stripe" → payments). */
export function requirementsTargetedBy(reqs: PrdRequirement[], brief: string): PrdRequirement[] {
  const hits = new Set<string>();
  for (const item of [brief, ...splitRequestedItems(brief)]) {
    const c = conceptFor(item);
    if (c) hits.add(c.id);
  }
  return reqs.filter((r) => hits.has(r.id) && r.status !== "REJECTED");
}

export type StageMode = "first_build" | "continue" | "targeted" | "scoped";

export function stageForTurn(
  reqs: PrdRequirement[],
  brief: string,
  isFirstBuild: boolean,
): { mode: StageMode; stage: PrdRequirement[] } {
  if (isFirstBuild) return { mode: "first_build", stage: selectNextStage(reqs) };
  if (CONTINUE_RE.test(brief)) return { mode: "continue", stage: selectNextStage(reqs) };
  const targeted = requirementsTargetedBy(reqs, brief);
  if (targeted.length) return { mode: "targeted", stage: targeted };
  return { mode: "scoped", stage: [] };
}

export interface ProductProgress {
  completed: number;
  total: number;
  items: Array<{ id: string; label: string; status: RequirementStatus }>;
}

export function productProgress(reqs: PrdRequirement[]): ProductProgress {
  const live = reqs.filter((r) => r.status !== "REJECTED" && r.status !== "SUPERSEDED");
  return {
    completed: live.filter((r) => r.status === "COMPLETED").length,
    total: live.length,
    items: live.map((r) => ({ id: r.id, label: r.description, status: r.status })),
  };
}

/** Suggestions from real remaining work. Empty when nothing remains. */
export function continuationSuggestions(reqs: PrdRequirement[]): string[] {
  const out: string[] = [];
  for (const r of selectNextStage(reqs, 3)) out.push(r.nextAction);
  for (const r of reqs) {
    if (r.status === "BLOCKED" && r.integration === "stripe") out.push("Connect my Stripe account");
    if (r.status === "BLOCKED" && r.integration === "email") out.push("Set up sending emails");
  }
  const remaining = reqs.filter((r) => OPEN.includes(r.status) && r.category !== "quality").length;
  if (remaining > 1) out.splice(Math.min(2, out.length), 0, "Continue building the remaining platform");
  return [...new Set(out)].slice(0, 4);
}

/** Truthful plain-language progress lines for the turn summary. */
export function renderProgressSummary(reqs: PrdRequirement[], productName: string): string {
  const p = productProgress(reqs);
  if (p.total === 0) return "";
  const by = (s: RequirementStatus) => reqs.filter((r) => r.status === s).map((r) => r.description);
  const done = by("COMPLETED");
  const building = by("IN_PROGRESS");
  const remaining = by("NOT_STARTED");
  const blocked = by("BLOCKED");
  const lines = [`${productName} — ${p.completed}/${p.total} requirements verified.`];
  if (done.length) lines.push(`Verified: ${done.join(", ")}.`);
  if (building.length) lines.push(`Built, waiting on checks: ${building.join(", ")}.`);
  if (remaining.length) lines.push(`Remaining: ${remaining.join(", ")}.`);
  if (blocked.length) lines.push(`Needs you: ${blocked.join(", ")} (an account has to be connected).`);
  return lines.join("\n");
}

/** Prompt block: whole product, current statuses, and this turn's stage. */
export function renderRequirementsBlock(
  reqs: PrdRequirement[],
  plan: { mode: StageMode; stage: PrdRequirement[] },
): string {
  if (!reqs.length) return "";
  const mark: Record<RequirementStatus, string> = {
    NOT_STARTED: "[ ]", IN_PROGRESS: "[~]", COMPLETED: "[x]", BLOCKED: "[!]", REJECTED: "[-]", SUPERSEDED: "[-]",
  };
  const lines = [
    "\n\n### Product requirements and progress (authoritative — retain all of them)",
    "The user's requested product scope is authoritative. Understand and retain the complete scope. Do not arbitrarily defer requested functionality merely because multiple features were requested. Large products are built in coherent stages; never lose or silently discard a requirement.",
  ];
  for (const r of reqs) {
    const deps = r.dependsOn.length ? ` (after: ${r.dependsOn.join(", ")})` : "";
    lines.push(`${mark[r.status]} ${r.id}: ${r.description}${deps}`);
  }
  if (plan.stage.length) {
    lines.push("");
    lines.push(
      plan.mode === "targeted"
        ? "THIS TURN — implement these requirements inside the existing app, reusing what exists:"
        : "THIS STAGE — implement these requirements fully and properly now:",
    );
    for (const r of plan.stage) lines.push(`- ${r.description}`);
    const later = reqs.filter((r) => OPEN.includes(r.status) && !plan.stage.includes(r) && r.category !== "quality");
    if (later.length) {
      lines.push(`Later stages (keep in mind, do not build their deep functionality now, never remove them): ${later.map((r) => r.description).join(", ")}.`);
    }
  } else {
    lines.push("");
    lines.push("THIS TURN is scoped to the user's request. Do not rebuild or regenerate other requirements.");
  }
  lines.push(
    "External accounts (payments, email): build the real integration code and screens; never invent keys or claim it is live — the account connection is the user's step.",
    "Your summary must never call the product complete while requirements remain; name what remains.",
  );
  return lines.join("\n");
}
