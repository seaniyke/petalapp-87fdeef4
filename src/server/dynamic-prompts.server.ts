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
  | "mobileNative";

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
Speed is not a virtue here. A turn that takes 10s longer but ships working code is worth far more than a turn that streams fast and leaves the user with broken links.`,
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
  // teaches users that Petal only does one-pagers. TanStack Start's
  // file-based routing makes proper multi-page trivial; this snippet tells
  // the model to USE it and to TELL the user it did.
  multiPage: {
    triggers:
      /\b(site|website|landing|marketing|portfolio|agency|consultancy|saas|studio|business|brand|services|about|pricing|contact|blog|faq|case stud|product page)\b/i,
    body: `\n\n[Reinforcement — Prefer real pages over one long scroll]
If the brief implies multiple sections that could each stand alone (Services, About, Contact, Pricing, Blog, FAQ, Case Studies, Portfolio, Team, Careers), scaffold them as SEPARATE TanStack routes under src/routes/ — not as <section id="..."> blocks on a single index page with hash-anchor nav.

Why this matters (don't skip):
- Each route gets its own SSR <head> (title, description, og:title, og:description) — hash anchors all share the home page metadata, which makes them invisible to Google and identical when shared on social.
- Deep links like /pricing or /case-studies/$slug actually work — users can bookmark and share them.
- Adding a new page later becomes "create one file" instead of "refactor a 600-line index".

Default decomposition for marketing/business sites:
- src/routes/index.tsx — home (hero + brief highlights + CTA only; do NOT cram every section here)
- src/routes/about.tsx
- src/routes/services.tsx (or features.tsx for product sites)
- src/routes/pricing.tsx (when relevant)
- src/routes/contact.tsx
- src/routes/blog.index.tsx + src/routes/blog.$slug.tsx (when blog requested)

Each route file MUST set its own head() with route-specific title + description + og:title + og:description. Do NOT copy the home page metadata into child routes.

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

  for (const key of Object.keys(SNIPPETS) as DynamicSnippetKey[]) {
    if (key === "kitCore") continue;
    if (key === "noBackendGate") continue; // handled above
    if (key === "auth" && !args.hasBackend) continue;
    const def = SNIPPETS[key];
    // "always" snippets are baseline reinforcements (e.g. verifyBeforeDone)
    // and ALWAYS go in. Topical snippets only fire on a keyword match.
    if (def.triggers === "always" || def.triggers.test(haystack)) {
      matched.push(key);
    }
  }

  // Cap at 9 total (kitCore + verifyBeforeDone + noBackendGate + 6 topical).
  const picked = matched.slice(0, 9);
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
