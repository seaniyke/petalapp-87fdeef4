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
 *  Build-mode default: state the limitation honestly in one line, then
 *  ship a polished demo. Do NOT stop to ask permission. */
export function highStakesBuildInstruction(domain: HighStakesDomain): string {
  const honesty: Record<HighStakesDomain, string> = {
    "crypto-wallet":
      "Petal CANNOT custody real crypto, manage seed phrases, sign on-chain transactions, or connect to real RPC providers. It CAN — and should — build a polished, realistic DEMO (mock balances, simulated transfers/swaps in the database, full wallet/exchange UI).",
    neobank:
      "Petal CANNOT move real money, hold deposits, issue cards, run ACH/SWIFT, or do KYC/AML. It CAN — and should — build a polished, realistic DEMO with simulated accounts, transfers as database rows, and a full banking UI.",
    trading:
      "Petal CANNOT execute real trades or connect to brokers. It CAN — and should — build a polished, realistic DEMO with mock prices, a fake portfolio, and a full trading UI.",
    lending:
      "Petal CANNOT originate, underwrite, or disburse real loans. It CAN — and should — build a polished, realistic DEMO of the application + approval flow.",
    "kyc-identity":
      "Petal does NOT have a Plaid/Persona/Onfido/Sumsub connector. It CAN — and should — build the full UI and store submissions; verification will be simulated.",
  };
  return [
    "HIGH-STAKES DOMAIN DETECTED (" + domain + ").",
    honesty[domain],
    "In your one-line preamble, state the limitation honestly and mention that bringing provider keys later (e.g. Stripe, Plaid, Alchemy) can wire it up for real. Then PROCEED TO BUILD — do not stop to ask permission, do not force a clarify, do not emit a multiple-choice question.",
  ].join(" ");
}

/** @deprecated Kept as an alias so older imports don't break. Use highStakesBuildInstruction. */
export const highStakesClarifyInstruction = highStakesBuildInstruction;

