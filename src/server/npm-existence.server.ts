/**
 * Phase 3 — npm package pre-flight.
 *
 * The local verifier emits `missing-dep` for any bare import whose package
 * root isn't in package.json. That covers two very different failure modes:
 *
 *   1. HALLUCINATION  — the model invented `react-cooler-toast-9001`. No
 *      install will ever succeed; the user's preview will spin forever and
 *      eventually red-screen with `Failed to resolve import`.
 *   2. REAL PACKAGE   — the model wrote a valid import (e.g. `date-fns`)
 *      but didn't add it to package.json. Our install step adds these
 *      automatically, so this isn't actually fatal.
 *
 * We can only tell them apart by asking npm. This module does exactly one
 * thing: HEAD `https://registry.npmjs.org/<pkg>` for each unique package
 * root, in parallel, with an aggressive cache and a tight timeout. The
 * caller (`generate.ts` Tier 2.45) uses the verdict to either drop the
 * issue (real package) or escalate it (hallucination).
 *
 * Design constraints:
 * - Zero new dependencies — uses global fetch.
 * - Cache results across calls within a single Worker instance. Negative
 *   results (404) are cached too, but with a shorter TTL (10 min vs 24 h)
 *   so a freshly-published package isn't permanently blacklisted.
 * - 3 s per-package timeout. Network fail → "unknown" (not "missing"). We
 *   never block a turn on a flaky registry; an unknown is treated as a
 *   real package by the caller.
 */

import type { LocalIssue } from "@/server/local-verifier";

export type ExistenceVerdict = "exists" | "missing" | "unknown";

interface CacheEntry {
  verdict: ExistenceVerdict;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const POSITIVE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const NEGATIVE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const PROBE_TIMEOUT_MS = 3_000;

/**
 * Packages that ship in the scaffold's package.json or are known-good
 * staples. We never probe these — they always exist and the request to
 * npm just adds latency. Keep this list small; the cache handles the rest.
 */
const NEVER_PROBE = new Set<string>([
  "react",
  "react-dom",
  "@tanstack/react-router",
  "@tanstack/react-start",
  "@tanstack/react-query",
  "@supabase/supabase-js",
  "zod",
  "clsx",
  "tailwind-merge",
  "class-variance-authority",
  "lucide-react",
  "framer-motion",
  "date-fns",
  "recharts",
  "sonner",
  "next-themes",
  "react-hook-form",
  "@hookform/resolvers",
  "zustand",
]);

/**
 * Bare specifier → npm package name. Mirrors the helper in local-verifier.
 *   `lodash`              → `lodash`
 *   `lodash/fp`           → `lodash`
 *   `@radix-ui/react-id`  → `@radix-ui/react-id`
 *   `@scope/pkg/sub/path` → `@scope/pkg`
 */
function pkgRoot(spec: string): string {
  if (spec.startsWith("@")) return spec.split("/").slice(0, 2).join("/");
  return spec.split("/")[0];
}

/** Allow tests to inject a fake fetch. */
export interface ProbeOptions {
  fetchImpl?: typeof fetch;
  /** Override the timeout (tests use a small value). */
  timeoutMs?: number;
}

async function probeOne(
  pkg: string,
  opts: ProbeOptions = {},
): Promise<ExistenceVerdict> {
  const cached = cache.get(pkg);
  if (cached && cached.expiresAt > Date.now()) return cached.verdict;

  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;

  // npm registry supports HEAD on the package endpoint and returns 200/404.
  // We use the registry domain (not npmjs.com) for stability + low latency.
  const url = `https://registry.npmjs.org/${encodeURIComponent(pkg).replace("%40", "@")}`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { method: "HEAD", signal: ac.signal });
    let verdict: ExistenceVerdict;
    if (res.status === 200) verdict = "exists";
    else if (res.status === 404) verdict = "missing";
    else verdict = "unknown"; // 5xx, redirects, rate limits → don't decide
    cache.set(pkg, {
      verdict,
      expiresAt:
        Date.now() + (verdict === "missing" ? NEGATIVE_TTL_MS : POSITIVE_TTL_MS),
    });
    return verdict;
  } catch {
    // Network error, abort, DNS — treat as unknown so we don't block.
    return "unknown";
  } finally {
    clearTimeout(t);
  }
}

/**
 * Probe a batch of package roots in parallel. Skips the never-probe list
 * (returned as "exists") and dedupes input. Always resolves; never throws.
 */
export async function probePackages(
  pkgs: string[],
  opts: ProbeOptions = {},
): Promise<Map<string, ExistenceVerdict>> {
  const out = new Map<string, ExistenceVerdict>();
  const toProbe = new Set<string>();
  for (const raw of pkgs) {
    const root = pkgRoot(raw);
    if (out.has(root)) continue;
    if (NEVER_PROBE.has(root)) {
      out.set(root, "exists");
      continue;
    }
    toProbe.add(root);
  }
  const probed = await Promise.all(
    [...toProbe].map(async (p) => [p, await probeOne(p, opts)] as const),
  );
  for (const [p, v] of probed) out.set(p, v);
  return out;
}

export interface PreflightResult {
  /** Issues to keep / surface to the rest of the pipeline. */
  issues: LocalIssue[];
  /** Packages we confirmed do not exist on the registry. */
  hallucinated: string[];
  /** Packages that exist on npm but weren't in package.json. */
  realButMissing: string[];
  /** Packages we couldn't decide on (network/registry hiccup). */
  unknown: string[];
}

/**
 * Apply the npm pre-flight to a set of local-verifier issues.
 *
 * Rules:
 *   - `missing-dep` for a HALLUCINATED package → keep, escalate detail.
 *   - `missing-dep` for a REAL package        → drop (installer handles it).
 *   - `missing-dep` for an UNKNOWN package    → keep as-is. We can't prove
 *     it's bogus, but we also can't promise the installer will find it,
 *     so the existing autofix path stays in play.
 *   - Any other issue kind → passes through untouched.
 */
export async function applyNpmPreflight(
  issues: LocalIssue[],
  opts: ProbeOptions = {},
): Promise<PreflightResult> {
  const depIssues = issues.filter((i) => i.kind === "missing-dep");
  if (depIssues.length === 0) {
    return { issues, hallucinated: [], realButMissing: [], unknown: [] };
  }
  // Extract the package root from each issue's detail. The local verifier
  // emits: `import "X" — package "Y" is not in package.json`. We parse Y.
  const pkgs: string[] = [];
  const issuePkg = new Map<LocalIssue, string>();
  for (const issue of depIssues) {
    const m = /package "([^"]+)"/.exec(issue.detail);
    if (m) {
      pkgs.push(m[1]);
      issuePkg.set(issue, m[1]);
    }
  }

  const verdicts = await probePackages(pkgs, opts);

  const hallucinated: string[] = [];
  const realButMissing: string[] = [];
  const unknown: string[] = [];
  const out: LocalIssue[] = [];

  for (const issue of issues) {
    if (issue.kind !== "missing-dep") {
      out.push(issue);
      continue;
    }
    const pkg = issuePkg.get(issue);
    const v = pkg ? verdicts.get(pkg) : undefined;
    if (v === "missing") {
      if (pkg && !hallucinated.includes(pkg)) hallucinated.push(pkg);
      out.push({
        ...issue,
        detail: `${issue.detail} — and "${pkg}" does not exist on npm (hallucinated)`,
      });
    } else if (v === "exists") {
      if (pkg && !realButMissing.includes(pkg)) realButMissing.push(pkg);
      // Drop — the install step will add it. This is the false-positive fix.
    } else {
      if (pkg && !unknown.includes(pkg)) unknown.push(pkg);
      out.push(issue);
    }
  }

  return { issues: out, hallucinated, realButMissing, unknown };
}

/** Test-only: clear the in-memory cache between fixtures. */
export function _resetNpmExistenceCache(): void {
  cache.clear();
}
