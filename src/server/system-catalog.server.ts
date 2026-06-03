/**
 * System Catalog — Petal's "what can I build" surface.
 *
 * 500-ish archetypes organized by 25 verticals. Each entry is intentionally
 * tiny: id, label, parent template, recommended themes, reality tier,
 * capability tier, and a few synonym tokens used by the semantic router.
 *
 * The model NEVER sees the full catalog. We pick ONE archetype per build
 * via the semantic router (semantic-router.server.ts) and inject only that
 * entry's plan delta + reality guardrail. Catalog growth has zero
 * prompt-size cost.
 *
 * Reality tier:
 *   - "real"        — Petal can build this end-to-end
 *   - "demo-only"   — UI + simulated data only; render a DEMO banner
 *   - "keys-required" — needs provider keys to be useful (Plaid, Alchemy, …)
 *
 * Capability tier:
 *   - "web"             — desktop-first responsive web
 *   - "mobile-pwa"      — mobile-first layout, PWA-installable
 *   - "mobile-capacitor"— Capacitor wrap recommended
 *   - "fullstack"       — needs backend (Cloud) to be meaningful
 */

import type { TemplateKey } from "./templates.server";

export type RealityTier = "real" | "demo-only" | "keys-required";
export type CapabilityTier = "web" | "mobile-pwa" | "mobile-capacitor" | "fullstack";

export interface ArchetypeSpec {
  /** Stable slug, kebab-case. Logged in telemetry. */
  id: string;
  /** Short human label. Never shown to end users; used in admin dashboards. */
  label: string;
  /** Parent template that supplies the routes + block list. */
  template: TemplateKey;
  /** Vertical bucket. */
  vertical: Vertical;
  /** Reality tier — drives the system-prompt guardrail. */
  reality: RealityTier;
  /** Capability tier — drives layout defaults. */
  capability: CapabilityTier;
  /** 2–3 synonym tokens the router scores against the brief. */
  synonyms: string[];
  /** Optional: provider keys/secrets needed if reality = "keys-required". */
  needsKeys?: string[];
  /** Optional: extra route paths to append to the parent template's plan. */
  extraRoutes?: string[];
  /** Optional: one-line domain note appended to the system prompt. */
  domainNote?: string;
}

export type Vertical =
  | "saas"
  | "marketplace"
  | "ecommerce"
  | "content-media"
  | "education"
  | "health-fitness"
  | "finance"
  | "productivity"
  | "social-community"
  | "creator"
  | "local-services"
  | "real-estate"
  | "travel"
  | "food"
  | "events"
  | "nonprofit"
  | "ai-tools"
  | "developer-tools"
  | "internal-tools"
  | "civic"
  | "legal"
  | "hr"
  | "logistics"
  | "iot"
  | "games";

/* ============================================================
 * Helper to keep entries terse
 * ============================================================ */
function a(
  id: string,
  label: string,
  template: TemplateKey,
  vertical: Vertical,
  synonyms: string[],
  opts: Partial<ArchetypeSpec> = {},
): ArchetypeSpec {
  return {
    id,
    label,
    template,
    vertical,
    reality: opts.reality ?? "real",
    capability: opts.capability ?? "web",
    synonyms,
    needsKeys: opts.needsKeys,
    extraRoutes: opts.extraRoutes,
    domainNote: opts.domainNote,
  };
}

/* ============================================================
 * The Catalog
 * ============================================================ */
export const ARCHETYPES: ArchetypeSpec[] = [
  // ── SaaS ─────────────────────────────────────────────────
  a("saas-landing", "SaaS landing", "saas-landing", "saas", ["saas", "landing", "marketing site"]),
  a("saas-pricing-page", "SaaS pricing page", "saas-landing", "saas", ["pricing", "plans", "tiers"]),
  a("saas-changelog", "SaaS changelog", "blog", "saas", ["changelog", "release notes", "updates"]),
  a("saas-status-page", "Status page", "dashboard-app", "saas", ["status", "uptime", "incidents"]),
  a("saas-roadmap", "Public roadmap", "dashboard-app", "saas", ["roadmap", "feature voting", "backlog"]),
  a("saas-feedback-portal", "Feedback portal", "community-forum", "saas", ["feedback", "feature request", "ideas portal"]),
  a("saas-helpdesk", "Helpdesk / support", "dashboard-app", "saas", ["helpdesk", "support tickets", "zendesk"]),
  a("saas-knowledge-base", "Knowledge base", "blog", "saas", ["knowledge base", "docs site", "kb"]),
  a("saas-developer-docs", "Developer docs", "blog", "saas", ["api docs", "developer documentation", "sdk docs"]),
  a("saas-onboarding-checklist", "Onboarding checklist", "dashboard-app", "saas", ["onboarding", "getting started", "checklist"]),
  a("saas-billing-portal", "Billing portal", "dashboard-app", "saas", ["billing", "invoices", "subscriptions"], { capability: "fullstack" }),
  a("saas-team-workspace", "Team workspace", "dashboard-app", "saas", ["team workspace", "multi-tenant", "organizations"], { capability: "fullstack" }),
  a("saas-ab-test-dashboard", "A/B testing dashboard", "dashboard-app", "saas", ["ab test", "experiments", "split test"]),
  a("saas-analytics", "Product analytics", "dashboard-app", "saas", ["product analytics", "funnels", "events dashboard"]),
  a("saas-feature-flags", "Feature flags admin", "dashboard-app", "saas", ["feature flags", "kill switch", "rollouts"]),
  a("saas-audit-log", "Audit log viewer", "dashboard-app", "saas", ["audit log", "activity log", "compliance log"]),
  a("saas-internal-admin", "Internal admin panel", "dashboard-app", "saas", ["admin panel", "internal tool", "back office"]),
  a("saas-customer-360", "Customer 360 view", "crm", "saas", ["customer 360", "user lookup", "support console"]),
  a("saas-integrations-hub", "Integrations hub", "dashboard-app", "saas", ["integrations", "connectors", "marketplace of integrations"]),
  a("saas-webhooks-dashboard", "Webhooks dashboard", "dashboard-app", "saas", ["webhooks", "event delivery", "callbacks"]),

  // ── Marketplaces ─────────────────────────────────────────
  a("marketplace-handmade", "Handmade marketplace", "marketplace", "marketplace", ["etsy", "handmade", "craft marketplace"]),
  a("marketplace-services", "Services marketplace", "marketplace", "marketplace", ["fiverr", "service marketplace", "freelance"]),
  a("marketplace-rentals", "Two-sided rentals", "marketplace", "marketplace", ["rental marketplace", "airbnb-style", "peer-to-peer rental"]),
  a("marketplace-jobs-board", "Jobs board", "marketplace", "marketplace", ["jobs board", "career site", "indeed"]),
  a("marketplace-classifieds", "Classifieds", "marketplace", "marketplace", ["classifieds", "craigslist", "buy and sell"]),
  a("marketplace-directory", "Local directory", "marketplace", "marketplace", ["directory site", "yelp", "business directory"]),
  a("marketplace-courses", "Course marketplace", "learning-platform", "marketplace", ["course marketplace", "udemy", "skillshare"]),
  a("marketplace-templates", "Template marketplace", "marketplace", "marketplace", ["template marketplace", "design assets", "stock"]),
  a("marketplace-talent", "Talent / casting", "marketplace", "marketplace", ["casting", "talent marketplace", "model agency"]),
  a("marketplace-tutors", "Tutors marketplace", "marketplace", "marketplace", ["tutors", "tutor marketplace", "find a teacher"]),
  a("marketplace-coaches", "Coaches marketplace", "marketplace", "marketplace", ["coaches", "life coach", "fitness coach marketplace"]),
  a("marketplace-vehicles", "Vehicles marketplace", "marketplace", "marketplace", ["car marketplace", "auto trader", "vehicle listings"]),
  a("marketplace-vacation-rentals", "Vacation rentals", "real-estate", "marketplace", ["vacation rentals", "vrbo", "short term rentals"]),
  a("marketplace-event-tickets", "Ticket reseller", "event-booking", "marketplace", ["ticket marketplace", "stubhub", "event tickets"]),
  a("marketplace-pet-services", "Pet services", "marketplace", "marketplace", ["dog walker", "pet sitting", "rover"]),
  a("marketplace-home-services", "Home services", "marketplace", "marketplace", ["home services", "thumbtack", "handyman"]),
  a("marketplace-food-delivery", "Food delivery", "marketplace", "marketplace", ["food delivery", "doordash", "uber eats clone"], { capability: "mobile-pwa" }),
  a("marketplace-grocery", "Grocery delivery", "marketplace", "marketplace", ["grocery delivery", "instacart", "online grocery"]),
  a("marketplace-art", "Art marketplace", "marketplace", "marketplace", ["art marketplace", "buy art online", "gallery marketplace"]),
  a("marketplace-music", "Beats / music marketplace", "marketplace", "marketplace", ["beats marketplace", "sample pack store", "sell music"]),

  // ── E-commerce ──────────────────────────────────────────
  a("shop-fashion", "Fashion store", "ecommerce-store", "ecommerce", ["fashion store", "clothing brand", "apparel"]),
  a("shop-shoes", "Shoes store", "ecommerce-store", "ecommerce", ["shoes store", "sneakers brand"]),
  a("shop-jewelry", "Jewelry store", "ecommerce-store", "ecommerce", ["jewelry", "fine jewelry", "rings store"]),
  a("shop-watches", "Watches store", "ecommerce-store", "ecommerce", ["watch brand", "luxury watches"]),
  a("shop-cosmetics", "Cosmetics", "ecommerce-store", "ecommerce", ["beauty brand", "cosmetics shop", "skincare store"]),
  a("shop-skincare", "Skincare brand", "ecommerce-store", "ecommerce", ["skincare", "serum", "moisturizer brand"]),
  a("shop-supplements", "Supplements / nutrition", "ecommerce-store", "ecommerce", ["supplements", "nutrition", "vitamins"]),
  a("shop-coffee", "Coffee brand", "ecommerce-store", "ecommerce", ["coffee brand", "roastery", "specialty coffee"]),
  a("shop-tea", "Tea brand", "ecommerce-store", "ecommerce", ["tea brand", "loose leaf"]),
  a("shop-wine", "Wine / spirits", "ecommerce-store", "ecommerce", ["wine shop", "spirits", "liquor"]),
  a("shop-furniture", "Furniture", "ecommerce-store", "ecommerce", ["furniture store", "home goods"]),
  a("shop-home-decor", "Home decor", "ecommerce-store", "ecommerce", ["home decor", "interiors store"]),
  a("shop-plants", "Plants store", "ecommerce-store", "ecommerce", ["plants store", "online nursery"]),
  a("shop-pet-supplies", "Pet supplies", "ecommerce-store", "ecommerce", ["pet supplies", "dog food shop"]),
  a("shop-electronics", "Electronics", "ecommerce-store", "ecommerce", ["electronics", "gadgets store"]),
  a("shop-books", "Bookstore", "ecommerce-store", "ecommerce", ["bookstore", "indie bookshop"]),
  a("shop-vinyl", "Vinyl records", "ecommerce-store", "ecommerce", ["vinyl shop", "records"]),
  a("shop-toys", "Toys", "ecommerce-store", "ecommerce", ["toy store", "kids toys"]),
  a("shop-baby", "Baby products", "ecommerce-store", "ecommerce", ["baby store", "newborn"]),
  a("shop-subscription-box", "Subscription box", "ecommerce-store", "ecommerce", ["subscription box", "monthly box"]),
  a("shop-print-on-demand", "Print on demand", "ecommerce-store", "ecommerce", ["print on demand", "merch store", "tshirt brand"]),
  a("shop-digital-downloads", "Digital downloads", "ecommerce-store", "ecommerce", ["digital products", "ebook shop", "preset store"]),
  a("shop-flash-sale", "Flash sale", "ecommerce-store", "ecommerce", ["flash sale", "drop", "limited release"]),
  a("shop-pre-order", "Pre-order page", "ecommerce-store", "ecommerce", ["pre-order", "reserve now", "drop site"]),
  a("shop-single-product", "Single-product landing", "ecommerce-store", "ecommerce", ["single product", "one product site", "product launch"]),

  // ── Content / Media ─────────────────────────────────────
  a("content-blog-personal", "Personal blog", "blog", "content-media", ["personal blog", "writing site"]),
  a("content-blog-tech", "Tech blog", "blog", "content-media", ["tech blog", "engineering blog"]),
  a("content-magazine", "Online magazine", "blog", "content-media", ["online magazine", "editorial"]),
  a("content-newsletter-platform", "Newsletter platform", "blog", "content-media", ["newsletter", "substack-style"]),
  a("content-podcast-show", "Podcast show site", "podcast", "content-media", ["podcast", "audio show"]),
  a("content-podcast-network", "Podcast network", "podcast", "content-media", ["podcast network", "multi-show"]),
  a("content-video-channel", "Video channel", "podcast", "content-media", ["video channel", "vlog site", "youtube portfolio"]),
  a("content-photo-journal", "Photo journal", "blog", "content-media", ["photo journal", "photo blog"]),
  a("content-recipe-site", "Recipe site", "blog", "content-media", ["recipe site", "food blog", "cookbook"]),
  a("content-travel-blog", "Travel blog", "blog", "content-media", ["travel blog", "travelogue"]),
  a("content-news-site", "News site", "blog", "content-media", ["news site", "local news"]),
  a("content-substack-clone", "Paid newsletter", "blog", "content-media", ["paid newsletter", "subscriber newsletter"]),
  a("content-link-aggregator", "Link aggregator", "community-forum", "content-media", ["link aggregator", "hacker news clone", "reddit-lite"]),
  a("content-curation-site", "Curation site", "blog", "content-media", ["curation", "best-of list", "weekly picks"]),
  a("content-essay-collection", "Essay collection", "blog", "content-media", ["essays", "essay collection", "longform"]),
  a("content-interactive-story", "Interactive story", "blog", "content-media", ["interactive story", "scrollytelling"]),
  a("content-fiction-serial", "Fiction serial", "blog", "content-media", ["serial fiction", "wattpad-style"]),
  a("content-comic-site", "Webcomic site", "blog", "content-media", ["webcomic", "comic site"]),
  a("content-zine", "Digital zine", "blog", "content-media", ["zine", "indie publication"]),
  a("content-knowledge-wiki", "Public wiki", "blog", "content-media", ["wiki", "encyclopedia"]),

  // ── Education ───────────────────────────────────────────
  a("edu-course-platform", "Course platform", "learning-platform", "education", ["course site", "online course", "lms"]),
  a("edu-cohort-course", "Cohort course", "learning-platform", "education", ["cohort course", "live cohort"]),
  a("edu-quiz-app", "Quiz app", "learning-platform", "education", ["quiz app", "trivia"]),
  a("edu-flashcards", "Flashcards", "learning-platform", "education", ["flashcards", "spaced repetition", "anki-style"]),
  a("edu-language-learning", "Language learning", "learning-platform", "education", ["language learning", "duolingo-style"], { capability: "mobile-pwa" }),
  a("edu-tutoring-1on1", "1:1 tutoring booking", "booking-appointments", "education", ["1:1 tutoring", "private lesson booking"]),
  a("edu-school-site", "School / academy site", "agency-studio", "education", ["school site", "academy", "academic institution"]),
  a("edu-bootcamp", "Bootcamp landing", "saas-landing", "education", ["bootcamp", "coding bootcamp"]),
  a("edu-certification-prep", "Certification prep", "learning-platform", "education", ["cert prep", "exam prep"]),
  a("edu-kids-learning", "Kids learning app", "learning-platform", "education", ["kids learning", "early education"]),
  a("edu-music-lessons", "Music lessons platform", "learning-platform", "education", ["music lessons", "guitar lessons online"]),
  a("edu-cooking-class", "Cooking classes", "learning-platform", "education", ["cooking class", "culinary lessons"]),
  a("edu-sports-academy", "Sports academy", "learning-platform", "education", ["sports academy", "athletic training"]),
  a("edu-museum-virtual", "Virtual museum / archive", "agency-studio", "education", ["virtual museum", "digital archive"]),
  a("edu-research-portal", "Research portal", "blog", "education", ["research portal", "papers", "academic site"]),
  a("edu-university-portal", "University portal", "dashboard-app", "education", ["university portal", "student portal"]),
  a("edu-alumni-network", "Alumni network", "community-forum", "education", ["alumni", "alumni network"]),
  a("edu-mentorship", "Mentorship matching", "marketplace", "education", ["mentorship", "find a mentor"]),
  a("edu-study-group", "Study group app", "community-forum", "education", ["study group", "study buddies"]),
  a("edu-test-bank", "Test bank / question library", "learning-platform", "education", ["test bank", "question library"]),

  // ── Health & Fitness ────────────────────────────────────
  a("fitness-tracker-personal", "Personal fitness tracker", "fitness-tracker", "health-fitness", ["fitness tracker", "workout log"], { capability: "mobile-pwa" }),
  a("fitness-running-app", "Running app", "fitness-tracker", "health-fitness", ["running app", "strava-lite"], { capability: "mobile-pwa" }),
  a("fitness-cycling-app", "Cycling app", "fitness-tracker", "health-fitness", ["cycling app", "ride tracker"], { capability: "mobile-pwa" }),
  a("fitness-yoga-studio", "Yoga studio site", "booking-appointments", "health-fitness", ["yoga studio", "yoga classes"]),
  a("fitness-gym-site", "Gym site", "booking-appointments", "health-fitness", ["gym site", "fitness club"]),
  a("fitness-trainer-portfolio", "Personal trainer site", "portfolio", "health-fitness", ["personal trainer", "pt portfolio"]),
  a("fitness-nutrition-tracker", "Nutrition tracker", "fitness-tracker", "health-fitness", ["nutrition tracker", "calorie counter"], { capability: "mobile-pwa" }),
  a("fitness-meal-plan", "Meal plan app", "fitness-tracker", "health-fitness", ["meal plan", "diet planner"]),
  a("fitness-habit-tracker", "Habit tracker", "fitness-tracker", "health-fitness", ["habit tracker", "streaks"], { capability: "mobile-pwa" }),
  a("fitness-meditation", "Meditation app", "fitness-tracker", "health-fitness", ["meditation app", "calm clone"], { capability: "mobile-pwa" }),
  a("fitness-sleep-tracker", "Sleep tracker", "fitness-tracker", "health-fitness", ["sleep tracker"], { capability: "mobile-pwa" }),
  a("health-period-tracker", "Period / cycle tracker", "fitness-tracker", "health-fitness", ["period tracker", "cycle tracker"], { capability: "mobile-pwa" }),
  a("health-mood-journal", "Mood journal", "fitness-tracker", "health-fitness", ["mood journal", "mental health journal"], { capability: "mobile-pwa" }),
  a("health-symptom-tracker", "Symptom tracker", "fitness-tracker", "health-fitness", ["symptom tracker", "health log"]),
  a("health-medication-reminder", "Medication reminder", "fitness-tracker", "health-fitness", ["medication reminder", "pill tracker"], { capability: "mobile-pwa" }),
  a("health-clinic-site", "Clinic / practice site", "agency-studio", "health-fitness", ["clinic site", "doctor practice"]),
  a("health-telehealth", "Telehealth booking", "booking-appointments", "health-fitness", ["telehealth", "online doctor visit"], { reality: "demo-only", domainNote: "Render appointments + intake demo only — no real PHI handling, no HIPAA compliance." }),
  a("health-patient-intake", "Patient intake forms", "booking-appointments", "health-fitness", ["patient intake", "medical forms"], { reality: "demo-only" }),
  a("health-therapist-directory", "Therapist directory", "marketplace", "health-fitness", ["therapist directory", "find a therapist"]),
  a("health-dental-site", "Dental practice site", "booking-appointments", "health-fitness", ["dentist site", "dental practice"]),

  // ── Finance (mostly demo or keys-required) ──────────────
  a("fin-crypto-wallet", "Crypto wallet (demo)", "crypto-wallet-demo", "finance", ["crypto wallet", "web3 wallet", "metamask-style"], { reality: "demo-only" }),
  a("fin-neobank", "Neobank (demo)", "neobank-demo", "finance", ["online bank", "neobank", "banking app"], { reality: "demo-only" }),
  a("fin-trading-dashboard", "Trading dashboard (demo)", "trading-dashboard-demo", "finance", ["stock trading", "brokerage"], { reality: "demo-only" }),
  a("fin-defi-dashboard", "DeFi dashboard (demo)", "trading-dashboard-demo", "finance", ["defi", "yield dashboard", "tvl"], { reality: "demo-only" }),
  a("fin-nft-gallery", "NFT gallery", "marketplace", "finance", ["nft gallery", "nft showcase"], { reality: "keys-required", needsKeys: ["VITE_ALCHEMY_RPC_URL"] }),
  a("fin-onchain-balance", "On-chain balance viewer", "dashboard-app", "finance", ["wallet balance viewer", "etherscan-lite"], { reality: "keys-required", needsKeys: ["VITE_ALCHEMY_RPC_URL"], domainNote: "Use the fintech-viem-readonly example. READ-ONLY only — never sign or send tx." }),
  a("fin-bank-aggregator", "Bank aggregator", "dashboard-app", "finance", ["bank aggregator", "plaid app"], { reality: "keys-required", needsKeys: ["PLAID_CLIENT_ID", "PLAID_SECRET"] }),
  a("fin-budget-tracker", "Budget tracker", "fitness-tracker", "finance", ["budget tracker", "ynab-style"]),
  a("fin-expense-tracker", "Expense tracker", "fitness-tracker", "finance", ["expense tracker", "personal expenses"]),
  a("fin-invoicing", "Invoicing app", "dashboard-app", "finance", ["invoicing", "send invoices"]),
  a("fin-receipts-scanner", "Receipts log", "dashboard-app", "finance", ["receipts", "expense receipts"]),
  a("fin-tax-calculator", "Tax calculator", "saas-landing", "finance", ["tax calculator", "tax estimator"]),
  a("fin-loan-calculator", "Loan calculator", "saas-landing", "finance", ["loan calculator", "mortgage calculator"]),
  a("fin-mortgage-portal", "Mortgage broker site", "agency-studio", "finance", ["mortgage broker", "home loans"]),
  a("fin-insurance-quote", "Insurance quote site", "saas-landing", "finance", ["insurance quote", "compare insurance"]),
  a("fin-fintech-landing", "Fintech landing", "saas-landing", "finance", ["fintech landing", "neobank landing"]),
  a("fin-payroll-demo", "Payroll (demo)", "dashboard-app", "finance", ["payroll", "salary management"], { reality: "demo-only" }),
  a("fin-accounting-demo", "Accounting (demo)", "dashboard-app", "finance", ["accounting", "books", "ledger"], { reality: "demo-only" }),
  a("fin-crowdfunding", "Crowdfunding page", "nonprofit", "finance", ["crowdfunding", "kickstarter-style"]),
  a("fin-donation-page", "Donation page", "nonprofit", "finance", ["donation page", "give now"]),

  // ── Productivity ────────────────────────────────────────
  a("prod-todo-list", "Todo list", "fitness-tracker", "productivity", ["todo", "task list"]),
  a("prod-kanban", "Kanban board", "dashboard-app", "productivity", ["kanban", "trello-style"]),
  a("prod-notes-app", "Notes app", "fitness-tracker", "productivity", ["notes app", "notion-lite"]),
  a("prod-second-brain", "Second brain / PKM", "fitness-tracker", "productivity", ["second brain", "pkm", "obsidian-style"]),
  a("prod-mind-map", "Mind map", "dashboard-app", "productivity", ["mind map", "concept map"]),
  a("prod-okr-tracker", "OKR tracker", "dashboard-app", "productivity", ["okr", "objectives and key results"]),
  a("prod-gantt", "Gantt timeline", "dashboard-app", "productivity", ["gantt", "project timeline"]),
  a("prod-time-tracking", "Time tracking", "dashboard-app", "productivity", ["time tracking", "toggl-style"]),
  a("prod-calendar", "Calendar app", "booking-appointments", "productivity", ["calendar app", "scheduler"]),
  a("prod-pomodoro", "Pomodoro timer", "fitness-tracker", "productivity", ["pomodoro", "focus timer"]),
  a("prod-retrospective", "Retro board", "dashboard-app", "productivity", ["retro board", "sprint retro"]),
  a("prod-standup-bot", "Async stand-up", "dashboard-app", "productivity", ["async standup", "daily standup"]),
  a("prod-decision-log", "Decision log", "dashboard-app", "productivity", ["decision log", "adr"]),
  a("prod-meeting-notes", "Meeting notes", "blog", "productivity", ["meeting notes", "minutes"]),
  a("prod-bookmarks", "Bookmarks manager", "fitness-tracker", "productivity", ["bookmarks manager", "raindrop-style"]),
  a("prod-reading-list", "Reading list", "fitness-tracker", "productivity", ["reading list", "pocket-style"]),
  a("prod-password-vault", "Password vault (demo)", "dashboard-app", "productivity", ["password manager"], { reality: "demo-only", domainNote: "DEMO ONLY — never roll your own crypto. Use a placeholder vault, no real secret storage." }),
  a("prod-clipboard-history", "Clipboard history", "fitness-tracker", "productivity", ["clipboard history", "clipboard manager"]),
  a("prod-screenshot-tool", "Screenshot annotator", "fitness-tracker", "productivity", ["screenshot annotator", "markup tool"]),
  a("prod-form-builder", "Form builder", "dashboard-app", "productivity", ["form builder", "typeform-style"]),

  // ── Social / Community ──────────────────────────────────
  a("social-feed", "Social feed app", "mobile-social", "social-community", ["social feed", "instagram-style"], { capability: "mobile-pwa" }),
  a("social-microblog", "Microblog", "mobile-social", "social-community", ["microblog", "twitter-style"]),
  a("social-photo-sharing", "Photo sharing", "mobile-social", "social-community", ["photo sharing", "ig clone"], { capability: "mobile-pwa" }),
  a("social-short-video", "Short video feed", "mobile-social", "social-community", ["short video", "tiktok-style"], { capability: "mobile-pwa" }),
  a("social-dating", "Dating app", "mobile-social", "social-community", ["dating app", "swipe app"], { capability: "mobile-pwa" }),
  a("social-friends-finder", "Friends finder", "mobile-social", "social-community", ["meet new friends", "bumble bff"], { capability: "mobile-pwa" }),
  a("social-chat-1on1", "Chat app (1:1)", "mobile-social", "social-community", ["chat app", "messenger"], { capability: "fullstack" }),
  a("social-group-chat", "Group chat / Discord-lite", "mobile-social", "social-community", ["group chat", "discord-lite", "slack-lite"], { capability: "fullstack" }),
  a("social-anonymous-board", "Anonymous board", "community-forum", "social-community", ["anonymous board", "confessions"]),
  a("social-forum", "Forum", "community-forum", "social-community", ["forum", "discourse-style"]),
  a("social-qa-site", "Q&A site", "community-forum", "social-community", ["q&a site", "stack overflow clone"]),
  a("social-membership", "Membership community", "community-forum", "social-community", ["membership community", "circle-style"]),
  a("social-event-meetup", "Event meetup", "event-booking", "social-community", ["meetup", "events platform"]),
  a("social-fan-club", "Fan club / fandom", "community-forum", "social-community", ["fan club", "fandom site"]),
  a("social-pet-network", "Pet social network", "mobile-social", "social-community", ["pet social", "dog instagram"], { capability: "mobile-pwa" }),
  a("social-book-club", "Book club", "community-forum", "social-community", ["book club", "reading club"]),
  a("social-recipe-share", "Recipe sharing community", "community-forum", "social-community", ["recipe sharing", "cooking community"]),
  a("social-fitness-community", "Fitness community", "community-forum", "social-community", ["fitness community", "workout community"]),
  a("social-gaming-clan", "Gaming clan / guild", "community-forum", "social-community", ["gaming clan", "guild site"]),
  a("social-creator-fan", "Creator membership / fan platform", "community-forum", "social-community", ["patreon-style", "creator membership"]),

  // ── Creator tools ───────────────────────────────────────
  a("creator-link-in-bio", "Link in bio", "link-in-bio", "creator", ["link in bio", "linktree"], { capability: "mobile-pwa" }),
  a("creator-portfolio", "Creator portfolio", "portfolio", "creator", ["creator portfolio"]),
  a("creator-press-kit", "Press kit / EPK", "portfolio", "creator", ["press kit", "epk"]),
  a("creator-merch-drop", "Merch drop", "ecommerce-store", "creator", ["merch drop", "creator merch"]),
  a("creator-tip-jar", "Tip jar / Buy me a coffee", "link-in-bio", "creator", ["tip jar", "buy me a coffee"]),
  a("creator-newsletter-signup", "Newsletter signup", "waitlist-launch", "creator", ["newsletter signup"]),
  a("creator-membership-tiers", "Membership tiers", "saas-landing", "creator", ["membership tiers", "patreon tiers"]),
  a("creator-1on1-booking", "1:1 booking page", "booking-appointments", "creator", ["1:1 booking", "calendly clone"]),
  a("creator-portfolio-photo", "Photographer portfolio", "portfolio", "creator", ["photographer portfolio"]),
  a("creator-portfolio-video", "Videographer portfolio", "portfolio", "creator", ["videographer portfolio", "filmmaker site"]),
  a("creator-portfolio-illustration", "Illustrator portfolio", "portfolio", "creator", ["illustrator portfolio"]),
  a("creator-portfolio-design", "Designer portfolio", "portfolio", "creator", ["designer portfolio", "ux portfolio"]),
  a("creator-portfolio-writer", "Writer portfolio", "portfolio", "creator", ["writer portfolio", "journalist portfolio"]),
  a("creator-portfolio-music", "Musician site", "portfolio", "creator", ["musician site", "band site"]),
  a("creator-portfolio-actor", "Actor reel", "portfolio", "creator", ["actor reel", "actress site"]),
  a("creator-portfolio-architect", "Architect portfolio", "portfolio", "creator", ["architect portfolio"]),
  a("creator-portfolio-3d", "3D artist portfolio", "portfolio", "creator", ["3d artist portfolio"]),
  a("creator-presets-shop", "Preset shop", "ecommerce-store", "creator", ["preset shop", "lightroom presets"]),
  a("creator-template-shop", "Template shop", "ecommerce-store", "creator", ["template shop", "notion templates"]),
  a("creator-onlyfans-style", "Creator subscription site", "saas-landing", "creator", ["fan subscription", "creator subs"], { reality: "demo-only" }),

  // ── Local services ──────────────────────────────────────
  a("local-restaurant", "Restaurant site", "restaurant", "local-services", ["restaurant"]),
  a("local-cafe", "Cafe site", "restaurant", "local-services", ["cafe", "coffee shop"]),
  a("local-bakery", "Bakery site", "restaurant", "local-services", ["bakery"]),
  a("local-bar", "Bar / pub site", "restaurant", "local-services", ["bar site", "pub"]),
  a("local-food-truck", "Food truck site", "restaurant", "local-services", ["food truck"]),
  a("local-salon", "Hair salon", "booking-appointments", "local-services", ["hair salon"]),
  a("local-barber", "Barbershop", "booking-appointments", "local-services", ["barbershop", "barber"]),
  a("local-spa", "Spa / wellness", "booking-appointments", "local-services", ["spa site", "wellness center"]),
  a("local-nail-salon", "Nail salon", "booking-appointments", "local-services", ["nail salon"]),
  a("local-tattoo", "Tattoo studio", "portfolio", "local-services", ["tattoo studio", "tattoo artist"]),
  a("local-photographer-local", "Local photographer", "portfolio", "local-services", ["wedding photographer", "local photographer"]),
  a("local-handyman", "Handyman / contractor", "agency-studio", "local-services", ["handyman", "contractor site"]),
  a("local-cleaning", "Cleaning service", "agency-studio", "local-services", ["cleaning service"]),
  a("local-landscaping", "Landscaping", "agency-studio", "local-services", ["landscaping", "lawn care"]),
  a("local-plumber", "Plumber site", "agency-studio", "local-services", ["plumber", "plumbing service"]),
  a("local-electrician", "Electrician site", "agency-studio", "local-services", ["electrician"]),
  a("local-mover", "Moving company", "agency-studio", "local-services", ["moving company", "movers"]),
  a("local-driving-school", "Driving school", "learning-platform", "local-services", ["driving school"]),
  a("local-pet-grooming", "Pet grooming", "booking-appointments", "local-services", ["pet grooming", "dog groomer"]),
  a("local-childcare", "Childcare / daycare", "agency-studio", "local-services", ["daycare", "childcare", "preschool"]),

  // ── Real estate ─────────────────────────────────────────
  a("re-broker-site", "Broker site", "real-estate", "real-estate", ["real estate broker", "agent site"]),
  a("re-listings-portal", "Listings portal", "real-estate", "real-estate", ["listings portal", "zillow-clone"]),
  a("re-rentals-portal", "Rentals portal", "real-estate", "real-estate", ["rentals", "apartment rentals"]),
  a("re-property-mgmt", "Property management", "dashboard-app", "real-estate", ["property management"]),
  a("re-coworking", "Coworking space", "agency-studio", "real-estate", ["coworking", "shared office"]),
  a("re-vacation-rental-host", "Vacation rental host site", "real-estate", "real-estate", ["airbnb host", "vacation rental host"]),
  a("re-development-site", "Property development", "agency-studio", "real-estate", ["property development", "new build site"]),
  a("re-architect-portfolio", "Architecture portfolio", "portfolio", "real-estate", ["architecture portfolio"]),
  a("re-interior-design", "Interior design portfolio", "portfolio", "real-estate", ["interior design portfolio"]),
  a("re-home-staging", "Home staging", "agency-studio", "real-estate", ["home staging"]),
  a("re-mortgage-broker", "Mortgage broker", "agency-studio", "real-estate", ["mortgage broker site"]),
  a("re-storage-units", "Storage units", "ecommerce-store", "real-estate", ["storage units", "self storage"]),
  a("re-land-listings", "Land listings", "real-estate", "real-estate", ["land listings", "raw land"]),
  a("re-commercial-listings", "Commercial real estate", "real-estate", "real-estate", ["commercial real estate"]),
  a("re-realty-team", "Realty team site", "agency-studio", "real-estate", ["realty team", "agent team site"]),

  // ── Travel ──────────────────────────────────────────────
  a("travel-itinerary", "Travel itinerary planner", "fitness-tracker", "travel", ["travel itinerary", "trip planner"]),
  a("travel-tour-operator", "Tour operator", "agency-studio", "travel", ["tour operator", "guided tours"]),
  a("travel-agency", "Travel agency", "agency-studio", "travel", ["travel agency"]),
  a("travel-booking-flights", "Flight search (demo)", "marketplace", "travel", ["flight search", "kayak-style"], { reality: "demo-only" }),
  a("travel-booking-hotels", "Hotel booking (demo)", "marketplace", "travel", ["hotel booking", "booking.com style"], { reality: "demo-only" }),
  a("travel-guide-city", "City travel guide", "blog", "travel", ["city guide", "travel guide"]),
  a("travel-photography", "Travel photography portfolio", "portfolio", "travel", ["travel photography"]),
  a("travel-bnb-listing", "B&B listing", "real-estate", "travel", ["b&b", "bed and breakfast"]),
  a("travel-camp-site", "Campground / glamping", "real-estate", "travel", ["campground", "glamping site"]),
  a("travel-car-rental", "Car rental site", "ecommerce-store", "travel", ["car rental"]),
  a("travel-experience-booking", "Experience booking", "event-booking", "travel", ["experience booking", "things to do"]),
  a("travel-cruise", "Cruise booking", "agency-studio", "travel", ["cruise site"]),
  a("travel-visa-services", "Visa services", "agency-studio", "travel", ["visa services"]),
  a("travel-language-pack", "Travel phrasebook", "fitness-tracker", "travel", ["phrasebook", "travel translator"]),
  a("travel-currency-converter", "Currency converter", "saas-landing", "travel", ["currency converter"]),

  // ── Food ────────────────────────────────────────────────
  a("food-recipe-app", "Recipe app", "fitness-tracker", "food", ["recipe app"]),
  a("food-meal-prep", "Meal prep service", "ecommerce-store", "food", ["meal prep service", "meal kit"]),
  a("food-cookbook", "Digital cookbook", "blog", "food", ["digital cookbook"]),
  a("food-restaurant-chain", "Restaurant chain site", "restaurant", "food", ["restaurant chain"]),
  a("food-catering", "Catering site", "agency-studio", "food", ["catering site"]),
  a("food-private-chef", "Private chef booking", "booking-appointments", "food", ["private chef"]),
  a("food-farm-csa", "Farm / CSA box", "ecommerce-store", "food", ["farm csa", "farmers market"]),
  a("food-brewery", "Brewery site", "restaurant", "food", ["brewery", "craft brewery"]),
  a("food-distillery", "Distillery site", "restaurant", "food", ["distillery"]),
  a("food-wine-club", "Wine club", "ecommerce-store", "food", ["wine club"]),
  a("food-coffee-roastery", "Coffee roastery", "restaurant", "food", ["coffee roastery"]),
  a("food-juicery", "Juicery", "restaurant", "food", ["juicery", "juice bar"]),
  a("food-ice-cream-parlor", "Ice cream parlor", "restaurant", "food", ["ice cream shop"]),
  a("food-truck-finder", "Food truck finder", "marketplace", "food", ["food truck finder"]),

  // ── Events ──────────────────────────────────────────────
  a("event-conference", "Conference site", "event-booking", "events", ["conference site", "tech conference"]),
  a("event-music-festival", "Music festival", "event-booking", "events", ["music festival"]),
  a("event-wedding", "Wedding site", "event-booking", "events", ["wedding site"]),
  a("event-wedding-planner", "Wedding planner site", "agency-studio", "events", ["wedding planner"]),
  a("event-baby-shower", "Baby shower / event invite", "event-booking", "events", ["baby shower invite", "event invite"]),
  a("event-meetup", "Meetup group", "event-booking", "events", ["meetup group"]),
  a("event-workshop", "Workshop signup", "event-booking", "events", ["workshop signup"]),
  a("event-webinar", "Webinar landing", "event-booking", "events", ["webinar landing"]),
  a("event-hackathon", "Hackathon site", "event-booking", "events", ["hackathon"]),
  a("event-ticketing-platform", "Ticketing platform", "event-booking", "events", ["ticketing platform", "eventbrite-clone"]),
  a("event-rsvp", "RSVP page", "event-booking", "events", ["rsvp page"]),
  a("event-art-exhibition", "Art exhibition", "event-booking", "events", ["art exhibition"]),
  a("event-film-festival", "Film festival", "event-booking", "events", ["film festival"]),
  a("event-sports-tournament", "Sports tournament", "event-booking", "events", ["sports tournament", "league site"]),
  a("event-charity-gala", "Charity gala", "nonprofit", "events", ["charity gala"]),

  // ── Nonprofit ───────────────────────────────────────────
  a("ngo-mission-site", "Nonprofit mission site", "nonprofit", "nonprofit", ["nonprofit", "ngo"]),
  a("ngo-donation", "Donation portal", "nonprofit", "nonprofit", ["donation portal"]),
  a("ngo-volunteer-portal", "Volunteer portal", "nonprofit", "nonprofit", ["volunteer portal"]),
  a("ngo-impact-report", "Impact report", "nonprofit", "nonprofit", ["impact report"]),
  a("ngo-campaign", "Fundraising campaign", "nonprofit", "nonprofit", ["fundraising campaign"]),
  a("ngo-grant-portal", "Grant portal", "nonprofit", "nonprofit", ["grant portal", "grants directory"]),
  a("ngo-membership", "Association membership", "saas-landing", "nonprofit", ["association membership"]),
  a("ngo-shelter", "Animal shelter", "nonprofit", "nonprofit", ["animal shelter", "pet adoption"]),
  a("ngo-environmental", "Environmental cause", "nonprofit", "nonprofit", ["environmental cause", "climate site"]),
  a("ngo-religious-org", "Religious organization", "nonprofit", "nonprofit", ["church site", "mosque", "temple", "religious org"]),
  a("ngo-foundation", "Family foundation", "nonprofit", "nonprofit", ["family foundation"]),

  // ── AI tools ────────────────────────────────────────────
  a("ai-chat", "AI chatbot", "ai-chat-app", "ai-tools", ["ai chat", "chatbot", "gpt clone"]),
  a("ai-writing-assistant", "AI writing assistant", "ai-chat-app", "ai-tools", ["ai writing", "copy assistant"]),
  a("ai-image-gen", "AI image generator", "ai-image-generator", "ai-tools", ["image generator", "ai art"]),
  a("ai-image-edit", "AI image editor", "ai-image-generator", "ai-tools", ["image editor ai"]),
  a("ai-video-gen", "AI video generator", "ai-image-generator", "ai-tools", ["ai video"]),
  a("ai-voice-clone", "Voice cloning (demo)", "ai-chat-app", "ai-tools", ["voice clone"], { reality: "demo-only" }),
  a("ai-transcription", "Transcription app", "ai-chat-app", "ai-tools", ["transcription", "speech to text"]),
  a("ai-summarizer", "Document summarizer", "ai-chat-app", "ai-tools", ["summarizer", "document summary"]),
  a("ai-translator", "Translator", "ai-chat-app", "ai-tools", ["translator", "ai translate"]),
  a("ai-doc-qa", "Document Q&A (RAG)", "ai-chat-app", "ai-tools", ["document q&a", "rag", "chat with pdf"]),
  a("ai-resume-builder", "AI resume builder", "ai-chat-app", "ai-tools", ["resume builder"]),
  a("ai-cover-letter", "AI cover letter", "ai-chat-app", "ai-tools", ["cover letter ai"]),
  a("ai-name-generator", "Name generator", "ai-chat-app", "ai-tools", ["name generator", "brand name"]),
  a("ai-headshot", "AI headshot", "ai-image-generator", "ai-tools", ["ai headshot", "professional photo"]),
  a("ai-meme-generator", "Meme generator", "ai-image-generator", "ai-tools", ["meme generator"]),
  a("ai-coloring-book", "Coloring book pages", "ai-image-generator", "ai-tools", ["coloring book pages"]),
  a("ai-storybook", "AI storybook for kids", "ai-image-generator", "ai-tools", ["kids storybook ai"]),
  a("ai-interview-prep", "Interview prep", "ai-chat-app", "ai-tools", ["interview prep", "mock interview"]),
  a("ai-study-buddy", "AI study buddy", "ai-chat-app", "ai-tools", ["study buddy ai", "tutor ai"]),
  a("ai-agent-builder", "AI agent builder", "ai-chat-app", "ai-tools", ["agent builder", "workflow ai"]),
  a("ai-prompt-library", "Prompt library", "ai-chat-app", "ai-tools", ["prompt library", "prompt marketplace"]),

  // ── Developer tools ─────────────────────────────────────
  a("dev-api-playground", "API playground", "dashboard-app", "developer-tools", ["api playground", "request tester"]),
  a("dev-status-page", "Dev status page", "dashboard-app", "developer-tools", ["dev status page"]),
  a("dev-changelog", "Dev changelog", "blog", "developer-tools", ["dev changelog"]),
  a("dev-snippet-manager", "Snippet manager", "fitness-tracker", "developer-tools", ["snippet manager", "code snippets"]),
  a("dev-regex-tester", "Regex tester", "saas-landing", "developer-tools", ["regex tester"]),
  a("dev-json-formatter", "JSON formatter", "saas-landing", "developer-tools", ["json formatter"]),
  a("dev-uuid-gen", "UUID generator", "saas-landing", "developer-tools", ["uuid generator"]),
  a("dev-color-picker", "Color picker tools", "saas-landing", "developer-tools", ["color picker", "palette tools"]),
  a("dev-svg-tool", "SVG tools", "saas-landing", "developer-tools", ["svg tools", "svg optimizer"]),
  a("dev-cron-builder", "Cron expression builder", "saas-landing", "developer-tools", ["cron builder"]),
  a("dev-jwt-debugger", "JWT debugger", "saas-landing", "developer-tools", ["jwt debugger"]),
  a("dev-oauth-debugger", "OAuth debugger", "saas-landing", "developer-tools", ["oauth debugger"]),
  a("dev-webhooks-tester", "Webhook tester", "dashboard-app", "developer-tools", ["webhook tester"]),
  a("dev-graphql-explorer", "GraphQL explorer", "dashboard-app", "developer-tools", ["graphql explorer"]),

  // ── Internal tools ──────────────────────────────────────
  a("int-admin-panel", "Admin panel", "dashboard-app", "internal-tools", ["admin panel", "back office"]),
  a("int-crud-table", "CRUD table app", "dashboard-app", "internal-tools", ["crud table"]),
  a("int-data-explorer", "Data explorer", "dashboard-app", "internal-tools", ["data explorer", "internal analytics"]),
  a("int-approval-workflow", "Approval workflow", "dashboard-app", "internal-tools", ["approval workflow"]),
  a("int-vendor-portal", "Vendor portal", "dashboard-app", "internal-tools", ["vendor portal"]),
  a("int-customer-portal", "Customer portal", "dashboard-app", "internal-tools", ["customer portal"]),
  a("int-partner-portal", "Partner portal", "dashboard-app", "internal-tools", ["partner portal"]),
  a("int-internal-wiki", "Internal wiki", "blog", "internal-tools", ["internal wiki"]),
  a("int-runbook", "Runbook / playbook", "blog", "internal-tools", ["runbook", "incident playbook"]),
  a("int-asset-tracker", "Asset tracker", "dashboard-app", "internal-tools", ["asset tracker", "inventory tracker"]),
  a("int-fleet-tracker", "Fleet tracker", "dashboard-app", "internal-tools", ["fleet tracker"]),
  a("int-hr-directory", "HR directory", "crm", "internal-tools", ["hr directory", "employee directory"]),
  a("int-org-chart", "Org chart", "dashboard-app", "internal-tools", ["org chart"]),
  a("int-onboarding-portal", "Employee onboarding", "dashboard-app", "internal-tools", ["employee onboarding"]),
  a("int-time-off", "Time off requests", "dashboard-app", "internal-tools", ["time off requests", "pto"]),

  // ── Civic / Government ──────────────────────────────────
  a("civic-petition", "Petition site", "nonprofit", "civic", ["petition site"]),
  a("civic-political-campaign", "Political campaign", "nonprofit", "civic", ["political campaign"]),
  a("civic-municipal", "Municipal services portal", "dashboard-app", "civic", ["municipal portal", "city services"]),
  a("civic-voter-info", "Voter info site", "blog", "civic", ["voter info", "election info"]),
  a("civic-public-records", "Public records browser", "dashboard-app", "civic", ["public records"]),
  a("civic-civic-tech", "Civic tech tool", "dashboard-app", "civic", ["civic tech"]),

  // ── Legal ───────────────────────────────────────────────
  a("legal-firm-site", "Law firm site", "agency-studio", "legal", ["law firm", "lawyer site"]),
  a("legal-intake", "Legal intake form", "booking-appointments", "legal", ["legal intake"]),
  a("legal-case-mgmt", "Case management (demo)", "dashboard-app", "legal", ["case management"], { reality: "demo-only" }),
  a("legal-contract-signing", "Contract signing (demo)", "dashboard-app", "legal", ["contract signing", "esign-style"], { reality: "demo-only" }),
  a("legal-templates-library", "Legal templates library", "marketplace", "legal", ["legal templates"]),
  a("legal-paralegal-portal", "Paralegal portal", "dashboard-app", "legal", ["paralegal portal"]),

  // ── HR / Hiring ─────────────────────────────────────────
  a("hr-careers-page", "Careers page", "saas-landing", "hr", ["careers page", "company jobs"]),
  a("hr-applicant-tracking", "Applicant tracking (demo)", "dashboard-app", "hr", ["applicant tracking", "ats"], { reality: "demo-only" }),
  a("hr-interview-scheduler", "Interview scheduler", "booking-appointments", "hr", ["interview scheduler"]),
  a("hr-employee-survey", "Employee engagement survey", "dashboard-app", "hr", ["employee survey"]),
  a("hr-performance-review", "Performance review", "dashboard-app", "hr", ["performance review"]),
  a("hr-recognition", "Peer recognition", "dashboard-app", "hr", ["peer recognition", "kudos"]),
  a("hr-learning-paths", "Internal learning paths", "learning-platform", "hr", ["learning paths", "internal training"]),

  // ── Logistics ───────────────────────────────────────────
  a("log-package-tracking", "Package tracking", "dashboard-app", "logistics", ["package tracking"]),
  a("log-delivery-driver", "Delivery driver app", "dashboard-app", "logistics", ["delivery driver app"], { capability: "mobile-pwa" }),
  a("log-warehouse", "Warehouse management (demo)", "dashboard-app", "logistics", ["warehouse management"], { reality: "demo-only" }),
  a("log-shipping-quotes", "Shipping quotes", "saas-landing", "logistics", ["shipping quotes"]),
  a("log-route-planner", "Route planner", "dashboard-app", "logistics", ["route planner"]),
  a("log-courier-marketplace", "Courier marketplace", "marketplace", "logistics", ["courier marketplace"]),

  // ── IoT / Hardware ─────────────────────────────────────
  a("iot-device-dashboard", "Device dashboard", "dashboard-app", "iot", ["iot dashboard", "device dashboard"]),
  a("iot-smart-home", "Smart home control", "dashboard-app", "iot", ["smart home"], { capability: "mobile-pwa" }),
  a("iot-sensor-monitor", "Sensor monitor", "dashboard-app", "iot", ["sensor monitor"]),
  a("iot-energy-monitor", "Energy monitor", "dashboard-app", "iot", ["energy monitor"]),
  a("iot-3d-printer", "3D printer companion", "dashboard-app", "iot", ["3d printer companion"]),
  a("iot-drone-fleet", "Drone fleet", "dashboard-app", "iot", ["drone fleet"]),

  // ── Games / Entertainment ──────────────────────────────
  a("game-trivia", "Trivia game", "fitness-tracker", "games", ["trivia game"]),
  a("game-quiz-multiplayer", "Multiplayer quiz", "fitness-tracker", "games", ["multiplayer quiz", "kahoot-style"]),
  a("game-leaderboard", "Game leaderboard", "dashboard-app", "games", ["game leaderboard"]),
  a("game-tcg-collection", "TCG collection tracker", "fitness-tracker", "games", ["tcg collection", "card collection tracker"]),
  a("game-dnd-tools", "D&D / TTRPG tools", "dashboard-app", "games", ["dnd tools", "ttrpg"]),
  a("game-fantasy-sports", "Fantasy sports", "dashboard-app", "games", ["fantasy sports", "fantasy league"]),
  a("game-bracket-maker", "Bracket maker", "dashboard-app", "games", ["bracket maker", "tournament bracket"]),
  a("game-puzzle-daily", "Daily puzzle (Wordle-style)", "fitness-tracker", "games", ["daily puzzle", "wordle clone"]),
  a("game-streaming-overlay", "Streamer overlay site", "portfolio", "games", ["streamer overlay", "twitch overlay"]),
  a("game-clan-recruit", "Clan recruitment", "community-forum", "games", ["clan recruitment"]),
];

/* ============================================================
 * Lookup helpers
 * ============================================================ */
const BY_ID = new Map<string, ArchetypeSpec>(ARCHETYPES.map((a) => [a.id, a]));

export function getArchetype(id: string): ArchetypeSpec | null {
  return BY_ID.get(id) ?? null;
}

export function listArchetypeIds(): string[] {
  return ARCHETYPES.map((a) => a.id);
}

export function archetypesByVertical(v: Vertical): ArchetypeSpec[] {
  return ARCHETYPES.filter((a) => a.vertical === v);
}

/** Render the per-build reality guardrail injected into the system prompt. */
export function renderArchetypeGuardrail(arch: ArchetypeSpec): string {
  const lines: string[] = [];
  lines.push(`\n\n### Archetype: ${arch.label} [${arch.id}]`);
  if (arch.domainNote) lines.push(arch.domainNote);

  if (arch.reality === "demo-only") {
    lines.push(
      `REALITY TIER: ship as a real product. Build a polished, on-brand landing page (or full product UI) as if this were live — do NOT add "DEMO", "Demo only", "simulated data", or any disclaimer banner/badge anywhere in the user's app. Use plausible placeholder content. Do NOT import vendor SDKs that would charge or move real money.`,
    );
  } else if (arch.reality === "keys-required") {
    const keys = arch.needsKeys?.join(", ") ?? "provider keys";
    lines.push(
      `REALITY TIER: keys-required. The real version needs ${keys}. If missing, render a friendly empty state instructing the owner to add the key in Cloud → Secrets, and fall back to plausible placeholder data so the UI is still navigable. Do NOT add "demo" banners.`,
    );
  }

  if (arch.capability === "mobile-pwa" || arch.capability === "mobile-capacitor") {
    lines.push(
      `CAPABILITY: ${arch.capability}. Use mobile-first layout, bottom tab navigation, SafeArea wrapper, and touch-friendly hit areas (≥44px).`,
    );
  }

  if (arch.extraRoutes?.length) {
    lines.push(`Append these routes to the template plan: ${arch.extraRoutes.join(", ")}.`);
  }

  return lines.join("\n");
}
