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
  | "booking-appointments"
  | "crypto-wallet-demo"
  | "neobank-demo"
  | "trading-dashboard-demo"
  | "directory-listings"
  | "job-board"
  | "classifieds"
  | "rental-marketplace"
  | "subscription-box"
  | "crowdfunding"
  | "membership-site"
  | "helpdesk-tickets"
  | "knowledge-base"
  | "wiki"
  | "status-page"
  | "changelog-roadmap"
  | "feature-voting"
  | "kanban-tasks"
  | "calendar-scheduling"
  | "invoicing-app"
  | "expense-tracker"
  | "time-tracking"
  | "okr-goals"
  | "retro-board"
  | "cms-headless"
  | "photography-portfolio"
  | "salon-spa"
  | "telehealth-demo"
  | "vacation-rental"
  | "recipe-site"
  | "newsletter-publication"
  | "alumni-network"
  | "fundraising-thermometer"
  | "civic-petition"
  | "legal-contracts-demo"
  | "iot-device-dashboard"
  | "fleet-asset-tracker"
  | "video-learning"
  | "music-streaming-demo"
  | "habit-tracker"
  | "journal-notes"
  | "recipe-meal-planner"
  | "ticketing-box-office"
  | "vendor-portal"
  | "b2b-portal"
  | "coworking-space"
  | "tour-operator"
  | "political-campaign"
  | "pwa-mobile-shell";

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
  "ai-image-generator": {
    key: "ai-image-generator",
    description: "AI image generation app: prompt composer, generation gallery, image detail, history, settings.",
    routes: ["/", "/generate", "/gallery", "/images/$id", "/history", "/settings", "/auth/sign-in"],
    blocks: ["Hero", "PromptCard", "Gallery", "EmptyState", "SidebarShell", "SignInCard"],
    features: ["bold hero with prompt input + sample outputs", "generate page with prompt, style presets, aspect ratio, generate button", "result gallery with masonry grid", "image detail with prompt + download/regenerate", "personal history sidebar"],
    keywords: [/image (generator|generation)/, /text.?to.?image/, /ai art/, /generative (art|image)/, /midjourney|dall.?e|stable diffusion|flux/i, /prompt.?to.?image/],
  },
  "link-in-bio": {
    key: "link-in-bio",
    description: "Mobile-first link-in-bio profile: avatar header, vertical link buttons, social icons, theme toggle.",
    routes: ["/", "/$username", "/edit", "/analytics", "/auth/sign-in"],
    blocks: ["ProfileHeader", "LinkButton", "SocialRow", "EmptyState", "MobileNav", "SignInCard"],
    features: ["centered avatar + name + bio", "stack of large tappable link buttons", "social icon row", "edit page with drag-to-reorder links", "simple click analytics"],
    keywords: [/link.?in.?bio/, /linktree/i, /bio (page|link)/, /creator profile/, /social links page/, /\bbeacons\b/i],
  },
  "waitlist-launch": {
    key: "waitlist-launch",
    description: "Pre-launch waitlist page: bold hero, email capture, social proof counter, referral share, FAQ.",
    routes: ["/", "/thanks", "/refer/$code", "/admin"],
    blocks: ["Hero", "Newsletter", "StatCard", "TestimonialGrid", "FaqAccordion", "FooterSection"],
    features: ["full-bleed hero with one email field + join CTA", "live waitlist counter + social proof", "thank-you page with referral link to climb the list", "FAQ + simple admin list of signups"],
    keywords: [/waitlist/, /coming soon/, /pre.?launch/, /early access/, /launch (page|site)/, /signup page/, /beta access/],
  },
  "agency-studio": {
    key: "agency-studio",
    description: "Creative agency / studio site: bold hero, services, selected work case studies, team, contact.",
    routes: ["/", "/work", "/work/$slug", "/services", "/about", "/contact"],
    blocks: ["Hero", "WorkGrid", "CaseStudy", "ServiceCard", "TeamGrid", "ContactForm", "FooterSection"],
    features: ["statement hero with agency tagline", "selected work grid with hover reveal", "case study with problem/process/outcome + images", "services list with deliverables", "team grid + contact form"],
    keywords: [/agency/, /studio site/, /design studio/, /creative studio/, /branding agency/, /web studio/, /production house/, /consultancy site/],
  },
  "booking-appointments": {
    key: "booking-appointments",
    description: "Service booking site: services list, calendar with time slots, booking form, confirmation, my bookings.",
    routes: ["/", "/services", "/book/$serviceId", "/confirmation/$id", "/bookings", "/auth/sign-in"],
    blocks: ["Hero", "ServiceCard", "Calendar", "BookingForm", "OrderConfirmation", "SignInCard"],
    features: ["hero with book-now CTA", "services with duration + price", "calendar picker with available time slots", "booking form (name/email/notes) + confirmation", "my bookings list with cancel/reschedule"],
    keywords: [/booking/, /appointment/, /calendly/i, /schedule (a|an) (call|appointment|consultation)/, /salon booking/, /barber booking/, /clinic booking/, /tutor booking/, /reservation system/],
  },
  "crypto-wallet-demo": {
    key: "crypto-wallet-demo",
    description: "DEMO crypto wallet UI with simulated balances and transactions stored in the database — NO real on-chain custody, signing, or RPC calls.",
    routes: ["/", "/wallet", "/send", "/receive", "/activity", "/settings", "/auth/sign-in"],
    blocks: ["MobileNav", "StatCard", "KpiGrid", "ActivityFeed", "EmptyState", "SignInCard"],
    features: [
      "prominent DEMO banner on the home/wallet route stating this is simulated, not a real wallet",
      "balance hero with clearly fake total (label it 'Demo balance')",
      "asset list (BTC, ETH, USDC) backed by a database table seeded with mock numbers",
      "send screen: address + amount form that inserts a row into a transactions table — never signs or broadcasts",
      "receive screen: shows a fake address + QR placeholder",
      "activity feed of mock transactions with status pills",
      "do NOT import viem/ethers/web3.js or any RPC client",
    ],
    keywords: [/crypto wallet/, /web3 wallet/, /defi wallet/, /metamask/, /seed phrase/, /self[- ]custody/, /\bsend\b.*\b(eth|btc|usdc|sol|tokens?)\b/, /\b(eth|btc|usdc|sol)\b.*\bwallet\b/],
  },
  "neobank-demo": {
    key: "neobank-demo",
    description: "DEMO neobank / online banking UI with simulated accounts and transfers stored in the database — NO real money movement, ACH, SWIFT, KYC, or card issuing.",
    routes: ["/", "/accounts", "/accounts/$id", "/transfer", "/cards", "/activity", "/settings", "/auth/sign-in"],
    blocks: ["MobileNav", "StatCard", "KpiGrid", "ActivityFeed", "EmptyState", "SignInCard"],
    features: [
      "prominent DEMO banner stating this is a simulated bank, not a real financial institution",
      "accounts overview with checking + savings cards (clearly labelled demo balances)",
      "transfer flow: from/to/amount form that updates two rows in a transactions table",
      "virtual cards screen with masked PAN placeholders",
      "activity feed grouped by date",
      "do NOT import Plaid, Increase, Unit, Treasury Prime, Marqeta, or any banking SDK",
    ],
    keywords: [/online bank/, /neobank/, /digital bank/, /banking app/, /checking account/, /savings account/, /\bbank\b.*\b(app|site|platform)\b/, /money transfer app/],
  },
  "trading-dashboard-demo": {
    key: "trading-dashboard-demo",
    description: "DEMO trading / brokerage dashboard with mock prices and a simulated portfolio in the database — NO real market data feeds, broker connections, or order execution.",
    routes: ["/", "/markets", "/markets/$symbol", "/portfolio", "/orders", "/watchlist", "/auth/sign-in"],
    blocks: ["SidebarShell", "KpiGrid", "StatCard", "FilterBar", "ActivityFeed", "EmptyState", "SignInCard"],
    features: [
      "prominent DEMO banner stating prices and orders are simulated",
      "markets list with mock tickers, prices, and 24h change (database-seeded)",
      "symbol detail with a placeholder chart and clearly fake quote",
      "buy/sell ticket that inserts a mock order row — never routes to a broker",
      "portfolio screen with positions, cost basis, and P&L computed from mock data",
      "watchlist with add/remove",
      "do NOT import broker SDKs (Alpaca, IB, Tradier) or live market data feeds",
    ],
    keywords: [/stock trading/, /brokerage/, /robinhood/i, /trading platform/, /trading app/, /\bportfolio\b.*\bstocks?\b/, /options trading/, /forex trading/],
  },
  "directory-listings": {
    key: "directory-listings",
    description: "Curated directory: searchable list of entries with categories, detail pages, submit form.",
    routes: ["/", "/browse", "/entries/$slug", "/categories/$id", "/submit"],
    blocks: ["Hero", "FilterBar", "ProductCard", "EmptyState", "ContactForm"],
    features: ["search + tag filters", "card grid of entries", "detail page with description, links, gallery", "submit-an-entry form"],
    keywords: [/directory/, /\bcurated list\b/, /\btop \d+\b/, /awesome.list/, /best of/],
  },
  "job-board": {
    key: "job-board",
    description: "Job board: search jobs, job detail with apply form, post a job, employer profile.",
    routes: ["/", "/jobs", "/jobs/$id", "/post-a-job", "/employers/$id"],
    blocks: ["Hero", "FilterBar", "ProductCard", "ContactForm", "EmptyState"],
    features: ["search by role/location/remote", "job cards with company + salary", "detail with description + apply form", "post-a-job flow"],
    keywords: [/job board/, /careers? site/, /hiring platform/, /remote jobs/, /\bgigs?\b/],
  },
  classifieds: {
    key: "classifieds",
    description: "Classifieds: post ads, browse by category, ad detail with seller contact.",
    routes: ["/", "/browse", "/ads/$id", "/post", "/account"],
    blocks: ["FilterBar", "ProductCard", "Gallery", "ContactForm", "EmptyState"],
    features: ["category browse", "ad detail with photos + price", "post-an-ad form", "saved ads"],
    keywords: [/classifieds/, /craigslist/i, /buy.sell.trade/, /local listings/],
  },
  "rental-marketplace": {
    key: "rental-marketplace",
    description: "Rentals two-sided marketplace: search, listing detail with calendar, owner profile, bookings.",
    routes: ["/", "/search", "/listings/$id", "/host/$id", "/bookings", "/list-your-place"],
    blocks: ["Hero", "FilterBar", "ProductCard", "Gallery", "Calendar", "BookingForm"],
    features: ["search with dates + filters", "listing detail with gallery + availability calendar", "booking request flow", "host onboarding"],
    keywords: [/rental marketplace/, /airbnb clone/i, /short.term rental/, /vacation rental marketplace/, /equipment rental/],
  },
  "subscription-box": {
    key: "subscription-box",
    description: "Subscription box product: hero, plan picker, what's-in-the-box, FAQ, signup.",
    routes: ["/", "/plans", "/how-it-works", "/faq", "/signup"],
    blocks: ["Hero", "PricingTable", "FeatureGrid", "TestimonialGrid", "FaqAccordion", "Newsletter"],
    features: ["bold lifestyle hero", "tiered plan picker (monthly/quarterly)", "unboxing showcase", "subscribe form (placeholder if no payments)"],
    keywords: [/subscription box/, /monthly box/, /\bcrate\b/, /curated box/],
  },
  crowdfunding: {
    key: "crowdfunding",
    description: "Crowdfunding campaign: hero with progress, story, rewards, backers, updates.",
    routes: ["/", "/campaigns/$id", "/back/$campaignId", "/updates", "/start-a-campaign"],
    blocks: ["Hero", "StatCard", "PricingTable", "ActivityFeed", "CheckoutSummary"],
    features: ["progress bar (raised / goal / backers / days left)", "story section with media", "reward tiers", "updates feed"],
    keywords: [/crowdfunding/, /kickstarter/i, /gofundme/i, /indiegogo/i, /campaign.*raise/],
  },
  "membership-site": {
    key: "membership-site",
    description: "Paid membership / community: marketing landing, member dashboard, content library, profile.",
    routes: ["/", "/join", "/dashboard", "/library", "/library/$slug", "/profile", "/auth/sign-in"],
    blocks: ["Hero", "PricingTable", "SidebarShell", "CourseCard", "ProfileHeader", "SignInCard"],
    features: ["public landing with member benefits", "member-only library grid", "content detail (article/video)", "member profile"],
    keywords: [/membership site/, /paid community/, /\bsubstack\b/i.compile ? /\bsubstack\b/i : /substack/i, /patreon/i, /\bcircle\b/i],
  },
  "helpdesk-tickets": {
    key: "helpdesk-tickets",
    description: "Customer support helpdesk: ticket list, ticket detail with thread, new ticket, agent dashboard.",
    routes: ["/", "/tickets", "/tickets/$id", "/new", "/dashboard", "/auth/sign-in"],
    blocks: ["SidebarShell", "FilterBar", "ActivityFeed", "MessageBubble", "StatCard"],
    features: ["ticket queue with status filters", "ticket detail with reply thread", "new ticket form", "agent KPIs"],
    keywords: [/helpdesk/, /support tickets?/, /zendesk/i, /intercom/i, /customer support tool/],
  },
  "knowledge-base": {
    key: "knowledge-base",
    description: "Help center / knowledge base: search, category grid, article detail with TOC, contact.",
    routes: ["/", "/categories/$slug", "/articles/$slug", "/search", "/contact"],
    blocks: ["Hero", "CategoryGrid", "ArticleCard", "FaqAccordion", "ContactForm"],
    features: ["prominent search bar hero", "category grid", "article with TOC + helpful? feedback", "contact fallback"],
    keywords: [/knowledge base/, /help center/, /\bdocs site\b/, /\bfaq site\b/, /support center/],
  },
  wiki: {
    key: "wiki",
    description: "Internal/community wiki: page tree sidebar, page view with edit, recent changes, search.",
    routes: ["/", "/wiki/$slug", "/wiki/$slug/edit", "/recent", "/search"],
    blocks: ["SidebarShell", "ArticleCard", "ActivityFeed", "EmptyState"],
    features: ["nested page tree sidebar", "rich page view with backlinks", "edit mode (textarea/markdown)", "recent changes"],
    keywords: [/\bwiki\b/, /notion clone/i, /confluence/i, /internal docs/],
  },
  "status-page": {
    key: "status-page",
    description: "Public status page: overall status hero, component grid, incidents timeline, subscribe.",
    routes: ["/", "/incidents/$id", "/history", "/subscribe"],
    blocks: ["Hero", "StatCard", "ActivityFeed", "Newsletter"],
    features: ["all-systems-operational hero with color status", "component grid (api, web, db) with uptime bars", "incidents timeline", "email/SMS subscribe"],
    keywords: [/status page/, /uptime page/, /statuspage/i, /system status/],
  },
  "changelog-roadmap": {
    key: "changelog-roadmap",
    description: "Public changelog + roadmap: timeline of releases, roadmap columns (planned/in-progress/shipped), subscribe.",
    routes: ["/", "/changelog", "/roadmap", "/subscribe"],
    blocks: ["Hero", "ActivityFeed", "KanbanBoard", "Newsletter"],
    features: ["chronological changelog with tags", "roadmap kanban", "RSS + email subscribe"],
    keywords: [/changelog site/, /product roadmap/, /release notes/, /what's new page/],
  },
  "feature-voting": {
    key: "feature-voting",
    description: "Feature request board: ideas list with upvotes, idea detail with comments, submit, roadmap.",
    routes: ["/", "/ideas", "/ideas/$id", "/submit", "/roadmap"],
    blocks: ["FilterBar", "ThreadCard", "ReplyList", "ComposeSheet", "KanbanBoard"],
    features: ["ideas list sortable by votes", "upvote button + status pill", "idea detail with comment thread", "roadmap kanban"],
    keywords: [/feature request/, /upvote.*ideas/, /canny/i, /featurebase/i, /product feedback/],
  },
  "kanban-tasks": {
    key: "kanban-tasks",
    description: "Project management: kanban board, task detail, projects list, members.",
    routes: ["/", "/projects", "/projects/$id", "/projects/$id/tasks/$taskId", "/auth/sign-in"],
    blocks: ["SidebarShell", "KanbanBoard", "ContactCard", "ActivityFeed", "SignInCard"],
    features: ["multi-column kanban with drag-friendly cards", "task detail with description + comments + checklists", "projects list", "member assignment"],
    keywords: [/kanban/, /trello/i, /project management/, /task tracker/, /asana/i, /linear clone/i],
  },
  "calendar-scheduling": {
    key: "calendar-scheduling",
    description: "Calendar app: month/week views, event detail, create event, my calendars.",
    routes: ["/", "/calendar", "/events/$id", "/new", "/settings"],
    blocks: ["SidebarShell", "Calendar", "BookingForm", "EmptyState"],
    features: ["month + week views", "event detail modal", "create-event form", "multiple calendars with color toggles"],
    keywords: [/calendar app/, /scheduling app/, /google calendar clone/i, /\bagenda\b/],
  },
  "invoicing-app": {
    key: "invoicing-app",
    description: "Freelancer invoicing: invoices list, invoice editor, clients list, invoice public view.",
    routes: ["/", "/invoices", "/invoices/$id", "/invoices/new", "/clients", "/clients/$id", "/auth/sign-in"],
    blocks: ["SidebarShell", "FilterBar", "StatCard", "ContactCard", "OrderConfirmation"],
    features: ["invoices table with status (draft/sent/paid)", "invoice editor with line items + totals", "clients CRUD", "public read-only invoice view"],
    keywords: [/invoicing/, /freelance invoices/, /\binvoices?\b.*\bapp\b/, /billing app/],
  },
  "expense-tracker": {
    key: "expense-tracker",
    description: "Personal finance / expense tracker: dashboard with charts, transactions list, categories, budgets.",
    routes: ["/", "/transactions", "/categories", "/budgets", "/settings"],
    blocks: ["SidebarShell", "KpiGrid", "StatCard", "FilterBar", "ActivityFeed"],
    features: ["spending dashboard with month-over-month KPIs", "transactions list with category tags", "budget vs actual bars", "add-transaction form"],
    keywords: [/expense tracker/, /personal finance/, /budget app/, /money tracker/, /spending tracker/],
  },
  "time-tracking": {
    key: "time-tracking",
    description: "Time tracker: timer, timesheet, projects/clients, reports.",
    routes: ["/", "/timer", "/timesheet", "/projects", "/reports", "/auth/sign-in"],
    blocks: ["SidebarShell", "StatCard", "FilterBar", "ActivityFeed", "KpiGrid"],
    features: ["start/stop timer with project picker", "weekly timesheet grid", "projects + clients", "reports with totals"],
    keywords: [/time tracking/, /toggl/i, /harvest/i, /timesheet/],
  },
  "okr-goals": {
    key: "okr-goals",
    description: "OKR / goals tracker: company objectives tree, key results with progress, check-ins.",
    routes: ["/", "/objectives", "/objectives/$id", "/check-ins", "/teams"],
    blocks: ["SidebarShell", "StatCard", "ActivityFeed", "KpiGrid"],
    features: ["objective tree with nested KRs", "progress bars per KR", "weekly check-in form", "team filters"],
    keywords: [/\bokrs?\b/, /goal tracking/, /objectives.*key results/],
  },
  "retro-board": {
    key: "retro-board",
    description: "Sprint retrospective board: columns (went well / improve / actions), sticky cards, voting.",
    routes: ["/", "/boards/$id", "/new", "/templates"],
    blocks: ["KanbanBoard", "ComposeSheet", "EmptyState"],
    features: ["3-4 columns of sticky cards", "add card + upvote", "group similar cards", "export summary"],
    keywords: [/retrospective/, /retro board/, /sprint retro/, /funretro/i],
  },
  "cms-headless": {
    key: "cms-headless",
    description: "Mini CMS: collections list, entries CRUD with rich-text editor, media library, settings.",
    routes: ["/", "/collections", "/collections/$slug", "/collections/$slug/$entryId", "/media", "/settings"],
    blocks: ["SidebarShell", "FilterBar", "ArticleCard", "EmptyState"],
    features: ["collections sidebar", "entries table per collection", "entry editor with title + body + meta", "media library grid"],
    keywords: [/headless cms/, /\bcms\b/, /content manager/, /sanity/i, /strapi/i, /contentful/i],
  },
  "photography-portfolio": {
    key: "photography-portfolio",
    description: "Photography portfolio: full-bleed gallery hero, project grids, project detail with lightbox, about, contact.",
    routes: ["/", "/projects/$slug", "/about", "/contact"],
    blocks: ["Hero", "Gallery", "WorkGrid", "ContactForm", "FooterSection"],
    features: ["full-bleed image hero", "masonry project grid", "project detail with lightbox", "contact form"],
    keywords: [/photography portfolio/, /photographer site/, /photo portfolio/, /wedding photographer/, /editorial photo/],
  },
  "salon-spa": {
    key: "salon-spa",
    description: "Salon / spa / barber site: hero with book CTA, services + prices, team, gallery, booking.",
    routes: ["/", "/services", "/team", "/gallery", "/book", "/contact"],
    blocks: ["Hero", "ServiceCard", "TeamGrid", "Gallery", "BookingForm"],
    features: ["hero with book-now CTA", "services with duration + price", "team with bios", "booking form with date/time/staff"],
    keywords: [/salon/, /\bspa\b/, /barber/, /nail (salon|bar)/, /hair stylist/, /beauty studio/],
  },
  "telehealth-demo": {
    key: "telehealth-demo",
    description: "DEMO telehealth UI: providers list, book consult, patient dashboard with mock visit history. NO real PHI, scheduling integrations, or video.",
    routes: ["/", "/providers", "/providers/$id", "/book/$providerId", "/dashboard", "/auth/sign-in"],
    blocks: ["Hero", "ContactCard", "Calendar", "BookingForm", "ActivityFeed"],
    features: ["DEMO banner — not for real medical use", "providers grid", "book a consult flow", "patient dashboard with mock past visits", "do NOT integrate Twilio Video or any EHR"],
    keywords: [/telehealth/, /telemedicine/, /doctor on demand/, /virtual clinic/],
  },
  "vacation-rental": {
    key: "vacation-rental",
    description: "Single-property vacation rental site: hero, gallery, amenities, location, availability calendar, book.",
    routes: ["/", "/gallery", "/amenities", "/location", "/book", "/contact"],
    blocks: ["Hero", "Gallery", "FeatureGrid", "Calendar", "BookingForm"],
    features: ["hero with stunning photo + book CTA", "gallery", "amenities grid", "availability calendar", "booking inquiry form"],
    keywords: [/vacation rental/, /cabin rental/, /villa rental/, /\bairbnb\b.*single/, /\bbnb\b site/],
  },
  "recipe-site": {
    key: "recipe-site",
    description: "Recipe site: recipe grid, recipe detail with ingredients + steps, categories, search, saved.",
    routes: ["/", "/recipes/$slug", "/categories/$slug", "/search", "/saved"],
    blocks: ["Hero", "FilterBar", "ProductCard", "ArticleCard", "EmptyState"],
    features: ["hero with featured recipe", "recipe grid filtered by cuisine/diet", "recipe detail with ingredients checklist + step images", "save-for-later"],
    keywords: [/recipe site/, /food blog/, /cookbook/, /\brecipes?\b.*\bapp\b/],
  },
  "newsletter-publication": {
    key: "newsletter-publication",
    description: "Newsletter publication: latest issue hero, archive, issue detail, subscribe, about author.",
    routes: ["/", "/issues/$slug", "/archive", "/subscribe", "/about"],
    blocks: ["Hero", "ArticleCard", "Newsletter", "AuthorCard", "FooterSection"],
    features: ["latest issue hero", "issue archive grid", "long-form issue page", "subscribe form everywhere"],
    keywords: [/newsletter site/, /substack/i, /beehiiv/i, /\bzine\b/],
  },
  "alumni-network": {
    key: "alumni-network",
    description: "Alumni / member directory: searchable directory, member profile, events, mentorship signup.",
    routes: ["/", "/directory", "/members/$id", "/events", "/mentorship", "/auth/sign-in"],
    blocks: ["FilterBar", "ContactCard", "EventCard", "ProfileHeader", "SignInCard"],
    features: ["directory with filters (year, industry, location)", "member profile with contact + bio", "events list", "mentor/mentee signup"],
    keywords: [/alumni/, /class of/, /\bnetwork\b.*members/, /\bassociation\b site/],
  },
  "fundraising-thermometer": {
    key: "fundraising-thermometer",
    description: "Fundraising campaign page: big thermometer, story, donor wall, donate CTA.",
    routes: ["/", "/donate", "/donors", "/updates"],
    blocks: ["Hero", "StatCard", "DonateForm", "ActivityFeed", "Newsletter"],
    features: ["giant progress thermometer hero", "compelling story section", "recent donors wall", "donate flow (placeholder if no payments)"],
    keywords: [/fundraiser/, /thermometer/, /raise.*goal/, /\bgofundme\b/i],
  },
  "civic-petition": {
    key: "civic-petition",
    description: "Petition / civic campaign: petition statement, sign form, signatures count, share, updates.",
    routes: ["/", "/sign", "/signatures", "/updates", "/share"],
    blocks: ["Hero", "StatCard", "ContactForm", "ActivityFeed"],
    features: ["bold statement hero with signature count", "sign form (name/email/comment)", "live signatures wall", "share buttons"],
    keywords: [/petition/, /change\.org/i, /\bcivic\b/, /campaign site/],
  },
  "legal-contracts-demo": {
    key: "legal-contracts-demo",
    description: "DEMO contract management: templates, draft a contract, send for signature (mock), status dashboard. NO real e-signature legality.",
    routes: ["/", "/templates", "/contracts", "/contracts/$id", "/sign/$token", "/auth/sign-in"],
    blocks: ["SidebarShell", "FilterBar", "ArticleCard", "OrderConfirmation"],
    features: ["DEMO banner — not legally binding", "template gallery", "contract editor", "fake e-sign flow", "do NOT integrate DocuSign/HelloSign"],
    keywords: [/contract management/, /e-?signature/, /docusign/i, /legal docs app/],
  },
  "iot-device-dashboard": {
    key: "iot-device-dashboard",
    description: "IoT device dashboard: devices grid with status, device detail with sensor charts (mock data), alerts, settings.",
    routes: ["/", "/devices", "/devices/$id", "/alerts", "/settings", "/auth/sign-in"],
    blocks: ["SidebarShell", "KpiGrid", "StatCard", "ActivityFeed", "FilterBar"],
    features: ["devices grid with online/offline status", "device detail with mock sensor charts", "alerts feed", "settings"],
    keywords: [/\biot\b/, /smart home/, /sensor dashboard/, /device monitoring/],
  },
  "fleet-asset-tracker": {
    key: "fleet-asset-tracker",
    description: "Fleet / asset tracker: assets list, asset detail with mock GPS map placeholder, maintenance log.",
    routes: ["/", "/assets", "/assets/$id", "/maintenance", "/reports"],
    blocks: ["SidebarShell", "FilterBar", "StatCard", "ActivityFeed", "KpiGrid"],
    features: ["assets table with status", "asset detail with map placeholder + telemetry", "maintenance log", "reports"],
    keywords: [/fleet (management|tracking)/, /asset tracker/, /vehicle tracker/, /gps tracking/],
  },
  "video-learning": {
    key: "video-learning",
    description: "Video-first course platform: video catalog, video player page, playlists, my library.",
    routes: ["/", "/videos", "/videos/$id", "/playlists/$id", "/library", "/auth/sign-in"],
    blocks: ["Hero", "FilterBar", "CourseCard", "LessonPlayer", "SidebarShell"],
    features: ["video grid with thumbnails", "player page with description + related", "playlists", "my library with progress"],
    keywords: [/video (course|learning|platform)/, /youtube clone/i, /vimeo/i, /tutorials site/],
  },
  "music-streaming-demo": {
    key: "music-streaming-demo",
    description: "DEMO music streaming UI: library, album/playlist detail, mini-player, search. Uses mock track metadata only — NO real streaming licenses.",
    routes: ["/", "/library", "/albums/$id", "/playlists/$id", "/search"],
    blocks: ["SidebarShell", "Gallery", "FilterBar", "AudioPlayer", "EmptyState"],
    features: ["DEMO banner", "library grid of mock albums", "album detail with track list", "persistent mini player UI", "do NOT integrate Spotify/Apple Music APIs"],
    keywords: [/music (streaming|app)/, /spotify clone/i, /apple music clone/i],
  },
  "habit-tracker": {
    key: "habit-tracker",
    description: "Habit tracker: today's habits with check-off, streaks, weekly/monthly heatmap, add habit.",
    routes: ["/", "/today", "/habits", "/habits/$id", "/stats"],
    blocks: ["MobileNav", "StatCard", "ActivityFeed", "EmptyState"],
    features: ["today list with tap-to-complete", "streak counters", "calendar heatmap per habit", "add habit form"],
    keywords: [/habit tracker/, /streaks app/, /daily habits/, /\bhabits?\b.*\bapp\b/],
  },
  "journal-notes": {
    key: "journal-notes",
    description: "Notes / journal app: sidebar of notes, note editor, daily journal, tags.",
    routes: ["/", "/notes", "/notes/$id", "/journal", "/tags/$tag"],
    blocks: ["SidebarShell", "ArticleCard", "EmptyState"],
    features: ["sidebar list of notes", "rich-text editor", "daily journal entries", "tag filtering"],
    keywords: [/notes app/, /journal app/, /\bdiary\b/, /bear notes/i, /apple notes/i, /obsidian/i],
  },
  "recipe-meal-planner": {
    key: "recipe-meal-planner",
    description: "Meal planner: weekly meal grid, recipe library, shopping list auto-generated, pantry.",
    routes: ["/", "/plan", "/recipes", "/recipes/$slug", "/shopping-list", "/pantry"],
    blocks: ["SidebarShell", "Calendar", "ProductCard", "FilterBar", "EmptyState"],
    features: ["weekly meal grid (drag recipes onto days)", "recipe library", "auto shopping list from week's meals", "pantry inventory"],
    keywords: [/meal planner/, /meal planning/, /weekly meals/, /shopping list app/],
  },
  "ticketing-box-office": {
    key: "ticketing-box-office",
    description: "Venue / box office ticketing: shows list, show detail with seat map placeholder, checkout, my tickets.",
    routes: ["/", "/shows/$id", "/checkout", "/tickets", "/auth/sign-in"],
    blocks: ["Hero", "EventCard", "PricingTable", "CheckoutSummary", "OrderConfirmation"],
    features: ["shows grid with date/venue", "show detail with seat map placeholder + ticket tiers", "checkout (placeholder if no payments)", "my tickets with QR placeholder"],
    keywords: [/box office/, /venue tickets/, /theater tickets/, /concert tickets/],
  },
  "vendor-portal": {
    key: "vendor-portal",
    description: "Vendor / supplier portal: orders received, fulfillment, invoices, profile.",
    routes: ["/", "/orders", "/orders/$id", "/invoices", "/profile", "/auth/sign-in"],
    blocks: ["SidebarShell", "FilterBar", "StatCard", "ActivityFeed", "SignInCard"],
    features: ["orders table with status", "order detail with line items + ship action", "invoices list", "vendor profile"],
    keywords: [/vendor portal/, /supplier portal/, /partner portal/],
  },
  "b2b-portal": {
    key: "b2b-portal",
    description: "B2B customer portal: account overview, orders/usage, billing, support, documents, team.",
    routes: ["/", "/overview", "/orders", "/billing", "/support", "/documents", "/team"],
    blocks: ["SidebarShell", "KpiGrid", "StatCard", "FilterBar", "ContactCard"],
    features: ["account overview KPIs", "orders / usage table", "billing + invoices", "support ticket list", "team management"],
    keywords: [/customer portal/, /\bb2b\b portal/, /client portal/, /account portal/],
  },
  "coworking-space": {
    key: "coworking-space",
    description: "Coworking space site: hero, plans (hot desk / dedicated / office), tour booking, amenities, location.",
    routes: ["/", "/plans", "/tour", "/amenities", "/location", "/contact"],
    blocks: ["Hero", "PricingTable", "FeatureGrid", "BookingForm", "Gallery"],
    features: ["lifestyle hero with book-tour CTA", "plan tiers", "tour booking form", "amenities + gallery"],
    keywords: [/coworking/, /shared workspace/, /\bweWork\b/i, /office space/],
  },
  "tour-operator": {
    key: "tour-operator",
    description: "Tour operator: tour catalog, tour detail with itinerary + dates, booking inquiry, about.",
    routes: ["/", "/tours/$slug", "/destinations/$slug", "/book", "/about"],
    blocks: ["Hero", "FilterBar", "ProductCard", "Gallery", "BookingForm"],
    features: ["tour catalog with destination filter", "tour detail with day-by-day itinerary + photos", "booking inquiry form"],
    keywords: [/tour operator/, /travel tours/, /guided tours/, /safari booking/, /trekking tours/],
  },
  "political-campaign": {
    key: "political-campaign",
    description: "Political campaign site: candidate hero, issues, events, volunteer signup, donate.",
    routes: ["/", "/issues", "/events", "/volunteer", "/donate", "/about"],
    blocks: ["Hero", "FeatureGrid", "EventCard", "ContactForm", "DonateForm"],
    features: ["candidate hero with bold tagline", "issues grid", "events with RSVP", "volunteer signup", "donate flow (placeholder if no payments)"],
    keywords: [/political campaign/, /candidate site/, /campaign for/, /\belection\b site/],
  },
  "pwa-mobile-shell": {
    key: "pwa-mobile-shell",
    description: "Mobile-first PWA shell: bottom-tab nav, home/feed/profile/settings tabs, installable PWA manifest.",
    routes: ["/", "/feed", "/explore", "/profile", "/settings"],
    blocks: ["MobileNav", "FeedCard", "ProfileHeader", "EmptyState"],
    features: ["bottom-tab nav with 4-5 tabs", "mobile-first layouts (max-w 430px content)", "installable PWA (manifest + icons)", "safe-area aware"],
    keywords: [/mobile app/, /\bpwa\b/, /\bios\b app/, /android app/, /native.?feel/],
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
