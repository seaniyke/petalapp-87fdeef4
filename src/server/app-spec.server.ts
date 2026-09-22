/**
 * App spec extraction.
 *
 * Complex briefs ("an ERP for a bakery with inventory, suppliers, orders and
 * staff shifts") were being flattened into "a dashboard" because nothing in
 * the pipeline forced the model to enumerate the data model first. This pass
 * does a cheap deterministic read of the brief — candidate entities, roles,
 * workflows, and CRUD depth — and renders a prompt block that makes the model
 * commit to that model BEFORE it writes files, then holds it accountable to it.
 *
 * Deterministic + pure. It intentionally over-collects candidates: the block
 * asks the model to confirm/extend, not to obey blindly.
 */

export interface AppSpec {
  entities: string[];
  roles: string[];
  workflows: string[];
  /** true when the brief clearly implies multi-entity relational data. */
  relational: boolean;
  /** true when the brief implies money movement / ledgers. */
  monetary: boolean;
  /** true when the brief implies reporting or analytics. */
  reporting: boolean;
}

const ENTITY_WORDS: Array<[RegExp, string]> = [
  [/\b(customer|client)s?\b/i, "Customer"],
  [/\b(user|member|account)s?\b/i, "User"],
  [/\b(order|purchase)s?\b/i, "Order"],
  [/\b(invoic(e|es|ing)|bill(s|ing)?)\b/i, "Invoice"],
  [/\b(payment|transaction)s?\b/i, "Payment"],
  [/\b(product|item|sku)s?\b/i, "Product"],
  [/\b(inventory|stock)\b/i, "InventoryItem"],
  [/\b(supplier|vendor)s?\b/i, "Supplier"],
  [/\b(employee|staff|worker)s?\b/i, "Employee"],
  [/\b(shift|roster|schedule)s?\b/i, "Shift"],
  [/\b(project)s?\b/i, "Project"],
  [/\b(task|ticket|issue)s?\b/i, "Task"],
  [/\b(lead|deal|opportunit(y|ies))\b/i, "Deal"],
  [/\b(appointment|booking|reservation)s?\b/i, "Booking"],
  [/\b(patient)s?\b/i, "Patient"],
  [/\b(student|pupil)s?\b/i, "Student"],
  [/\b(course|class|lesson)es?s?\b/i, "Course"],
  [/\b(property|listing)(s|ies)?\b/i, "Listing"],
  [/\b(vehicle|fleet|car)s?\b/i, "Vehicle"],
  [/\b(document|file|contract)s?\b/i, "Document"],
  [/\b(expense|budget)s?\b/i, "Expense"],
  [/\b(campaign)s?\b/i, "Campaign"],
  [/\b(post|article|content)s?\b/i, "Post"],
  [/\b(message|chat|conversation)s?\b/i, "Message"],
  [/\b(warehouse|branch|location|store)s?\b/i, "Location"],
  [/\b(report)s?\b/i, "Report"],
];

const ROLE_WORDS: Array<[RegExp, string]> = [
  [/\badmin(istrator)?s?\b/i, "admin"],
  [/\bmanager s?\b|\bmanagers?\b/i, "manager"],
  [/\b(staff|employee|agent)s?\b/i, "staff"],
  [/\b(customer|client|buyer)s?\b/i, "customer"],
  [/\b(vendor|supplier|seller|merchant)s?\b/i, "vendor"],
  [/\b(teacher|instructor|tutor)s?\b/i, "instructor"],
  [/\b(student|learner)s?\b/i, "student"],
  [/\b(doctor|clinician|nurse)s?\b/i, "clinician"],
  [/\b(patient)s?\b/i, "patient"],
  [/\b(owner)s?\b/i, "owner"],
];

const WORKFLOW_WORDS: Array<[RegExp, string]> = [
  [/\bapprov(e|al)s?\b/i, "approval flow"],
  [/\b(check ?out|cart|purchase)\b/i, "checkout"],
  [/\b(onboard(ing)?)\b/i, "onboarding"],
  [/\b(invit(e|ation)|team)s?\b/i, "team invites"],
  [/\b(notif(y|ication)|alert)s?\b/i, "notifications"],
  [/\b(import|export|csv)\b/i, "import / export"],
  [/\b(assign|delegat)\w*/i, "assignment"],
  [/\b(status|pipeline|stage)s?\b/i, "status pipeline"],
  [/\b(audit|log|history)\b/i, "audit trail"],
  [/\b(subscription|recurring|billing)\b/i, "subscription billing"],
  [/\b(refund|dispute)s?\b/i, "refunds"],
  [/\b(search|filter)\w*/i, "search + filtering"],
];

function collect(brief: string, table: Array<[RegExp, string]>): string[] {
  const out: string[] = [];
  for (const [rx, label] of table) if (rx.test(brief) && !out.includes(label)) out.push(label);
  return out;
}

export function extractAppSpec(brief: string): AppSpec {
  const b = brief || "";
  const entities = collect(b, ENTITY_WORDS);
  const roles = collect(b, ROLE_WORDS);
  const workflows = collect(b, WORKFLOW_WORDS);
  return {
    entities,
    roles,
    workflows,
    relational: entities.length >= 2,
    monetary: /\b(payment|invoice|price|pricing|revenue|billing|amount|currency|refund|salary|payroll|expense)\b/i.test(b),
    reporting: /\b(report|analytic|dashboard|kpi|metric|chart|insight|forecast)\w*/i.test(b),
  };
}

/**
 * Prompt block. Returns "" for briefs with nothing app-shaped in them so we
 * never spend tokens on a landing page.
 */
export function renderAppSpecBlock(brief: string): string {
  const spec = extractAppSpec(brief);
  if (spec.entities.length === 0 && spec.workflows.length === 0 && !spec.monetary && !spec.reporting) return "";

  const lines: string[] = [];
  if (spec.entities.length) lines.push(`  Candidate entities: ${spec.entities.join(", ")}`);
  if (spec.roles.length) lines.push(`  Candidate roles: ${spec.roles.join(", ")}`);
  if (spec.workflows.length) lines.push(`  Candidate workflows: ${spec.workflows.join(", ")}`);
  if (spec.monetary) lines.push("  Money is involved: amounts need a currency, integer minor units, and consistent formatting everywhere.");
  if (spec.reporting) lines.push("  Reporting is involved: every metric must be computed from the seeded data, never hard-coded.");

  return `\n\n[Spec-first — model the data BEFORE writing screens]
This brief describes a real product with real data. Kimble read it and extracted these candidates (they are a starting point, not a limit — confirm, correct, and extend them from the user's actual words):
${lines.join("\n")}

Before you emit any file, decide and state — in at most 5 short lines at the top of your reply — the following:
  1. Entities and their key fields (name, type, required, defaults). Include the timestamps and the owner/tenant column.
  2. Relationships between them (one-to-many / many-to-many, and the join tables that implies).
  3. Statuses / enums for anything with a lifecycle.
  4. Roles and what each role may read and write.
  5. The single most important workflow a user completes end-to-end in this app.

Then build to that spec, in this order of priority:
  - The primary entity gets a complete slice: list + filters + detail + create + edit + delete-with-confirm.
  - The second and third entities get at least list + detail.
  - Every relationship is navigable in the UI (a customer's orders are reachable from the customer).
  - Enums render as status pills with consistent colours across every screen.
  - ${spec.monetary ? "Money is stored as integer minor units and formatted with Intl.NumberFormat — never floats, never a bare `$` concatenation." : "Dates render with Intl.DateTimeFormat, never a raw ISO string in the UI."}
  - Seeded demo data must satisfy the relationships (orders reference real customers) and be plausible for the domain.

Do NOT ship a screen for an entity you did not model, and do NOT model an entity you never surface. If the brief is genuinely ambiguous on ONE material point, state the assumption you made in one line and keep building — do not stop to ask.`;
}
