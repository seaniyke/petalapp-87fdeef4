/**
 * Anti-sameness scan.
 *
 * Post-generation, we scan the composed landing for the exact
 * fingerprints of "AI-drafted default" output — indigo-on-white palette,
 * unbranded Inter typography, missing sections from the landing
 * checklist, etc. Findings are emitted as LocalIssue notes so the
 * existing generation-quality-gate can surface them in the same shape
 * as other quality warnings.
 *
 * NEVER blocks generation. Emits informational notes only — the model
 * uses them in the next turn if the user complains.
 */

import type { ProjectFile } from "@/server/generate.server";
import type { LocalIssue } from "@/server/local-verifier";
import { LANDING_SECTION_KEYWORDS } from "./design-taste.server";
import { findCopySlopIssues } from "./copy-slop.server";

const CLICHE_PATTERNS: Array<{ rx: RegExp; label: string }> = [
  { rx: /from-purple-\d{3}\s+to-pink-\d{3}/i, label: "purple-to-pink gradient (banned AI default)" },
  { rx: /from-indigo-\d{3}\s+to-purple-\d{3}/i, label: "indigo-to-purple gradient (banned AI default)" },
  { rx: /bg-indigo-500|text-indigo-600|from-indigo-500/i, label: "raw indigo-500 accent (use locked palette)" },
  { rx: /\bLorem ipsum\b/i, label: "Lorem ipsum in shipped copy" },
  { rx: /©\s*2024\b/, label: "hardcoded 2024 copyright (use current year)" },
  { rx: /text-white\s+bg-black|bg-black\s+text-white/i, label: "raw text-white on bg-black — use semantic tokens" },
  { rx: /font-family:\s*['"]?Inter['"]?/i, label: "Inter typography (design-taste bans default Inter)" },
];

function scanCliches(content: string): string[] {
  const hits: string[] = [];
  for (const { rx, label } of CLICHE_PATTERNS) {
    if (rx.test(content)) hits.push(label);
  }
  return hits;
}

function scanLandingSections(joined: string): string[] {
  const missing: string[] = [];
  for (const [name, rx] of Object.entries(LANDING_SECTION_KEYWORDS)) {
    if (!rx.test(joined)) missing.push(name);
  }
  return missing;
}

/**
 * Design contract — the checks that decide whether the locked direction
 * actually reached the browser. These are backstops: `design-finisher`
 * repairs most of them deterministically before we get here, so anything
 * that still trips is a real miss worth reporting.
 */
function findDesignContractIssues(files: ProjectFile[]): LocalIssue[] {
  const issues: LocalIssue[] = [];
  const styles =
    files.find((f) => f.path === "src/styles.css") ?? files.find((f) => f.path === "src/index.css");
  const shell = files.find((f) => f.path === "index.html");

  // 1. Fonts declared but never loaded → the app renders in system sans.
  if (styles) {
    const declared = Array.from(
      styles.content.matchAll(/--font-(?:display|body)\s*:\s*["']([^"',]+)["']/g),
    ).map((m) => (m[1] ?? "").trim());
    if (declared.length) {
      const everything = files.map((f) => f.content).join("\n").replace(/\+/g, " ").toLowerCase();
      const loadsFonts = /fonts\.googleapis\.com|@fontsource/i.test(everything);
      const missing = declared.filter((fam) => !everything.includes(fam.toLowerCase()) || !loadsFonts);
      if (missing.length) {
        issues.push({
          path: shell?.path ?? styles.path,
          kind: "render-risk",
          detail: `design-contract: ${missing.join(", ")} is declared in CSS but never loaded, so the app renders in the system font. Add the Google Fonts <link> tags to the <head> of index.html.`,
        });
      }
    }
    // 2. No base typography binding — the pair exists but nothing uses it.
    if (/--font-display\s*:/.test(styles.content) && !/font-family:\s*var\(--font-(display|body)\)/.test(styles.content)) {
      const usesUtility = files.some((f) => /\bfont-(display|body)\b/.test(f.content));
      if (!usesUtility) {
        issues.push({
          path: styles.path,
          kind: "render-risk",
          detail:
            "design-contract: the locked type pair is declared but no element uses it. Bind body to var(--font-body) and h1–h3 to var(--font-display).",
        });
      }
    }
  }

  // 3. Interior pages built from raw divs with no design system.
  const interior = files.filter(
    (f) =>
      /^src\/(pages|routes)\/[^/]+\.(tsx|jsx)$/.test(f.path) &&
      !/(home|index|landing|__root)/i.test(f.path) &&
      f.content.length > 600,
  );
  const bare = interior.filter(
    (f) =>
      !/@\/components\//.test(f.content) &&
      !/\b(bg-card|bg-muted|bg-background|text-muted-foreground|border-border|shadow-|rounded-(xl|2xl|3xl))\b/.test(
        f.content,
      ),
  );
  if (bare.length) {
    issues.push({
      path: bare[0]!.path,
      kind: "render-risk",
      detail: `design-contract: ${bare.length} interior page(s) (${bare
        .slice(0, 3)
        .map((f) => f.path)
        .join(", ")}) are raw unstyled markup — no kit components, no semantic tokens, no elevation. Rebuild them with the same design system as the landing: page header, elevated cards, empty states.`,
    });
  }

  return issues;
}

export function findAntiSamenessIssues(files: ProjectFile[]): LocalIssue[] {
  const issues: LocalIssue[] = [...findDesignContractIssues(files), ...findCopySlopIssues(files)];
  const indexRoute =
    files.find((f) => f.path === "src/routes/index.tsx") ??
    files.find((f) => f.path === "src/App.tsx") ??
    files.find((f) => f.path === "src/pages/Index.tsx") ??
    files.find((f) => f.path === "src/pages/Home.tsx");

  const joined = files
    .filter((f) => /\.(tsx|css)$/.test(f.path))
    .map((f) => f.content)
    .join("\n")
    .slice(0, 250_000);

  const cliches = scanCliches(joined);
  if (cliches.length > 0 && indexRoute) {
    issues.push({
      path: indexRoute.path,
      kind: "render-risk",
      detail: `anti-sameness: found ${cliches.length} banned AI-default fingerprint(s) — ${cliches.slice(0, 4).join("; ")}. Replace with locked palette tokens and typography.`,
    });
  }

  // Only enforce section checklist for pages that look like landings.
  const looksLikeLanding =
    /\b(Hero|Landing)\b/.test(joined) && /\b(Footer|FooterSection)\b/.test(joined);
  if (looksLikeLanding && indexRoute) {
    const missing = scanLandingSections(joined);
    if (missing.length >= 4) {
      issues.push({
        path: indexRoute.path,
        kind: "render-risk",
        detail: `landing-checklist: missing ${missing.length} required section(s) — ${missing.join(", ")}. A complete landing needs nav + hero + social proof + features + how-it-works + showcase + testimonials + pricing + FAQ + CTA + footer.`,
      });
    }
  }

  return issues;
}
