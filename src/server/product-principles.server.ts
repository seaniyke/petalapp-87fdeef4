/**
 * Phase 5 — Product Principles enforcement (deterministic linter).
 *
 * Source: docs/petal-product-principles.md. Most principles are UX or
 * pipeline contracts enforced elsewhere (P1 edit-scope-guard, P5 verify
 * tiers, P6/P7 repair codemods, P15 credit settlement). This module covers
 * the ones that are decidable from the generated file set:
 *
 *   P3  — no placeholders: "coming soon", TODO copy, dead `href="#"` links,
 *         "Feature One / Two / Three" filler.
 *   P19 — real identity: no demo/simulated/"not real" disclaimer banners.
 *   P20 — say what it is: no "Lovable" brand leak in user-visible copy of a
 *         generated app, no hype adjectives in headings.
 *
 * Conservative by construction — every rule is a SOFT warning routed into
 * the same autofix queue as the other quality tiers. A false positive must
 * never wedge a clean turn.
 */

import type { LocalIssue } from "@/server/local-verifier";

export type PrincipleRule = "P3" | "P19" | "P20";

const ENABLED_RULES = new Set<PrincipleRule>(["P3", "P19", "P20"]);

const UI_FILE = /\.(tsx|jsx)$/;

/** Files that are scaffolding/config, not user-visible product surface. */
const SKIP_PREFIXES = ["src/integrations/", "src/components/ui/", "supabase/"];

export interface PrincipleFile {
  path: string;
  content: string;
}

/** Strip JS/TS comments so TODO markers in code comments don't count as copy. */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "/" && c2 === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const RULES: Array<{
  rule: PrincipleRule;
  id: string;
  test: RegExp;
  detail: string;
}> = [
  {
    rule: "P3",
    id: "coming-soon",
    test: /\b(coming soon|under construction|work in progress|stay tuned)\b/i,
    detail:
      'Principle 3 — no placeholders. This screen promises a "coming soon" surface. Either build the feature now or remove the entry point entirely; never ship a page that advertises something that does not exist.',
  },
  {
    rule: "P3",
    id: "todo-copy",
    test: /(["'>])\s*TODO\b|\bTODO:\s*(add|write|replace|fill)/,
    detail:
      "Principle 3 — no placeholders. TODO copy is visible in the rendered output. Replace it with real, domain-specific content.",
  },
  {
    rule: "P3",
    id: "dead-link",
    test: /href\s*=\s*["']#["']/,
    detail:
      'Principle 3 — no dead controls. `href="#"` goes nowhere. Point the link at a real route, or make it an in-page anchor with a matching `id` and `scroll-mt-24`, or convert it to a button with a handler.',
  },
  {
    rule: "P3",
    id: "filler-features",
    test: /\bFeature (One|Two|Three|1|2|3)\b|\bTitle (One|Two|Three)\b|\bYour (Heading|Title) Here\b/i,
    detail:
      'Principle 3 — no placeholders. Generic "Feature One / Feature Two" filler is visible. Write specific copy naming what the product actually does.',
  },
  {
    rule: "P19",
    id: "demo-banner",
    test: /\b(this is a demo|demo only|for demonstration purposes|simulated data|not real (money|funds|data)|no real (money|funds) )/i,
    detail:
      "Principle 19 — every generated app has a real identity. Disclaimer banners about being a demo or simulated are never shipped. Remove the banner and present the product as a real product.",
  },
  {
    rule: "P20",
    id: "brand-leak",
    test: /\b(Lovable Cloud|Lovable AI|Built with Lovable|lovable\.app)\b/,
    detail:
      'Principle 20 — say what it is. User-visible copy references "Lovable". Kimble-owned surfaces are named Kimble, Kimble Cloud, and Kimble AI; a generated app should carry its own brand name instead.',
  },
  {
    rule: "P20",
    id: "hype",
    test: /\b(revolutionary|game-?changing|cutting-?edge|world-?class|next-?gen(?:eration)?|unleash|supercharge)\b/i,
    detail:
      "Principle 20 — no hype. Replace marketing adjectives with a concrete claim about what the product does for the reader.",
  },
];

export function lintProductPrinciples(files: PrincipleFile[]): LocalIssue[] {
  const issues: LocalIssue[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    if (!UI_FILE.test(file.path)) continue;
    if (SKIP_PREFIXES.some((p) => file.path.startsWith(p))) continue;
    const src = stripComments(file.content);

    for (const r of RULES) {
      if (!ENABLED_RULES.has(r.rule)) continue;
      if (!r.test.test(src)) continue;
      const key = `${file.path}::${r.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({ path: file.path, kind: "product-principle", detail: r.detail });
    }
  }

  return issues;
}
