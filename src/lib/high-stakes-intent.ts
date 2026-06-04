/**
 * @deprecated Thin compatibility shim. Use `@/lib/project-archetype` instead.
 *
 * The high-stakes detector originally covered 5 separate fintech domains
 * (crypto-wallet, neobank, trading, lending, kyc-identity). They were all
 * merged into the single `fintech-highstakes` archetype after research
 * showed they collectively account for <3% of real builds and share the
 * same landing layout, deferred features, and provider list.
 *
 * This file maps legacy callers (triage.ts, generate.ts, build-blueprint)
 * onto the new module so existing imports keep working.
 */

import {
  detectArchetype,
  getArchetype,
  archetypeBuildInstruction,
  archetypeRoadmapBlock,
  type ProjectArchetype,
} from "./project-archetype";

// -----------------------------------------------------------------------------
// Legacy type surface
// -----------------------------------------------------------------------------

export type HighStakesDomain =
  | "crypto-wallet"
  | "neobank"
  | "trading"
  | "lending"
  | "kyc-identity";

export type HighStakesIntent = {
  detected: boolean;
  domain?: HighStakesDomain;
  match?: string;
};

export interface HighStakesRoadmap {
  productLabel: string;
  landingSections: string[];
  futureFeatures: string[];
  providersToWireLater: string[];
}

// Sub-domain hints inside the unified fintech archetype, kept so legacy
// callers still see a granular `domain` value in logs and saved blueprints.
const SUBDOMAIN_KEYWORDS: Array<{ domain: HighStakesDomain; needles: string[] }> = [
  { domain: "crypto-wallet", needles: ["crypto wallet", "web3 wallet", "defi wallet", "defi app", "swap tokens", "stake crypto", "crypto exchange"] },
  { domain: "neobank", needles: ["neobank", "digital bank", "online bank", "banking app", "send and receive money"] },
  { domain: "trading", needles: ["trading dashboard", "stock trading", "brokerage", "options trading", "portfolio tracker stocks"] },
  { domain: "lending", needles: ["lending platform", "loan origination"] },
  { domain: "kyc-identity", needles: ["kyc verification", "identity verification"] },
];

function inferSubdomain(matchOrPrompt: string): HighStakesDomain {
  const t = matchOrPrompt.toLowerCase();
  for (const { domain, needles } of SUBDOMAIN_KEYWORDS) {
    if (needles.some((n) => t.includes(n))) return domain;
  }
  return "neobank"; // safe generic fintech fallback
}

// -----------------------------------------------------------------------------
// Legacy API — all delegate to project-archetype
// -----------------------------------------------------------------------------

export function detectHighStakesIntent(text: string | null | undefined): HighStakesIntent {
  const m = detectArchetype(text);
  if (!m.detected || !m.archetype || !m.archetype.highStakes) return { detected: false };
  const lowerPrompt = (text ?? "").toLowerCase();
  const domain = inferSubdomain(m.match ? lowerPrompt : "");
  return { detected: true, domain, match: m.match };
}

function fintechArchetype(): ProjectArchetype {
  return getArchetype("fintech-highstakes");
}

export function highStakesBuildInstruction(_domain: HighStakesDomain): string {
  return archetypeBuildInstruction(fintechArchetype());
}

/** @deprecated alias retained for legacy imports. */
export const highStakesClarifyInstruction = highStakesBuildInstruction;

export function highStakesRoadmap(_domain: HighStakesDomain): HighStakesRoadmap {
  const a = fintechArchetype();
  return {
    productLabel: a.productLabel,
    landingSections: [...a.landingSections],
    futureFeatures: [...a.futureFeatures],
    providersToWireLater: [...a.providersToWireLater],
  };
}

export function highStakesRoadmapBlock(_domain: HighStakesDomain): string {
  return archetypeRoadmapBlock(fintechArchetype());
}
