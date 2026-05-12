/**
 * Layer I — App-Shape Classifier.
 *
 * Pure rule-based classifier that runs before generation on a free-form
 * user prompt. Predicts which surfaces (landing, auth, dashboard, admin,
 * webhooks, public-detail, settings, kyc) the app likely needs, the
 * Cloud features to enable, and likely third-party integrations.
 *
 * The output is rendered into a "## Predicted app shape" block injected
 * into the system prompt so the LLM scaffolds the right pages with the
 * right backend rather than producing one dashboard page and stopping.
 *
 * Pure function, no IO, safe in browser or server. Deterministic so the
 * same prompt always produces the same shape (testable, debuggable).
 */

export type Surface =
  | "landing"
  | "auth"
  | "dashboard"
  | "admin"
  | "settings"
  | "public-detail"
  | "webhooks"
  | "kyc"
  | "checkout"
  | "messages";

export type ShapeCategory =
  | "fintech"
  | "crypto"
  | "saas"
  | "ecommerce"
  | "marketplace"
  | "social"
  | "messaging"
  | "booking"
  | "content"
  | "creator"
  | "ai-tool"
  | "internal-tool"
  | "directory"
  | "local-business"
  | "newsletter"
  | "consultancy"
  | "real-estate"
  | "fitness"
  | "restaurant"
  | "game"
  | "generic";

export type CloudFeature =
  | "auth"
  | "database"
  | "email"
  | "payments"
  | "storage"
  | "ai"
  | "analytics";

export type AppShape = {
  surfaces: Surface[];
  category: ShapeCategory;
  cloudFeatures: CloudFeature[];
  integrationsLikely: string[];
  /** Plain-English reason — surfaced in the prompt so the LLM understands why. */
  rationale: string;
  /** Confidence 0–1. Below 0.4 the classifier won't inject the block. */
  confidence: number;
};

type Rule = {
  category: ShapeCategory;
  match: RegExp;
  surfaces: Surface[];
  cloud: CloudFeature[];
  integrations?: string[];
  weight?: number; // default 1; higher overrides
};

/* ----------------------------- ruleset ----------------------------- */

const RULES: Rule[] = [
  // — Fintech / banking / personal finance —
  {
    category: "fintech",
    match:
      /\b(neobank|fintech|personal[- ]?finance|bank(ing)?\s+app|budget(ing)?\s+app|expense\s+tracker|invest(ment|ing)|brokerage|robo[- ]?advisor|trading\s+app|stock\s+app|portfolio\s+tracker|wealth)\b/i,
    surfaces: ["landing", "auth", "dashboard", "settings", "admin", "webhooks"],
    cloud: ["auth", "database", "email", "analytics"],
    integrations: ["plaid", "stripe"],
    weight: 3,
  },
  {
    category: "fintech",
    match: /\b(invoic(e|ing)|billing\s+platform|accounts\s+receivable|AR\b|smb\s+payments)\b/i,
    surfaces: ["landing", "auth", "dashboard", "public-detail", "settings", "webhooks"],
    cloud: ["auth", "database", "email", "payments"],
    integrations: ["stripe", "resend"],
    weight: 2,
  },
  {
    category: "fintech",
    match: /\b(lending|loan|underwriting|credit\s+score|insurance\s+app|insurtech)\b/i,
    surfaces: ["landing", "auth", "kyc", "dashboard", "admin", "webhooks"],
    cloud: ["auth", "database", "email", "storage"],
    integrations: ["plaid", "stripe"],
    weight: 2,
  },
  // — Crypto / web3 —
  {
    category: "crypto",
    match:
      /\b(crypto|web3|wallet\s+app|wallet\s+connect|defi|nft|on[- ]?chain|ethereum|solana|polygon|base\s+chain|swap\s+ui|dex|token\s+gated)\b/i,
    surfaces: ["landing", "auth", "dashboard", "settings", "public-detail"],
    cloud: ["auth", "database", "analytics"],
    integrations: ["wagmi", "viem", "rainbowkit", "alchemy", "coingecko"],
    weight: 3,
  },
  {
    category: "crypto",
    match: /\b(buy\s+crypto|on[- ]?ramp|off[- ]?ramp|fiat\s+to\s+crypto)\b/i,
    surfaces: ["landing", "auth", "dashboard", "kyc", "webhooks"],
    cloud: ["auth", "database", "email"],
    integrations: ["moonpay", "ramp", "transak"],
    weight: 2,
  },
  // — Marketplace —
  {
    category: "marketplace",
    match:
      /\b(marketplace|two[- ]?sided|peer[- ]?to[- ]?peer|p2p\s+rental|sellers?\s+and\s+buyers?|listings?\s+platform)\b/i,
    surfaces: ["landing", "auth", "dashboard", "admin", "public-detail", "messages", "checkout", "webhooks"],
    cloud: ["auth", "database", "email", "payments", "storage"],
    integrations: ["stripe"],
    weight: 3,
  },
  // — E-commerce / store —
  {
    category: "ecommerce",
    match:
      /\b(e[- ]?commerce|online\s+store|shop|storefront|product\s+catalog|inventory|cart\s+and\s+checkout)\b/i,
    surfaces: ["landing", "public-detail", "checkout", "auth", "dashboard", "admin", "webhooks"],
    cloud: ["auth", "database", "email", "payments", "storage"],
    integrations: ["stripe"],
    weight: 2,
  },
  // — SaaS —
  {
    category: "saas",
    match:
      /\b(saas|subscription\s+(app|product|service)|paywall|tiered\s+pricing|b2b\s+(tool|app|product))\b/i,
    surfaces: ["landing", "auth", "dashboard", "settings", "admin", "webhooks"],
    cloud: ["auth", "database", "email", "payments"],
    integrations: ["stripe"],
    weight: 2,
  },
  // — Booking / scheduling —
  {
    category: "booking",
    match:
      /\b(book(ing)?|appointment|reservation|scheduler|calendar\s+app|salon|therapist|coach)\b/i,
    surfaces: ["landing", "auth", "dashboard", "admin", "checkout", "webhooks"],
    cloud: ["auth", "database", "email", "payments"],
    integrations: ["stripe", "resend"],
    weight: 2,
  },
  // — Social / creator —
  {
    category: "social",
    match:
      /\b(social\s+(media|network)|community\s+(app|platform)|x\s+\(twitter\)|instagram\s+app|threads|bluesky|mastodon|link[- ]?in[- ]?bio|creator\s+(tool|dashboard|platform))\b/i,
    surfaces: ["landing", "auth", "dashboard", "public-detail", "settings"],
    cloud: ["auth", "database", "storage", "analytics"],
    weight: 2,
  },
  // — Messaging / bots —
  {
    category: "messaging",
    match:
      /\b(whatsapp|telegram\s+bot|discord\s+bot|slack\s+bot|chat\s+app|messaging\s+app|inbox\s+app|customer\s+support\s+bot)\b/i,
    surfaces: ["landing", "auth", "dashboard", "admin", "webhooks"],
    cloud: ["auth", "database", "ai"],
    weight: 2,
  },
  // — AI tool —
  {
    category: "ai-tool",
    match:
      /\b(ai\s+(tool|app|assistant|agent|chatbot)|llm\s+app|gpt\s+wrapper|rag|chat\s+with\s+(your|my)\s+(data|pdfs?|docs?))\b/i,
    surfaces: ["landing", "auth", "dashboard", "settings"],
    cloud: ["auth", "database", "ai", "storage"],
    weight: 2,
  },
  // — Internal tool / admin panel —
  {
    category: "internal-tool",
    match:
      /\b(internal\s+tool|admin\s+(panel|dashboard)|ops\s+dashboard|back[- ]?office|crud\s+app|data\s+entry)\b/i,
    surfaces: ["auth", "dashboard", "admin"],
    cloud: ["auth", "database"],
    weight: 2,
  },
  // — Newsletter / content —
  {
    category: "newsletter",
    match: /\b(newsletter|substack[- ]?like|email\s+list|subscriber\s+(list|signup))\b/i,
    surfaces: ["landing", "public-detail", "admin"],
    cloud: ["database", "email"],
    integrations: ["resend"],
  },
  {
    category: "content",
    match: /\b(blog|magazine|publication|cms|portfolio|landing\s+page\s+only|marketing\s+site)\b/i,
    surfaces: ["landing", "public-detail"],
    cloud: ["database"],
  },
  // — Local business verticals (use the existing industry-pack shape) —
  {
    category: "restaurant",
    match: /\b(restaurant|cafe|bistro|menu\s+site|food\s+truck|bakery)\b/i,
    surfaces: ["landing", "public-detail", "admin"],
    cloud: ["database", "email", "storage"],
  },
  {
    category: "real-estate",
    match: /\b(real[- ]?estate|property\s+listings?|realtor|agency\s+site)\b/i,
    surfaces: ["landing", "public-detail", "auth", "admin"],
    cloud: ["auth", "database", "email", "storage"],
  },
  {
    category: "fitness",
    match: /\b(gym|fitness\s+studio|crossfit|yoga\s+studio|class\s+schedule)\b/i,
    surfaces: ["landing", "auth", "dashboard", "checkout", "admin"],
    cloud: ["auth", "database", "email", "payments"],
    integrations: ["stripe"],
  },
  {
    category: "consultancy",
    match: /\b(consultancy|consulting\s+firm|agency\s+site|case\s+study|professional\s+services)\b/i,
    surfaces: ["landing", "public-detail"],
    cloud: ["database", "email"],
  },
  {
    category: "directory",
    match: /\b(directory|local\s+(directory|guide)|listings\s+(site|directory)|find\s+a)\b/i,
    surfaces: ["landing", "public-detail", "admin"],
    cloud: ["database", "storage"],
  },
  // — Games (any genre) —
  {
    category: "game",
    match:
      /\b(game|gameplay|leaderboard|high[- ]?score|endless\s+runner|platformer|tower\s+defense|trivia\s+game|quiz\s+battle|card\s+game|board\s+game|puzzle\s+game|arcade\s+game|shooter|tycoon|idle\s+game|rpg|phaser|three\.?js|@react-three\/fiber)\b/i,
    surfaces: ["landing", "auth", "dashboard"],
    cloud: ["auth", "database"],
    weight: 2,
  },
];

/* --------------------------- classifier ---------------------------- */

const ALL_SURFACES_BY_DEFAULT: Surface[] = ["landing"];

export function classifyAppShape(prompt: string): AppShape {
  const text = (prompt || "").toLowerCase();
  if (text.length < 12) {
    return {
      surfaces: ALL_SURFACES_BY_DEFAULT,
      category: "generic",
      cloudFeatures: [],
      integrationsLikely: [],
      rationale: "Prompt too short to predict shape; defaulting to a single landing page.",
      confidence: 0,
    };
  }

  // Score each rule by match count.
  const matched: Array<{ rule: Rule; hits: number }> = [];
  for (const r of RULES) {
    const m = text.match(r.match);
    if (m) matched.push({ rule: r, hits: m.length });
  }

  if (matched.length === 0) {
    return {
      surfaces: ALL_SURFACES_BY_DEFAULT,
      category: "generic",
      cloudFeatures: [],
      integrationsLikely: [],
      rationale: "No category signal detected; LLM will infer shape from the brief itself.",
      confidence: 0.2,
    };
  }

  // Pick the highest-weight rule as the category anchor; merge all matched
  // rules' surfaces / cloud / integrations.
  const sorted = matched.sort(
    (a, b) => (b.rule.weight ?? 1) * b.hits - (a.rule.weight ?? 1) * a.hits,
  );
  const anchor = sorted[0].rule;
  const surfaces = uniq(matched.flatMap((m) => m.rule.surfaces));
  const cloud = uniq(matched.flatMap((m) => m.rule.cloud));
  const integrations = uniq(matched.flatMap((m) => m.rule.integrations ?? []));

  // Surface-augmenters not category-bound.
  if (/\b(login|sign[- ]?in|sign[- ]?up|account|profile)\b/i.test(text) && !surfaces.includes("auth")) {
    surfaces.push("auth");
    if (!cloud.includes("auth")) cloud.push("auth");
  }
  if (/\b(payment|checkout|subscription|paywall|stripe|paddle)\b/i.test(text) && !surfaces.includes("checkout")) {
    surfaces.push("checkout");
    if (!cloud.includes("payments")) cloud.push("payments");
  }
  if (/\b(webhook|stripe webhook|callback|integration)\b/i.test(text) && !surfaces.includes("webhooks")) {
    surfaces.push("webhooks");
  }
  if (/\b(kyc|identity\s+verification|onboarding\s+verification|aml)\b/i.test(text) && !surfaces.includes("kyc")) {
    surfaces.push("kyc");
  }

  const totalHits = matched.reduce((s, m) => s + m.hits * (m.rule.weight ?? 1), 0);
  const confidence = Math.min(1, 0.4 + totalHits * 0.15);

  return {
    surfaces: orderSurfaces(surfaces),
    category: anchor.category,
    cloudFeatures: cloud,
    integrationsLikely: integrations,
    rationale: rationaleFor(anchor.category, surfaces, integrations),
    confidence,
  };
}

/* ----------------------------- render ------------------------------ */

export function renderShapeBlock(shape: AppShape): string {
  if (shape.confidence < 0.4 || shape.surfaces.length <= 1) return "";
  const lines = [
    "",
    "",
    "## Predicted app shape",
    `Category: **${shape.category}** (confidence ${shape.confidence.toFixed(2)})`,
    `Surfaces to scaffold (do not stop after the first one): ${shape.surfaces.map((s) => `\`${s}\``).join(", ")}`,
    shape.cloudFeatures.length
      ? `Cloud features to enable: ${shape.cloudFeatures.map((c) => `\`${c}\``).join(", ")}`
      : "",
    shape.integrationsLikely.length
      ? `Likely integrations: ${shape.integrationsLikely.map((i) => `\`${i}\``).join(", ")}. Check the integration briefs above before improvising.`
      : "",
    `Why: ${shape.rationale}`,
    "",
    "Use this shape as the floor, not the ceiling — if the user asked for more, build more. But never produce fewer surfaces than predicted: a fintech app missing /admin or /webhooks is incomplete.",
  ].filter(Boolean);
  return lines.join("\n");
}

/* ----------------------------- helpers ----------------------------- */

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

const SURFACE_ORDER: Surface[] = [
  "landing",
  "auth",
  "kyc",
  "dashboard",
  "public-detail",
  "checkout",
  "messages",
  "settings",
  "admin",
  "webhooks",
];

function orderSurfaces(s: Surface[]): Surface[] {
  return [...s].sort((a, b) => SURFACE_ORDER.indexOf(a) - SURFACE_ORDER.indexOf(b));
}

function rationaleFor(
  category: ShapeCategory,
  surfaces: Surface[],
  integrations: string[],
): string {
  switch (category) {
    case "fintech":
      return "Fintech apps need a public landing for trust, authenticated dashboard for account data, admin for operations, and webhook endpoints for provider callbacks. Money movement requires idempotency and signature verification — never trust client input.";
    case "crypto":
      return "Crypto/web3 apps need a wallet-connect entrypoint, dashboard for balances/transactions, and provider integrations for chain data. Private keys NEVER live in the browser code or database; rely on wallet providers (RainbowKit/wagmi) for signing.";
    case "marketplace":
      return "Two-sided marketplaces need separate seller and buyer flows, public listing detail pages, in-app messaging, checkout via Stripe Connect, and webhooks for payout/refund events.";
    case "ecommerce":
      return "Storefront needs landing, browseable product detail, cart + checkout, customer auth, and an admin to manage inventory.";
    case "saas":
      return "SaaS apps need a marketing landing, auth, a tiered paywall (Stripe/Paddle), a logged-in dashboard with user-scoped data via RLS, and webhooks for subscription events.";
    case "booking":
      return "Booking apps need a public services page, a slot picker with conflict detection, payment, customer dashboard, and an admin schedule view. Email + calendar invite on confirmation.";
    case "messaging":
      return "Messaging/bot apps need a public webhook endpoint with signature verification, an admin dashboard for handover/monitoring, and persistent conversation threads.";
    case "social":
      return "Social/creator apps need public profile pages, an authenticated dashboard, content composer/inbox, and per-user OAuth to upstream platforms (not workspace connectors).";
    case "ai-tool":
      return "AI tools need auth, a chat/composer surface, settings for model/preferences, and storage for uploaded context. Default to Lovable AI Gateway over BYO keys.";
    case "internal-tool":
      return "Internal tools skip the marketing landing and focus on auth + admin/data CRUD with role checks. Use the user_roles pattern, never store role on profiles.";
    case "game":
      return "Game apps need a play surface (the actual game), an auth-gated profile when leaderboards exist, and a leaderboard route/modal. Pick library by genre: Phaser for arcade/runner/platformer/shooter, three.js + @react-three/fiber for 3D, plain React + Zustand for card/board/trivia/puzzle/idle. Persist scores in Cloud with RLS public read + authenticated insert; never trust raw client scores.";
    default:
      return `Detected ${category} pattern. Suggested surfaces: ${surfaces.join(", ")}.${integrations.length ? ` Likely services: ${integrations.join(", ")}.` : ""}`;
  }
}
