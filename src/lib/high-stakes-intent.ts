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

/** Short instruction we splice into the triage system prompt when fired. */
export function highStakesClarifyInstruction(domain: HighStakesDomain): string {
  const honesty: Record<HighStakesDomain, string> = {
    "crypto-wallet":
      "The user mentioned a crypto wallet. Petal CANNOT custody real crypto, manage seed phrases securely, sign on-chain transactions, or connect to real RPC providers out of the box. It CAN build a realistic demo (mock balances, fake transactions in the database, polished wallet UI).",
    neobank:
      "The user mentioned a bank / neobank / banking app. Petal CANNOT move real money, hold deposits, issue cards, run ACH/SWIFT, or do KYC/AML. It CAN build a realistic demo with simulated accounts, transfers as database rows, and a banking UI.",
    trading:
      "The user mentioned a trading / brokerage app. Petal CANNOT execute real trades or connect to brokers. It CAN build a realistic demo with mock prices, a fake portfolio, and a trading UI.",
    lending:
      "The user mentioned a lending product. Petal CANNOT originate, underwrite, or disburse real loans. It CAN build a demo loan application UI and fake approval flow.",
    "kyc-identity":
      "The user asked for KYC / identity verification. Petal does NOT have a Plaid/Persona/Onfido/Sumsub connector. It CAN build the UI and store form submissions, but verification will be simulated.",
  };
  return [
    "HIGH-STAKES DOMAIN DETECTED.",
    honesty[domain],
    "You MUST set mode = \"clarify\" with a warm, honest one-liner explaining the limitation, then ask: \"Do you want me to build a realistic demo, or do you have provider keys (e.g. Stripe, Plaid, Alchemy) you want wired up?\"",
    "Set suggestions to: [\"Build a demo\", \"I have provider keys\", \"Explain what's possible\"].",
    "Do NOT silently proceed to build.",
  ].join(" ");
}
