/**
 * Intent contract — deterministic request → product-archetype validation.
 *
 * Part of the existing PRD (stored on `Prd.intent`), not a second planner.
 * It answers, WITHOUT asking the model whether its own plan is right:
 *   - what product type / domain the user asked for,
 *   - core roles, entities, workflows and pages of that archetype,
 *   - which product concepts are explicitly OUT (e.g. shop/cart/checkout for
 *     a hospital system),
 * and validates any plan or router against it before expensive generation.
 *
 * Pure; no I/O.
 */
import type { Prd, PrdEntity, PrdSurface } from "./prd-types";
import type { PrdRequirement } from "./prd-requirements";

export interface IntentPage {
  route: string;
  label: string;
}

export interface IntentContract {
  /** Archetype id, e.g. "healthcare". null = no confident archetype. */
  archetype: string | null;
  label: string;
  domain: string;
  productType: Prd["productType"] | null;
  roles: string[];
  entities: string[];
  workflows: string[];
  pages: IntentPage[];
  /** Concepts the plan must not introduce unless the user asks for them. */
  exclusions: string[];
  /** True when the request itself asks for selling goods online. */
  commerceRequested: boolean;
}

interface Family {
  id: string;
  label: string;
  triggers: RegExp;
  productType: Prd["productType"];
  roles: string[];
  entities: string[];
  workflows: string[];
  pages: IntentPage[];
}

const p = (route: string, label: string): IntentPage => ({ route, label });

/** Ordered most-specific first. Triggers are tested against the raw request. */
const FAMILIES: Family[] = [
  {
    id: "healthcare",
    label: "hospital / clinic management",
    triggers: /\b(hospital|clinic|clinical|patients?|medical records?|healthcare|health ?care|ehr|emr|physicians?|nurs(e|es|ing)|ward|outpatient|inpatient|pharmacy|prescriptions?)\b/i,
    productType: "workflow-app",
    roles: ["admin", "doctor", "nurse", "receptionist", "patient"],
    entities: ["Patient", "Doctor", "Appointment", "MedicalRecord", "Prescription", "Department", "Staff", "Invoice"],
    workflows: ["Register a patient", "Book and manage appointments", "Record a visit in the medical record", "Issue a prescription", "Bill a patient"],
    pages: [p("/", "Dashboard"), p("/patients", "Patients"), p("/doctors", "Doctors"), p("/appointments", "Appointments"), p("/records", "Medical Records"), p("/prescriptions", "Prescriptions"), p("/billing", "Billing"), p("/departments", "Departments"), p("/staff", "Staff"), p("/settings", "Settings")],
  },
  {
    id: "education",
    label: "school / learning management",
    triggers: /\b(school|students?|teachers?|classroom|lms|learning management|university|college|enrol(l)?ments?|gradebook|grades)\b/i,
    productType: "workflow-app",
    roles: ["admin", "teacher", "student", "parent"],
    entities: ["Student", "Teacher", "Class", "Course", "Enrollment", "Grade", "Attendance"],
    workflows: ["Enrol a student", "Take attendance", "Record grades"],
    pages: [p("/", "Dashboard"), p("/students", "Students"), p("/teachers", "Teachers"), p("/classes", "Classes"), p("/attendance", "Attendance"), p("/grades", "Grades"), p("/settings", "Settings")],
  },
  {
    id: "hr",
    label: "HR / people management",
    triggers: /\b(hr|human resources|employees?|payroll|recruit(ing|ment)?|leave requests?|onboarding staff)\b/i,
    productType: "workflow-app",
    roles: ["admin", "manager", "employee"],
    entities: ["Employee", "Department", "LeaveRequest", "PayrollRun", "Candidate"],
    workflows: ["Add an employee", "Approve leave", "Run payroll"],
    pages: [p("/", "Dashboard"), p("/employees", "Employees"), p("/departments", "Departments"), p("/leave", "Leave"), p("/payroll", "Payroll"), p("/settings", "Settings")],
  },
  {
    id: "crm",
    label: "CRM / sales pipeline",
    triggers: /\b(crm|leads?|sales pipeline|deals?|prospects?|customer relationship)\b/i,
    productType: "workflow-app",
    roles: ["admin", "sales rep"],
    entities: ["Contact", "Company", "Deal", "Activity"],
    workflows: ["Capture a lead", "Move a deal through the pipeline", "Log an activity"],
    pages: [p("/", "Dashboard"), p("/contacts", "Contacts"), p("/companies", "Companies"), p("/deals", "Deals"), p("/activities", "Activities"), p("/settings", "Settings")],
  },
  {
    id: "inventory",
    label: "inventory / warehouse management",
    triggers: /\b(inventory|warehouse|stock (levels?|control|management)|suppliers?|purchase orders?)\b/i,
    productType: "workflow-app",
    roles: ["admin", "staff"],
    entities: ["Item", "Supplier", "StockMovement", "PurchaseOrder", "Location"],
    workflows: ["Receive stock", "Adjust stock", "Raise a purchase order"],
    pages: [p("/", "Dashboard"), p("/items", "Items"), p("/suppliers", "Suppliers"), p("/purchase-orders", "Purchase Orders"), p("/movements", "Stock Movements"), p("/settings", "Settings")],
  },
  {
    id: "projects",
    label: "project / task management",
    triggers: /\b(project management|task management|kanban|to-?do|issue tracker|sprints?)\b/i,
    productType: "workflow-app",
    roles: ["admin", "member"],
    entities: ["Project", "Task", "Member", "Comment"],
    workflows: ["Create a task", "Move a task across the board", "Assign a task"],
    pages: [p("/", "Dashboard"), p("/projects", "Projects"), p("/tasks", "Tasks"), p("/team", "Team"), p("/settings", "Settings")],
  },
  {
    id: "commerce",
    label: "online store",
    triggers: /\b(e-?commerce|online (store|shop)|storefront|shopping cart|\bcart\b|checkout|sell (products|goods|online)|webshop|\bshop\b|\bstore\b)\b/i,
    productType: "storefront",
    roles: ["customer", "admin"],
    entities: ["Product", "Order", "Customer"],
    workflows: ["Browse products", "Add to cart", "Check out"],
    pages: [p("/", "Home"), p("/shop", "Shop"), p("/cart", "Cart"), p("/checkout", "Checkout")],
  },
];

const APP_REQUEST = /\b(management system|management app|system|platform|portal|dashboard|admin panel|back ?office|crm|erp|software|tool)\b/i;

/** Page names/routes that belong to a shopping product. */
export const COMMERCE_PAGE = /(^|\/|\b)(shop|store|storefront|cart|checkout|products?|wishlist|catalog(ue)?)(\b|\/|$)/i;
/** "Orders" is commerce only when it is not a domain word (lab/medical orders). */
const COMMERCE_ORDERS = /(^|\/|\b)orders?(\b|\/|$)/i;

export function deriveIntentContract(brief: string, prd?: Prd | null): IntentContract {
  const text = brief || "";
  const commerceFamily = FAMILIES.find((f) => f.id === "commerce")!;
  const commerceRequested = commerceFamily.triggers.test(text);
  // Domain families win over commerce words used incidentally ("hospital pharmacy store").
  const family = FAMILIES.find((f) => f.id !== "commerce" && f.triggers.test(text)) ?? (commerceRequested ? commerceFamily : null);
  const exclusions = commerceRequested ? [] : ["online shop", "product catalogue", "cart", "checkout"];
  if (!family) {
    return {
      archetype: null,
      label: prd?.domain || "",
      domain: prd?.domain || "",
      productType: APP_REQUEST.test(text) ? "workflow-app" : null,
      roles: prd?.roles ?? [],
      entities: (prd?.dataModel ?? []).map((e) => e.name),
      workflows: prd?.primaryWorkflow ? [prd.primaryWorkflow.name] : [],
      pages: [],
      exclusions,
      commerceRequested,
    };
  }
  return {
    archetype: family.id,
    label: family.label,
    domain: prd?.domain || family.label,
    productType: family.productType,
    roles: family.roles,
    entities: family.entities,
    workflows: family.workflows,
    pages: family.pages,
    exclusions,
    commerceRequested,
  };
}

/**
 * Validate planned/router pages against the contract. Returns the routes that
 * materially diverge from the request (e.g. shop pages in a hospital system).
 */
const ALWAYS_ALLOWED = /^\/($|auth|login|sign-?in|sign-?up|register|account|profile|dashboard|settings|404|not-found)/i;

export function divergentPages(contract: IntentContract, routes: string[], brief: string): string[] {
  if (contract.commerceRequested) return [];
  const contractRoutes = new Set(contract.pages.map((x) => x.route));
  const briefMentions = (r: string) => {
    const word = r.replace(/^\//, "").split(/[/-]/)[0] ?? "";
    return word.length > 2 && new RegExp(`\\b${word.replace(/s$/, "")}`, "i").test(brief);
  };
  const out: string[] = [];
  for (const r of routes) {
    if (contractRoutes.has(r) || briefMentions(r)) continue;
    if (COMMERCE_PAGE.test(r)) out.push(r);
    // A recognised archetype defines the product's pages: a template/router
    // page outside it (e.g. a clinic-booking "/services" or "/confirmation"
    // for a hospital system) is drift, unless the user named it. Account
    // plumbing (/, auth, profile, dashboard) is always allowed.
    else if (contract.archetype && contract.pages.length && !ALWAYS_ALLOWED.test(r)) out.push(r);
    else if (COMMERCE_ORDERS.test(r) && routes.some((x) => COMMERCE_PAGE.test(x))) out.push(r);
  }
  return out;
}

/** Prompt block for the shell/page writers: what we are building and what is OUT. */
export function renderIntentBlock(c: IntentContract): string {
  if (!c.archetype && !c.exclusions.length) return "";
  return [
    `\n\n### Product contract (authoritative — do not drift)`,
    c.archetype ? `Product: ${c.label}${c.domain && c.domain !== c.label ? ` (${c.domain})` : ""}.` : "",
    c.roles.length ? `Users/roles: ${c.roles.join(", ")}.` : "",
    c.entities.length ? `Core entities: ${c.entities.join(", ")}.` : "",
    c.workflows.length ? `Primary workflows: ${c.workflows.join("; ")}.` : "",
    c.pages.length ? `Pages: ${c.pages.map((x) => `${x.label} (${x.route})`).join(", ")}.` : "",
    c.exclusions.length ? `OUT OF SCOPE — never add: ${c.exclusions.join(", ")}.` : "",
  ].filter(Boolean).join("\n");
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/**
 * Enrich the authored PRD with the deterministic contract. Only fills gaps and
 * corrects contradictions with the request; never removes user-named items.
 */
export function applyIntentContract(prd: Prd, brief: string, now = new Date().toISOString()): Prd {
  const c = deriveIntentContract(brief, prd);
  const next: Prd = { ...prd, intent: c };
  if (!c.archetype) {
    if (c.productType === "workflow-app" && prd.productType === "content-site") {
      next.productType = "workflow-app";
      next.requiredSurfaces = Array.from(new Set<PrdSurface>([...prd.requiredSurfaces.filter((s) => s !== "content"), "dashboard"]));
    }
    return next;
  }
  if (c.productType && c.productType !== "storefront" && (prd.productType === "storefront" || prd.productType === "content-site")) {
    next.productType = c.productType;
  }
  if (c.productType === "workflow-app") {
    const keep = prd.requiredSurfaces.filter((s) => s !== "content" && s !== "catalog" && s !== "checkout");
    next.requiredSurfaces = Array.from(new Set<PrdSurface>([...keep, "dashboard", "settings"]));
    next.excludedSurfaces = Array.from(new Set<PrdSurface>([...prd.excludedSurfaces.filter((s) => s !== "dashboard"), ...(c.commerceRequested ? [] : (["checkout", "catalog"] as PrdSurface[]))]));
  }
  if (!prd.roles?.length) next.roles = c.roles;
  if (!prd.dataModel?.length) {
    next.dataModel = c.entities.map<PrdEntity>((name) => ({
      name,
      fields: [],
      operations: ["create", "read", "update", "delete"],
      visibility: "role",
      allowedRoles: c.roles.slice(0, 2),
      relationships: [],
    }));
  }
  if (c.exclusions.length) next.outOfScope = Array.from(new Set([...(prd.outOfScope ?? []), ...c.exclusions]));
  // Every contract page becomes a page requirement (the plan contract).
  const reqs = [...(prd.requirements ?? [])];
  const have = new Set(reqs.map((r) => r.id));
  for (const page of c.pages) {
    const id = page.route === "/" ? "home" : slug(page.label);
    if (have.has(id)) continue;
    const r: PrdRequirement = {
      id,
      description: page.label,
      category: "page",
      status: "NOT_STARTED",
      dependsOn: [],
      evidence: [],
      lastVerifiedRevision: null,
      updatedAt: now,
      evidenceFingerprint: null,
      integration: null,
      nextAction: `Build the ${page.label} page`,
    };
    reqs.push(r);
    have.add(id);
  }
  next.requirements = reqs;
  return next;
}

/**
 * Remove divergent pages from a model-written router (import line + <Route>).
 * Returns null when the router can't be cleaned safely.
 */
export function stripRoutesFromRouter(app: string, pageFiles: string[]): string | null {
  let out = app;
  for (const file of pageFiles) {
    const name = file.split("/").pop()!.replace(/\.(tsx?|jsx?)$/, "");
    const importRe = new RegExp(`^\\s*import\\s+([A-Za-z_$][\\w$]*)\\s+from\\s*["'](?:@|\\.)/pages/${name}(?:\\.tsx?)?["'];?\\s*$\\n?`, "m");
    const lazyRe = new RegExp(`^\\s*const\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*lazy\\([^\\n]*(?:@|\\.)/pages/${name}["'.][^\\n]*$\\n?`, "m");
    const m = importRe.exec(out) ?? lazyRe.exec(out);
    if (!m) continue;
    const ident = m[1]!;
    out = out.replace(m[0], "");
    out = out.replace(new RegExp(`^[^\\n]*<Route\\b[^\\n]*<${ident}\\b[^\\n]*$\\n?`, "gm"), "");
    if (new RegExp(`\\b${ident}\\b`).test(out)) return null;
  }
  return out;
}
