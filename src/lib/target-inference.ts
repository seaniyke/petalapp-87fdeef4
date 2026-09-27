import { isTargetEnabled } from "@/lib/site-flags";
/**
 * Build-target inference from the prompt text.
 *
 * Why this exists: the target chip rail was removed from the composer on the
 * understanding that Kimble would infer the product type from what the user
 * typed. That inference was never actually built — `/api/generate` read
 * `x-petal-target` from the header and defaulted to `"web"`, with no
 * prompt-text inference anywhere in the codebase. The result: "build me a
 * Chrome extension" shipped a web app.
 *
 * Deliberately deterministic (scored keyword table, no LLM call):
 *  - same prompt always produces the same target, which is testable
 *  - costs nothing and adds no latency to a path that already has 4 LLM stages
 *  - a wrong-but-stable answer is debuggable; a wrong-and-random one is not
 */
import type { BuildTargetId } from "./build-targets";

export type TargetInference = {
  target: BuildTargetId;
  /** 0–1. Below ~0.35 the caller should prefer an explicit user selection. */
  confidence: number;
  /** Phrases that drove the decision — surfaced in build traces. */
  signals: string[];
};

type Rule = { re: RegExp; target: BuildTargetId; weight: number; label: string };

const RULES: Rule[] = [
  // ---- Chrome / browser extension -------------------------------------
  { re: /\bchrome extension\b/i, target: "extension", weight: 6, label: "chrome extension" },
  { re: /\bbrowser extension\b/i, target: "extension", weight: 6, label: "browser extension" },
  { re: /\b(firefox|edge|safari) (extension|add-?on)\b/i, target: "extension", weight: 6, label: "browser add-on" },
  { re: /\bextension\b/i, target: "extension", weight: 2, label: "extension" },
  { re: /\bmanifest v3\b|\bmanifest\.json\b/i, target: "extension", weight: 4, label: "manifest v3" },
  { re: /\b(content script|background service worker|popup extension)\b/i, target: "extension", weight: 4, label: "extension internals" },
  { re: /\bnew tab (page|override)\b/i, target: "extension", weight: 3, label: "new tab override" },

  // ---- Mobile (Expo / React Native, one codebase two stores) -----------
  { re: /\bmobile app\b/i, target: "mobile", weight: 5, label: "mobile app" },
  // "mobile banking app", "mobile fitness tracker app" — the adjective and the
  // noun are usually separated by the domain word, so a strict "mobile app"
  // match misses the most natural phrasing there is.
  { re: /\bmobile\b[\w\s-]{0,24}\bapp\b/i, target: "mobile", weight: 5, label: "mobile … app" },

  { re: /\b(ios|android) app\b/i, target: "mobile", weight: 5, label: "ios/android app" },
  { re: /\breact native\b|\bexpo\b/i, target: "mobile", weight: 6, label: "react native / expo" },
  { re: /\bapp store\b|\bplay store\b|\bgoogle play\b|\btestflight\b/i, target: "mobile", weight: 4, label: "store submission" },
  { re: /\bnative app\b/i, target: "mobile", weight: 4, label: "native app" },
  { re: /\bon (my |a )?(phone|iphone|android)\b/i, target: "mobile", weight: 3, label: "phone" },
  { re: /\bpush notifications?\b/i, target: "mobile", weight: 1, label: "push notifications" },

  // ---- Backend / API only ---------------------------------------------
  { re: /\b(rest|graphql|json)?\s*api\b(?!\s*key)/i, target: "backend", weight: 3, label: "api" },
  { re: /\bbackend (service|only|api)\b/i, target: "backend", weight: 5, label: "backend service" },
  { re: /\bmicroservice\b/i, target: "backend", weight: 5, label: "microservice" },
  { re: /\bwebhook (handler|endpoint|receiver)\b/i, target: "backend", weight: 4, label: "webhook endpoint" },
  { re: /\bcron (job|worker)\b/i, target: "backend", weight: 3, label: "cron job" },
  { re: /\bno (ui|frontend|front-?end)\b|\bheadless\b/i, target: "backend", weight: 4, label: "headless" },
  { re: /\bopenapi\b|\bswagger\b/i, target: "backend", weight: 4, label: "openapi" },

  // ---- Explicit web ----------------------------------------------------
  { re: /\bweb app\b|\bwebsite\b|\bweb site\b/i, target: "web", weight: 4, label: "web app" },
  { re: /\blanding page\b/i, target: "web", weight: 4, label: "landing page" },
  { re: /\bdashboard\b|\badmin panel\b/i, target: "web", weight: 2, label: "dashboard" },
  { re: /\bblog\b|\bportfolio\b|\bdocs site\b/i, target: "web", weight: 3, label: "web content site" },
  { re: /\bseo\b/i, target: "web", weight: 2, label: "seo" },
];

/** "mobile + web" phrasing wins over either alone. */
const BOTH_RE =
  /\b(web and mobile|mobile and web|cross-?platform|both web and (mobile|app)|responsive (mobile )?app and website)\b/i;

export function inferBuildTarget(prompt: string | null | undefined): TargetInference {
  const text = (prompt ?? "").trim();
  if (!text) return { target: "web", confidence: 0, signals: [] };

  if (BOTH_RE.test(text)) {
    return { target: "web-mobile", confidence: 0.9, signals: ["web and mobile"] };
  }

  const scores = new Map<BuildTargetId, number>();
  const signals: string[] = [];
  for (const rule of RULES) {
    if (!rule.re.test(text)) continue;
    scores.set(rule.target, (scores.get(rule.target) ?? 0) + rule.weight);
    signals.push(rule.label);
  }

  if (scores.size === 0) return { target: "web", confidence: 0, signals: [] };

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const [topTarget, topScore] = ranked[0];
  const runnerUp = ranked[1]?.[1] ?? 0;

  // A target only wins if it clearly beats the next one. Ties fall back to web,
  // which is both the safest scaffold and the overwhelmingly common case.
  if (topScore < 3 || topScore - runnerUp < 2) {
    return { target: "web", confidence: 0.2, signals };
  }

  const total = ranked.reduce((sum, [, s]) => sum + s, 0);
  const confidence = Math.min(0.95, topScore / Math.max(total, 1));
  return { target: topTarget, confidence, signals };
}

/**
 * Final target for a request.
 *
 * Precedence: an explicit non-default header (the user actively picked a
 * target, or a project already has one pinned) always wins. Otherwise we infer
 * from the prompt. Otherwise `web`.
 */
export function resolveBuildTarget(
  headerTarget: string | null | undefined,
  prompt: string | null | undefined,
): { target: BuildTargetId; source: "header" | "inferred" | "default"; confidence: number } {
  const r = resolveBuildTargetRaw(headerTarget, prompt);
  // Paused build types never reach the engine: they build as web.
  return isTargetEnabled(r.target) ? r : { target: "web", source: "default", confidence: 1 };
}

function resolveBuildTargetRaw(
  headerTarget: string | null | undefined,
  prompt: string | null | undefined,
): { target: BuildTargetId; source: "header" | "inferred" | "default"; confidence: number } {
  const header = (headerTarget ?? "").trim() as BuildTargetId | "";
  if (header && header !== "web") {
    return { target: header, source: "header", confidence: 1 };
  }
  const inferred = inferBuildTarget(prompt);
  if (inferred.target !== "web" && inferred.confidence >= 0.35) {
    return { target: inferred.target, source: "inferred", confidence: inferred.confidence };
  }
  return { target: "web", source: header ? "header" : "default", confidence: 1 };
}
