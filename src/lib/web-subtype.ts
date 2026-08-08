/**
 * Web sub-type router.
 *
 * The `web` build target is the catch-all (landing pages, dashboards,
 * marketplaces all land here). Without a sub-classifier the model
 * defaults to whatever it feels like for a given turn, which is why a
 * "landing page for a film company" can come out app-shell-y.
 *
 * `inferWebSubtype` looks at the user's prompt and returns one of:
 *   - "marketing"  → landing/portfolio/waitlist/homepage
 *   - "app"        → dashboard/CRM/admin/SaaS tool/analytics
 *   - "fullstack"  → marketplace/platform with auth+payments+db
 *
 * Each subtype ships a HARD-CONSTRAINT addendum that the generator
 * appends to the system prompt. Pure functions, no I/O — easy to test
 * and cheap to call on every request.
 *
 * Only consulted when the resolved build target is `web`. Mobile,
 * extension, backend, and web-mobile already have their own addenda
 * in build-targets.ts and skip this step.
 */

export type WebSubtype = "marketing" | "app" | "fullstack" | "tool";

type Rule = { subtype: WebSubtype; patterns: RegExp[]; weight: number };

/**
 * Single-purpose utilities: one focused interactive thing on a public page.
 * A calculator, converter, generator, timer, quiz or checker is not a
 * dashboard and must never be routed to the app-shell prompt.
 */
const TOOL_PATTERNS: RegExp[] = [
  /\bcalculator\b/i,
  /\bcalculate[sr]?\b/i,
  /\bconverter\b/i,
  /\bconvert\s+\w+\s+to\b/i,
  /\bgenerator\b/i,
  /\b(countdown|pomodoro)?\s*timer\b/i,
  /\bstopwatch\b/i,
  /\bquiz\b/i,
  /\b(checker|validator|analyzer|estimator|planner\s+tool)\b/i,
  /\b(bmi|mortgage|loan|tax|tip|pregnancy|ovulation|due[-\s]?date|currency|unit)\s+(calculator|converter|tool)\b/i,
];

// Word-boundary phrase matchers. Order matters only for tie-breaking via
// `weight` — the highest score wins. Defaults to "app" because it's the
// safer fallback (you can always strip a sidebar; you can't conjure one).
const RULES: Rule[] = [
  // Marketing surfaces
  {
    subtype: "marketing",
    weight: 3,
    patterns: [
      /\blanding\s*page\b/i,
      /\bwaitlist\b/i,
      /\bcoming\s*soon\b/i,
      /\bportfolio\s*(site|page|website)?\b/i,
      /\bone[-\s]?pager?\b/i,
      /\bmarketing\s*(site|page|website)\b/i,
      /\bsplash\s*page\b/i,
    ],
  },
  {
    subtype: "marketing",
    weight: 2,
    patterns: [
      /\bhomepage\b/i,
      /\b(company|startup|product|agency|studio|brand)\s*(website|site|page)\b/i,
      /\b(restaurant|cafe|bakery|salon|gym|hotel|wedding|film|photography|design)\s+(landing|site|website|page)\b/i,
      /\b(personal|developer|designer|artist)\s+(site|website|portfolio)\b/i,
      /\bblog\b/i,
    ],
  },

  // Fullstack platforms — checked BEFORE "app" so marketplace beats dashboard.
  {
    subtype: "fullstack",
    weight: 4,
    patterns: [
      /\bmarketplace\b/i,
      /\bmulti[-\s]?tenant\b/i,
      /\bsocial\s+(network|platform|app)\b/i,
      /\b(two|2)[-\s]?sided\s+platform\b/i,
      /\bbuild\s+(uber|airbnb|doordash|instagram|tiktok|twitter|stripe|shopify)\b/i,
    ],
  },
  {
    subtype: "fullstack",
    weight: 2,
    patterns: [
      /\bauth(entication)?\b.*\b(payments?|stripe|checkout|billing)\b/i,
      /\b(payments?|stripe|checkout|billing)\b.*\bauth(entication)?\b/i,
      /\bfintech\s+(app|platform|product)?\b/i,
      /\b(saas|b2c|b2b)\s+platform\b/i,
    ],
  },

  // Web app / dashboard
  {
    subtype: "app",
    weight: 3,
    patterns: [
      /\bdashboard\b/i,
      /\b(admin|control)\s*(panel|console)\b/i,
      /\bCRM\b/,
      /\bERP\b/,
      /\b(saas|b2b)\s*(tool|app|product)\b/i,
      /\banalytics\s+(platform|app|tool)\b/i,
      /\binternal\s+tool\b/i,
      /\bback[-\s]?office\b/i,
    ],
  },
  {
    subtype: "app",
    weight: 2,
    patterns: [
      /\b(todo|task|project|inventory|booking|appointment|invoice)\s*(app|manager|tracker|system)\b/i,
      /\b(kanban|crud)\b/i,
      /\bteam\s+(workspace|hub)\b/i,
    ],
  },
];

export function inferWebSubtype(prompt: string): WebSubtype {
  if (!prompt) return "app";
  const text = prompt.slice(0, 4000); // bound work
  // Single-purpose utilities are their own shape. They used to score 0 on
  // every rule and fall through to `app`, which forbids a public home page —
  // that is exactly how "a pregnancy calculator" shipped as a dashboard.
  if (TOOL_PATTERNS.some((re) => re.test(text)) && !/\bdashboard\b|\badmin\b|\bCRM\b/i.test(text)) {
    return "tool";
  }
  const scores: Record<WebSubtype, number> = { marketing: 0, app: 0, fullstack: 0, tool: 0 };
  for (const rule of RULES) {
    for (const re of rule.patterns) {
      if (re.test(text)) scores[rule.subtype] += rule.weight;
    }
  }
  // Compare scores rather than short-circuiting on fullstack. The old rule was
  // `if (scores.fullstack >= 2) return "fullstack"` checked FIRST, so "landing
  // page for a fintech" (marketing 3, fullstack 2) returned fullstack — and the
  // fullstack addendum mandates a dashboard-first "/" with no marketing home.
  // The user asked for a landing page and got an app shell.
  //
  // Fullstack still wins ties against app (it is a superset of dashboard), but
  // an explicitly stronger marketing signal now wins outright.
  if (scores.marketing >= 2 && scores.marketing > scores.fullstack && scores.marketing > scores.app) {
    return "marketing";
  }
  if (scores.fullstack >= 2) return "fullstack";
  if (scores.marketing > scores.app && scores.marketing >= 2) return "marketing";
  if (scores.app > 0) return "app";
  if (scores.marketing > 0) return "marketing";
  return "app";

}

const MARKETING_ADDENDUM = [
  "### Web sub-type (HARD CONSTRAINT): Marketing website",
  "The user wants a marketing surface (landing page / portfolio / homepage / waitlist), NOT an app.",
  "",
  "MUST include — in this order, as full-bleed sections on the home route:",
  "  1. Hero: oversized editorial headline, supporting line, ONE primary CTA + one secondary. Strong focal visual (hero image or signature motion).",
  "  2. Social proof or logo strip (optional but encouraged).",
  "  3. Feature/benefit sections — alternating layouts, NEVER three identical centered cards.",
  "  4. Showcase / testimonials / case studies.",
  "  5. Pricing OR call-to-action band.",
  "  6. FAQ (accordion).",
  "  7. Footer with nav + socials.",
  "",
  "MUST NOT include: sidebar navigation, auth shells, sign-in/sign-up routes, dashboard layouts, data tables, CRUD forms, `_authenticated` route folders, or anything that reads as an app shell. Do not scaffold Supabase auth UI.",
  "",
  "Design: desktop-first responsive, generous whitespace, premium typography pair (Plus Jakarta Sans / Space Grotesk / Geist / Instrument Serif + a refined body), gradients + motion on hero. Aim for Linear / Stripe / Framer / Raycast quality.",
  "",
  "Routing: create separate routes for shareable sections (about, pricing, contact, work, blog) — each with its own head() title + og: tags. NEVER put everything on `/` with hash anchors.",
].join("\n");

const APP_ADDENDUM = [
  "### Web sub-type (HARD CONSTRAINT): Web application",
  "The user wants a working app, NOT a marketing page.",
  "",
  "MUST include:",
  "  - App shell with persistent left sidebar (collapsible) + top bar. Use the existing UI kit primitives.",
  "  - Routes structured as workspace areas: `/dashboard`, `/settings`, plus the app's domain routes (e.g. `/orders`, `/customers`). NO marketing home — `/` IS the dashboard.",
  "  - Real data UI: tables, cards with metrics, forms, empty states, loading skeletons.",
  "  - Compact spacing, utility-first layout, consistent header pattern on every page.",
  "",
  "MUST NOT include: giant hero section on `/`, marketing-style testimonials/pricing/FAQ blocks, scroll-driven landing animations. This is a tool, not a brochure.",
  "",
  "If the app needs accounts, wire the existing backend kit's auth (`useAuth`, `AuthProvider`) — never roll your own. If no backend is attached, mock data in a typed `src/lib/mock-data.ts` so the UI is fully populated on first render.",
].join("\n");

const FULLSTACK_ADDENDUM = [
  APP_ADDENDUM,
  "",
  "### Plus (fullstack platform)",
  "The user is building a platform with multiple actors (customers + operators + admins) or a marketplace.",
  "",
  "MUST include:",
  "  - Auth from day one (`AuthProvider`, protected routes under `_authenticated/`).",
  "  - A user-role model — at minimum `user` vs `admin`. Use a separate `user_roles` table and `has_role()` security-definer function for RLS; NEVER store roles on the profile/users table.",
  "  - A clear split between the customer-facing surface and the admin surface (separate route trees).",
  "  - At least one transactional flow scaffolded end-to-end (create-on-the-customer-side → visible-on-the-admin-side).",
  "",
  "When the prompt names payments, end your summary with a fenced `INTEGRATION:` block recommending Stripe — don't try to wire it inline.",
].join("\n");

export function getWebSubtypeAddendum(subtype: WebSubtype): string {
  switch (subtype) {
    case "marketing":
      return MARKETING_ADDENDUM;
    case "fullstack":
      return FULLSTACK_ADDENDUM;
    case "app":
    default:
      return APP_ADDENDUM;
  }
}

/* ------------------- Defect C: shape reconciliation ------------------- */

/**
 * `inferWebSubtype` (keyword rules) and `classifyAppShape` (surface rules)
 * used to run on two independent signal tables, so they could disagree —
 * "Airbnb clone" scored `fullstack` in one and a landing-only generic
 * shape in the other, and the planner got contradictory instructions.
 *
 * `resolveWebSubtype` is the single entry point: it runs both and
 * reconciles them with explicit precedence.
 *
 *   1. An explicit marketing ask always wins ("landing page for a fintech"
 *      is a landing page, full stop).
 *   2. Otherwise, if the predicted shape needs auth plus an operator or
 *      transactional surface, the brief is fullstack even when the prompt
 *      never used a fullstack keyword. An admin surface alone is not
 *      enough — internal tools stay app-shaped.
 *   3. Otherwise, a landing-only shape in a brochure-ish category demotes
 *      a weak `app` guess to `marketing`.
 */
const BROCHURE_CATEGORIES = new Set([
  "content",
  "creator",
  "local-business",
  "consultancy",
  "restaurant",
  "newsletter",
  "fitness",
]);

const PLATFORM_CATEGORIES = new Set([
  "marketplace",
  "social",
  "ecommerce",
  "fintech",
  "crypto",
  "booking",
  "messaging",
  "real-estate",
]);

export type ResolvedWebSubtype = {
  subtype: WebSubtype;
  /** Raw keyword-rule guess, before reconciliation. */
  keywordSubtype: WebSubtype;
  /** Why the final value differs from the keyword guess (if it does). */
  reason: string;
};

export function resolveWebSubtype(
  prompt: string,
  shape: {
    category: string;
    surfaces: string[];
    confidence: number;
  },
): ResolvedWebSubtype {
  const keywordSubtype = inferWebSubtype(prompt);
  const trusted = shape.confidence >= 0.4;
  const has = (s: string) => shape.surfaces.includes(s);

  if (keywordSubtype === "marketing") {
    return {
      subtype: "marketing",
      keywordSubtype,
      reason: "explicit marketing ask wins over predicted shape",
    };
  }

  if (
    trusted &&
    has("auth") &&
    (PLATFORM_CATEGORIES.has(shape.category) ||
      // an admin surface only implies "platform" when there is also a
      // customer-side transactional surface — otherwise it is an internal tool
      (has("admin") && (has("checkout") || has("public-detail") || has("messages"))))
  ) {
    return {
      subtype: "fullstack",
      keywordSubtype,
      reason:
        keywordSubtype === "fullstack"
          ? "keyword and shape agree on a multi-actor platform"
          : `shape predicts a multi-actor platform (${shape.category})`,
    };
  }

  if (
    keywordSubtype === "app" &&
    trusted &&
    BROCHURE_CATEGORIES.has(shape.category) &&
    !has("dashboard") &&
    !has("admin")
  ) {
    return {
      subtype: "marketing",
      keywordSubtype,
      reason: `shape is a brochure surface (${shape.category}) with no dashboard`,
    };
  }

  return { subtype: keywordSubtype, keywordSubtype, reason: "keyword rules only" };
}
