/**
 * Workstream C2 — hidden template registry.
 *
 * 16 internal app templates the brief expander / generation prompt picks
 * ONE of for every initial build. The chosen template is translated into a
 * compact prompt block that tells the builder model:
 *   - which 4–8 routes to scaffold
 *   - which kit blocks to lean on
 *   - which sections / features the user almost certainly wants
 *
 * The user NEVER sees the template name. To them it just feels like Petal
 * "got" the kind of app they were describing. Internally this drastically
 * cuts the failure mode where every project converges on a generic
 * landing-page-with-three-feature-cards.
 *
 * Override path: low-confidence matches return null and the build proceeds
 * with the model's default plan.
 */

export type TemplateKey =
  | "saas-landing"
  | "marketplace"
  | "dashboard-app"
  | "blog"
  | "portfolio"
  | "mobile-social"
  | "restaurant"
  | "fitness-tracker"
  | "event-booking"
  | "real-estate"
  | "learning-platform"
  | "crm"
  | "community-forum"
  | "podcast"
  | "nonprofit"
  | "ai-chat-app"
  | "ecommerce-store"
  | "ai-image-generator"
  | "link-in-bio"
  | "waitlist-launch"
  | "agency-studio"
  | "booking-appointments";

export interface TemplateSpec {
  key: TemplateKey;
  /** Internal one-liner. Shown to the model only. */
  description: string;
  /** 4–8 route paths the model should scaffold first. */
  routes: string[];
  /** Kit blocks the model should reuse instead of inventing UI. */
  blocks: string[];
  /** Concrete features the model must include. */
  features: string[];
  /** Keywords used by the brief scorer. Each match adds +2 to the score. */
  keywords: RegExp[];
}

export const TEMPLATES: Record<TemplateKey, TemplateSpec> = {
  "saas-landing": {
    key: "saas-landing",
    description: "Single-page SaaS marketing site: hero, features, pricing, testimonials, CTA.",
    routes: ["/", "/pricing", "/auth/sign-in", "/auth/sign-up"],
    blocks: ["Hero", "FeatureGrid", "PricingTable", "TestimonialGrid", "CTA", "SignInCard", "SignUpCard"],
    features: ["one bold hero with primary CTA", "3-tier pricing table", "trust strip with 4-6 logos", "FAQ accordion"],
    keywords: [/\bsaas\b/, /landing page/, /marketing site/, /product (page|site)/, /\bb2b\b/],
  },
  marketplace: {
    key: "marketplace",
    description: "Two-sided marketplace: browse listings, listing detail, seller profile, simple cart.",
    routes: ["/", "/browse", "/listings/$id", "/sellers/$id", "/auth/sign-in", "/account"],
    blocks: ["Hero", "FilterBar", "ProductCard", "EmptyState", "SignInCard"],
    features: ["search + category filter", "card grid with image, title, price, rating", "listing detail with gallery + seller info", "favorite/save action"],
    keywords: [/marketplace/, /etsy|airbnb|fiverr/, /buy and sell/, /two.?sided/, /listings/, /vendor/],
  },
  "dashboard-app": {
    key: "dashboard-app",
    description: "Authed dashboard app with sidebar shell, KPI grid, data table, settings.",
    routes: ["/", "/dashboard", "/dashboard/items", "/dashboard/settings", "/auth/sign-in"],
    blocks: ["SidebarShell", "KpiGrid", "StatCard", "ActivityFeed", "SectionHeader", "FilterBar", "SignInCard"],
    features: ["collapsible sidebar nav", "4 KPI cards with deltas", "filterable data table", "profile + workspace settings"],
    keywords: [/dashboard/, /admin panel/, /internal tool/, /workspace/, /control panel/],
  },
  blog: {
    key: "blog",
    description: "Editorial blog: post list, post detail, author page, about, newsletter signup.",
    routes: ["/", "/posts/$slug", "/authors/$id", "/about", "/subscribe"],
    blocks: ["Hero", "ArticleCard", "AuthorCard", "Newsletter", "FooterSection"],
    features: ["featured post + recent grid", "rich post detail with TOC", "author bio", "newsletter signup"],
    keywords: [/\bblog\b/, /publication/, /magazine/, /journal/, /newsletter/, /essays?/, /writing site/],
  },
  portfolio: {
    key: "portfolio",
    description: "Personal portfolio: hero intro, selected work grid, case study detail, contact.",
    routes: ["/", "/work/$slug", "/about", "/contact"],
    blocks: ["Hero", "WorkGrid", "CaseStudy", "ContactForm", "FooterSection"],
    features: ["bold name + tagline hero", "selected work grid with hover states", "case study with images + outcomes", "contact form"],
    keywords: [/portfolio/, /personal site/, /\bcv\b/, /\bresume\b/, /freelance.*site/, /designer site/],
  },
  "mobile-social": {
    key: "mobile-social",
    description: "Mobile-first social app: feed, post detail, profile, compose, notifications.",
    routes: ["/", "/post/$id", "/profile/$id", "/compose", "/notifications"],
    blocks: ["MobileNav", "FeedCard", "ComposeSheet", "ProfileHeader", "NotificationsList"],
    features: ["bottom-tab navigation", "scrollable feed of cards", "compose modal", "profile with stats"],
    keywords: [/social (app|network)/, /\bfeed\b/, /community app/, /sharing app/, /threads|twitter|instagram/i],
  },
  restaurant: {
    key: "restaurant",
    description: "Restaurant site: hero with reservation CTA, menu, story, gallery, reservation form.",
    routes: ["/", "/menu", "/reservations", "/story", "/contact"],
    blocks: ["Hero", "MenuSection", "Gallery", "ReservationForm", "FooterSection"],
    features: ["hero with hours + reserve CTA", "menu sectioned by course", "photo gallery", "reservation form with date/time/party-size"],
    keywords: [/restaurant/, /cafe|caf\u00e9/, /coffee shop/, /bistro/, /bakery/, /\bmenu\b/, /\bdiner\b/, /eatery/],
  },
  "fitness-tracker": {
    key: "fitness-tracker",
    description: "Fitness app: today's workout, log exercise, progress charts, programs library.",
    routes: ["/", "/workouts", "/workouts/$id", "/progress", "/profile"],
    blocks: ["MobileNav", "StatCard", "KpiGrid", "ActivityFeed", "EmptyState"],
    features: ["today screen with active workout", "exercise logging with sets/reps", "progress charts (weekly volume)", "program browser"],
    keywords: [/fitness/, /workout/, /gym/, /running app/, /strength training/, /exercise tracker/, /habit tracker/],
  },
  "event-booking": {
    key: "event-booking",
    description: "Events platform: browse events, event detail with ticket tiers, checkout, my tickets.",
    routes: ["/", "/events/$id", "/checkout", "/tickets", "/auth/sign-in"],
    blocks: ["Hero", "EventCard", "FilterBar", "PricingTable", "CheckoutSummary", "OrderConfirmation"],
    features: ["upcoming events grid with date/venue", "event detail with ticket tiers", "checkout flow (placeholder if no payments)", "my tickets list"],
    keywords: [/event/, /ticket/, /conference/, /\bmeetup\b/, /workshop booking/, /seminar/, /eventbrite/i],
  },
  "real-estate": {
    key: "real-estate",
    description: "Property listings: search, listing card grid, listing detail with gallery, agent contact.",
    routes: ["/", "/listings", "/listings/$id", "/agents/$id", "/contact"],
    blocks: ["Hero", "FilterBar", "ProductCard", "Gallery", "ContactForm"],
    features: ["search with location/price/beds filters", "listing grid with key stats", "detail with photo gallery + map placeholder", "agent contact form"],
    keywords: [/real estate/, /property listing/, /apartment/, /rental site/, /houses for/, /zillow|airbnb listings/i],
  },
  "learning-platform": {
    key: "learning-platform",
    description: "Online courses: course catalog, course detail, lesson player, my learning dashboard.",
    routes: ["/", "/courses", "/courses/$id", "/learn/$courseId/$lessonId", "/dashboard"],
    blocks: ["Hero", "CourseCard", "FilterBar", "LessonPlayer", "ProgressBar", "SignInCard"],
    features: ["course catalog with categories", "course detail with curriculum + instructor", "lesson player with sidebar nav", "progress tracking"],
    keywords: [/course/, /\blms\b/, /e-?learning/, /tutorial site/, /lesson/, /udemy|coursera|teachable/i, /education platform/],
  },
  crm: {
    key: "crm",
    description: "CRM: contacts list, contact detail with timeline, deals pipeline (kanban), activities.",
    routes: ["/", "/contacts", "/contacts/$id", "/deals", "/activities", "/auth/sign-in"],
    blocks: ["SidebarShell", "FilterBar", "ContactCard", "KanbanBoard", "ActivityFeed", "StatCard"],
    features: ["contacts table with search", "contact detail with notes + activity timeline", "deals kanban with drag-friendly columns", "task list"],
    keywords: [/\bcrm\b/, /sales pipeline/, /leads tracker/, /customer relationship/, /salesforce|hubspot|pipedrive/i],
  },
  "community-forum": {
    key: "community-forum",
    description: "Discussion forum: category list, thread list, thread detail with replies, new post.",
    routes: ["/", "/c/$category", "/t/$threadId", "/new", "/profile/$id"],
    blocks: ["CategoryGrid", "ThreadCard", "ReplyList", "ComposeSheet", "ProfileHeader"],
    features: ["category grid on home", "thread list with last-reply meta", "thread detail with nested replies", "compose new post"],
    keywords: [/forum/, /community/, /discussion/, /reddit|discourse|circle/i, /chat community/, /support community/],
  },
  podcast: {
    key: "podcast",
    description: "Podcast site: hero with latest episode, episode list, episode detail with player, about.",
    routes: ["/", "/episodes", "/episodes/$slug", "/about", "/subscribe"],
    blocks: ["Hero", "EpisodeCard", "AudioPlayer", "Newsletter", "FooterSection"],
    features: ["latest episode hero with player", "episode list with duration + date", "episode detail with show notes + chapters", "subscribe links"],
    keywords: [/podcast/, /audio show/, /show notes/, /spotify show/i, /apple podcasts/i],
  },
  nonprofit: {
    key: "nonprofit",
    description: "Nonprofit: mission hero, programs, impact stats, donate, get involved, stories.",
    routes: ["/", "/mission", "/programs", "/impact", "/donate", "/get-involved"],
    blocks: ["Hero", "StatCard", "KpiGrid", "StorySection", "DonateForm", "Newsletter"],
    features: ["mission-led hero", "program cards", "impact stats grid", "donate flow (placeholder if no payments)", "volunteer signup"],
    keywords: [/nonprofit/, /charity/, /\bngo\b/, /foundation/, /donate site/, /fundraising/, /mission.driven/],
  },
  "ai-chat-app": {
    key: "ai-chat-app",
    description: "AI chat product: chat interface, conversation history, prompt library, settings.",
    routes: ["/", "/chat", "/chat/$id", "/library", "/settings", "/auth/sign-in"],
    blocks: ["SidebarShell", "ChatStream", "MessageBubble", "PromptCard", "EmptyState", "SignInCard"],
    features: ["sidebar with conversation history", "streaming chat UI with markdown rendering", "prompt library / templates", "model + settings panel"],
    keywords: [/\bai\b chat/, /chatbot/, /\bllm\b/, /\bgpt\b/, /assistant app/, /copilot/, /chatgpt clone/i],
  },
  "ecommerce-store": {
    key: "ecommerce-store",
    description: "Single-vendor online store: product catalog, product detail with variants, cart, checkout, order confirmation.",
    routes: ["/", "/shop", "/products/$slug", "/cart", "/checkout", "/orders/$id", "/auth/sign-in"],
    blocks: ["Hero", "FilterBar", "ProductCard", "Gallery", "PricingTable", "CheckoutSummary", "OrderConfirmation", "Newsletter", "FooterSection"],
    features: ["hero with featured collection + shop CTA", "product grid with category filters", "product detail with gallery, variant picker (size/color), add-to-cart", "slide-out cart with quantities + subtotal", "checkout form (placeholder if no payments) + order confirmation"],
    keywords: [/e-?commerce/, /online (store|shop)/, /\bstore\b/, /\bshop\b/, /storefront/, /sell (products?|merch|clothing|shoes|apparel)/, /shopify/, /merch (store|shop)/, /\bcatalog\b/, /\bcart\b.*\bcheckout\b/],
  },
};

/** Render the template catalog so the design director / brief expander can pick one. */
export function renderTemplateCatalog(): string {
  return Object.values(TEMPLATES)
    .map((t) => `- "${t.key}" — ${t.description}`)
    .join("\n");
}

/** Render the chosen template's plan as a compact prompt block. */
export function renderTemplatePlanBlock(key: TemplateKey): string {
  const t = TEMPLATES[key];
  if (!t) return "";
  return (
    `\n\n### App Template (committed before this build — execute it)\n` +
    `Scope this MVP as a "${t.key}" app: ${t.description}\n` +
    `- Routes to scaffold (use these paths exactly): ${t.routes.join(", ")}\n` +
    `- Lean on these kit blocks where possible: ${t.blocks.join(", ")}\n` +
    `- Features the user almost certainly wants:\n${t.features.map((f) => `  - ${f}`).join("\n")}\n` +
    `Do NOT mention the template name in any user-facing copy or comment. The user should never see the word "${t.key}".\n`
  );
}

/** Pick a template from a brief using cheap keyword scoring. Returns null below threshold. */
export function pickTemplateForBrief(brief: string): TemplateKey | null {
  const b = brief.toLowerCase();
  const score: Record<TemplateKey, number> = Object.keys(TEMPLATES).reduce(
    (acc, k) => ({ ...acc, [k]: 0 }),
    {} as Record<TemplateKey, number>,
  );
  for (const t of Object.values(TEMPLATES)) {
    for (const re of t.keywords) if (re.test(b)) score[t.key] += 2;
  }
  let best: TemplateKey | null = null;
  let bestScore = 0;
  for (const k of Object.keys(score) as TemplateKey[]) {
    if (score[k] > bestScore) { best = k; bestScore = score[k]; }
  }
  // Confidence threshold: at least one strong keyword match. Otherwise fall
  // through to the model's default plan rather than misclassify.
  return bestScore >= 2 ? best : null;
}
