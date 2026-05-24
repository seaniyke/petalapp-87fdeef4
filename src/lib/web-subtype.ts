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

export type WebSubtype = "marketing" | "app" | "fullstack";

type Rule = { subtype: WebSubtype; patterns: RegExp[]; weight: number };

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
  const scores: Record<WebSubtype, number> = { marketing: 0, app: 0, fullstack: 0 };
  for (const rule of RULES) {
    for (const re of rule.patterns) {
      if (re.test(text)) scores[rule.subtype] += rule.weight;
    }
  }
  // Fullstack signals dominate if present at all (marketplace beats dashboard
  // even if both fire, because fullstack IS a superset of dashboard).
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
