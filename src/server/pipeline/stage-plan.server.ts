/**
 * Staged Pipeline — Stage 1: PLAN
 *
 * Asks a model to emit a file MANIFEST for an MVP, NOT code. The manifest
 * is later consumed by Stage 2 (scaffold) which generates each file in
 * parallel, isolated calls.
 *
 * CONTRACT:
 *   - Target stack is Vite + React + TS + Tailwind v4 (NOT TanStack Start).
 *     The user-app kit mounts via src/main.tsx → <App /> in src/App.tsx.
 *   - src/App.tsx is ALWAYS the root view and is ALWAYS file #1 in the
 *     plan. If the model omits it, we inject it deterministically below.
 *   - index.html and src/main.tsx are Petal-owned and must NEVER appear
 *     in the plan — the renderable-shell guard writes them.
 *   - src/styles.css is Petal-owned and must NEVER appear in the plan —
 *     the orchestrator pre-writes it from the chosen theme tokens.
 *   - src/routes/* is NEVER planned — this is not TanStack.
 *
 * Quality inputs (Phase 1 + 3 of the staged-pipeline rebuild):
 *   - appShapeBlock — rendered output of classifyAppShape(brief). Tells
 *     the planner the category + surfaces so it picks the right layout
 *     archetype (feed, marketing, dashboard, tool, game) instead of
 *     defaulting to "sidebar + dashboard" for everything.
 *   - designDirectionBlock — rendered output of pickDesignDirection().
 *     Tells the planner the vibe + typography + density so component
 *     names and counts match the aesthetic.
 *
 * Why this matters: before the fix the plan stage had a thin prompt and
 * received no shape/design context. Even when the monolithic path had
 * already computed both, the staged path threw them away. Result:
 * "sidebar + dashboard" plans for prompts that obviously wanted a feed.
 */

import { aiChatCompletions } from "@/server/ai-provider.server";
import {
  DOMAIN_COMPONENTS,
  DOMAIN_FEATURE_PACKS,
  CATEGORY_FEATURE_PACKS,
  type BusinessDomain,
  type ShapeCategory,
} from "@/lib/app-shape-classifier";

export interface PlannedFile {
  /** App-relative path, e.g. "src/App.tsx". */
  path: string;
  /** One-sentence purpose for the scaffold pass to read. */
  purpose: string;
  /** Other planned paths this file imports/depends on. */
  deps: string[];
  /** Estimated lines — used by Stage 2 to size each call. */
  est_lines: number;
}

export interface StagePlanResult {
  ok: true;
  files: PlannedFile[];
  summary: string;
}

export interface StagePlanFailure {
  ok: false;
  reason: string;
}

function buildPlanTool(maxFiles: number) {
  return {
    type: "function" as const,
    function: {
      name: "emit_plan",
      description: `Emit a file manifest for an MVP. Cap at ${maxFiles} files. Each file gets a path, a one-sentence purpose, its dependency list, and an estimated line count.`,
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "One sentence describing the app being planned.",
          },
          files: {
            type: "array",
            minItems: 1,
            maxItems: maxFiles,
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                purpose: { type: "string" },
                deps: { type: "array", items: { type: "string" } },
                est_lines: { type: "number" },
              },
              required: ["path", "purpose", "deps", "est_lines"],
              additionalProperties: false,
            },
          },
        },
        required: ["summary", "files"],
        additionalProperties: false,
      },
    },
  };
}

const SYSTEM_PROMPT = `You plan MVPs for a Vite + React + TypeScript app using Tailwind v4 and the bundled shadcn UI kit at "@/components/ui/*".
Always call emit_plan — never reply in prose.

HARD RULES:
1. src/App.tsx is ALWAYS the root view and MUST be file #1 in the plan. It renders the full MVP shell (header + primary content showing the actual feature + nav/footer where appropriate). Never a placeholder.
2. Other files are components imported by src/App.tsx (e.g. src/components/PostCard.tsx, src/components/Composer.tsx). Aim for 3–7 components total for a single-surface app, 8–14 for a business-app (marketing + product).
3. NEVER plan index.html, src/main.tsx, or src/styles.css — Petal writes those itself.
4. NEVER plan src/routes/* — this is NOT TanStack Start. Routing, if needed, lives inside src/App.tsx with simple state or react-router.
5. Skip backend wiring unless explicitly required by the brief.

LAYOUT ARCHETYPE (choose ONE, drive the file plan from it):
- feed → single-column. Composer at top + post cards stream below. Optional tag/sort chip rail. NO sidebar, NO "DashboardPage" component, NO admin panel.
- marketing → hero + 3–5 stacked sections (features, social proof, CTA) + footer. NO auth shells.
- dashboard → sidebar + main content area. ONLY use this when the user explicitly asked for a dashboard, admin tool, analytics surface, or internal tool.
- tool → centered canvas/workspace (calculator, editor, generator). Minimal chrome.
- game → full-bleed play surface + score HUD. No marketing chrome.
- content → reader layout (article list + detail), generous whitespace.
- business-app → BOTH a public marketing site AND an authenticated app shell, shipped together. Think Stripe/Linear/Notion: a customer-facing landing site that sells the product, plus a real logged-in product behind sign-up. Plan SEVEN marketing components (Navbar, Hero, Features, SocialProof/Testimonials, Pricing, Faq, Footer) AND ~4–6 app components (AuthCard, AppShell with sidebar, Dashboard with domain-specific widgets, SettingsPanel, plus 1–2 surfaces matching the domain — e.g. CRM → ContactsTable + Pipeline; fintech → Wallet + Transactions; AI startup → Workspace + UsageMeter). The Hero MUST include an eyebrow badge, a gradient text accent, a trust row, and a mocked product-visual panel — never just a centered headline with two buttons. src/App.tsx does lightweight routing between marketing and app sections (hash router, simple state, or react-router) and gates app routes behind a mock <AuthGate>. NEVER ship only the marketing site or only the dashboard for a business-app brief — both surfaces must exist in the same plan.

If you plan a "Sidebar" or "DashboardPage" component for a feed/marketing/tool/game/content brief, that is a PLANNING ERROR — pick the right archetype instead.
If you plan ONLY a dashboard (no Hero/Pricing) or ONLY a landing page (no Dashboard/AuthCard) for a business-app brief, that is a PLANNING ERROR — both surfaces are required.

Component naming must reflect the domain (PostCard, Composer, FeedFilter, ContactsTable, Pipeline), not generic chrome (Dashboard, Sidebar, MainPanel).`;

interface PlanContext {
  /**
   * Rendered output of classifyAppShape(brief). When present, the planner
   * is told the category + surfaces so it picks the right archetype.
   */
  appShapeBlock?: string;
  /**
   * Rendered output of pickDesignDirection(). When present, the planner
   * knows the vibe so component counts/names align with the aesthetic.
   */
  designDirectionBlock?: string;
  /** Hint for the LAYOUT ARCHETYPE block — when known, we tell the model directly. */
  archetypeHint?: "feed" | "marketing" | "dashboard" | "tool" | "game" | "content" | "business-app";
  /**
   * Narrow product vertical inside a business-app brief. Used to seed the
   * required component list (CRM → ContactsTable + Pipeline …) so the
   * planner can't substitute generic KPI cards.
   */
  businessDomain?: BusinessDomain;
  /**
   * Top-level shape category. Used to compute the category-level feature
   * pack (fintech → KYC + AuditLog, marketplace → Ratings + Messaging)
   * when there is no narrow businessDomain.
   */
  category?: ShapeCategory;
}

function injectRootViewIfMissing(
  plan: PlannedFile[],
  brief: string,
  archetype?: PlanContext["archetypeHint"],
): PlannedFile[] {
  // Drop forbidden paths the model may have planned despite the prompt.
  const cleaned = plan.filter(
    (f) =>
      f.path !== "index.html" &&
      f.path !== "src/main.tsx" &&
      f.path !== "src/styles.css" &&
      !f.path.startsWith("src/routes/"),
  );

  const hasRoot = cleaned.some((f) => f.path === "src/App.tsx");
  if (hasRoot) {
    // Make sure App.tsx is first so the scaffold renders it before its deps.
    const idx = cleaned.findIndex((f) => f.path === "src/App.tsx");
    if (idx > 0) {
      const [root] = cleaned.splice(idx, 1);
      cleaned.unshift(root);
    }
    return cleaned;
  }

  // Model forgot the root view. Inject it as file #1 with explicit deps on
  // every other planned component so the scaffold prompt tells it to wire
  // them up.
  const deps = cleaned.map((f) => f.path);
  const purpose = archetype === "business-app"
    ? `Root view — renders BOTH the public marketing site AND the authenticated app shell with a lightweight route switch (hash router or simple state) for: ${brief.slice(0, 140)}. Required route map: '/' → <main> stacking Navbar + Hero + Features + SocialProof + Pricing + Faq + Footer in THAT order; '/auth' → AuthCard; '/app' → AppShell with sidebar + main domain components; '/app/settings' → SettingsPanel. Gate '/app/*' behind a mock <AuthGate>. Import and wire every listed component dep. NEVER render only the dashboard or only the landing — both surfaces must mount. NEVER render the marketing surface as just a centered headline with Login/Sign-Up buttons — the Navbar and all seven marketing components must be present.`
    : `Root view — renders the full MVP shell with real domain UI for: ${brief.slice(0, 160)}. Import and use the listed component deps.`;
  const rootEntry: PlannedFile = {
    path: "src/App.tsx",
    purpose,
    deps,
    est_lines: archetype === "business-app" ? 240 : 140,
  };
  return [rootEntry, ...cleaned];
}

/**
 * Cheap sanity check: catch the "I planned a dashboard for a feed" failure
 * mode where the model ignored the archetype block and emitted Sidebar +
 * DashboardPage anyway. Returns a list of offending paths.
 */
function detectArchetypeMismatch(
  files: PlannedFile[],
  archetype: PlanContext["archetypeHint"],
): string[] {
  if (!archetype) return [];
  if (archetype === "dashboard" || archetype === "business-app") return [];
  const bannedForNonDashboard =
    /(Sidebar|Dashboard(Page|Layout)?|AdminPanel|MainPanel)\b/;
  return files
    .map((f) => f.path)
    .filter((p) => bannedForNonDashboard.test(p));
}

/**
 * For business-app, both surfaces (marketing + product) must be present.
 * Returns a reason string if either side is missing, else null.
 */
function detectBusinessAppGap(files: PlannedFile[]): "missing_both_surfaces" | "missing_marketing_surface" | "missing_app_surface" | null {
  const paths = files.map((f) => f.path).join(" ");
  const hasMarketing = /(Hero|Landing|Pricing|Features|Testimonial|Faq|FAQ|Footer|Navbar)/i.test(paths);
  const hasApp = /(Dashboard|AppShell|AuthCard|Settings|Workspace|Pipeline|Contacts|Wallet|Transactions|Inbox|Ticket|Project|Candidate|Employee|Invoice|Course|Stock|Campaign|Booking|Availability)/i.test(paths);
  if (!hasMarketing && !hasApp) return "missing_both_surfaces";
  if (!hasMarketing) return "missing_marketing_surface";
  if (!hasApp) return "missing_app_surface";
  return null;
}

// Seven-component marketing surface. Each `purpose` is composition-specific
// so Stage 2 produces a Stripe/Linear-grade landing — NOT a centered headline
// with two buttons and three plain bordered cards (the old failure mode).
const MARKETING_SYNTH: PlannedFile[] = [
  { path: "src/components/marketing/Navbar.tsx", purpose: "Sticky top navbar with backdrop-blur background (bg-background/70 backdrop-blur-md border-b). Left: small logo dot + wordmark. Center (hidden on mobile, md:flex): Product, Pricing, Customers, Docs links scrolling to section ids. Right: 'Sign in' ghost button + primary CTA button to /auth. Mobile: replace center links with a Sheet-based menu trigger. Height h-16, container mx-auto px-6.", deps: [], est_lines: 130 },
  { path: "src/components/marketing/Hero.tsx", purpose: "Marketing hero with serious composition — NOT a centered headline with two buttons. Layout: container mx-auto px-6 pt-24 pb-20 sm:pt-32 sm:pb-28. Top: small pill/badge ('New' dot + short tagline, rounded-full border bg-muted/50 text-xs px-3 py-1). Headline: two lines, text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight, ONE phrase wrapped in a span with bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent. Subhead: text-lg text-muted-foreground max-w-2xl. Dual CTA row: primary Button size='lg' → /auth, ghost Button size='lg' with ArrowRight icon. Trust row below CTAs: small text-xs text-muted-foreground 'Trusted by 2,000+ teams' + flex row of 5 muted logo-style wordmarks. Then a hero visual: a large rounded-2xl border bg-card/50 backdrop-blur p-2 shadow-2xl panel containing a mocked product dashboard chrome (top bar with 3 dots + window title, sidebar stub, content area with 2-3 stat tiles and a fake chart bars). Real domain copy specific to the brief — never 'Welcome to Our X'.", deps: [], est_lines: 220 },
  { path: "src/components/marketing/Features.tsx", purpose: "Features section. Section wrapper: py-20 sm:py-28 container mx-auto px-6 with id='product'. Section header: small uppercase eyebrow text-xs text-primary tracking-wider, h2 text-3xl sm:text-4xl font-bold tracking-tight, one-line muted subtitle. Then a bento-style 6-card grid: grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6. Each card: rounded-2xl border bg-card/50 p-6 hover:border-primary/40 transition, with a lucide icon in a rounded-lg bg-primary/10 text-primary p-2 size-10 wrapper at top, then h3 font-semibold, then text-sm text-muted-foreground description. Real domain features — pick 6 specific to the brief.", deps: [], est_lines: 160 },
  { path: "src/components/marketing/SocialProof.tsx", purpose: "Testimonials section. py-20 sm:py-28 container mx-auto px-6 with id='customers'. Section header same pattern as Features. Then a 3-card grid: grid grid-cols-1 md:grid-cols-3 gap-6. Each testimonial card: rounded-2xl border bg-card/50 p-6, with a Quote icon (lucide) top-left in text-primary/40, a 3-4 line quote (text-foreground/90), and a footer row with an Avatar (initials in bg-primary/10 text-primary rounded-full size-10) + name + role · company. Real-sounding names and roles relevant to the domain.", deps: [], est_lines: 140 },
  { path: "src/components/marketing/Pricing.tsx", purpose: "Pricing section. py-20 sm:py-28 container mx-auto px-6 with id='pricing'. Section header pattern. Three tier cards in grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto. Each card: rounded-2xl border p-8 flex flex-col, with tier name (font-semibold), price (text-4xl font-bold + /mo muted), one-line description, then a divider, then a feature checklist (Check icon from lucide in text-primary + text-sm) — 5-7 items per tier, then a Button at the bottom (mt-auto). Middle tier is 'Pro' / Most popular: add ring-2 ring-primary, a small Badge at top 'Most popular', and a solid primary Button; other tiers use variant='outline'. Real per-domain feature lines.", deps: [], est_lines: 200 },
  { path: "src/components/marketing/Faq.tsx", purpose: "FAQ section using the shadcn Accordion (import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion'). py-20 sm:py-28 container mx-auto px-6 max-w-3xl with id='faq'. Section header pattern. Then an Accordion type='single' collapsible with 6 real domain-relevant Q&A items. AccordionTrigger: text-left font-medium. AccordionContent: text-muted-foreground.", deps: [], est_lines: 130 },
  { path: "src/components/marketing/Footer.tsx", purpose: "Footer. border-t bg-card/30. Inner container mx-auto px-6 py-16. Top: grid grid-cols-2 md:grid-cols-5 gap-8. First column (md:col-span-2): logo dot + wordmark, one-line tagline (text-sm text-muted-foreground max-w-xs), then a small row of social icon buttons (Twitter, Github, Linkedin from lucide). Then 3 link columns: Product (Features, Pricing, Changelog, Roadmap), Company (About, Customers, Careers, Contact), Legal (Privacy, Terms, Security, DPA). Bottom row: border-t mt-12 pt-8 flex flex-col sm:flex-row justify-between items-center text-xs text-muted-foreground — copyright on the left, 'All systems operational' with a small green dot on the right.", deps: [], est_lines: 150 },
];

function synthAppSurfaceFor(
  domain: BusinessDomain | undefined,
  category: ShapeCategory | undefined,
): PlannedFile[] {
  const comps = (domain && DOMAIN_COMPONENTS[domain]) || ["DataTable", "DetailPanel"];
  // Petal Quality Engine v1 / Part A — also synth secondary "feature pack"
  // components so the repaired surface looks like a product, not a demo.
  const pack = domain
    ? (DOMAIN_FEATURE_PACKS[domain] ?? [])
    : (category ? (CATEGORY_FEATURE_PACKS[category] ?? []) : []);
  const out: PlannedFile[] = [
    { path: "src/components/app/AuthCard.tsx", purpose: "Linear/Stripe-grade auth surface — NOT a centered form on white. Layout: min-h-screen grid lg:grid-cols-2. Left pane (hidden on mobile, lg:flex): bg-gradient-to-br from-primary/10 via-background to-background with a logo dot + wordmark top-left, a large headline ('Welcome back' / 'Get started in seconds') text-3xl font-bold tracking-tight, a one-line muted subtitle, and a small testimonial quote card (rounded-2xl border bg-card/50 backdrop-blur p-6) at the bottom with avatar + name + role. Right pane (full-bleed on mobile): centered max-w-sm w-full mx-auto px-6 py-12 with Tabs (signin/signup) — each tab has Email Input, Password Input (with eye toggle icon), primary Button w-full, divider 'or continue with', Google + GitHub outline buttons with lucide icons, and a small 'Continue as demo' ghost link that flips an in-memory auth flag. Use shadcn Tabs, Input, Button, Label. Real domain copy.", deps: [], est_lines: 220 },
    { path: "src/components/app/AppShell.tsx", purpose: "Production-grade authenticated shell — NOT three placeholder cards. Layout: flex h-screen w-full. Sidebar (w-64 shrink-0 border-r bg-card/30, hidden on mobile, md:flex flex-col): top has logo dot + wordmark + small workspace switcher (rounded-md border bg-background px-3 py-2 with ChevronsUpDown icon); middle is a nav list — section label 'Workspace' uppercase text-xs text-muted-foreground tracking-wider px-3 mb-2, then nav items as <button> rounded-md px-3 py-2 text-sm flex items-center gap-3 with a lucide icon (size-4) + label, active state bg-accent text-accent-foreground, inactive hover:bg-accent/50; one nav item per primary domain component AND each feature-pack component, plus 'Overview' first and 'Settings' last. Bottom of sidebar: a user card (rounded-lg p-2 flex items-center gap-3) with Avatar + name + email (truncate) + small ellipsis icon. Top bar (h-14 border-b flex items-center justify-between px-6): left has mobile Sheet trigger (Menu icon, md:hidden) + breadcrumb (current section name text-sm font-medium); right has a search Input (max-w-xs with Search icon prefix, hidden on small), a Bell icon ghost Button, and an Avatar. Main: flex-1 overflow-y-auto bg-background — render <Outlet/> or the active route's component via the routing state. Mobile: sidebar collapses into a shadcn Sheet drawer triggered by the Menu button. Use semantic tokens only. NO 'coming soon' panels.", deps: [], est_lines: 260 },
    { path: "src/components/app/SettingsPanel.tsx", purpose: "Real settings surface — NOT one card with a save button. Layout: container mx-auto max-w-4xl px-6 py-10 space-y-10. Header: h1 text-2xl font-bold + muted subtitle. Then a vertical Tabs (or section list): Profile, Workspace, Notifications, Billing, Danger Zone. Each section is a card (rounded-xl border bg-card p-6 space-y-4) with a section title (font-semibold) + muted description + real form controls. Profile: Avatar with 'Change' button, Name Input, Email Input (disabled), Role Select. Workspace: Workspace name Input, slug Input, Timezone Select, Logo upload placeholder. Notifications: 4-5 Switch rows (label + muted description on the left, Switch on the right). Billing: current plan card with plan name, price, 'Manage' Button + small usage bar. Danger Zone: red-tinted card (border-destructive/40 bg-destructive/5) with 'Delete workspace' destructive Button. Each section ends with a 'Save changes' Button row. Use shadcn Input, Select, Switch, Button, Tabs, Avatar.", deps: [], est_lines: 240 },
  ];
  for (const c of comps) {
    out.push({
      path: `src/components/app/${c}.tsx`,
      purpose: `Production-grade ${domain ?? "product"} ${c} — NOT a KPI card stub. Build the ACTUAL workflow this component implies with realistic seed data (8-20 rows minimum, real-sounding names/companies/amounts tied to ${domain ?? "the domain"}). Header strip: page title (text-2xl font-bold tracking-tight) + muted subtitle on the left; right side has a filter group (Search Input with icon, Select for filter, Button variant='outline' with Filter icon) + primary action Button (with Plus icon — e.g. 'New contact', 'Add deal'). Below the header: a toolbar row with view toggles or status chips (rounded-full border px-3 py-1 text-xs, active = bg-primary text-primary-foreground). Main content matches the component type: tables use shadcn Table with sortable headers, row hover (hover:bg-muted/50), checkbox column, avatar + name + sub-line cells, status Badge, right-aligned actions with DropdownMenu (MoreHorizontal icon); pipelines/kanban use a horizontal scroll row of column cards (rounded-xl border bg-card/30 p-3 w-72 shrink-0) with column header (name + count Badge) + stacked draggable item cards; detail panels use a 2-column grid (lg:grid-cols-3) with main info card spanning 2 cols + sidebar metadata card. Always include an empty-state path (centered icon in a rounded-full bg-muted size-12, headline, muted line, CTA Button) — but render the populated state by default. Use shadcn Table, Badge, Avatar, DropdownMenu, Input, Select, Button. Mobile-first: tables become stacked cards under sm:; kanban becomes a single scrollable column. Use lucide-react icons throughout. NO 'placeholder', 'coming soon', or generic 'Item 1 / Item 2 / Item 3'.`,
      deps: [],
      est_lines: 240,
    });
  }
  for (const c of pack) {
    out.push({
      path: `src/components/app/${c}.tsx`,
      purpose: `Secondary ${domain ?? category ?? "product"} component ${c} — part of the domain feature pack that turns this screen into a product, not a demo. Build the ACTUAL workflow the component name implies with realistic seed data (e.g. ActivityTimeline = chronological event list with avatars + verbs + timestamps + filterable types; NotificationsCenter = grouped notification list with unread badges, mark-as-read, settings link; ReportsPanel = chartless-friendly KPI grid + downloadable report rows; KycPanel = stepper with document upload slots + verification status; RatingsAndReviews = star summary + paginated review cards with helpful counts; AuditLog = filterable event table with actor + action + target + ip + ts). Match the page-level header + toolbar + main-content pattern used by the core domain components. Use shadcn primitives + lucide icons + semantic tokens only. NO 'coming soon' placeholders.`,
      deps: [],
      est_lines: 220,
    });
  }
  return out;
}

/**
 * When the model returns a business-app plan that's missing a surface,
 * we DON'T retry the LLM — we synthesise the missing pieces deterministically.
 * Stage 2 will then generate the actual code for each synthesised file
 * using its `purpose` string. This is the difference between "warned"
 * (current) and "repaired" (new). Returns the patched file list.
 */
function repairBusinessAppPlan(
  files: PlannedFile[],
  gap: ReturnType<typeof detectBusinessAppGap>,
  domain: BusinessDomain | undefined,
  category: ShapeCategory | undefined,
  brief: string,
): PlannedFile[] {
  if (!gap) return files;
  const additions: PlannedFile[] = [];
  if (gap === "missing_marketing_surface" || gap === "missing_both_surfaces") {
    additions.push(...MARKETING_SYNTH);
  }
  if (gap === "missing_app_surface" || gap === "missing_both_surfaces") {
    additions.push(...synthAppSurfaceFor(domain, category));
  }
  // De-dupe by path so we never re-add something the model already had.
  const seen = new Set(files.map((f) => f.path));
  const merged = [...files];
  for (const a of additions) if (!seen.has(a.path)) merged.push(a);

  // Re-write App.tsx so wire-up actually mounts the synthesised pieces.
  const appIdx = merged.findIndex((f) => f.path === "src/App.tsx");
  if (appIdx >= 0) {
    const deps = merged.filter((f) => f.path !== "src/App.tsx").map((f) => f.path);
    merged[appIdx] = {
      ...merged[appIdx],
      deps,
      purpose: `Root view — business-app for: ${brief.slice(0, 140)}. Route map: '/' renders <main> with Navbar + Hero + Features + SocialProof + Pricing + Faq + Footer stacked in that exact order (marketing); '/auth' renders AuthCard; '/app/*' renders AppShell with sidebar + each domain component as a sub-route; '/app/settings' renders SettingsPanel. Use a hash router or simple state for routing; gate '/app/*' behind a mock <AuthGate>. Import every dep listed and ensure both marketing AND product surfaces mount. NEVER ship a marketing surface that is just a centered headline + two buttons + bordered cards — the Navbar, hero visual panel, social proof, pricing, FAQ, and footer columns MUST all render.`,
      est_lines: 260,
    };
  }
  return merged;
}


export async function runStagePlan(args: {
  brief: string;
  hasBackend: boolean;
  context?: PlanContext;
}): Promise<StagePlanResult | StagePlanFailure> {
  try {
    const ctx = args.context ?? {};
    const archetypeLine = ctx.archetypeHint
      ? `\n\nARCHETYPE FOR THIS BRIEF: **${ctx.archetypeHint}**. Pick the matching layout from the rules above and reject components that contradict it.`
      : "";
    const pack = ctx.businessDomain
      ? (DOMAIN_FEATURE_PACKS[ctx.businessDomain] ?? [])
      : (ctx.category ? (CATEGORY_FEATURE_PACKS[ctx.category] ?? []) : []);
    const domainLine = ctx.businessDomain
      ? `\n\nBUSINESS DOMAIN: **${ctx.businessDomain}**. Required core components (build ALL — generic KPI cards do NOT satisfy this list): ${DOMAIN_COMPONENTS[ctx.businessDomain].join(", ")}.${pack.length ? `\nFEATURE PACK (also required — turns the screen into a product, not a demo): ${pack.join(", ")}.` : ""}`
      : pack.length
        ? `\n\nFEATURE PACK for category **${ctx.category}** (also required alongside any core components): ${pack.join(", ")}.`
        : "";

    const contextBlocks = [
      ctx.appShapeBlock?.trim(),
      ctx.designDirectionBlock?.trim(),
    ]
      .filter(Boolean)
      .join("\n\n");

    // business-app needs more files (marketing + product + feature pack);
    // other archetypes stay at 10 to keep latency predictable.
    const maxFiles = ctx.archetypeHint === "business-app" ? 28 : 10;
    const planTool = buildPlanTool(maxFiles);

    const upstream = await aiChatCompletions({
      feature: "generate",
      body: {
        model: "google/gemini-3.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT + archetypeLine + domainLine },
          {
            role: "user",
            content:
              `Brief: ${args.brief}\n\n` +
              `Backend connected: ${args.hasBackend ? "yes" : "no"}\n\n` +
              (contextBlocks ? `${contextBlocks}\n\n` : "") +
              `Plan the MVP file manifest now (max ${maxFiles} files). Remember: src/App.tsx must be file #1, the archetype rules are HARD, and never plan index.html / src/main.tsx / src/styles.css.`,
          },
        ],
        tools: [planTool],
        tool_choice: { type: "function", function: { name: "emit_plan" } },
        max_tokens: ctx.archetypeHint === "business-app" ? 1800 : 1200,
        stream: false,
      },
      timeoutTier: "default",
      meta: { phase: "plan", promptChars: args.brief.length },
    });

    if (!upstream.ok) {
      return { ok: false, reason: `upstream_${upstream.status}` };
    }

    const json = (await upstream.json()) as {
      choices?: Array<{
        message?: { tool_calls?: Array<{ function?: { arguments?: string } }> };
      }>;
    };
    const argsStr = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argsStr) return { ok: false, reason: "no_tool_call" };

    const parsed = JSON.parse(argsStr) as { summary?: string; files?: PlannedFile[] };
    if (!parsed.files?.length) return { ok: false, reason: "empty_plan" };

    let files = injectRootViewIfMissing(parsed.files, args.brief, ctx.archetypeHint);

    // Hard-reject archetype mismatches: drop offending files so wire-up
    // doesn't ship a "Sidebar" component for a feed app. The scaffold
    // stage will still build the legitimate components.
    const mismatched = detectArchetypeMismatch(files, ctx.archetypeHint);
    if (mismatched.length > 0) {
      console.warn(
        `[stage-plan] archetype=${ctx.archetypeHint} but model planned ${mismatched.join(", ")} — dropping`,
      );
      files = files.filter((f) => !mismatched.includes(f.path));
      // Re-check the root view: dropping a dep doesn't invalidate App.tsx
      // but we want to make sure App.tsx didn't get dropped.
      if (!files.some((f) => f.path === "src/App.tsx")) {
        files = injectRootViewIfMissing(files, args.brief, ctx.archetypeHint);
      }
    }

    // business-app surface-presence repair. Previously this only warned;
    // now we synthesise the missing surface deterministically so wire-up
    // always has both halves of the product.
    if (ctx.archetypeHint === "business-app") {
      const gap = detectBusinessAppGap(files);
      if (gap) {
        console.warn(
          `[stage-plan] business-app ${gap} — repairing with domain=${ctx.businessDomain ?? "generic"}; plan before: ${files.map((f) => f.path).join(", ")}`,
        );
        files = repairBusinessAppPlan(files, gap, ctx.businessDomain, args.brief);
      }
    }


    return {
      ok: true,
      files,
      summary: parsed.summary?.trim() || "Planning your app",
    };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "plan_threw" };
  }
}
