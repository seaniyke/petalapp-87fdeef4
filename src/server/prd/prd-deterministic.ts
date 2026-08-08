/**
 * PRD — deterministic authoring pass.
 *
 * Runs first, on every build, with no I/O and no model call. It produces a
 * complete, usable PRD from rules alone so the pipeline is NEVER left with an
 * empty spec (the failure mode of the old regex `app-spec` pass, which
 * returned "" for anything that was not CRUD-shaped).
 *
 * The model pass refines this; it never starts from a blank page.
 *
 * Pure + deterministic: same prompt in, same PRD out. Easy to test.
 */

import type {
  Prd,
  PrdAcceptanceCriterion,
  PrdFormula,
  PrdSurface,
  PrdWorkflow,
  ProductType,
} from "./prd-types";

/* ============================================================
 * Domain-logic registry — products whose whole value is a formula
 * ============================================================ */

interface CalculatorSpec {
  id: string;
  /** Phrases that identify this calculator. */
  needles: RegExp[];
  productName: string;
  purpose: string;
  targetUser: string;
  primaryOutcome: string;
  domain: string;
  contentTone: string;
  inputs: string[];
  outputs: string[];
  formulas: PrdFormula[];
  /** Extra informational surfaces this domain expects. */
  extraSurfaces?: PrdSurface[];
  /** Domain-specific required states. */
  states?: string[];
}

export const CALCULATORS: CalculatorSpec[] = [
  {
    id: "pregnancy-due-date",
    needles: [
      /\bpregnan\w*\s+(calculator|tracker|app|tool)\b/i,
      /\bdue[-\s]?date\s+(calculator|estimator|tool)\b/i,
      /\bgestational\s+age\b/i,
      /\bpregnancy\s+week\s+calculator\b/i,
      /\bconception\s+calculator\b/i,
    ],
    productName: "Due Date Companion",
    purpose:
      "Estimates a pregnancy due date and current gestational age from a last menstrual period or conception date.",
    targetUser: "Someone who is pregnant or trying to conceive and wants to know where they are in the pregnancy.",
    primaryOutcome: "See an estimated due date, the current week and trimester, and what happens next.",
    domain: "pregnancy & prenatal health",
    contentTone:
      "Warm, calm, and informative. Educational only — never diagnostic, never alarming, and never a substitute for a clinician.",
    inputs: ["last menstrual period date", "or conception date", "average cycle length (optional, default 28 days)"],
    outputs: ["estimated due date", "gestational age in weeks and days", "current trimester", "weeks remaining"],
    formulas: [
      {
        id: "naegele-due-date",
        statement:
          "Estimated due date = first day of last menstrual period + 280 days, adjusted by (cycle length − 28) days when a non-standard cycle length is given.",
        example: { input: "LMP 2025-01-01, 28-day cycle", expected: "due date 2025-10-08" },
      },
      {
        id: "gestational-age",
        statement:
          "Gestational age = days between the LMP and today, rendered as full weeks plus remaining days (e.g. 12w 3d).",
        example: { input: "LMP 70 days ago", expected: "10w 0d" },
      },
      {
        id: "trimester",
        statement:
          "Trimester boundaries: weeks 0–13 first, 14–27 second, 28+ third.",
        example: { input: "20 weeks", expected: "second trimester" },
      },
      {
        id: "conception-to-lmp",
        statement: "When a conception date is given instead, LMP = conception date − 14 days, then apply the rules above.",
      },
    ],
    extraSurfaces: ["content"],
    states: [
      "no date entered yet — calculator is inviting, not empty-looking",
      "future date entered — clear inline validation message",
      "date more than 44 weeks ago — explain the result is out of range",
      "successful result — due date, week, trimester, and milestones visible without scrolling on desktop",
    ],
  },
  {
    id: "ovulation",
    needles: [/\bovulation\s+(calculator|tracker)\b/i, /\bfertility\s+window\b/i, /\bperiod\s+calculator\b/i],
    productName: "Cycle Window",
    purpose: "Estimates the fertile window and next period from cycle history.",
    targetUser: "Someone tracking their menstrual cycle.",
    primaryOutcome: "See the predicted fertile window and next period date.",
    domain: "menstrual & reproductive health",
    contentTone: "Practical and non-judgemental. Educational only, never medical advice.",
    inputs: ["first day of last period", "average cycle length"],
    outputs: ["ovulation date", "fertile window", "next period date"],
    formulas: [
      {
        id: "ovulation-day",
        statement: "Ovulation ≈ next period date − 14 days; fertile window = ovulation − 5 days through ovulation + 1 day.",
        example: { input: "28-day cycle starting 2025-03-01", expected: "ovulation 2025-03-15" },
      },
    ],
    extraSurfaces: ["content"],
  },
  {
    id: "mortgage-loan",
    needles: [
      /\b(mortgage|loan|amorti[sz]ation)\s+calculator\b/i,
      /\brepayment\s+calculator\b/i,
      /\bhow much.*monthly payment\b/i,
    ],
    productName: "Repayment Planner",
    purpose: "Calculates monthly repayments, total interest, and an amortisation schedule for a loan.",
    targetUser: "Someone comparing loan or mortgage options.",
    primaryOutcome: "See the monthly payment and total cost for a given amount, rate, and term.",
    domain: "personal finance",
    contentTone: "Precise and plain. Show the maths, avoid financial advice.",
    inputs: ["loan amount", "annual interest rate", "term in years"],
    outputs: ["monthly payment", "total interest", "total repaid", "amortisation schedule"],
    formulas: [
      {
        id: "annuity-payment",
        statement:
          "Monthly payment = P × r / (1 − (1 + r)^−n) where r is the monthly rate (annual / 12 / 100) and n the number of months. When r is 0, payment = P / n.",
        example: { input: "100000 at 6% over 30 years", expected: "≈ 599.55 per month" },
      },
    ],
  },
  {
    id: "bmi-body",
    needles: [/\bbmi\s+calculator\b/i, /\bbody\s+mass\s+index\b/i, /\bideal\s+weight\s+calculator\b/i],
    productName: "Body Index",
    purpose: "Calculates body mass index and the corresponding range.",
    targetUser: "Someone tracking general health metrics.",
    primaryOutcome: "See a BMI value and what range it falls in.",
    domain: "general health",
    contentTone: "Neutral and non-shaming. Educational only, never diagnostic.",
    inputs: ["height", "weight", "unit system"],
    outputs: ["BMI value", "range label"],
    formulas: [
      {
        id: "bmi",
        statement: "BMI = weight in kg / (height in metres)². Imperial: 703 × lb / in².",
        example: { input: "70 kg, 1.75 m", expected: "22.9" },
      },
    ],
  },
  {
    id: "calorie-tdee",
    needles: [/\b(calorie|tdee|macro)\s+calculator\b/i, /\bdaily\s+calorie\s+needs\b/i],
    productName: "Daily Energy",
    purpose: "Estimates daily calorie needs and macro split from body stats and activity level.",
    targetUser: "Someone planning their nutrition.",
    primaryOutcome: "See an estimated daily calorie target and macro breakdown.",
    domain: "nutrition",
    contentTone: "Supportive and factual. Educational only.",
    inputs: ["age", "sex", "height", "weight", "activity level", "goal"],
    outputs: ["BMR", "TDEE", "calorie target", "protein/carb/fat split"],
    formulas: [
      {
        id: "mifflin-st-jeor",
        statement:
          "BMR = 10×kg + 6.25×cm − 5×age + 5 (male) or − 161 (female). TDEE = BMR × activity factor (1.2 sedentary → 1.9 very active).",
        example: { input: "male, 30y, 80kg, 180cm, sedentary", expected: "BMR 1780, TDEE ≈ 2136" },
      },
    ],
  },
  {
    id: "age-date",
    needles: [/\bage\s+calculator\b/i, /\bdate\s+(difference|duration)\s+calculator\b/i, /\bcountdown\s+calculator\b/i],
    productName: "Date Between",
    purpose: "Calculates the exact duration between two dates.",
    targetUser: "Anyone needing an exact age or interval.",
    primaryOutcome: "See an exact duration in years, months, and days.",
    domain: "everyday utilities",
    contentTone: "Plain and fast.",
    inputs: ["start date", "end date"],
    outputs: ["years, months, days", "total days"],
    formulas: [
      {
        id: "calendar-diff",
        statement: "Difference is calendar-aware: borrow days from the previous month and months from the year, never a flat /365.",
        example: { input: "1990-05-10 to 2025-03-01", expected: "34y 9m 19d" },
      },
    ],
  },
  {
    id: "tip-split",
    needles: [/\btip\s+calculator\b/i, /\bsplit\s+the\s+bill\b/i, /\bbill\s+splitter\b/i],
    productName: "Split It",
    purpose: "Calculates tip and splits a bill between people.",
    targetUser: "A group settling a bill.",
    primaryOutcome: "See what each person owes.",
    domain: "everyday utilities",
    contentTone: "Fast and frictionless.",
    inputs: ["bill amount", "tip percentage", "number of people"],
    outputs: ["tip amount", "total", "per person"],
    formulas: [
      {
        id: "tip-split",
        statement: "tip = bill × pct/100; total = bill + tip; per person = total / people, rounded to 2 decimals.",
        example: { input: "80 at 20% between 4", expected: "24.00 each" },
      },
    ],
  },
  {
    id: "unit-conversion",
    needles: [/\bunit\s+conver(ter|sion)\b/i, /\bcurrency\s+converter\b/i, /\bconvert\b.*\bcalculator\b/i],
    productName: "Convert",
    purpose: "Converts values between units.",
    targetUser: "Anyone needing a quick conversion.",
    primaryOutcome: "See a converted value instantly as they type.",
    domain: "everyday utilities",
    contentTone: "Minimal and instant.",
    inputs: ["value", "source unit", "target unit"],
    outputs: ["converted value"],
    formulas: [
      {
        id: "conversion-table",
        statement: "Conversion factors live in one typed table; every conversion is table-driven, never hard-coded per pair.",
      },
    ],
  },
  {
    id: "percentage-generic",
    needles: [/\bpercentage\s+calculator\b/i, /\b(vat|tax|discount|margin)\s+calculator\b/i],
    productName: "Percent",
    purpose: "Calculates percentages, discounts, and tax-inclusive totals.",
    targetUser: "Anyone doing quick commercial maths.",
    primaryOutcome: "See the resulting amount immediately.",
    domain: "everyday utilities",
    contentTone: "Plain and fast.",
    inputs: ["base amount", "percentage"],
    outputs: ["result", "difference"],
    formulas: [
      { id: "percent", statement: "Compute in a single typed helper; round only at render time, never mid-calculation." },
    ],
  },
];

/** Generic calculator/converter/generator detection when no named spec matches. */
const GENERIC_UTILITY = [
  /\bcalculator\b/i,
  /\bconverter\b/i,
  /\bestimator\b/i,
  /\b(generator|randomi[sz]er)\b/i,
  /\btimer\b/i,
  /\bcounter\b/i,
  /\bchecker\b/i,
  /\bsimple\s+tool\b/i,
];

/* ============================================================
 * Product type detection
 * ============================================================ */

const TYPE_RULES: Array<{ type: ProductType; weight: number; patterns: RegExp[] }> = [
  {
    type: "marketplace",
    weight: 5,
    patterns: [/\bmarketplace\b/i, /\btwo[-\s]?sided\b/i, /\b(buyers?|sellers?)\s+and\s+(sellers?|buyers?)\b/i],
  },
  {
    type: "storefront",
    weight: 4,
    patterns: [/\b(online\s+)?(store|shop)\b/i, /\becommerce\b/i, /\bsell\s+(products?|merch)\b/i, /\bcart\b/i],
  },
  {
    type: "social",
    weight: 4,
    patterns: [/\bsocial\s+(network|app|platform)\b/i, /\bfeed\b/i, /\bfollowers?\b/i, /\bcommunity\s+app\b/i],
  },
  { type: "game", weight: 5, patterns: [/\bgame\b/i, /\bpuzzle\b/i, /\bquiz\s+game\b/i, /\barcade\b/i] },
  {
    type: "ai-tool",
    weight: 4,
    patterns: [/\bai\s+(chat|assistant|tool|agent|generator)\b/i, /\bchatbot\b/i, /\bgpt\b/i, /\bllm\b/i],
  },
  {
    type: "workflow-app",
    weight: 3,
    patterns: [
      /\bdashboard\b/i,
      /\bcrm\b/i,
      /\berp\b/i,
      /\badmin\s+(panel|console|tool|dashboard)\b/i,
      /\binternal\s+(tool|app|system|dashboard)\b/i,
      /\bback[-\s]?office\b/i,
      /\b(support|ops|operations)\s+team\b/i,
      /\b(task|project|invoice|habit|expense|client)\s+manager\b/i,
      /\bsaas\b/i,
      /\b(manage|track)\s+\w+\s+(for|across)\b/i,
      /\b(inventory|invoice|booking|appointment|project|task)\s+(management|manager|system|tracker)\b/i,
    ],
  },
  {
    type: "content-site",
    weight: 3,
    patterns: [
      /\blanding\s*page\b/i,
      /\bportfolio\b/i,
      /\bblog\b/i,
      /\b(company|agency|restaurant|studio)\s+(site|website)\b/i,
      /\bwaitlist\b/i,
    ],
  },
];

function detectProductType(brief: string): { type: ProductType; confidence: number } {
  const scores = new Map<ProductType, number>();
  for (const rule of TYPE_RULES) {
    for (const p of rule.patterns) {
      if (p.test(brief)) scores.set(rule.type, (scores.get(rule.type) ?? 0) + rule.weight);
    }
  }
  // Utility signals are strong and specific — they beat a stray "dashboard".
  if (CALCULATORS.some((c) => c.needles.some((n) => n.test(brief)))) {
    return { type: "utility", confidence: 0.95 };
  }
  if (GENERIC_UTILITY.some((p) => p.test(brief))) {
    scores.set("utility", (scores.get("utility") ?? 0) + 5);
  }

  let best: ProductType | null = null;
  let bestScore = 0;
  for (const [type, score] of scores) {
    if (score > bestScore) {
      best = type;
      bestScore = score;
    }
  }
  if (!best) return { type: "content-site", confidence: 0.3 };
  return { type: best, confidence: Math.min(0.9, 0.4 + bestScore * 0.1) };
}

/* ============================================================
 * Surface defaults per product type
 * ============================================================ */

const SURFACES: Record<ProductType, { required: PrdSurface[]; excluded: PrdSurface[] }> = {
  utility: {
    required: ["landing", "tool", "results", "about"],
    excluded: ["dashboard", "admin", "auth", "account", "checkout"],
  },
  "content-site": {
    required: ["landing", "content", "about", "contact"],
    excluded: ["dashboard", "admin", "auth", "account"],
  },
  "workflow-app": {
    required: ["dashboard", "detail", "settings"],
    excluded: ["checkout", "admin"],
  },
  marketplace: {
    required: ["landing", "catalog", "detail", "auth", "account", "dashboard"],
    excluded: [],
  },
  social: {
    required: ["landing", "auth", "dashboard", "detail", "account"],
    excluded: ["checkout"],
  },
  game: { required: ["landing", "tool"], excluded: ["dashboard", "admin", "auth", "checkout"] },
  "ai-tool": { required: ["landing", "tool", "results"], excluded: ["admin", "checkout"] },
  storefront: {
    required: ["landing", "catalog", "detail", "checkout"],
    excluded: ["admin"],
  },
};

/* ============================================================
 * Persistence / auth inference
 * ============================================================ */

const PERSISTENCE = [
  /\bsave\b/i,
  /\bhistory\b/i,
  /\baccounts?\b/i,
  /\blog\s+in\b/i,
  /\bsign\s?up\b/i,
  /\bdatabase\b/i,
  /\bmulti[-\s]?user\b/i,
  /\bstore\s+(my|their|user)\b/i,
];
const AUTH = [/\blog\s?in\b/i, /\bsign\s?(in|up)\b/i, /\bsigned[-\s]?in\b/i, /\blogged[-\s]?in\b/i, /\bmembers?\s+(area|only)\b/i, /\baccounts?\b/i, /\bauth\w*/i, /\buser\s+profiles?\b/i];

/* ============================================================
 * Product naming
 * ============================================================ */

/** Pull an explicit name out of the brief: `called X`, `named X`, quoted X. */
function extractExplicitName(brief: string): string | null {
  const m =
    brief.match(/\b(?:called|named)\s+["“']?([A-Z][\w' -]{1,28})["”']?/) ||
    brief.match(/["“']([A-Z][\w' -]{2,28})["”']\s+(?:app|site|tool|platform)/);
  return m ? m[1].trim() : null;
}

const STOP_WORDS = new Set([
  "a","an","the","build","create","make","me","my","our","for","with","and","that","this","app","application",
  "website","site","web","please","i","want","need","would","like","to","of","in","on","it","where","users",
  "user","people","can","should","simple","nice","modern","beautiful","full","new","some","their",
]);

const TYPE_LABEL: Record<ProductType, string> = {
  utility: "tool",
  "content-site": "site",
  "workflow-app": "workspace",
  marketplace: "marketplace",
  social: "community",
  game: "game",
  "ai-tool": "assistant",
  storefront: "shop",
};

/**
 * A never-blank product identity derived from the user's own words. The model
 * pass usually improves on this, but the floor must always be a real name —
 * a nameless product is how "My App" placeholders reach a user's screen.
 */
function fallbackIdentity(brief: string, type: ProductType): {
  productName: string;
  purpose: string;
  targetUser: string;
  primaryOutcome: string;
  domain: string;
} {
  const words = (brief.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []).filter((w) => !STOP_WORDS.has(w));
  const seen: string[] = [];
  for (const w of words) {
    if (!seen.includes(w)) seen.push(w);
    if (seen.length === 2) break;
  }
  const title = seen.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  const subject = seen.join(" ") || "the job at hand";
  const label = TYPE_LABEL[type];
  return {
    productName: title ? `${title} ${label[0].toUpperCase()}${label.slice(1)}` : `Petal ${label[0].toUpperCase()}${label.slice(1)}`,
    purpose: `A ${label} for ${subject}, built from the user's request: "${brief.trim().slice(0, 140)}".`,
    targetUser: `Someone who needs to handle ${subject} without extra tooling.`,
    primaryOutcome: `Complete the main job around ${subject} and see a real result.`,
    domain: subject,
  };
}

/* ============================================================
 * Workflow synthesis
 * ============================================================ */

function utilityWorkflow(spec: CalculatorSpec | null, brief: string): PrdWorkflow {
  const inputs = spec ? spec.inputs.join(", ") : "the values the tool needs";
  const outputs = spec ? spec.outputs.join(", ") : "the computed result";
  return {
    name: spec ? `Use the ${spec.productName.toLowerCase()}` : "Use the tool",
    steps: [
      { kind: "entry", description: "Land on `/` and see the tool itself above the fold, not a marketing wall." },
      { kind: "input", description: `Enter ${inputs}, with inline validation on bad or impossible values.` },
      { kind: "action", description: "Trigger the calculation — instantly on change, or via one obvious primary button." },
      { kind: "result", description: `See ${outputs}, formatted for humans and explained in one line.` },
      {
        kind: "next",
        description: spec?.extraSurfaces?.includes("content")
          ? "Continue into the explanatory content (what the result means, what happens next), or recalculate."
          : "Copy or share the result, or change an input and recalculate without a page reload.",
      },
    ],
  };
}

function genericWorkflow(type: ProductType, brief: string): PrdWorkflow {
  switch (type) {
    case "content-site":
      return {
        name: "Understand the offer and make contact",
        steps: [
          { kind: "entry", description: "Land on a hero that says what this is and who it is for in one glance." },
          { kind: "input", description: "Scan the supporting sections: what it does, proof, and pricing or offer." },
          { kind: "action", description: "Click the primary call to action." },
          { kind: "result", description: "Complete the contact/booking/waitlist form and see a real confirmation." },
          { kind: "next", description: "Explore a secondary page (about, work, or contact) via working navigation." },
        ],
      };
    case "workflow-app":
      return {
        name: "Complete the core record lifecycle",
        steps: [
          { kind: "entry", description: "Land in the working surface with real, populated data — never an empty shell." },
          { kind: "input", description: "Create a new record through a validated form." },
          { kind: "action", description: "Save it and see it appear in the list immediately." },
          { kind: "result", description: "Open its detail view, edit it, and delete it with a confirmation step." },
          { kind: "next", description: "Filter or search the list and navigate to a related record." },
        ],
      };
    case "storefront":
      return {
        name: "Find a product and reach checkout",
        steps: [
          { kind: "entry", description: "Land on a shopfront with real products visible." },
          { kind: "input", description: "Browse or filter the catalog." },
          { kind: "action", description: "Open a product and add it to the cart." },
          { kind: "result", description: "See the cart update with correct totals." },
          { kind: "next", description: "Proceed to a working checkout summary." },
        ],
      };
    case "marketplace":
      return {
        name: "Discover a listing and act on it",
        steps: [
          { kind: "entry", description: "Land on a discovery surface with real listings." },
          { kind: "input", description: "Search or filter listings." },
          { kind: "action", description: "Open a listing detail and start the primary transaction." },
          { kind: "result", description: "See a confirmation reflecting the action." },
          { kind: "next", description: "See it reflected in the user's own area." },
        ],
      };
    case "ai-tool":
      return {
        name: "Ask and receive",
        steps: [
          { kind: "entry", description: "Land on the tool with the input focused and example prompts visible." },
          { kind: "input", description: "Type a request." },
          { kind: "action", description: "Submit and see an immediate optimistic state, then streamed output." },
          { kind: "result", description: "Read the rendered result with markdown support." },
          { kind: "next", description: "Refine, copy, or start again." },
        ],
      };
    case "social":
      return {
        name: "Post and see it appear",
        steps: [
          { kind: "entry", description: "Land on a populated feed." },
          { kind: "input", description: "Compose a post." },
          { kind: "action", description: "Publish it." },
          { kind: "result", description: "See it at the top of the feed instantly." },
          { kind: "next", description: "Open a profile and interact with another item." },
        ],
      };
    case "game":
      return {
        name: "Play a round",
        steps: [
          { kind: "entry", description: "Land on the game with a clear start affordance and the rules visible." },
          { kind: "input", description: "Start a round and take an action." },
          { kind: "action", description: "The game responds immediately with visible feedback." },
          { kind: "result", description: "The round ends with a score or outcome." },
          { kind: "next", description: "Play again without reloading the page." },
        ],
      };
    default:
      return utilityWorkflow(null, brief);
  }
}

/* ============================================================
 * Acceptance synthesis
 * ============================================================ */

function buildAcceptance(args: {
  type: ProductType;
  required: PrdSurface[];
  excluded: PrdSurface[];
  formulas: PrdFormula[];
}): PrdAcceptanceCriterion[] {
  const out: PrdAcceptanceCriterion[] = [];
  for (const s of args.required) {
    out.push({
      id: `surface-${s}`,
      statement: `The ${s} surface exists and is reachable from the app's navigation.`,
      check: "surface-exists",
    });
  }
  out.push({
    id: "primary-action-visible",
    statement: "The primary action of the product is visible without scrolling on a 1280px desktop viewport.",
    check: "interaction",
    route: "/",
  });
  out.push({
    id: "primary-action-mobile",
    statement: "The primary action is fully usable at 390px wide with no horizontal scroll and ≥44px hit areas.",
    check: "responsive",
    route: "/",
  });
  out.push({
    id: "primary-workflow-completes",
    statement: "A user can complete the primary workflow end to end and see a real result.",
    check: "interaction",
    route: "/",
  });
  for (const f of args.formulas) {
    if (!f.example) continue;
    out.push({
      id: `formula-${f.id}`,
      statement: `Given ${f.example.input}, the product produces ${f.example.expected}.`,
      check: "computation",
      route: "/",
    });
  }
  for (const s of args.excluded) {
    out.push({
      id: `no-${s}`,
      statement: `No ${s} surface is present — it was not requested and is out of scope.`,
      check: "absence",
    });
  }
  out.push({
    id: "no-dead-controls",
    statement: "Every button, link, and form on every page does something real — no dead controls, no placeholder text.",
    check: "interaction",
  });
  return out;
}

/* ============================================================
 * Entry point
 * ============================================================ */

export function deterministicPrd(brief: string): Prd {
  const b = (brief || "").slice(0, 8000);
  const calc = CALCULATORS.find((c) => c.needles.some((n) => n.test(b))) ?? null;
  const detected = detectProductType(b);
  const type: ProductType = calc ? "utility" : detected.type;

  const base = SURFACES[type];
  const required = [...base.required, ...(calc?.extraSurfaces ?? [])].filter(
    (s, i, arr) => arr.indexOf(s) === i,
  );

  const needsPersistence = PERSISTENCE.some((p) => p.test(b));
  const needsAuth = AUTH.some((p) => p.test(b));

  // Persistence/auth requested explicitly pulls surfaces back in even when the
  // product type would normally exclude them. Intent always beats the default.
  const excluded = base.excluded.filter((s) => {
    if (needsAuth && (s === "auth" || s === "account")) return false;
    if (needsPersistence && s === "dashboard") return false;
    return true;
  });
  if (needsAuth && !required.includes("auth")) required.push("auth");
  // A product that is described as having a public front door gets one, even
  // when its type defaults to a signed-in shell. This is the fix for "SaaS
  // with a marketing landing page and a dashboard" shipping only the shell.
  if (/\b(landing\s*page|marketing\s+(page|site)|home\s*page|public\s+site)\b/i.test(b) && !required.includes("landing")) {
    required.unshift("landing");
  }
  if (needsPersistence && type === "utility" && !required.includes("account")) required.push("account");

  const workflow = calc ? utilityWorkflow(calc, b) : genericWorkflow(type, b);
  const formulas = calc?.formulas ?? [];

  const explicitName = extractExplicitName(b);
  const fallback = fallbackIdentity(b, type);

  const states = calc?.states ?? [
    "empty — meaningful first-run content, never a blank panel",
    "loading — skeletons, not spinners over blank pages",
    "error — plain-English message with a retry",
    "success — visible confirmation of what happened",
  ];

  return {
    version: 1,
    productName: explicitName ?? calc?.productName ?? fallback.productName,
    purpose: calc?.purpose ?? fallback.purpose,
    targetUser: calc?.targetUser ?? fallback.targetUser,
    primaryOutcome: calc?.primaryOutcome ?? fallback.primaryOutcome,
    productType: type,
    domain: calc?.domain ?? fallback.domain,
    primaryWorkflow: workflow,
    secondaryWorkflows: [],
    formulas,
    dataModel: [],
    needsPersistence,
    needsAuth,
    requiredSurfaces: required,
    excludedSurfaces: excluded,
    states,
    navigation:
      type === "workflow-app"
        ? "Persistent sidebar on desktop, drawer on mobile, consistent page header."
        : "Top navigation with a working mobile drawer. No sidebar.",
    contentTone: calc?.contentTone ?? "Specific to the domain, written for a real user. No lorem ipsum, no filler.",
    acceptance: buildAcceptance({ type, required, excluded, formulas }),
    outOfScope: [],
    source: "deterministic",
    confidence: calc ? 0.95 : detected.confidence,
  };
}
