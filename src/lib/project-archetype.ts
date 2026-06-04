/**
 * Project archetype registry.
 *
 * Maps a free-form user prompt to one of ~18 archetypes that cover ~92% of
 * what people actually build on AI app builders (data from Lovable gallery,
 * Bolt hackathons, v0 community, Replit Agent, Product Hunt). For each
 * archetype we store:
 *   - landing sections to ship on turn 1 (complete marketing site)
 *   - in-app features to defer to follow-up turns
 *   - providers Petal can wire later when the user asks
 *
 * Petal uses this to:
 *   1. Land a real branded marketing site first (not a half-baked dashboard).
 *   2. Save the roadmap to project memory so iteration turns pick from a
 *      coherent backlog instead of re-planning from scratch.
 *   3. Treat high-stakes domains (regulated fintech) as live products —
 *      never as "demo" disclaimers — but defer SDK imports.
 *
 * When no archetype matches, `generateFallbackArchetype` does a one-shot
 * cheap-model call to invent {productLabel, futureFeatures[3], providers[2]}
 * so EVERY first turn still ends with "here's what's queued next."
 */

export type ArchetypeId =
  | "saas-dashboard"
  | "ai-tool-wrapper"
  | "landing-waitlist"
  | "portfolio-personal-site"
  | "quiz-survey"
  | "productivity-tool"
  | "ecommerce"
  | "directory"
  | "booking-scheduling"
  | "fitness-health"
  | "crm"
  | "job-board"
  | "marketplace"
  | "media-blog"
  | "edtech"
  | "social-community"
  | "restaurant-local-biz"
  | "fintech-highstakes";

export interface ProjectArchetype {
  id: ArchetypeId;
  productLabel: string;
  /** Regulated / financial / identity — extra no-demo guarantees, no SDK imports today. */
  highStakes: boolean;
  /** Lowercase, space-or-hyphen phrases. Matched as case-insensitive substrings. */
  detectionKeywords: string[];
  /** Sections to ship in order on turn 1. */
  landingSections: string[];
  /** In-app features deferred to future turns. */
  futureFeatures: string[];
  /** Provider names the user can wire later. Do NOT import these today. */
  providersToWireLater: string[];
}

// -----------------------------------------------------------------------------
// REGISTRY
// -----------------------------------------------------------------------------

export const PROJECT_ARCHETYPES: readonly ProjectArchetype[] = [
  {
    id: "saas-dashboard",
    productLabel: "SaaS product with dashboard",
    highStakes: false,
    detectionKeywords: [
      "saas app", "subscription app", "user dashboard", "multi tenant",
      "admin panel", "saas tool for", "software as a service",
      "build me a platform", "role based access", "b2b tool",
    ],
    landingSections: [
      "NavBar with brand + logo",
      "Hero with headline + primary CTA",
      "Problem statement",
      "Feature highlights (3-6 cards)",
      "Product screenshot or demo",
      "How it works (3 steps)",
      "Pricing tiers",
      "Social proof / testimonials",
      "FAQ",
      "Final CTA banner",
      "Footer",
    ],
    futureFeatures: [
      "Team collaboration and multi-seat workspaces",
      "Usage analytics and activity logs",
      "Custom report builder",
      "API access with key management",
      "Webhook event subscriptions",
      "White-label / custom domain support",
    ],
    providersToWireLater: [
      "Stripe (subscriptions + billing portal)",
      "Resend (transactional email)",
      "PostHog (product analytics)",
      "Slack (notifications)",
    ],
  },
  {
    id: "ai-tool-wrapper",
    productLabel: "AI-powered tool",
    highStakes: false,
    detectionKeywords: [
      "ai chatbot", "chat with", "powered by gpt", "powered by openai",
      "ai assistant", "ai that can generate", "build me an ai tool",
      "ai that analyzes", "talk to your", "ai copilot", "ai agent",
      "rag app", "ai writer", "ai summarizer",
    ],
    landingSections: [
      "NavBar with brand + logo",
      "Hero with interactive demo or input box",
      "Problem it solves",
      "Feature highlights",
      "Live demo / playground preview",
      "Use cases by persona",
      "How it works",
      "Pricing tiers",
      "Social proof",
      "FAQ",
      "Final CTA",
      "Footer",
    ],
    futureFeatures: [
      "Saved conversation history per user",
      "Prompt template library",
      "Model selector",
      "Document or file upload context",
      "Usage quota UI",
    ],
    providersToWireLater: [
      "Petal AI Gateway (default — no key required)",
      "Pinecone or pgvector (RAG)",
      "ElevenLabs (voice output)",
      "Replicate (image/audio models)",
    ],
  },
  {
    id: "landing-waitlist",
    productLabel: "Product landing & waitlist",
    highStakes: false,
    detectionKeywords: [
      "landing page", "waitlist", "coming soon page", "product launch page",
      "startup homepage", "marketing site", "collect emails", "pre launch",
      "sign up for early access", "one pager",
    ],
    landingSections: [
      "NavBar with brand + logo",
      "Hero with headline + email capture",
      "Problem statement",
      "Solution overview",
      "Feature list",
      "Social proof / logos",
      "Waitlist CTA section",
      "Founder note",
      "FAQ",
      "Footer",
    ],
    futureFeatures: [
      "Referral program (share to move up waitlist)",
      "Email nurture sequence after signup",
      "A/B tested hero copy",
      "Signup analytics dashboard",
      "Blog or updates section",
    ],
    providersToWireLater: [
      "Resend (email capture + sequences)",
      "PostHog (page analytics)",
      "Cal.com (book a demo)",
    ],
  },
  {
    id: "portfolio-personal-site",
    productLabel: "Portfolio & personal site",
    highStakes: false,
    detectionKeywords: [
      "portfolio website", "personal website", "showcase my work",
      "freelancer site", "about me page", "resume website",
      "designer portfolio", "my projects gallery", "personal brand site",
    ],
    landingSections: [
      "NavBar with name + nav",
      "Hero intro (photo or wordmark)",
      "About me",
      "Skills / tech stack",
      "Projects or work gallery",
      "Experience timeline",
      "Testimonials / endorsements",
      "Writing / blog preview",
      "Contact form",
      "Footer with socials",
    ],
    futureFeatures: [
      "CMS-backed blog with markdown",
      "Downloadable PDF resume",
      "Password-protected case studies",
      "Contact form with email notification",
    ],
    providersToWireLater: [
      "Resend (contact form)",
      "Cloudinary (image optimization)",
    ],
  },
  {
    id: "quiz-survey",
    productLabel: "Quiz or survey app",
    highStakes: false,
    detectionKeywords: [
      "quiz app", "trivia game", "personality quiz", "survey tool",
      "questionnaire", "assessment tool", "test my knowledge",
      "create a quiz for", "multiple choice questions", "scoring and results",
    ],
    landingSections: [
      "NavBar with brand + logo",
      "Hero with sample question preview",
      "How it works",
      "Quiz categories or topics",
      "Leaderboard preview",
      "Use cases by audience",
      "Pricing",
      "Testimonials",
      "FAQ",
      "CTA to create quiz",
      "Footer",
    ],
    futureFeatures: [
      "Timed quiz mode with countdown",
      "Global leaderboard",
      "Certificate of completion",
      "Embeddable quiz widget",
      "AI-generated questions from a topic",
      "Branching logic for surveys",
    ],
    providersToWireLater: [
      "Stripe (paid quiz packs)",
      "Resend (results emailed)",
      "Petal AI Gateway (question generation)",
    ],
  },
  {
    id: "productivity-tool",
    productLabel: "Productivity & task app",
    highStakes: false,
    detectionKeywords: [
      "todo app", "task manager", "kanban board", "project management tool",
      "note taking app", "invoicing app", "time tracking", "habit tracker",
      "personal productivity", "team task tracking",
    ],
    landingSections: [
      "NavBar with brand + logo",
      "Hero with app screenshot",
      "Problem being solved",
      "Feature highlights",
      "Workflow demo (steps)",
      "Integrations row",
      "Pricing tiers",
      "Social proof",
      "FAQ",
      "Final CTA",
      "Footer",
    ],
    futureFeatures: [
      "Recurring task templates",
      "Team sharing and commenting",
      "Calendar sync (Google / Outlook)",
      "Bulk CSV import",
      "Time tracking with reports",
    ],
    providersToWireLater: [
      "Google Calendar API",
      "Slack (notifications)",
      "Stripe (team plan billing)",
      "Resend (deadline reminders)",
    ],
  },
  {
    id: "ecommerce",
    productLabel: "E-commerce store",
    highStakes: false,
    detectionKeywords: [
      "online store", "sell products online", "ecommerce site", "shopping cart",
      "product catalog", "sell my products", "buy now button",
      "digital downloads store", "merch store", "shop page", "storefront",
    ],
    landingSections: [
      "NavBar with cart + search",
      "Hero banner with promotion",
      "Featured products grid",
      "Category navigation",
      "Bestsellers section",
      "Brand story",
      "Trust signals (shipping, returns)",
      "Newsletter signup",
      "Reviews / testimonials",
      "Footer",
    ],
    futureFeatures: [
      "Wishlist and save for later",
      "Product reviews and ratings",
      "Discount codes and flash sales",
      "Abandoned cart email recovery",
      "Inventory low-stock alerts",
    ],
    providersToWireLater: [
      "Stripe (checkout + payment links)",
      "Shippo (shipping labels)",
      "Klaviyo (abandoned cart)",
      "Printful (print-on-demand)",
    ],
  },
  {
    id: "directory",
    productLabel: "Curated directory",
    highStakes: false,
    detectionKeywords: [
      "directory site", "listing site", "find a professional", "database of",
      "curated list of", "submit your listing", "resource directory",
      "tool directory", "find the best", "searchable database",
    ],
    landingSections: [
      "NavBar with brand + search",
      "Hero with search bar",
      "Featured / sponsored listings",
      "Categories grid",
      "How to submit",
      "Why get listed",
      "Pricing for premium listing",
      "Testimonials from listed businesses",
      "FAQ",
      "Newsletter for new listings",
      "Footer",
    ],
    futureFeatures: [
      "Verified badge system",
      "Premium / featured tiers",
      "User reviews and ratings",
      "Geolocation filtering",
      "Email alerts by category",
      "Claim your listing flow",
    ],
    providersToWireLater: [
      "Google Maps API",
      "Stripe (paid listings)",
      "Algolia (full-text search)",
      "Resend (notifications)",
    ],
  },
  {
    id: "booking-scheduling",
    productLabel: "Booking & scheduling app",
    highStakes: false,
    detectionKeywords: [
      "booking app", "appointment scheduling", "book a session", "reserve a slot",
      "calendar booking", "schedule a meeting", "availability calendar",
      "service booking", "online reservations", "book a class",
    ],
    landingSections: [
      "NavBar with brand + logo",
      "Hero with booking CTA",
      "Services offered",
      "How it works (3 steps)",
      "Provider / staff profiles",
      "Live calendar preview",
      "Pricing or packages",
      "Testimonials",
      "FAQ",
      "Contact and location",
      "Footer",
    ],
    futureFeatures: [
      "SMS and email reminders",
      "Recurring booking support",
      "Cancellation and reschedule policy",
      "Waitlist for fully-booked slots",
      "Client review after session",
    ],
    providersToWireLater: [
      "Stripe (deposit at booking)",
      "Twilio (SMS reminders)",
      "Google Calendar (provider sync)",
      "Cal.com API (scheduling engine)",
    ],
  },
  {
    id: "fitness-health",
    productLabel: "Fitness & health app",
    highStakes: false,
    detectionKeywords: [
      "fitness tracker", "workout app", "meal planning app", "calorie counter",
      "health tracking", "gym app", "nutrition tracker", "weight loss tracker",
      "running log", "wellness app",
    ],
    landingSections: [
      "NavBar with brand + logo",
      "Hero with transformation visual",
      "Core feature highlights",
      "App demo / screenshots",
      "How it works",
      "Success stories",
      "Pricing or free trial",
      "Science / methodology",
      "FAQ",
      "Final CTA",
      "Footer",
    ],
    futureFeatures: [
      "Wearable device sync (HealthKit / Google Fit)",
      "Social challenges and leaderboards",
      "Coach / trainer dashboard",
      "Progress photo log with timeline",
      "AI-generated meal plans",
      "Streak and badge gamification",
    ],
    providersToWireLater: [
      "Apple HealthKit / Google Fit",
      "Petal AI Gateway (meal suggestions)",
      "Stripe (premium plan)",
      "Twilio (check-in SMS)",
    ],
  },
  {
    id: "crm",
    productLabel: "CRM & contact manager",
    highStakes: false,
    detectionKeywords: [
      "crm app", "customer relationship management", "contact management",
      "sales pipeline", "lead tracking", "deal tracker", "personal crm for",
      "client database", "follow up tracker", "relationship manager",
    ],
    landingSections: [
      "NavBar with brand + logo",
      "Hero with pipeline screenshot",
      "Core problem solved",
      "Feature highlights",
      "Pipeline demo walkthrough",
      "Integrations grid",
      "Pricing tiers",
      "Testimonials",
      "FAQ",
      "Final CTA",
      "Footer",
    ],
    futureFeatures: [
      "Email sequence automation",
      "Meeting notes with AI summary",
      "AI deal scoring",
      "Revenue forecasting",
      "Bulk CSV import",
      "Chrome extension for lead capture",
    ],
    providersToWireLater: [
      "Gmail / Outlook API",
      "Slack (deal notifications)",
      "Stripe (invoicing)",
      "Petal AI Gateway (call summaries)",
    ],
  },
  {
    id: "job-board",
    productLabel: "Job board",
    highStakes: false,
    detectionKeywords: [
      "job board", "job listings site", "find a job", "post a job",
      "career site", "hiring platform", "niche job board", "find candidates",
      "remote jobs", "apply for jobs",
    ],
    landingSections: [
      "NavBar with brand + post-a-job CTA",
      "Hero with job search bar",
      "Featured jobs",
      "Top categories",
      "How it works for job seekers",
      "How it works for employers",
      "Employer pricing",
      "Success stories",
      "Newsletter (job alerts)",
      "FAQ",
      "Footer",
    ],
    futureFeatures: [
      "Resume upload and profile builder",
      "AI-powered job matching",
      "Saved job alerts by keyword",
      "Applicant tracking for employers",
      "Employer branding pages",
    ],
    providersToWireLater: [
      "Stripe (employer posting plans)",
      "Resend (job alerts)",
      "Algolia (job search)",
    ],
  },
  {
    id: "marketplace",
    productLabel: "Two-sided marketplace",
    highStakes: false,
    detectionKeywords: [
      "marketplace", "buy and sell platform", "connect buyers and sellers",
      "peer to peer marketplace", "list your services", "hire freelancers",
      "sell your skills", "gig marketplace", "rental marketplace",
      "service marketplace",
    ],
    landingSections: [
      "NavBar with dual CTA",
      "Hero with buyer + seller value props",
      "How it works for buyers",
      "How it works for sellers",
      "Featured listings",
      "Category grid",
      "Trust and safety",
      "Fee structure",
      "Testimonials from both sides",
      "FAQ",
      "Footer",
    ],
    futureFeatures: [
      "Escrow / milestone payments",
      "In-platform messaging",
      "Dispute resolution workflow",
      "Seller analytics dashboard",
      "Verified seller badges",
      "Review and rating system",
    ],
    providersToWireLater: [
      "Stripe Connect (split payments + payouts)",
      "Twilio (messaging)",
      "Algolia (search)",
      "Persona (seller verification)",
    ],
  },
  {
    id: "media-blog",
    productLabel: "Blog, newsletter & media site",
    highStakes: false,
    detectionKeywords: [
      "blog site", "newsletter platform", "content publication",
      "write and publish articles", "media site", "personal blog",
      "news site", "substack alternative", "publishing platform",
    ],
    landingSections: [
      "NavBar with masthead",
      "Featured articles hero",
      "Category navigation",
      "Newsletter signup callout",
      "About the publication",
      "Contributor profiles",
      "Recent posts grid",
      "Reader testimonials",
      "Footer",
    ],
    futureFeatures: [
      "Comments with moderation",
      "Subscriber-only paywalled posts",
      "Weekly email digest",
      "SEO metadata per post",
      "RSS feed",
    ],
    providersToWireLater: [
      "Resend (newsletter sends)",
      "Stripe (paid subscriber tier)",
      "Cloudinary (image CDN)",
    ],
  },
  {
    id: "edtech",
    productLabel: "Online learning platform",
    highStakes: false,
    detectionKeywords: [
      "online course platform", "learning management system", "e learning app",
      "teach online", "student dashboard", "lesson plan tool",
      "educational platform", "tutor marketplace", "skills training app",
      "course builder", "lms",
    ],
    landingSections: [
      "NavBar with brand + logo",
      "Hero with course preview",
      "Course catalog",
      "How it works",
      "Instructor profiles",
      "Student outcomes & testimonials",
      "Pricing or free trial",
      "Enterprise / team plans",
      "FAQ",
      "Final CTA",
      "Footer",
    ],
    futureFeatures: [
      "Course completion certificates",
      "Progress tracking and streaks",
      "Live session scheduling",
      "Discussion forums per course",
      "Gamification badges and XP",
      "Instructor revenue sharing",
    ],
    providersToWireLater: [
      "Stripe (course purchases)",
      "Mux (video hosting)",
      "Zoom or Daily.co (live sessions)",
      "Petal AI Gateway (AI tutoring)",
    ],
  },
  {
    id: "social-community",
    productLabel: "Social network & community",
    highStakes: false,
    detectionKeywords: [
      "community platform", "social network", "forum app", "discussion board",
      "social feed", "user profiles and posts", "community for",
      "connect with others who", "social app like", "build a community around",
    ],
    landingSections: [
      "NavBar with brand + join CTA",
      "Hero with community preview",
      "Feature highlights",
      "Sample posts / feed preview",
      "How it works",
      "Use cases by community type",
      "Pricing if white-label",
      "Testimonials from community leaders",
      "FAQ",
      "CTA to join or create",
      "Footer",
    ],
    futureFeatures: [
      "Direct messaging between members",
      "Notification system (in-app + email)",
      "Badges, reputation, roles",
      "Content moderation tools",
      "Subgroups or channels",
      "Paid membership tiers",
    ],
    providersToWireLater: [
      "Petal Cloud Realtime (live feed)",
      "Resend (digest emails)",
      "Stripe (paid access)",
      "Stream.io (chat infra)",
    ],
  },
  {
    id: "restaurant-local-biz",
    productLabel: "Restaurant & local business site",
    highStakes: false,
    detectionKeywords: [
      "restaurant website", "cafe website", "bar website",
      "local business website", "menu online", "reserve a table",
      "food ordering page", "salon website", "barbershop site",
      "small business website",
    ],
    landingSections: [
      "NavBar with brand + reserve CTA",
      "Hero with ambiance photo + reserve CTA",
      "Menu preview",
      "About us / story",
      "Gallery (food + space)",
      "Hours and location map",
      "Reservation or contact form",
      "Google reviews / testimonials",
      "Events or specials",
      "Footer",
    ],
    futureFeatures: [
      "Online ordering with delivery/pickup",
      "Loyalty points program",
      "Gift card purchase flow",
      "Event and private dining booking",
    ],
    providersToWireLater: [
      "Stripe (online orders)",
      "Google Maps API",
      "Resend (reservation confirmations)",
    ],
  },
  {
    id: "fintech-highstakes",
    productLabel: "Fintech, neobank, crypto or trading app",
    highStakes: true,
    detectionKeywords: [
      "crypto wallet", "web3 wallet", "defi wallet", "defi app",
      "neobank", "digital bank", "online bank", "banking app",
      "trading dashboard", "stock trading", "brokerage", "options trading",
      "send and receive money", "payment platform",
      "kyc verification", "identity verification",
      "lending platform", "loan origination",
      "crypto exchange", "swap tokens", "stake crypto",
      "portfolio tracker stocks",
    ],
    landingSections: [
      "NavBar with brand + logo",
      "Hero with trust signals + CTA",
      "Product overview",
      "Key features",
      "Security & compliance section",
      "How it works (steps)",
      "Supported assets / currencies",
      "Fees and limits",
      "Regulatory badges & licenses",
      "Testimonials",
      "FAQ",
      "Footer with legal disclaimers",
    ],
    futureFeatures: [
      "KYC / AML identity verification flow",
      "Multi-currency or multi-chain support",
      "Full transaction history with CSV export",
      "Two-factor authentication (TOTP / SMS)",
      "Regulatory reporting surfaces",
      "Fraud detection alerts",
    ],
    providersToWireLater: [
      "Plaid (bank account linking)",
      "Stripe Treasury or Issuing",
      "Persona / Onfido (KYC)",
      "viem or ethers.js (Web3 wallet connect)",
      "Alchemy or Infura (RPC)",
    ],
  },
];

const ARCHETYPE_BY_ID: Record<ArchetypeId, ProjectArchetype> = Object.fromEntries(
  PROJECT_ARCHETYPES.map((a) => [a.id, a]),
) as Record<ArchetypeId, ProjectArchetype>;

// -----------------------------------------------------------------------------
// DETECTION
// -----------------------------------------------------------------------------

export interface ArchetypeMatch {
  detected: boolean;
  archetype?: ProjectArchetype;
  match?: string;
}

/**
 * Match a prompt to an archetype. First-match wins; order in
 * PROJECT_ARCHETYPES matters slightly when two could apply (e.g. an
 * "ai-powered crm" — `crm` is later than `ai-tool-wrapper`, but the more
 * specific "crm" keyword still wins because we match the longest keyword).
 *
 * Strategy: scan all archetypes, score by longest matched keyword length,
 * tie-break by registry order. Cheap (<1ms for ~180 keywords).
 */
export function detectArchetype(text: string | null | undefined): ArchetypeMatch {
  if (!text) return { detected: false };
  const t = text.toLowerCase().trim();
  if (t.length < 6) return { detected: false };

  let best: { archetype: ProjectArchetype; match: string } | null = null;
  for (const archetype of PROJECT_ARCHETYPES) {
    for (const kw of archetype.detectionKeywords) {
      if (t.includes(kw)) {
        if (!best || kw.length > best.match.length) {
          best = { archetype, match: kw };
        }
      }
    }
  }
  if (!best) return { detected: false };
  return { detected: true, archetype: best.archetype, match: best.match };
}

export function getArchetype(id: ArchetypeId): ProjectArchetype {
  return ARCHETYPE_BY_ID[id];
}

// -----------------------------------------------------------------------------
// PROMPT BLOCKS
// -----------------------------------------------------------------------------

/**
 * Always-applied build instruction. For ANY archetype, force landing-first
 * + real brand + no demo banners + no theme toggle. Adds extra no-SDK
 * guarantees for high-stakes archetypes.
 */
export function archetypeBuildInstruction(archetype: ProjectArchetype): string {
  const lines = [
    `PROJECT ARCHETYPE DETECTED: ${archetype.id} (${archetype.productLabel}) — treat as a LIVE product launch.`,
    `Build a polished, on-brand marketing LANDING PAGE first. Invent a memorable brand name + logo mark if the user did not provide one; use it consistently in nav, hero, footer, and <title>.`,
    `Do NOT add a "Demo only", "Simulated data", "no real money", or any disclaimer banner anywhere in the user's app.`,
    `Do NOT add a light/dark mode toggle unless the user explicitly asks.`,
  ];
  if (archetype.highStakes) {
    lines.push(
      `HIGH-STAKES domain: do NOT import on-chain libraries (viem, ethers, web3.js), banking SDKs (Plaid, Increase, Unit), or KYC SDKs on this turn. Wire keys later when the user explicitly asks. Build the in-product dashboard only when the user asks for it in a follow-up.`,
    );
  } else {
    lines.push(
      `Do not import vendor SDKs (Stripe, Twilio, Resend, etc.) on this turn — wire them later when the user asks. Build the in-product surfaces only when the user asks for them in a follow-up.`,
    );
  }
  return lines.join(" ");
}

/**
 * Renders the saved roadmap as a prompt block: which landing sections to
 * build NOW and which features to defer. Keeps Petal landing-first instead
 * of shipping a half-built dashboard on turn 1.
 */
export function archetypeRoadmapBlock(archetype: ProjectArchetype): string {
  return [
    `### Saved roadmap — ${archetype.productLabel}`,
    `On THIS turn, ship a COMPLETE on-brand marketing landing page (real, live company feel — no "demo" banners, no disclaimers, no theme toggle). Include these sections in order:`,
    ...archetype.landingSections.map((s, i) => `  ${i + 1}. ${s}`),
    ``,
    `Pick (or invent) a short memorable brand name + logo mark and use it in the nav, hero, footer, and <title>.`,
    ``,
    `DO NOT build the in-app product yet. These are saved for future turns; the user will pick which one to iterate on next:`,
    ...archetype.futureFeatures.map((s, i) => `  ${i + 1}. ${s}`),
    ``,
    `Providers the user can wire later when they ask (do NOT import these libraries today, do NOT mention them as "limitations"):`,
    `  ${archetype.providersToWireLater.join(", ")}`,
    ``,
    `Preamble requirement: open your reply with ONE short, confident paragraph that (a) names the product by its brand name, (b) says you're shipping the landing page first and that next features (list 2-3 by name) are queued up, (c) invites the user to pick what to build next. Do NOT say "demo", "simulated", "limitation", or "cannot". Then build.`,
  ].join("\n");
}

// -----------------------------------------------------------------------------
// FALLBACK — one-shot LLM-generated archetype for unknown prompts
// -----------------------------------------------------------------------------

export interface FallbackArchetype {
  id: "custom";
  productLabel: string;
  highStakes: false;
  detectionKeywords: [];
  landingSections: string[];
  futureFeatures: string[];
  providersToWireLater: string[];
}

/**
 * One-shot cheap-model call. Used when `detectArchetype` returns nothing —
 * e.g. "build me a recipe app", "build me a wedding planner". Produces a
 * minimal roadmap (3 future features, 2 providers) using the 11-section
 * default landing checklist. ~$0.0005 per call on Gemini Flash Lite.
 *
 * Pass a function that performs an OpenAI-compatible chat completion (the
 * caller controls the gateway, auth headers, and model). Returns null on
 * any failure — caller MUST fall back to "no archetype" path gracefully.
 */
export async function generateFallbackArchetype(
  prompt: string,
  invokeChat: (body: {
    model: string;
    messages: Array<{ role: "system" | "user"; content: string }>;
    response_format?: { type: "json_object" };
  }) => Promise<{ content: string } | null>,
): Promise<FallbackArchetype | null> {
  if (!prompt || prompt.trim().length < 6) return null;

  const system = `You classify app-building prompts into a tiny roadmap. Always respond with strict JSON matching this shape:
{
  "productLabel": "Short human label, max 6 words",
  "futureFeatures": ["3 in-app features the user will want next, one sentence each"],
  "providersToWireLater": ["2 third-party services the user might integrate later, name only"]
}
No prose, no markdown fences. Avoid "demo", "simulated", "limitation". Treat every prompt as a real live product.`;

  try {
    const resp = await invokeChat({
      model: "google/gemini-3.1-flash-lite-preview",
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt.slice(0, 2000) },
      ],
      response_format: { type: "json_object" },
    });
    if (!resp?.content) return null;

    const raw = resp.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    const parsed = JSON.parse(raw) as {
      productLabel?: unknown;
      futureFeatures?: unknown;
      providersToWireLater?: unknown;
    };

    const productLabel = typeof parsed.productLabel === "string" ? parsed.productLabel.slice(0, 80) : null;
    const futureFeatures = Array.isArray(parsed.futureFeatures)
      ? parsed.futureFeatures.filter((x): x is string => typeof x === "string").slice(0, 5)
      : [];
    const providers = Array.isArray(parsed.providersToWireLater)
      ? parsed.providersToWireLater.filter((x): x is string => typeof x === "string").slice(0, 4)
      : [];

    if (!productLabel || futureFeatures.length === 0) return null;

    return {
      id: "custom",
      productLabel,
      highStakes: false,
      detectionKeywords: [],
      landingSections: DEFAULT_LANDING_SECTIONS,
      futureFeatures,
      providersToWireLater: providers.length > 0 ? providers : ["Resend (transactional email)", "Stripe (payments)"],
    };
  } catch {
    return null;
  }
}

/** 11-section default — covers any product when archetype is unknown. */
export const DEFAULT_LANDING_SECTIONS: string[] = [
  "NavBar with brand + logo",
  "Hero with headline + primary CTA",
  "Social proof / logos",
  "Feature highlights",
  "How it works",
  "Showcase or stats",
  "Testimonials",
  "Pricing",
  "FAQ",
  "Final CTA section",
  "Footer",
];

/** Render a fallback archetype as a prompt block, same shape as the registry path. */
export function fallbackRoadmapBlock(fa: FallbackArchetype): string {
  return [
    `### Saved roadmap — ${fa.productLabel}`,
    `On THIS turn, ship a COMPLETE on-brand marketing landing page (real, live company feel — no "demo" banners, no disclaimers, no theme toggle). Include these sections in order:`,
    ...fa.landingSections.map((s, i) => `  ${i + 1}. ${s}`),
    ``,
    `Pick (or invent) a short memorable brand name + logo mark and use it in the nav, hero, footer, and <title>.`,
    ``,
    `DO NOT build the in-app product yet. These are saved for future turns; the user will pick which one to iterate on next:`,
    ...fa.futureFeatures.map((s, i) => `  ${i + 1}. ${s}`),
    ``,
    `Providers the user can wire later when they ask (do NOT import these libraries today, do NOT mention them as "limitations"):`,
    `  ${fa.providersToWireLater.join(", ")}`,
    ``,
    `Preamble requirement: open your reply with ONE short, confident paragraph that (a) names the product by its brand name, (b) says you're shipping the landing page first and that next features (list 2-3 by name) are queued up, (c) invites the user to pick what to build next. Do NOT say "demo", "simulated", "limitation", or "cannot". Then build.`,
  ].join("\n");
}
