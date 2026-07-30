/**
 * Dynamic system-prompt snippets (Tier 2 reliability).
 *
 * The base SYSTEM_PROMPT_INITIAL / SYSTEM_PROMPT_PATCH stays small. We
 * APPEND topic-specific reinforcement blocks that include the actual kit
 * component signatures the model needs for *this* turn — instead of
 * shoving all 50 components into every prompt. This keeps prompt size
 * down, raises adherence (rules buried under 200 lines get ignored),
 * and lets us pin version-specific snippets without bloating every call.
 *
 * Strategy: keyword-match the latest user turn (+ recent history), and
 * append concise reinforcement blocks for matched topics. Cap at a
 * generous N matches (most topics are independent) but always include
 * the "kit-core" baseline so the model knows the always-needed
 * primitives (Button/Card/Input/etc.) on every turn.
 */

import { renderKitManifestBlock } from "./kit-manifest.server";

export type DynamicSnippetKey =
  | "kitCore"
  | "verifyBeforeDone"
  | "fileBudget"
  | "charts"
  | "forms"
  | "datetime"
  | "tables"
  | "router"
  | "auth"
  | "noBackendGate"
  | "images"
  | "tailwindv4"
  | "toast"
  | "layout"
  | "overlays"
  | "navigation"
  | "feedback"
  | "sections"
  | "multiPage"
  | "mobileApp"
  | "navbarBrand"
  | "mobileNative"
  | "fullstackFeature"
  | "fileUpload"
  | "webhook"
  | "cronJob"
  | "payments"
  | "businessApp"
  | "designFloor"
  | "interactivity"
  | "contentDepth"
  | "polishStates"
  | "dashboardCraft"
  | "perRouteSEO"
  | "mobileCraft"
  | "backendCraft"
  | "chromeExtensionCraft";

interface SnippetDef {
  /** Substrings that trigger this snippet (lowercased match against prompt). */
  triggers: RegExp | "always";
  /** Reinforcement text appended to the system prompt. */
  body: string;
}

const SNIPPETS: Record<DynamicSnippetKey, SnippetDef> = {
  // Always-on baseline. Replaced at injection time with the auto-derived
  // kit manifest (see renderKitManifestBlock) so new primitives become
  // visible to the model the moment they ship in scaffold-kit.ts. The
  // body here is a placeholder that gets swapped in pickDynamicSnippets.
  kitCore: {
    triggers: "always",
    body: "__KIT_MANIFEST_PLACEHOLDER__",
  },
  // Always-on. Pushes the model to be thorough rather than fast: do the
  // mental walk-through BEFORE writing the recap, and never claim work is
  // "done" if any obvious gap remains. Targeted at the verifier-pass-rate
  // gap (~66% → 85%) and the "Petal said it's done but it's not" UX bug.
  verifyBeforeDone: {
    triggers: "always",
    body: `\n\n[Reinforcement — Verify before claiming done]
Before you emit the recap (the past-tense "I added / wired up / shipped" sentence the user reads), mentally walk the change end-to-end:
1. Every NEW import resolves to a file you just wrote OR a package already in package.json. No imports of files you forgot to create. No npm packages you didn't install.
2. Every NEW route is reachable: linked from somewhere the user can click, AND its file actually exists at the path the route claims.
3. Every NEW table has RLS enabled in the same migration AND at least one policy that lets the intended user read/write it. No "I created the table" without policies.
4. Every NEW form has BOTH a submit handler AND a visible success/error state. No dead buttons.
5. Every state change the user requested is observable in the UI — not just stored in state.
If ANY of these is missing, FIX IT in this same turn instead of writing the recap. The recap must describe what is actually true after this turn lands. "I added a profiles page" must mean the page renders, is linked, and shows real data — not just that a file was created.
Speed is not a virtue here. A turn that takes 10s longer but ships working code is worth far more than a turn that streams fast and leaves the user with broken links.

JSX correctness — prevents the most common runtime crash (React error #31 "objects are not valid as a React child", object with keys {$$typeof, render, displayName}):
- A component is NEVER a valid React child by itself. Write \`<Icon />\`, never \`{Icon}\`. Lucide icons and any \`forwardRef\` component are objects at the value level; React throws #31 if you drop one into JSX.
- Slots typed as \`ReactNode\` / \`children\` / \`label\` / \`title\` / \`description\` / \`heading\` / \`cta\` accept RENDERED elements (strings, numbers, \`<Foo />\`), NOT component references. Only props explicitly typed as a component (e.g. \`icon: LucideIcon\` on kit blocks like \`<EmptyState icon={Inbox} />\` or \`<FeaturesGrid3 items={[{ icon: Film }]} />\`) accept a bare component value.
- When in doubt, render it: \`label: <><Icon className="h-4 w-4" /> Save</>\` — not \`label: Icon\`.`,
  },
  // Fires on multi-section / landing / dashboard / page-shaped requests —
  // the exact turns that historically blew past the 180-line cap and got
  // reverted by the file-budget gate. Reinforces the split-into-files
  // pattern WITH a concrete example so the model has a template to follow.
  fileBudget: {
    triggers:
      /\b(landing|landing page|home ?page|dashboard|marketing site|portfolio|saas|product page|pricing page|about page|multi[- ]?page|site|website|several pages?|full app|complete app|app from scratch|build me an? app)\b/i,
    body: `\n\n[Reinforcement — Split into small files]
This turn looks like a multi-section page. The server enforces a hard 180-line / 6 KB cap per file (>280 lines is auto-reverted). To stay under it:
- Build the page as a SHELL that composes sub-components — never a single 300-line file.
- Canonical landing-page split (mirror this structure):
    src/components/Hero.tsx
    src/components/Features.tsx
    src/components/Testimonials.tsx   (if asked)
    src/components/Pricing.tsx        (if asked)
    src/components/CTA.tsx
    src/components/FooterSection.tsx
  Then src/App.tsx (or src/pages/Home.tsx) is just:
    <Container><Hero /><Features /><CTA /><FooterSection /></Container>
- Each sub-component owns its own copy/data — do not pass props down for purely-presentational content.
- The MOMENT a file you are writing crosses ~120 lines, stop and extract the next section into its own file before continuing.`,
  },
  layout: {
    triggers:
      /\b(layout|page|section|hero|landing|grid|stack|inline|container|sidebar|header|footer|two[- ]column|split|columns?)\b/i,
    body: `\n\n[Reinforcement — Layout primitives]
- <Container size="sm|md|lg|xl|full"> — outermost wrapper for every page section (default "lg").
- <Stack gap={4} align="start|center|end|stretch" justify="..."> — vertical columns. <Inline gap={2} align wrap> — horizontal rows. Use these instead of writing flex/gap utility chains by hand.
- <Grid preset="stats|kpis|dashboard|cards|features|pricing|split|gallery"> for instant dashboard layouts. Or compose: <Grid cols={1} sm={2} md={3} lg={4} gap={6}>. Allowed cols: 1, 2, 3, 4, 6, 12.
Read "src/components/examples/LAYOUT.md" before laying out any new page.`,
  },
  overlays: {
    triggers: /\b(modal|dialog|drawer|sheet|popover|tooltip|side panel|bottom sheet|overlay)\b/i,
    body: `\n\n[Reinforcement — Overlays]
- <Dialog>, <DialogTrigger asChild>, <DialogContent>, <DialogHeader>, <DialogTitle>, <DialogDescription>, <DialogFooter> — center modal.
- <Sheet>, <SheetTrigger asChild>, <SheetContent side="top|right|bottom|left">, <SheetHeader>, <SheetTitle>, <SheetDescription>, <SheetFooter> — desktop side panel.
- <Drawer open onOpenChange>, <DrawerTrigger asChild>, <DrawerClose asChild>, <DrawerContent>, <DrawerHeader>, <DrawerTitle>, <DrawerDescription>, <DrawerFooter> — bottom-anchored mobile sheet with handle.
- <Popover>, <PopoverTrigger asChild>, <PopoverContent align="start|center|end">.
- <Tooltip content side="top|bottom|left|right">.
NEVER hand-roll overlays with fixed positioning.`,
  },
  navigation: {
    triggers: /\b(tabs|accordion|menu|dropdown|nav|navigation|breadcrumb)\b/i,
    body: `\n\n[Reinforcement — Navigation primitives]
- <Tabs defaultValue>, <TabsList>, <TabsTrigger value>, <TabsContent value>.
- <Accordion type="single|multiple" defaultValue>, <AccordionItem value>, <AccordionTrigger>, <AccordionContent>.
- <DropdownMenu>, <DropdownMenuTrigger asChild>, <DropdownMenuContent>, <DropdownMenuItem onSelect>, <DropdownMenuLabel>, <DropdownMenuSeparator>.
- <ScrollArea> for fixed-height scrollable regions.`,
  },
  feedback: {
    triggers: /\b(progress|loading|spinner|status|busy|skeleton|placeholder)\b/i,
    body: `\n\n[Reinforcement — Feedback primitives]
- <Progress value={0..100}> — determinate bar.
- <Skeleton> — loading placeholder shape.
- <Switch checked onChange>, <Checkbox checked onChange>, <Slider min max step value onChange>, <RadioGroup value onValueChange>/<RadioGroupItem value>.
- <EmptyState icon={Inbox} title description action> — use for any zero-data list / table / panel. NEVER ship a bare "Nothing here yet."`,
  },
  // Fires on landing/marketing/page-shaped requests. Pushes the model toward
  // composing sections from "@/components/blocks/*" instead of inventing
  // section layouts from scratch — which is the root cause of "every Petal
  // site looks the same" (LLMs default to centered hero + 3-card grid).
  sections: {
    triggers:
      /\b(landing|landing page|home ?page|marketing site|hero|features?|testimonials?|pricing|faq|call to action|cta|footer|nav|navbar|header|portfolio|agency|product page|saas|about page|blog|stats|kpi)\b/i,
    body: `\n\n[Reinforcement — Section blocks (the look-different fix)]
Compose pages by picking ONE variant per section from "@/components/blocks/*". Do NOT hand-roll a hero, feature grid, pricing card, FAQ, CTA, footer, or nav from scratch — pick a block, theme it via className.

Available section blocks:
- Nav: <NavBar>, <NavWithCta>, <NavWithSearch>
- Hero: <HeroCentered>, <HeroSplitImage>, <HeroEditorial>
- Logos: <LogosGrid>, <LogosMarquee>
- Features: <FeaturesGrid3>, <FeaturesBento>, <FeaturesAlternatingRows>
- Stats: <StatsBand>, <StatsGrid>, <StatsWithChart>
- Testimonials: <TestimonialsCards>, <TestimonialsMarquee>, <TestimonialsQuoteHero>
- Pricing: <PricingSingleProduct> (3-tier and comparison table examples in examples-pack)
- FAQ: <FaqAccordion>, <FaqTwoColumn>
- CTA: <CtaCentered>, <CtaSplit>, <CtaGradientBand>
- Footer: <FooterColumns>, <FooterMinimal>, <FooterNewsletter>

Exact data prop names for blocks that render lists:
- <TestimonialsCards items={[{ quote, name, role }]} /> (alias accepted: testimonials)
- <LogosMarquee logos={[{ name, src }]} /> or logos={["/logo.svg"]}
- <PricingTable tiers={[{ name, price, features, cta: { label, href } }]} />
- <FaqAccordion items={[{ q, a }]} /> (aliases accepted: faqs with question/answer)
- <FeaturesGrid3 items={[{ icon: Film, title, description }]} />
- <StatsBand items={[{ label, value }]} />

Reference page assemblies — READ ONE before composing a similar page:
- src/components/examples/landing-saas-product.tsx — SaaS / dev tools / B2B
- src/components/examples/landing-editorial-portfolio.tsx — agency / studio / portfolio
- src/components/examples/landing-ecommerce-single-product.tsx — D2C / lifetime deal / single SKU
- src/components/examples/landing-agency-services.tsx — services firm
- src/components/examples/app-shell-with-sidebar.tsx — authenticated app interior
- src/components/examples/blog-index.tsx + blog-post-detail.tsx — content / writing site

Composition rules — this is the difference between forgettable and memorable:
1. MIX variants across a single page. Do NOT use all "centered" variants together. Pair an editorial hero with alternating-rows features; pair a split-image hero with a bento grid.
2. Match variants to the Design Direction vibe:
   - editorial / brutalist / agency / portfolio → NavBar + HeroEditorial + FeaturesAlternatingRows + TestimonialsQuoteHero + CtaSplit + FooterMinimal
   - playful / maximalist / consumer launch → NavWithCta + HeroCentered (GradientBlob) + FeaturesBento + TestimonialsMarquee + CtaGradientBand + FooterNewsletter
   - SaaS product / dev tools → NavWithCta + HeroSplitImage + LogosMarquee + FeaturesBento + StatsBand + TestimonialsCards + PricingSingleProduct + FaqAccordion + CtaCentered + FooterColumns
   - docs / dashboard / app interior → NavWithSearch + content + EmptyState
3. Supporting atoms for spaces between blocks: <Section eyebrow title description>, <Marquee>, <Stat>, <Timeline>, <Rating>, <FeatureIcon>, <GradientBlob>/<GradientText>, <Prose>, <Divider label>, <EmptyState>.
4. Each block accepts \`className\`. Sharper corners → override rounded-2xl. Different type → override in styles.css and blocks inherit.
5. NEVER reinvent a section the kit already provides. If you're writing \`<section><div className="grid grid-cols-3">…three cards…</div></section>\`, stop and use <FeaturesGrid3>. If you're writing a sticky <header> with mobile toggle, use <NavWithCta>. If you're writing a footer with link columns, use <FooterColumns>.`,
  },
  // Fires on landing/marketing/site requests. The default failure mode for
  // AI builders is "stuff everything onto index.tsx with hash anchors" —
  // which kills SSR per-page metadata, makes deep links unshareable, and
  // teaches users that Petal only does one-pagers. The generated Vite app's
  // React Router setup makes proper multi-page routing straightforward; this tells
  // the model to USE it and to TELL the user it did.
  multiPage: {
    triggers:
      /\b(site|website|landing|marketing|portfolio|agency|consultancy|saas|studio|business|brand|services|about|pricing|contact|blog|faq|case stud|product page)\b/i,
    body: `\n\n[Reinforcement — Prefer real pages over one long scroll]
If the brief implies multiple sections that could each stand alone (Services, About, Contact, Pricing, Blog, FAQ, Case Studies, Portfolio, Team, Careers), create separate page components under src/pages/ and register each path in the EXISTING React Router <Routes> tree in src/App.tsx — not as <section id="..."> blocks on one page with hash-anchor nav.

Why this matters (don't skip):
- Each route gets its own title and description — hash anchors all share the home page metadata and look identical when shared.
- Deep links like /pricing or /case-studies/$slug actually work — users can bookmark and share them.
- Adding a new page later becomes "create one file" instead of "refactor a 600-line index".

Default decomposition for marketing/business sites:
- src/pages/Home.tsx — home (hero + brief highlights + CTA only; do NOT cram every section here)
- src/pages/About.tsx
- src/pages/Services.tsx (or Features.tsx for product sites)
- src/pages/Pricing.tsx (when relevant)
- src/pages/Contact.tsx
- src/pages/Blog.tsx + src/pages/BlogPost.tsx (when blog requested)
- src/App.tsx — the single existing <Router>/<Routes> tree that registers all paths

Each page MUST set route-specific title and description metadata when it renders. Do NOT copy the home page metadata into child pages.

Hash anchors (#section) are allowed ONLY for in-page scrolling within a single long page (e.g. a TOC inside a docs page). They are NEVER the primary cross-section nav.

In your chat reply: when you scaffold multiple pages, briefly tell the user which pages were created (e.g. "I built /, /about, /services, /pricing, and /contact — say the word and I'll add a /blog or /faq page too"). This teaches users that Petal builds real multi-page sites, not one-pagers.`,
  },
  // Mobile-app intent. Petal wraps the web app in a Capacitor shell (hidden
  // from the user) and offloads native builds to a remote runner. The model
  // should NOT add Capacitor/RN imports speculatively, and should NOT promise
  // App Store publishing in code — that lives in the MobileAppPanel UI flow,
  // gated behind a paid plan. Instead: confirm the intent in plain language
  // and tell the user to click "Set it up" on the chip below the reply.
  mobileApp: {
    triggers:
      /\b(mobile app|native app|ios app|android app|app store|play store|push notif|testflight|apk|ipa|aab|capacitor|react native|wrap (?:as|in)(?: a)? (?:mobile|native) app|turn (?:this|it) into (?:a )?(?:mobile|native|phone) app)\b/i,
    body: `\n\n[Reinforcement — Mobile app requests]
If the user asks for a real mobile app (App Store / Play Store presence, push notifications, "install on my phone", signed builds), DO NOT:
- Install @capacitor/* or react-native packages on your own.
- Scaffold android/ or ios/ folders.
- Promise that "I shipped it to the App Store" — you didn't.

Instead:
- Confirm in plain language that Petal can wrap this app for iOS + Android (cloud builds, no Mac needed).
- Tell the user to click "Set it up" on the suggestion chip that will appear under your reply — that's where the real flow lives (bundle id, signing, build queue).
- Continue making the WEB app excellent in this turn (responsive layout, large tap targets ≥44px, no hover-only affordances, viewport meta in head). A great responsive web app IS the mobile app — Capacitor is just the shell.

Why: native shell setup (signing keys, bundle ids, App Store Connect API) is paid-plan-gated infrastructure, not a code change. Trying to do it inline produces broken installs and confused users.`,
  },
  charts: {
    triggers: /\b(chart|graph|bar chart|line chart|area chart|analytics dashboard|kpi|metric)\b/i,
    body: `\n\n[Reinforcement — Charts]
The kit ships <LineChart>, <AreaChart>, <BarChart>, <ChartContainer> from "@/components/ui/chart". Pass data as { x, y } arrays and color={1..5}. NEVER import recharts, victory, or chart.js. NEVER hand-roll SVG bars.
Example:
  import { BarChart } from "@/components/ui/chart";
  <BarChart data={[{x:"Mon", y:12}, {x:"Tue", y:18}]} color={2} />`,
  },
  forms: {
    triggers:
      /\b(form|sign ?up|sign ?in|login|register|contact form|onboarding|wizard|multi-step|input field|validation)\b/i,
    body: `\n\n[Reinforcement — Forms]
Use the kit form helper, NEVER scattered useState for field values:
  import { useForm, Form, FormField } from "@/components/ui/form";
  const form = useForm({ defaults: { email: "" }, validate: v => ({ email: !v.email && "Required" }), onSubmit: async v => {...} });
  <Form {...form}><FormField name="email" label="Email"><Input /></FormField></Form>
For arrays/async validation, graduate to react-hook-form (kit does NOT include it by default — add to package.json).
Also available: <Select options={[{label,value}]} placeholder onChange>, <Combobox options={[{label,value}]} value onChange placeholder searchPlaceholder emptyText> (use for 5+ options instead of styled <select>).`,
  },
  datetime: {
    triggers:
      /\b(date picker|date input|calendar|appointment|booking|schedule|deadline|due date)\b/i,
    body: `\n\n[Reinforcement — Date / Calendar]
NEVER use <input type="date">. Use the kit's <DatePicker value onChange placeholder> from "@/components/ui/date-picker". For raw inline month grids use <Calendar mode="single|range" selected onSelect>.`,
  },
  tables: {
    triggers: /\b(table|data grid|list view|users? list|invoices?|orders?|spreadsheet|rows? of)\b/i,
    body: `\n\n[Reinforcement — Tables]
Use <Table>/<TableHeader>/<TableBody>/<TableRow>/<TableHead>/<TableCell>/<TableFooter>/<TableCaption> from "@/components/ui/table". For interactive features (sorting, filtering, pagination) wrap with hand-rolled state — the kit does NOT bundle tanstack-table. Reference: "src/components/examples/table-paginated.tsx".`,
  },
  router: {
    triggers:
      /\b(multi-?page|pages?|route|navigation|nav bar|menu link|landing.*about|home.*pricing|several screens)\b/i,
    body: `\n\n[Reinforcement — Routing]
Multi-page apps MUST use "@/components/ui/router" (re-exports react-router-dom, including Router/Routes/Route and RouterProvider/createBrowserRouter/RouteObject). Prefer <Router><Routes><Route element={<Layout />}><Route path="/" element={<Home />} />…</Route></Routes></Router> in src/App.tsx, put pages in src/pages/<Name>.tsx. NEVER import from "react-router-dom" directly. NEVER use useState for "current page". NEVER use <a href="/x"> for in-app links — use <Link to="/x">.
PAGE EXPORTS: prefer plain named exports + eager imports. React.lazy(() => import("@/pages/X")) only works if X also has \`export default\` — otherwise crashes at render with React error #306.`,
  },
  auth: {
    triggers:
      /\b(auth|login|sign ?up|sign ?in|password|otp|magic link|user account|protected route)\b/i,
    body: `\n\n[Reinforcement — Auth (only if backend is connected)]
Use ONLY the helpers exported from "@/integrations/backend/auth": useAuth(), signUpWithPassword, signInWithPassword, signInWithOtp, verifyOtp, verifySignupOtp, resendSignupOtp, resetPasswordForEmail, updatePassword, signOut, signInWithGoogle. After signUpWithPassword, verify with verifySignupOtp (NOT verifyOtp). For Google / "Continue with Google" / social login, call \`signInWithGoogle()\` from useAuth() — it returns \`{ error }\` and redirects the browser. NEVER call supabase.auth.signInWithOAuth directly. NEVER call supabase.auth.* directly. NEVER import from "@supabase/supabase-js". Read "src/components/examples/BACKEND.md" for full reference.`,
  },
  // Fires when the user asked for a data-shaped feature AND a backend is
  // already connected. Teaches the complete vertical-slice pattern in one
  // block so a single turn produces working CRUD instead of half-wired
  // queries against hallucinated tables. Pairs with the optional schema
  // injection (see renderSchemaBlock) which lists real table names.
  fullstackFeature: {
    triggers:
      /\b(crud|create.*read|todo|notes?|posts?|comments?|orders?|tasks?|messages?|chat|projects?|listings?|reviews?|reservations?|bookings?|appointments?|tickets?|invoices?|customers?|leads?|likes?|favorites?|bookmarks?|follows?|threads?|votes?|polls?|saved items?|wish ?list|cart|cms|dashboard.*(data|records|rows)|admin panel|build .* (app|tool|tracker|manager))\b/i,
    body: `\n\n[Reinforcement — Full-stack feature pattern]
A backend IS connected. When the user asks for a data feature (todo list, comments, bookings, etc.), you MUST ship a complete vertical slice in ONE turn — not a half-wired UI.

A complete slice = four coordinated pieces:

1. MIGRATION (end your summary with a fenced \`MIGRATION:\` sql block — the user runs it):
   - \`CREATE TABLE public.<name> (id uuid primary key default gen_random_uuid(), user_id uuid not null, ...domain columns..., created_at timestamptz not null default now())\`
   - \`GRANT SELECT, INSERT, UPDATE, DELETE ON public.<name> TO authenticated;\` and \`GRANT ALL ON public.<name> TO service_role;\` (add \`GRANT SELECT ... TO anon\` ONLY if rows should be world-readable)
   - \`ALTER TABLE public.<name> ENABLE ROW LEVEL SECURITY;\`
   - At least ONE \`CREATE POLICY\` scoped to \`auth.uid() = user_id\` (or \`true\` for genuinely public rows). Missing any of GRANT / RLS / POLICY means the app cannot read the table at all — it's a hard failure, not a polish item.

2. TYPED CLIENT QUERIES via the existing helpers:
   - \`import { supabase } from "@/integrations/backend/client"\`
   - All inserts MUST set \`user_id\` from \`useAuth().user?.id\` so the RLS policy lets the row through.
   - Wrap every \`.select / .insert / .update / .delete\` in try/catch with a toast on error and an optimistic local update.

3. AUTH-GATED ROUTE — if the data is per-user, render a sign-in CTA when \`useAuth().user\` is null instead of an empty list. Never expose a write form to an unauthenticated user. Public reads stay open.

4. LIVE UX:
   - Loading skeletons (not blank screens) while the first fetch resolves.
   - Empty state with a clear primary action ("Add your first note").
   - Visible success/error toast on every mutation.
   - Refetch (or local-state update) AFTER each mutation so the UI matches the DB.

Forbidden in this turn:
- Writing the table name with no migration. The user will paste the SQL — you MUST emit it.
- \`supabase.from('<some_table_you_invented>')\` without the matching CREATE TABLE in the same MIGRATION block. Use exact column names you just declared.
- Calling \`supabase.auth.*\` directly — go through \`useAuth()\`.
- Importing \`@supabase/supabase-js\`, \`createClient\`, or any service-role key.

If the user named a table that already exists in the [Connected backend tables] block below, REUSE it — do not emit a duplicate CREATE TABLE. If they asked for a new table, pick a short snake_case name and follow the four-piece pattern above.`,
  },
  // Fires when the user asked for auth / data / accounts / uploads / realtime
  // BUT no backend is connected to this project. Triggers are matched in
  // pickDynamicSnippets only when args.hasBackend === false. This is a
  // POSITIVE instruction — we tell the model exactly what to do instead of
  // hoping it remembers the buried PREREQUISITE GATING rule. Without this
  // block the model has historically (a) bailed to prose and (b) emitted
  // imports from "@/integrations/backend/*" that don't resolve.
  noBackendGate: {
    triggers: "always", // gating handled in pickDynamicSnippets
    body: `\n\n[CRITICAL — No backend is connected to this project]
The user asked for a feature that normally needs a backend (auth, accounts, login, persistent data, comments, uploads, realtime, etc.) — but THIS project has no backend yet.

You MUST still call write_project (or patch_files). Never reply with prose. Never bail.

What to build:
- Scaffold the UI ONLY: forms, empty states, mock lists, disabled "Sign in" buttons, etc. Use realistic placeholder data inline (NOT from a database).
- DO NOT import from "@/integrations/backend/*" — those files do not exist in this project and the build will fail.
- DO NOT import "@supabase/supabase-js", do NOT call createClient, do NOT hardcode any keys or URLs.
- DO NOT add any auth/data wiring. Leave a clear \`// TODO: connect backend\` comment where the wiring would go.

What to say:
- In "plan" and "summary", in plain friendly English, tell the user that you've built the UI and that to make it real (save data / let users sign in / etc.) they should tap the "Add backend" chip below the chat. Keep it warm, not technical.
- Do NOT mention Supabase, edge functions, or any infra names — just "a backend".`,
  },
  images: {
    triggers:
      /\b(image|photo|picture|hero|illustration|avatar|background|banner|cover|logo|gallery)\b/i,
    body: `\n\n[Reinforcement — Images]
Use \`petal-image://<descriptive-prompt>\` for any AI-generated visual. Be SPECIFIC (e.g. "petal-image://cozy-coffee-shop-hero-warm-morning-light"). Max 6 unique placeholders per turn — extras silently fall back to picsum. NEVER use unsplash.com / placeholder.com / picsum.photos when petal-image:// fits. Fake testimonial avatars MAY use https://i.pravatar.cc/150?u=<seed>.

CRITICAL — no gratuitous photo grids: do NOT add a generic "Gallery / Recent Work / Our Projects / Portfolio" grid of 3-6 stock photos on a service-business landing page (plumber, electrician, lawyer, dentist, restaurant, salon, etc.) UNLESS the user explicitly asked for a gallery / portfolio / case studies. These grids land as random grayscale picsum fallbacks and look amateur. Default to FeaturesGrid3 (icon + title + copy) or StatsBand for trust signals instead. Use GalleryGrid ONLY for: photographer / designer / architect / restaurant menu / real-estate portfolios, and ONLY when the brief implies showcasing visual work.`,
  },
  navbarBrand: {
    triggers: /\b(nav|navbar|header|landing|marketing site|site|website|portfolio|saas|product page|app|dashboard|home ?page)\b/i,
    body: `\n\n[Reinforcement — Navbar brand mark is REQUIRED]
Every NavBar / NavWithCta / NavWithSearch MUST render a visible brand mark on the left: an icon (lucide-react icon themed via primary color OR a small <img> logo) PAIRED WITH the brand name as text. Never pass an empty string, null, or only an icon to \`brand\`. Pattern:

  <NavBar brand={<span className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /><span className="font-semibold">BrandName</span></span>} links={...} />

If the user provided a business name, use it verbatim. If not, infer one from the brief and tell the user in the summary that they can rename it. A header with only a hamburger menu and no brand is a render-quality FAILURE.`,
  },
  mobileNative: {
    triggers: /\b(mobile app|native app|ios app|android app|phone app|app from scratch)\b/i,
    body: `\n\n[Reinforcement — Mobile-native aesthetic]
For mobile-target builds, the result must FEEL native, not like a shrunk website. ALWAYS use the mobile primitives from "@/components/mobile/*":
- <SafeArea> as the root of every screen (respects notch + home-indicator)
- <MobileHeader title back action /> — compact 44-56px header, NOT a desktop NavBar
- <BottomTabBar tabs={[{ key, label, icon, href }]} /> — 3-5 tabs, fixed bottom, the primary nav
- <MobileScreen> convenience wrapper combining the three above

Visual rules (MWM / Linear-mobile / Apple-app quality bar):
- Full-bleed hero cards with rounded-3xl corners and dramatic shadows; never a desktop-style centered hero.
- Stacks of cards with generous padding (p-4 to p-5), 16-20px gap between cards.
- Large touch targets: buttons min-h-12, list rows min-h-14.
- Use bold display type for screen titles (text-2xl to text-3xl font-semibold), tight line-height.
- Bottom tab bar is non-negotiable for any multi-screen mobile app — never put primary nav in a hamburger on mobile-native.
- Status-bar-aware: top padding from SafeArea, not hardcoded.
- Prefer vertical scroll + horizontal card carousels (overflow-x-auto snap-x) over multi-column grids — phones are portrait.
- Sheets and modals slide up from the bottom (use Sheet with side="bottom"), never centered desktop dialogs.

If the user references an app by name (Spotify, Notion, Linear, MWM, Headspace, Calm), match THAT app's information density and chrome — do not regress to generic web hero + 3-card grid.`,
  },
  tailwindv4: {
    triggers: /\b(theme|color|palette|brand color|dark mode|styles?\.css|@theme|tailwind)\b/i,
    body: `\n\n[Reinforcement — Tailwind v4 + styles.css]
Tailwind v4 syntax ONLY: \`@import "tailwindcss";\` on line 1, then \`@theme { --color-primary: oklch(...); --radius-lg: 0.75rem; }\`. CRITICAL: \`@theme { ... }\` accepts ONLY token declarations (\`--name: value;\`). NEVER nest selectors inside it — no \`.dark { ... }\`, \`:root { ... }\`, \`@media (...)\`, or \`&:is(...)\` inside @theme. Put \`:root { ... }\` and \`.dark { ... }\` blocks AFTER @theme at the top level. Class-based dark mode is enabled with \`@custom-variant dark (&:where(.dark, .dark *));\` BEFORE @theme — do not redeclare it inside. NEVER use v3 \`@tailwind base/components/utilities\` directives — they abort the build. NEVER \`@apply\` an undefined class. When unsure, EMIT NOTHING for src/styles.css and let the scaffold's defaults win.`,
  },
  toast: {
    triggers:
      /\b(toast|notification|alert message|success message|error message|snackbar|flash message)\b/i,
    body: `\n\n[Reinforcement — Toasts]
Mount <Toaster /> ONCE in App.tsx (or main.tsx). Then call toast.success("Saved.") / toast.error("…") / toast("Default") from "@/components/ui/toast" anywhere. NEVER build a custom alert div for ephemeral feedback.`,
  },
  fileUpload: {
    triggers:
      /\b(upload|file upload|attach(ment)?s?|avatar upload|profile (picture|photo)|image upload|drag.?and.?drop file|csv import|photo gallery upload)\b/i,
    body: `\n\n[Reinforcement — File upload]
The user asked for file uploads. Ship the full vertical slice in ONE turn:

1. STORAGE BUCKET — emit a \`MIGRATION:\` block that creates the bucket and policies (skip CREATE TABLE if not needed):
   - \`insert into storage.buckets (id, name, public) values ('<bucket>', '<bucket>', <true|false>) on conflict (id) do nothing;\`
   - Private buckets: \`create policy "Users read own files" on storage.objects for select using (bucket_id = '<bucket>' and auth.uid()::text = (storage.foldername(name))[1]);\` plus matching insert/update/delete policies.
   - Public buckets (avatars, public images): SELECT policy with \`using (bucket_id = '<bucket>')\` and INSERT scoped to \`auth.uid()::text = (storage.foldername(name))[1]\`.

2. UPLOAD UI — use react-dropzone if installed, otherwise a styled \`<input type="file" />\`. Always:
   - Show a preview thumbnail for images.
   - Show upload progress (use \`onUploadProgress\` from the upload promise).
   - Validate size/MIME client-side before calling supabase.
   - Path convention: \`\${user.id}/\${crypto.randomUUID()}-\${file.name}\` so the RLS \`storage.foldername(name)[1]\` check passes.

3. UPLOAD CALL: \`await supabase.storage.from('<bucket>').upload(path, file, { upsert: false, contentType: file.type })\`. For public buckets, render \`supabase.storage.from('<bucket>').getPublicUrl(path).data.publicUrl\`. For private buckets, render via \`createSignedUrl(path, 3600)\`.

4. PERSIST the path in the related row (e.g. \`profiles.avatar_url\`) so the UI can re-render after refresh.

Forbidden: storing base64 in a text column, uploading without an auth check, hardcoding bucket policies that allow \`true\` on insert.`,
  },
  webhook: {
    triggers:
      /\b(webhook|callback url|external (api )?callback|stripe webhook|paystack webhook|github webhook|inbound webhook|receive (events?|notifications?) from)\b/i,
    body: `\n\n[Reinforcement — Inbound webhook]
The user asked to receive a webhook from an external service. Build a TanStack server route under \`src/routes/api/public/\` — that prefix bypasses Lovable's published-site auth so external callers can reach it. ALWAYS implement these four pieces:

1. ROUTE SHAPE (e.g. \`src/routes/api/public/<source>-webhook.ts\`):
   \`\`\`ts
   import { createFileRoute } from "@tanstack/react-router";
   import { createHmac, timingSafeEqual } from "crypto";
   import { supabaseAdmin } from "@/integrations/supabase/client.server";

   export const Route = createFileRoute("/api/public/<source>-webhook")({
     server: { handlers: { POST: async ({ request }) => {
       const sig = request.headers.get("<provider-signature-header>") ?? "";
       const body = await request.text();
       const expected = createHmac("sha256", process.env.<SOURCE>_WEBHOOK_SECRET!).update(body).digest("hex");
       if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
         return new Response("invalid signature", { status: 401 });
       }
       const payload = JSON.parse(body);
       // … route by payload.type, write via supabaseAdmin …
       return new Response("ok");
     } } },
   });
   \`\`\`

2. SECRET — the webhook secret MUST come from \`process.env.<SOURCE>_WEBHOOK_SECRET\` read INSIDE the handler. Tell the user in your summary that they need to add this secret (Lovable will prompt them). Never hardcode it.

3. PERSISTENCE — use \`supabaseAdmin\` (service role) to write the event row; webhooks have no user session. If you also need a \`webhook_events\` audit table, include the MIGRATION (table + GRANT to service_role only + RLS enabled + no policies = nothing readable from the client).

4. IDEMPOTENCY — if the provider sends an event id, dedupe on it (\`on conflict (event_id) do nothing\`) so retries don't double-process.

Forbidden: skipping signature verification, returning 500 for replays, reading \`process.env\` at module scope, exposing PII in the response body. Never put inbound webhooks under \`/api/\` without the \`/public/\` segment — they'll 401 on production.`,
  },
  cronJob: {
    triggers:
      /\b(cron|scheduled (job|task)|every (hour|day|week|minute)|daily (digest|reminder|cleanup|report)|nightly|background job|periodic)\b/i,
    body: `\n\n[Reinforcement — Scheduled / cron job]
The user asked for recurring server work. Pick ONE of these two patterns:

A) SQL-ONLY (cleanup, aggregation, no external calls) — emit a MIGRATION enabling \`pg_cron\` and scheduling the SQL directly:
   \`\`\`sql
   create extension if not exists pg_cron;
   select cron.schedule('<job-name>', '<cron expr>', $$ <SQL to run> $$);
   \`\`\`

B) BUSINESS-LOGIC (send email, hit an API, call an LLM) — build a public route + cron caller:
   - Create \`src/routes/api/public/cron/<job>.ts\` that validates a shared header OR a signed token, then runs the work using \`supabaseAdmin\`.
   - Tell the user to run this SQL ONCE in their backend (do NOT put it in a migration — it embeds secrets):
     \`\`\`sql
     create extension if not exists pg_cron;
     create extension if not exists pg_net;
     select cron.schedule('<job-name>', '<cron expr>', $$
       select net.http_post(
         url := 'https://<their-domain>/api/public/cron/<job>',
         headers := '{"Content-Type":"application/json","apikey":"<their anon key>"}'::jsonb,
         body := '{}'::jsonb
       );
     $$);
     \`\`\`

Common cron expressions: \`* * * * *\` (every minute), \`0 * * * *\` (hourly), \`0 0 * * *\` (daily midnight), \`0 9 * * 1\` (Mondays 9am).

Forbidden: relying on \`setInterval\` in the running app (workers are stateless), embedding service-role keys in the SQL, scheduling without an idempotency check on the called endpoint.`,
  },
  payments: {
    triggers:
      /\b(stripe|paystack|paddle|checkout|payment(s)?|subscribe|subscription|paywall|pricing page that charges|buy now|sell (a|my) (product|course|access))\b/i,
    body: `\n\n[Reinforcement — Payments]
The user asked to take real money. Do NOT scaffold a fake Stripe form. The correct pattern is:

1. ASK FIRST — in your summary, tell the user which provider you'll use (Stripe for global cards / Paystack for Africa / Paddle for SaaS-MoR) and that they need to (a) connect that provider in Lovable Cloud → Integrations and (b) add API keys. STOP here if no provider is connected; do not invent client-side card UI.

2. ONCE THE PROVIDER IS WIRED, build the slice as:
   - \`src/lib/checkout.functions.ts\` — a POST \`createServerFn\` that takes \`{ priceId, quantity }\` via \`.inputValidator(z.object(...).parse)\`, reads the secret INSIDE the handler (\`process.env.STRIPE_SECRET_KEY!\`), creates the Checkout Session, and returns \`{ url }\`.
   - Client button → \`const checkout = useServerFn(createCheckout); const { url } = await checkout({ data: { priceId } }); window.location.href = url;\`
   - Webhook route at \`src/routes/api/public/<provider>-webhook.ts\` that verifies the signature (see the webhook reinforcement) and updates a \`payments\` or \`subscriptions\` table via \`supabaseAdmin\`.
   - MIGRATION: \`payments(id, user_id, amount_cents, currency, status, provider, provider_ref, created_at)\` with RLS so users only see their own rows.

3. NEVER do these — they're hard failures the user will catch in production:
   - Collect raw card numbers in your UI. Always redirect to the provider's hosted Checkout.
   - Mark a subscription "active" from the client. Only the verified webhook flips status.
   - Hardcode price ids in components. Read from a \`prices\` table or env.`,
  },
  // Business-app dual-surface rule. Fires when the user describes a business
  // (SaaS, CRM, fintech, marketplace, AI startup, edtech, healthtech, booking).
  // Tells the monolithic path to ship the marketing site AND the auth'd
  // product in the SAME build — the staged path already does this via the
  // "business-app" archetype, but the monolithic fallback needs the same
  // floor.
  businessApp: {
    triggers:
      /\b(saas|crm|fintech|marketplace|platform|startup|edtech|healthtech|booking system|ai (product|startup|tool)|build (me )?an? (saas|startup|platform))\b/i,
    body: `\n\n[Reinforcement — Business product = marketing site + authenticated app]
The user described a BUSINESS, not a single screen. Ship BOTH surfaces in the same build, defaulting to:

PUBLIC (marketing site — Stripe / Linear / Notion grade, NOT a dashboard):
- src/routes/index.tsx — Hero + value prop + primary CTA
- src/routes/features.tsx (or /product) — what it does, with real component examples
- src/routes/pricing.tsx — tiered pricing or "contact us" if enterprise
- src/routes/about.tsx — story / team / mission
- src/routes/contact.tsx — form + alternate channels
- (optional) src/routes/faq.tsx, /testimonials, /blog.index.tsx

PRIVATE (authenticated product):
- src/routes/auth.tsx (or /login + /signup) — real Supabase email/password + Google
- src/routes/app/index.tsx — Dashboard with REAL domain widgets (CRM → ContactsTable + Pipeline; fintech → Wallet + Transactions; AI → Workspace + UsageMeter; booking → Schedule + Bookings)
- src/routes/app/settings.tsx
- src/routes/app/profile.tsx

BACKEND:
- Auth (email/password + Google), profiles table, user_roles table, domain tables with RLS scoped to auth.uid().

EXCEPTIONS — do NOT generate a marketing site when the brief explicitly asks for:
- "admin dashboard only" / "internal tool" / "back office"
- "chrome extension" / "browser extension"
- "mobile app only"
- "API only"

In your reply: tell the user which marketing pages AND which app routes you scaffolded, and that they can run the product end-to-end after signing up. Do NOT ship only a landing page or only a dashboard — that's the most common failure mode for business briefs.`,
  },
  // Fires on any visual / UI / page / redesign turn. Encodes the
  // non-negotiable design-quality floor that separates polished output
  // from "obviously AI-generated". Pairs with `sections` (which says
  // WHAT to compose) by saying HOW it must look and behave.
  designFloor: {
    triggers:
      /\b(landing|landing page|home ?page|marketing|hero|features?|pricing|faq|cta|footer|nav|navbar|header|portfolio|about|page|site|website|design|redesign|restyle|theme|ui|layout|responsive|mobile|tablet|desktop|polish|beautiful|pretty|modern|style|look|visual|aesthetic|brand)\b/i,
    body: `\n\n[Reinforcement — Design quality floor (non-negotiable)]
These rules apply to EVERY visual file you write this turn. Violating any of them ships obviously-AI output.

1. Responsive is mandatory, mobile-first. Every layout MUST work at 375px wide without horizontal scroll. Start with the single-column mobile layout, then add \`sm:\` / \`md:\` / \`lg:\` modifiers to upgrade. Never write \`grid-cols-3\` without a \`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3\` progression. Hero headings: \`text-4xl sm:text-5xl md:text-6xl lg:text-7xl\`. Section padding: \`py-16 md:py-24 lg:py-32\`. Container: always \`<Container>\` or \`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8\` — never edge-to-edge content on desktop.

2. Icons: \`lucide-react\` ONLY. Never emoji in UI chrome, never raw inline \`<svg>\`, never \`react-icons\` / \`heroicons\` / \`@radix-ui/react-icons\`. Render as \`<Icon className="h-5 w-5" />\`, never as a bare value.

3. Semantic tokens ONLY in components. Never write \`text-white\`, \`text-black\`, \`bg-white\`, \`bg-black\`, \`bg-slate-900\`, \`text-gray-500\`, \`#3b82f6\`, \`rgb(...)\`, or any raw color/hex in JSX. Use \`bg-background\`, \`text-foreground\`, \`bg-card\`, \`text-card-foreground\`, \`bg-primary\`, \`text-primary-foreground\`, \`bg-muted\`, \`text-muted-foreground\`, \`bg-accent\`, \`border-border\`, \`ring-ring\`. If a token you need doesn't exist, ADD IT to \`src/styles.css\` first — never inline a hex as a workaround. This is what makes dark mode and theme swaps work; raw colors break both.

4. Typography floor. Pair a distinctive display font with a clean body font — never both Inter, never both Poppins. Display headings get \`font-display tracking-tight leading-[1.05]\` (or \`leading-tight\`). Body copy gets \`leading-relaxed\` and a max measure (\`max-w-prose\` or \`max-w-2xl\`). Minimum hero h1: \`text-4xl md:text-6xl font-semibold tracking-tight\`. Never ship default browser typography.

5. Color discipline. Commit to ONE accent (primary) + neutral surfaces + at most one secondary accent. No rainbow gradients. No purple-on-white "AI default". Gradients allowed: \`bg-gradient-to-br from-primary to-primary/60\` (semantic tokens only, never \`from-purple-500 to-pink-500\`).

6. Spacing rhythm. Use the \`<Section>\` block when available. Otherwise: \`py-16 md:py-24\` between sections, \`gap-6 md:gap-8\` inside grids, \`space-y-4\` inside cards. Never random \`mt-7\` / \`pb-11\` — stick to the 4/6/8/12/16/24 scale.

7. Landing page canonical order (when building one): NavBar → Hero → Logos/Social proof → Features → How it works / Stats → Testimonials → Pricing (if applicable) → FAQ → CTA → Footer. Skip sections that don't apply; never reorder. Each section sits in its own component file.

8. Motion: one well-timed entrance > scattered micro-interactions. If using \`framer-motion\`, animate the hero once on mount (\`initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}\`). Do NOT animate every card, every icon, every nav item.

9. Accessibility floor. Every \`<img>\` and \`<Image>\` gets a meaningful \`alt=\`. Every interactive element gets visible focus (shadcn primitives already include \`focus-visible:ring-2\`). Buttons that show only an icon get an \`aria-label\`. Color contrast: minimum 4.5:1 for body text — semantic tokens already satisfy this when used as designed.

10. Forbidden AI defaults. Do NOT ship: centered hero with three identical feature cards as the only layout, generic stock-photo placeholders ("photo of person smiling at laptop"), \`text-white bg-black\` "dark sections" in the middle of a light page, purple-pink gradients, "Lorem ipsum", placeholder logos rendered as gray rectangles in a row, "© 2024" footers. Replace any of these with the kit's actual blocks and the project's design tokens.

11. Readable small text. Landing-page copy MUST NOT use \`text-xs\` (12px). The floor is \`text-sm\` (14px) for captions, badges, meta labels, footer links, and legal copy; body paragraphs stay at \`text-base\` (16px) or larger; lead paragraphs use \`text-lg md:text-xl\`. Use \`leading-relaxed\` on any paragraph over one line. On mobile, section eyebrow labels (\`text-sm font-medium tracking-wide uppercase\`) are the smallest text allowed above the fold. If you catch yourself reaching for \`text-xs\`, upgrade it — small type is the single biggest tell of an AI-drafted landing page.

12. Intent first, decoration second. Before writing a single component, restate the user's brief in one sentence: "This is a {archetype} for {audience} whose primary job is {action}." Every section on the page must serve that job. If a section (testimonials, stats, logo cloud, FAQ) doesn't reinforce the primary action, cut it — do not pad. A short, focused page always beats a long generic one.

13. Opinionated visual direction. Pick ONE distinctive direction per project and commit to it: editorial (serif display + generous whitespace + oversized photography), brutalist (mono/sans + hard borders + saturated accent), soft-futurist (geometric sans + gradient mesh + glass cards), organic (rounded serif + warm palette + botanical imagery), or technical (mono + grid + terminal accents). Choose based on the brief's domain; NEVER default to "clean modern" (Inter + white + indigo + rounded-2xl cards) — that is the single most tired AI aesthetic and it makes every Petal app look identical. Match font pairing, radius scale, shadow depth, and imagery style to the chosen direction, and encode those choices as design tokens in \`src/styles.css\` so the whole app inherits them.

14. Real content, real images. Never ship "Lorem ipsum", "Feature One / Feature Two / Feature Three", or grey-box image placeholders. Write copy that references the specific product ("Track macros without logging every gram" beats "Amazing feature that helps users"). For hero and section imagery, prefer AI-generated project-specific art (via the image generation tool) or well-chosen semantic placeholder services (Unsplash Source with domain-relevant queries) over solid grey blocks. Every image gets a meaningful alt and \`loading="lazy"\` except the hero image (\`loading="eager"\`).

15. Section variety on a landing page. If the page has 4+ sections, at least THREE distinct layout patterns must appear: e.g. split-screen hero + asymmetric feature row + full-bleed testimonial + bento grid + centered CTA. Do NOT stack five identical three-column card grids in a row — that is the fastest tell of a generated page. Alternate light/dark surfaces, alternate image-left/image-right rows, alternate density.`,
  },
  // Fires on any list-shaped surface. The default AI failure is "render an
  // array — no search, no filters, no sort, no pagination, no URL sync."
  // This snippet says: if a list has 8+ items, it MUST be interactive.
  interactivity: {
    triggers:
      /\b(list|listing|catalog|directory|feed|inbox|browse|search|filter|sort|paginat|table|data ?grid|explore|gallery|library|store|marketplace|dashboard)\b/i,
    body: `\n\n[Reinforcement — Interactivity floor for list surfaces]
A list-shaped surface is not "done" when it renders an array. If the list will hold 8+ items in production, ship these in the SAME turn:

1. SEARCH — a debounced text input (\`useDeferredValue\` or 250ms debounce) filters by name/title/description. Client-side is fine for < 500 rows; graduate to a server \`ilike\` query above that.
2. FILTERS — at least ONE domain-relevant facet (status, category, tag, price band, date range). Render as \`<Select>\`, \`<Combobox>\`, or shadcn \`<ToggleGroup>\`; NEVER free-text with no picker.
3. SORT — user-controllable sort (name / newest / price / relevance). Table headers become clickable; card grids get a \`<Select>\` sort control.
4. PAGINATION or infinite scroll — never render 500 DOM nodes at once. 20-30 per page is the floor; use \`<Pagination>\` from the kit or intersection-observer for infinite.
5. URL SYNC — every search/filter/sort/page value MUST live in the URL (\`?q=&status=open&sort=newest&page=2\`). Use TanStack Router \`useNavigate({ search })\` + \`Route.useSearch()\` so users can share, refresh, and back-button. NEVER stash filter state in \`useState\` only.
6. EMPTY-FILTER STATE — when filters return zero, show \`<EmptyState title="No matches" description="Try clearing filters" action={<Button onClick={clear}>Clear filters</Button>} />\`. NEVER a blank list.
7. RESULT COUNT — always visible ("48 results" / "Showing 1–20 of 48"). Users need to know filters are working.

Interactions are what separates a mockup from an app. A catalog page without search + filters IS a bug.`,
  },
  // Fires on any list / seed-data surface. The tell-tale AI default is
  // "Item 1, Item 2, Item 3" — 3 fake cards, gray boxes for images.
  // This snippet enforces real content density and real imagery.
  contentDepth: {
    triggers:
      /\b(list|catalog|directory|gallery|feed|marketplace|store|shop|products?|posts?|articles?|projects?|listings?|team|members|testimonials?|pricing|features?|blog|showcase|portfolio|inventory|menu)\b/i,
    body: `\n\n[Reinforcement — Content depth (no "Item 1, Item 2, Item 3")]
Every list you render this turn must feel like a REAL product, not a wireframe. Rules:

1. QUANTITY. Landing-page proof sections (testimonials, features, logos, pricing): minimum 3, target 6. Product catalogs / feeds / directories / galleries: minimum 12 varied items. Never ship 3 identical placeholder cards as the entire content.
2. VARIETY. Item names, prices, dates, categories, and status values must VARY realistically. A products list has different prices ($12, $48, $199, $2,400 — not "$X"); a team page has different roles and photos; a feed has different post lengths and timestamps ("2h ago", "yesterday", "Mar 14").
3. REAL COPY. Never "Lorem ipsum". Never "Feature One / Feature Two". Write copy that names the specific domain: for a running app "Log a 5K without a watch", for a legal SaaS "Redline contracts in the browser", for a bakery "Sourdough loaves proofed 36 hours". If you don't know the domain, RE-READ the user's brief before writing copy.
4. REAL NAMES. People in testimonials / team / avatars get real full names from a mix of cultures ("Priya Nair, Marcus Chen, Ana Rossi, Amara Okafor, Leo Martín, Yuki Tanaka") — never "John Doe / Jane Smith". Roles are specific ("Head of Growth at Linear") not generic ("Product Manager").
5. REAL IMAGES. Never gray-box placeholders. Options in order of preference:
   - Domain-relevant AI-generated images (already-imported assets or new generations).
   - Unsplash Source with a specific query: \`https://source.unsplash.com/800x600/?<domain-keyword>,<style>\` — e.g. \`?ceramics,studio\` for a pottery store. Vary the query per item so the grid doesn't repeat one photo.
   - Deterministic per-row seed: \`https://source.unsplash.com/800x600/?<keyword>&sig=\${item.id}\`.
6. AVATARS. Use \`https://api.dicebear.com/9.x/avataaars/svg?seed=\${name}\` OR \`https://i.pravatar.cc/128?u=\${name}\` — vary per person. Never a single avatar reused. Never a bare initial circle across a whole team page.
7. DATA SHAPE. Give each seed item a stable \`id\` (\`crypto.randomUUID()\` at module scope is fine for mocks). This makes React keys stable and lets the interactivity floor (search/filter/sort) work correctly.

If the seed data lives inline in the component, extract it to a sibling \`*.data.ts\` file the moment the array crosses ~30 lines — keeps the component under the 180-line budget.`,
  },
  // Fires on any list / page / data-fetch surface. The failure mode is
  // "render data or blank" — no loading, no empty, no error. Ships the
  // three-state contract every real app has.
  polishStates: {
    triggers:
      /\b(fetch|load|list|page|route|dashboard|profile|detail|feed|inbox|table|data|form|submit|api|query|realtime|comments?|posts?|orders?|users?|customers?)\b/i,
    body: `\n\n[Reinforcement — Loading / empty / error is a contract, not a polish]
Every surface that renders data (list, detail, dashboard, profile, feed, form response) MUST handle three states EXPLICITLY. A missing state is a bug, not a nice-to-have.

1. LOADING — first paint of ANY async data uses a skeleton, not a spinner-in-the-middle and never a blank page. Kit: \`<Skeleton className="h-4 w-32" />\` stacked to mimic the final shape. For grids: render 6-8 skeleton cards matching the real card dimensions. NEVER a text "Loading…" as the only feedback.
2. EMPTY — zero rows / zero results always renders \`<EmptyState icon={<domain-icon>} title description action={<Button>...</Button>} />\`. The action is a real next step (Create, Invite, Import, Clear filters), never a dead-end message. Empty state copy references the domain ("No customers yet. Add your first one to start tracking.") — never generic ("Nothing here").
3. ERROR — every \`try/catch\` around a mutation shows \`toast.error(friendlyMessage)\`. Every route with a loader sets \`errorComponent\` on \`createFileRoute\` returning a card with the error message + a "Try again" button that calls \`router.invalidate()\`. Never let a thrown promise silently kill the page.

For routes specifically:
- Set BOTH \`errorComponent\` and \`notFoundComponent\` on every route with a loader (see the errors-notfound rules).
- Wrap the component body in a defensive \`try/catch\` when it does heavy computation that could throw at render.

The three-state contract is what makes an app feel real. Users forgive slow. They do NOT forgive blank.`,
  },
  // Fires on dashboard / admin / console asks. The generic dashboard
  // failure is "here's a chart in the middle of a page" — no sidebar, no
  // topbar, no real widgets, no domain data. This snippet enforces the
  // full dashboard shell.
  dashboardCraft: {
    triggers:
      /\b(dashboard|admin panel|admin dashboard|console|workspace|control panel|back ?office|internal tool|analytics dashboard|ops dashboard|command ?center|cms admin)\b/i,
    body: `\n\n[Reinforcement — Dashboard shell (not "a chart on a page")]
A dashboard is NOT a landing page with a chart. It is a persistent authenticated shell. Ship this structure:

STRUCTURE (\`src/components/examples/app-shell-with-sidebar.tsx\` is the canonical reference):
- Sidebar (left, 240-280px, collapsible to icon-only on md, hidden behind \`<Sheet>\` drawer on mobile):
  - Logo/brand at top
  - Primary nav: 4-8 sections MAX, each with a lucide icon and label
  - Section separator, then Settings + Sign out at bottom
  - Active state via \`useLocation().pathname\` or \`<Link activeProps>\`
- Topbar (sticky, h-14, border-b):
  - Left: page title OR \`<Breadcrumbs>\`
  - Center: \`<Command>\`-style search (⌘K) OR a global filter
  - Right: notifications bell (\`<Popover>\`), user avatar (\`<DropdownMenu>\` with Profile / Settings / Sign out)
- Content area: \`max-w-7xl mx-auto px-6 py-6\` grid of widgets

WIDGETS (mix, don't repeat one type):
- KPI band: 4 \`<Stat>\` cards across the top (label, value, delta arrow, sparkline optional)
- Primary chart (\`<AreaChart>\` or \`<BarChart>\` from the kit, 60-day series)
- Recent activity feed (last 10 events, avatar + verb + object + timestamp)
- Data table with search + filter + sort (see interactivity floor)
- Secondary chart or breakdown (\`<PieChart>\` or grouped bars)

DOMAIN-SPECIFIC WIDGETS — match the widgets to the brief:
- CRM: Pipeline board (kanban), Deals-by-stage chart, Top accounts table, Activity feed
- Fintech: Balance card, Cash-flow chart, Transactions table, Upcoming payments
- SaaS analytics: MRR / Churn / ARPU / Active users stat band, Cohort chart, Signups feed
- Ops / logistics: Orders queue, Fulfillment SLA, Warehouse capacity, Alerts

RESPONSIVE — sidebar becomes a hamburger \`<Sheet>\` on mobile. Widgets stack 1-col on mobile, 2-col on md, 3-col on lg. KPI band stays horizontal-scroll on mobile if it doesn't fit.

Forbidden: dashboard that is a marketing hero + one chart. Dashboard that hides real domain data behind "Feature coming soon". Dashboard without persistent nav.`,
  },
  // Fires whenever a new route is being created. Reinforces that route.head()
  // is not optional — every route must ship route-specific SEO.
  perRouteSEO: {
    triggers:
      /\b(route|page|multi-?page|landing|about|pricing|contact|blog|faq|features?|services|portfolio|gallery|docs|changelog|privacy|terms|marketing|site|website)\b/i,
    body: `\n\n[Reinforcement — Per-route SEO (every route.head() is required)]
Every new TanStack route file MUST set its own \`head()\` in \`createFileRoute\`. Copy-pasting the home-page metadata into a child route is a bug — search engines and social crawlers will treat them as duplicates.

Required per-route (in the \`head()\` return):
- \`meta: [{ title }]\` — 40-60 chars, includes the site/brand name (e.g. "Pricing — Acme").
- \`meta: [{ name: "description", content }]\` — 120-160 chars, describes THIS page, not the whole site.
- \`meta: [{ property: "og:title", content }]\` and \`{ property: "og:description", content }\` — usually the same as title/description.
- \`meta: [{ property: "og:url", content }]\` — full https URL of THIS route.
- \`meta: [{ property: "og:type", content: "website" }]\` (or "article" on blog posts).
- \`links: [{ rel: "canonical", href }]\` — full https URL of THIS route, LEAF ROUTES ONLY (never in \`__root.tsx\`).
- \`og:image\` (absolute https URL) — set ONLY when the page has a real hero image. Never a relative path. Never a placeholder. Never on \`__root.tsx\` — root \`head()\` concatenates into every match and overrides leaf images.

Dynamic routes derive metadata from loader data:
\`\`\`ts
head: ({ params, loaderData }) => ({
  meta: [
    { title: loaderData ? \`\${loaderData.item.name} — Acme\` : "Not found" },
    { name: "description", content: loaderData?.item.summary ?? "…" },
    { property: "og:url", content: \`https://<domain>/items/\${params.slug}\` },
    ...(loaderData?.item.image ? [{ property: "og:image", content: loaderData.item.image }] : []),
  ],
  links: [{ rel: "canonical", href: \`https://<domain>/items/\${params.slug}\` }],
}),
\`\`\`

Never leave a route with the default "Lovable App" / "Petal App" title. That is a scanner-visible defect.`,
  },
  // Fires on any mobile / native / phone / Expo / React Native ask. Raises
  // the same quality bar the web snippets enforce — real screens, native
  // chrome, deep interactivity — for the mobile target.
  mobileCraft: {
    triggers:
      /\b(mobile app|native app|ios app|android app|phone app|expo|react ?native|snack|capacitor|app store|play store|push notif|onboarding screens?|tab bar|bottom sheet|swipe|gesture)\b/i,
    body: `\n\n[Reinforcement — Mobile app craft (deep, not a shrunk website)]
A mobile app is a stack of screens with native chrome, real gestures, and a persistent tab bar — not a responsive landing page. Ship this depth in ONE turn:

1. SCREEN COUNT. Never a single-screen app. Minimum viable mobile app = 4 screens: Home/Feed, Detail, Create/Compose, Profile/Settings. Wire them behind a <BottomTabBar> (3-5 tabs). If auth is involved add Sign-in + Onboarding (2-3 slides with skip/next).
2. NAVIGATION. <BottomTabBar> for primary sections. <MobileHeader back title action /> at the top of every screen — never a desktop NavBar. Push transitions between screens (respect back gesture). Modals/forms slide up as bottom sheets, never centered dialogs.
3. INTERACTIONS THAT FEEL NATIVE. Pull-to-refresh on any feed. Swipe-to-delete or swipe-actions on list rows. Long-press context menu on cards. Haptic-style feedback via toast. Skeleton shimmer while loading (never a spinner in the middle). Empty states with a domain icon + real CTA.
4. CONTENT DEPTH. Same rule as web — 12+ varied items in any list, real names/prices/dates/images. Avatars via dicebear. Hero images via Unsplash Source with domain keywords. Never "Item 1 / Item 2".
5. LAYOUT PRIMITIVES. Full-bleed cards, rounded-3xl, dramatic shadows. Stacked cards with p-4 to p-5 and 16-20px gaps. Horizontal card carousels (overflow-x-auto snap-x) for "featured" rows — never multi-column grids on portrait phones. Large touch targets: buttons min-h-12, list rows min-h-14.
6. STATE. Persist filters, drafts, and auth in AsyncStorage-equivalent (localStorage for Snack web preview). URL-sync where router supports it. Never lose the user's input on a re-render.
7. VISUAL DIRECTION. Pick ONE app archetype and commit: fintech (dense numeric cards + charts), social (feed + stories rail + comments sheet), productivity (checklist + gestures + streaks), health (rings + tracking + coach copy), commerce (product grid + cart sheet + checkout). Match iconography, radius, and copy to the archetype.
8. ONBOARDING. If it's a new app, ship a 2-3 slide onboarding (illustration + one-line value prop + Next/Skip), then a first-run empty state that guides the user to create their first item.

The user should be able to complete the app's primary action — post, log, book, buy — inside the preview, not just look at a home screen.`,
  },
  // Fires on backend / API / server / database / schema / RLS asks. Raises
  // the bar on data modeling, security, and API design beyond the minimum
  // "create a table with RLS" the base prompt already enforces.
  backendCraft: {
    triggers:
      /\b(backend|database|schema|table|api|rest|graphql|rls|policy|policies|migration|edge function|server function|trigger|stored procedure|index|foreign key|relation|audit log|soft delete|multi[- ]?tenant|roles?|permissions?)\b/i,
    body: `\n\n[Reinforcement — Backend craft (modeling, security, DX)]
A backend is not one table with two policies. Real apps ship a coherent data model with the guardrails a production app needs. When the user asks for backend work, apply these:

1. DATA MODEL. Think in entities BEFORE typing SQL. For any non-trivial feature there are 3+ related tables (e.g. blog = posts + comments + tags + post_tags). Use foreign keys with \`on delete cascade\` where a child cannot exist without a parent, \`on delete set null\` where it can. Add \`created_at timestamptz not null default now()\` AND \`updated_at timestamptz not null default now()\` to every table plus a trigger to keep updated_at fresh.
2. INDEXES. Every foreign key column gets an index. Every column used in a WHERE / ORDER BY on a hot query gets one. Add them in the same migration — Postgres does NOT auto-index FKs.
3. RLS THAT ACTUALLY WORKS. Enable RLS in the SAME migration as CREATE TABLE. Emit BOTH the \`GRANT\` statements (public schema needs explicit grants to authenticated / anon / service_role) AND the policies. Owner rows: \`using (auth.uid() = user_id)\`. Team rows: use a \`security definer\` \`has_role(_user_id, _role)\` helper — never check roles from a table joined in the policy (recursion). Never store roles on \`profiles\` — use a separate \`user_roles\` table with an app_role enum.
4. VALIDATION AT THE EDGE. Zod schema on every server function input. Reject bad input with a 400, never trust the client. On mutations that touch money / permissions / other users, re-check authorization on the server even when RLS would also block — defense in depth.
5. AUDIT + SOFT DELETE where the domain needs it (orders, invoices, admin actions): \`deleted_at timestamptz\`, filtered out in views. An \`audit_log\` table (actor_id, action, entity_type, entity_id, diff jsonb, created_at) for admin surfaces.
6. SEED DATA. After creating a table for a demo/landing feature, emit \`INSERT ... ON CONFLICT DO NOTHING\` rows in the SAME migration so the UI has something to render on first load. Never a page-load seed function.
7. API SHAPE. For public endpoints under \`src/routes/api/public/*\`: verify signature (HMAC) before touching the DB, use \`timingSafeEqual\`, never return PII to unauthenticated callers, always validate with zod. For internal calls: use \`createServerFn\` from \`@tanstack/react-start\` with \`.middleware([requireSupabaseAuth])\` on anything user-scoped.
8. REALTIME + STORAGE — only when asked. Realtime: enable via \`alter publication supabase_realtime add table <t>\` in the migration; subscribe in the component with cleanup on unmount. Storage: create the bucket in the migration with matching path-scoped policies (\`storage.foldername(name)[1] = auth.uid()::text\`).

A backend without indexes, without RLS on every table, or without seed data is not production-ready.`,
  },
  // Fires on chrome extension / browser extension asks. Enforces MV3
  // structure, real popup UI, background service worker patterns, and a
  // downloadable zip artifact — not a bare manifest.json.
  chromeExtensionCraft: {
    triggers:
      /\b(chrome extension|browser extension|firefox extension|edge extension|manifest ?v?3|popup extension|content script|background service worker|browser add-?on)\b/i,
    body: `\n\n[Reinforcement — Chrome extension craft (MV3, complete artifact)]
A browser extension is a small app with its own runtime. Ship these pieces together in ONE turn:

1. STRUCTURE — put source under \`/dev-server/extension/\` (or \`extension/\` at the repo root), packaged output under \`public/\`:
   - \`extension/manifest.json\` — \`"manifest_version": 3\` (V2 is dead). Set \`name\`, \`version\`, \`description\`, \`permissions\` (minimum viable), \`host_permissions\` if needed, \`action.default_popup\`, \`action.default_icon\`, \`background.service_worker\`, \`icons\`.
   - \`extension/popup.html\` + \`extension/popup.js\` (or a compiled bundle) — real UI, not "Hello world". Match the extension's job: quick action panel, save-to-list, page annotator, etc.
   - \`extension/background.js\` — service worker. Use \`chrome.storage.local\` for persistence (NOT \`localStorage\` — unavailable in MV3 SW). Wire \`chrome.action.onClicked\`, \`chrome.runtime.onInstalled\`, alarms as needed.
   - \`extension/content.js\` (only if the extension mutates page DOM) — declared in \`content_scripts\` with narrow \`matches\`.
   - \`extension/icons/icon-{16,48,128}.png\` — real icons, not placeholders.
2. POPUP UX. Fixed width 320-400px, fixed height 400-600px. Use the SAME design tokens as the main app so it looks branded. Real states: loading skeleton, empty state with CTA, error toast. If it needs auth, deep-link to the app's auth page in a new tab (\`chrome.tabs.create({ url })\`) — never build a login form inside the popup.
3. STORAGE + SYNC. Use \`chrome.storage.local\` for local, \`chrome.storage.sync\` for cross-device (quota 100KB). Wrap in a tiny \`storage.get/set\` helper. Never assume \`chrome.storage\` is synchronous — it's promise-based in MV3.
4. TABS + MESSAGING. Get the active tab with \`chrome.tabs.query({ active: true, currentWindow: true })\`. Message background ↔ popup ↔ content with \`chrome.runtime.sendMessage\` / \`chrome.tabs.sendMessage\`; ALWAYS return \`true\` from \`onMessage\` when replying asynchronously.
5. PACKAGING. Emit a build step that zips \`extension/\` to \`public/<name>.zip\`. The Petal preview cannot serve authenticated static assets directly — provide a download button that does \`fetch('/<name>.zip').then(r => r.blob()).then(...) \` and triggers a blob download, NOT a bare \`<a href download>\`.
6. INSTALL INSTRUCTIONS. Add a short "How to install" panel on the app's page: 1) download zip, 2) unzip, 3) open chrome://extensions, 4) enable Developer mode, 5) Load unpacked → pick the folder. Works in Chrome / Edge / Brave / Arc / Opera. Store publishing needs the Web Store — mention it once, don't scaffold it.
7. HOST APP. Even for extension-only briefs, ship a minimal landing page in the Petal app that markets the extension, shows a screenshot, and hosts the download link. Never leave the user with a naked zip.

Forbidden: MV2 manifest, \`localStorage\` in the SW, bare \`<a download>\` on the preview, missing icons, popup that's just "Hello world".`,
  },
};



/** Extract plain-text content from a chat message (strips attachments shape). */
function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        typeof p === "object" && p && "text" in p ? String((p as { text: string }).text) : "",
      )
      .join(" ");
  }
  return "";
}

/**
 * Pick reinforcement snippets that match the latest user turn.
 *
 * Always includes the "kitCore" baseline. Match ONLY the latest user
 * message so stale requests in chat history don't silently expand the
 * current scope. Cap at 6 topical snippets to keep prompt size reasonable
 * while still covering compound asks (e.g. "auth + dashboard with charts").
 */
export function pickDynamicSnippets(args: {
  /** Full message thread (oldest → newest). */
  messages: Array<{ role: string; content: unknown }>;
  /** When true, skip the auth block (no backend connected). */
  hasBackend: boolean;
  /** Force-include target-specific craft snippets regardless of keywords. */
  buildTarget?: { id: string };
}): { snippets: DynamicSnippetKey[]; text: string } {
  const latestUserTurn = [...args.messages].reverse().find((m) => m.role === "user");
  const haystack = messageText(latestUserTurn?.content).toLowerCase();

  const matched: DynamicSnippetKey[] = [];
  // kitCore is always first — the baseline primitives every turn needs.
  matched.push("kitCore");

  // No-backend gate: if the user mentioned a capability that needs a
  // backend but none is connected, inject explicit "scaffold UI-only and
  // tell the user to enable a backend" instructions. Without this the
  // model either bails to prose or imports modules that don't exist.
  const NEEDS_BACKEND_RX =
    /\b(auth|login|log ?in|sign ?up|sign ?in|password|otp|magic link|account|protected route|profile|database|persist|save (data|users?|posts?|comments?|orders?)|crud|comments?|posts?|orders?|todo|notes?|messages?|chat|upload|file upload|avatar upload|attachment|storage|realtime|live (chat|update)|presence)\b/i;
  if (!args.hasBackend && NEEDS_BACKEND_RX.test(haystack)) {
    matched.push("noBackendGate");
  }

  // Always enforce target-specific craft rules when the build target is
  // mobile, backend, or extension — even if the latest user turn doesn't
  // re-state the target (e.g. "make it blue" on a mobile app must still
  // use native primitives).
  const targetId = args.buildTarget?.id ?? "web";
  if (targetId === "mobile" || targetId === "ios" || targetId === "android" || targetId === "web-mobile") {
    if (!matched.includes("mobileCraft")) matched.push("mobileCraft");
  }
  if (targetId === "backend") {
    if (!matched.includes("backendCraft")) matched.push("backendCraft");
  }
  if (targetId === "extension") {
    if (!matched.includes("chromeExtensionCraft")) matched.push("chromeExtensionCraft");
  }

  for (const key of Object.keys(SNIPPETS) as DynamicSnippetKey[]) {
    if (key === "kitCore") continue;
    if (key === "noBackendGate") continue; // handled above
    if (key === "auth" && !args.hasBackend) continue;
    if (key === "fullstackFeature" && !args.hasBackend) continue;
    // Backend-dependent capability blocks: only fire when a backend is wired.
    // Without one, the noBackendGate snippet already tells the model to
    // scaffold UI-only and prompt the user to enable a backend.
    if ((key === "fileUpload" || key === "webhook" || key === "cronJob" || key === "payments") && !args.hasBackend) continue;
    // Target-specific craft snippets are already forced above; skip keyword
    // matching for them so they don't double-count toward the cap.
    if (key === "mobileCraft" || key === "backendCraft" || key === "chromeExtensionCraft") continue;
    const def = SNIPPETS[key];
    // "always" snippets are baseline reinforcements (e.g. verifyBeforeDone)
    // and ALWAYS go in. Topical snippets only fire on a keyword match.
    if (def.triggers === "always" || def.triggers.test(haystack)) {
      matched.push(key);
    }
  }

  // Cap generously — kitCore + verifyBeforeDone + noBackendGate + designFloor + up to ~12 topical.
  const picked = matched.slice(0, 16);
  const text = picked
    .map((k) => {
      const body = SNIPPETS[k].body;
      // kitCore body is a placeholder — swap in the auto-derived manifest
      // so new primitives become visible to the model the moment they
      // ship in scaffold-kit.ts.
      if (k === "kitCore") return renderKitManifestBlock();
      return body;
    })
    .join("");
  return { snippets: picked, text };
}

/**
 * Inject the actual current date into the system prompt.
 *
 * Why: LLM training data has a knowledge cutoff (typically 2024). Without
 * this, models default to writing `© 2024` in footers, "last updated 2024"
 * in copy, and similar stale year references. We give them ground truth so
 * every generated app reflects the real current year.
 */
export function renderCurrentDateBlock(now: Date = new Date()): string {
  const iso = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const year = now.getUTCFullYear();
  const human = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  return `\n\n[Current date — use this, not your training cutoff]
Today is ${human} (${iso}). The current year is ${year}.
When writing footers, copyright notices ("© ${year}"), "last updated" labels, blog post dates, or any other user-facing date, use ${year} (or a sensible recent year). Never default to 2023 or 2024.`;
}

/**
 * Best-effort schema introspection for the connected backend.
 *
 * Hits PostgREST's OpenAPI endpoint with the anon key, parses the table
 * list (and a few column names per table), and returns a compact prompt
 * block. Soft-fails on any error / timeout — we never want a missing
 * schema block to break a generation turn.
 *
 * Cached in-process for 60s per project to avoid hammering PostgREST
 * across rapid follow-up turns.
 */
type SchemaCacheEntry = { at: number; block: string };
const SCHEMA_CACHE = new Map<string, SchemaCacheEntry>();
const SCHEMA_TTL_MS = 60_000;

export async function renderSchemaBlock(args: {
  backend: { url: string; anonKey: string } | null;
  projectId?: string;
}): Promise<string> {
  if (!args.backend) return "";
  const cacheKey = args.projectId ?? args.backend.url;
  const now = Date.now();
  const cached = SCHEMA_CACHE.get(cacheKey);
  if (cached && now - cached.at < SCHEMA_TTL_MS) return cached.block;

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`${args.backend.url.replace(/\/+$/, "")}/rest/v1/`, {
      headers: {
        apikey: args.backend.anonKey,
        Authorization: `Bearer ${args.backend.anonKey}`,
        Accept: "application/openapi+json",
      },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      SCHEMA_CACHE.set(cacheKey, { at: now, block: "" });
      return "";
    }
    const spec = (await res.json()) as {
      definitions?: Record<string, { properties?: Record<string, { type?: string; format?: string }> }>;
    };
    const defs = spec.definitions ?? {};
    const tables = Object.keys(defs).filter(
      (n) => !n.startsWith("rpc/") && !/^(?:objects|buckets)$/.test(n),
    );
    if (tables.length === 0) {
      SCHEMA_CACHE.set(cacheKey, { at: now, block: "" });
      return "";
    }
    const lines = tables.slice(0, 30).map((t) => {
      const props = defs[t]?.properties ?? {};
      const cols = Object.entries(props)
        .slice(0, 12)
        .map(([k, v]) => `${k}:${v.format || v.type || "?"}`)
        .join(", ");
      return `- ${t} (${cols})`;
    });
    const more = tables.length > 30 ? `\n…and ${tables.length - 30} more` : "";
    const block = `\n\n[Connected backend tables — REAL schema, prefer reusing these]
Tables already exist in this project's database. When the user asks for a feature whose name matches one of these, query that table instead of inventing a new one. Column names listed are authoritative — do not hallucinate columns that aren't here.

${lines.join("\n")}${more}

If you need a column or table that isn't listed, add it via a fenced MIGRATION sql block at the end of your summary (with GRANT + RLS + POLICY per the full-stack feature pattern).`;
    SCHEMA_CACHE.set(cacheKey, { at: now, block });
    return block;
  } catch {
    SCHEMA_CACHE.set(cacheKey, { at: now, block: "" });
    return "";
  }
}
