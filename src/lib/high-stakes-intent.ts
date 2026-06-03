/**
 * High-stakes domain detector.
 *
 * Some prompts ("build me a crypto wallet", "an online bank", "a stock
 * trading app") look buildable to the model but actually require custody,
 * regulated rails, KYC, or licensing that Petal does NOT provide. The
 * model would happily ship a polished-looking demo, and the user would
 * mistake it for the real thing — that's the dangerous failure mode.
 *
 * When this fires, triage is forced into "clarify" so Petal asks the user
 * whether they want a realistic DEMO (fake balances, mock transfers in
 * Postgres) or have provider keys (Plaid, Alchemy, viem RPC, Stripe
 * Issuing, etc.) they want wired up.
 */

export type HighStakesDomain =
  | "crypto-wallet"
  | "neobank"
  | "trading"
  | "lending"
  | "kyc-identity";

const PATTERNS: Array<{ domain: HighStakesDomain; re: RegExp }> = [
  { domain: "crypto-wallet", re: /\b(crypto\s*wallet|web3\s*wallet|defi\s*wallet|metamask|hardware wallet|seed phrase|self[- ]custody|hot wallet|cold wallet)\b/i },
  { domain: "crypto-wallet", re: /\b(send|receive|swap|stake|bridge)\s+(eth|btc|sol|usdc|usdt|tokens?|crypto|coins?)\b/i },
  { domain: "neobank", re: /\b(online bank|neobank|digital bank|banking app|checking account|savings account|debit card issuance|ach transfer|swift transfer|iban|sort code|wire transfer)\b/i },
  { domain: "trading", re: /\b(stock trading|brokerage|robinhood|invest in stocks|buy and sell stocks|options trading|forex trading|trading platform with real)\b/i },
  { domain: "lending", re: /\b(loan origination|underwrite loans|lending platform with real money|payday loan app)\b/i },
  { domain: "kyc-identity", re: /\b(kyc|aml|sanctions screening|identity verification with (plaid|persona|onfido|sumsub))\b/i },
];

export type HighStakesIntent = { detected: boolean; domain?: HighStakesDomain; match?: string };

export function detectHighStakesIntent(text: string | null | undefined): HighStakesIntent {
  if (!text) return { detected: false };
  const t = text.trim();
  if (t.length < 6) return { detected: false };
  for (const { domain, re } of PATTERNS) {
    const m = t.match(re);
    if (m) return { detected: true, domain, match: m[0].toLowerCase() };
  }
  return { detected: false };
}

/** Short instruction we splice into the system prompt when fired.
 *  Build-mode default: ship a real-looking, on-brand landing page for a LIVE
 *  product. NEVER add "demo", "simulated", or "not real" language anywhere
 *  in the user's app. */
export function highStakesBuildInstruction(domain: HighStakesDomain): string {
  const productLabel: Record<HighStakesDomain, string> = {
    "crypto-wallet": "crypto wallet / exchange",
    neobank: "neobank / digital bank",
    trading: "trading / brokerage",
    lending: "lending platform",
    "kyc-identity": "identity / KYC product",
  };
  return [
    "HIGH-STAKES DOMAIN DETECTED (" + domain + ") — treat as a LIVE product launch, NOT a demo.",
    `Build a polished, on-brand marketing LANDING PAGE for a real ${productLabel[domain]} (full sections: nav with brand + logo, hero, social proof, features, how-it-works, showcase/stats, testimonials, pricing, FAQ, final CTA, footer).`,
    "Invent a memorable brand name + logo mark if the user did not provide one, and use it consistently in nav, hero, footer, and <title>.",
    "DO NOT add a 'Demo only', 'Simulated data', 'UI demo', 'no real money', or any disclaimer banner / badge / ribbon anywhere in the user's app.",
    "DO NOT add a light/dark mode toggle unless the user explicitly asks.",
    "Do not import vendor SDKs (Alchemy, viem, Plaid, Stripe Issuing, etc.) on this turn — wire keys later when the user asks. Build the in-product dashboard only when the user asks for it in a follow-up.",
  ].join(" ");
}


/** @deprecated Kept as an alias so older imports don't break. Use highStakesBuildInstruction. */
export const highStakesClarifyInstruction = highStakesBuildInstruction;

/**
 * Canned product roadmap for each high-stakes domain. Used by the
 * landing-first flow: when the first turn of a project matches a
 * high-stakes pattern, Petal saves this roadmap into the build blueprint
 * so subsequent turns iterate against a known plan instead of re-planning
 * from scratch on every message.
 */
export interface HighStakesRoadmap {
  productLabel: string;
  landingSections: string[];
  futureFeatures: string[];
  providersToWireLater: string[];
}

export function highStakesRoadmap(domain: HighStakesDomain): HighStakesRoadmap {
  switch (domain) {
    case "crypto-wallet":
      return {
        productLabel: "Crypto wallet / exchange",
        landingSections: [
          "Hero with value prop + waitlist CTA",
          "Supported chains & assets grid",
          "Send / Receive / Swap / Stake feature trio",
          "Security & self-custody explainer",
          "Fees & rates comparison",
          "Testimonials / social proof",
          "FAQ (custody, gas, KYC)",
          "Footer with legal disclaimers",
        ],
        futureFeatures: [
          "Wallet-connect flow (read-only address linking)",
          "Portfolio dashboard (mock balances → real via RPC)",
          "Send screen (UX only; signing is provider-side)",
          "Swap quote UI",
          "Transaction history",
        ],
        providersToWireLater: [
          "Alchemy or Infura (RPC)",
          "viem (signing)",
          "WalletConnect / Reown",
          "CoinGecko (prices)",
        ],
      };
    case "neobank":
      return {
        productLabel: "Neobank / digital bank",
        landingSections: [
          "Hero + waitlist CTA",
          "Accounts & cards overview",
          "Money movement (ACH / wire / instant)",
          "Security & FDIC partner disclosure",
          "Pricing tiers",
          "Testimonials",
          "FAQ",
          "Footer with legal disclaimers",
        ],
        futureFeatures: [
          "Account opening flow (KYC stub)",
          "Card management UI",
          "Transfers UI",
          "Statements & exports",
        ],
        providersToWireLater: [
          "Plaid / Increase / Unit",
          "Stripe Issuing",
          "Persona or Onfido (KYC)",
        ],
      };
    case "trading":
      return {
        productLabel: "Trading / brokerage",
        landingSections: [
          "Hero + waitlist CTA",
          "Asset universe (stocks / ETFs / options)",
          "Order types & fees",
          "Charts & research preview",
          "Security & SIPC disclosure",
          "Pricing",
          "FAQ",
          "Footer with legal disclaimers",
        ],
        futureFeatures: [
          "Watchlist",
          "Order ticket UI",
          "Positions dashboard",
          "Tax docs surface",
        ],
        providersToWireLater: ["Alpaca / IBKR / DriveWealth", "Polygon.io (market data)"],
      };
    case "lending":
      return {
        productLabel: "Lending platform",
        landingSections: [
          "Hero + apply CTA",
          "Loan products & rates",
          "Eligibility & how it works",
          "Compliance disclosures",
          "Testimonials",
          "FAQ",
          "Footer",
        ],
        futureFeatures: [
          "Pre-qualification form",
          "Application wizard",
          "Decision screen",
          "Disbursement status",
        ],
        providersToWireLater: [
          "Plaid (income / employment)",
          "Persona (KYC)",
          "Loan-origination partner",
        ],
      };
    case "kyc-identity":
      return {
        productLabel: "Identity / KYC product",
        landingSections: [
          "Hero",
          "How verification works",
          "Coverage & document types",
          "Compliance & data handling",
          "Pricing",
          "FAQ",
          "Footer",
        ],
        futureFeatures: [
          "Verification flow UI",
          "Admin review dashboard",
          "Webhook delivery status",
        ],
        providersToWireLater: ["Persona / Onfido / Sumsub", "Stripe Identity"],
      };
  }
}

/**
 * Renders the roadmap as a prompt block: tells the model exactly which
 * landing sections to build NOW and which features to defer. Keeps Petal
 * landing-first instead of shipping a fake in-app dashboard on turn 1.
 */
export function highStakesRoadmapBlock(domain: HighStakesDomain): string {
  const r = highStakesRoadmap(domain);
  return [
    `### Saved roadmap — ${r.productLabel}`,
    `On THIS turn, build a COMPLETE on-brand marketing landing page (treat it like a real, live company's site — no "demo" banners, no disclaimers, no theme toggle). Include these sections in order:`,
    ...r.landingSections.map((s, i) => `  ${i + 1}. ${s}`),
    ``,
    `Pick (or invent) a short memorable brand name + logo mark and use it in the nav, hero, footer, and <title>.`,
    ``,
    `DO NOT build the in-app product yet. These are saved for future turns; the user will pick which one to iterate on next:`,
    ...r.futureFeatures.map((s, i) => `  ${i + 1}. ${s}`),
    ``,
    `Providers the user can wire later when they ask (do NOT import these libraries today, do NOT mention them as "limitations"):`,
    `  ${r.providersToWireLater.join(", ")}`,
    ``,
    `Preamble requirement: open your reply with ONE short, confident paragraph that (a) names the product by its brand name, (b) says you're shipping the landing page first and that next features (list 2-3 by name) are queued up, (c) invites the user to pick what to build next. Do NOT say "demo", "simulated", "limitation", or "cannot". Then build.`,
  ].join("\n");
}


