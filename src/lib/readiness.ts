/**
 * Production Readiness Score — Petal's "is my app actually ready?" metric.
 *
 * No competitor surfaces this. We aggregate signals we already have access to
 * (project files, project row, Shield report) into a single 0–100 score with
 * a checklist the user can click through. Frames Petal as "the one that
 * actually ships," not just another vibe-coding toy.
 *
 * Pure client-side computation over ProjectFile[] + ProjectRow + ShieldReport.
 */
import type { ProjectFile } from "@/server/generate.server";
import type { ProjectRow } from "@/lib/projects";
import type { ShieldReport } from "@/lib/petal-shield";

export type ReadinessCheckId =
  | "shield_clean"
  | "custom_domain"
  | "auth_wired"
  | "error_boundaries"
  | "loading_states"
  | "seo_metadata"
  | "responsive_design"
  | "analytics"
  | "rls_policies"
  | "no_placeholder";

export type ReadinessCheck = {
  id: ReadinessCheckId;
  label: string;
  passed: boolean;
  weight: number; // contribution to score
  detail: string; // why it passed/failed
  category: "security" | "polish" | "growth" | "infra";
};

export type ReadinessReport = {
  score: number; // 0–100
  level: "prototype" | "beta" | "production";
  checks: ReadinessCheck[];
  passedCount: number;
  totalChecks: number;
};

function findFile(files: ProjectFile[], path: string): ProjectFile | undefined {
  return files.find((f) => f.path === path);
}

function anyFileMatches(files: ProjectFile[], re: RegExp): boolean {
  return files.some((f) => re.test(f.content));
}

function levelFor(score: number): ReadinessReport["level"] {
  if (score >= 80) return "production";
  if (score >= 55) return "beta";
  return "prototype";
}

export function evaluateReadiness(
  files: ProjectFile[],
  project: ProjectRow | null,
  shield: ShieldReport,
): ReadinessReport {
  const checks: ReadinessCheck[] = [];

  // 1. Shield clean (no critical findings)
  const criticals = shield.findings.filter((f) => f.severity === "critical").length;
  checks.push({
    id: "shield_clean",
    label: "No critical security issues",
    passed: criticals === 0,
    weight: 20,
    detail:
      criticals === 0
        ? "Petal Shield found no critical issues."
        : `Petal Shield found ${criticals} critical issue${criticals === 1 ? "" : "s"}. Open Shield to fix.`,
    category: "security",
  });

  // 2. Custom domain attached
  const hasDomain = Boolean(
    (project as unknown as { custom_domain?: string | null })?.custom_domain ||
      (project as unknown as { domain?: string | null })?.domain,
  );
  checks.push({
    id: "custom_domain",
    label: "Custom domain connected",
    passed: hasDomain,
    weight: 10,
    detail: hasDomain
      ? "Your project is reachable on a custom domain."
      : "Add a custom domain in Settings → Domains for a brand-ready URL.",
    category: "growth",
  });

  // 3. Auth wired
  const authWired = anyFileMatches(
    files,
    /supabase\.auth\.(signInWith|signUp|signOut|getUser|getSession)/,
  );
  checks.push({
    id: "auth_wired",
    label: "Authentication implemented",
    passed: authWired,
    weight: 10,
    detail: authWired
      ? "Auth flows are wired up."
      : "No auth calls detected. Add login/signup if your app stores user data.",
    category: "infra",
  });

  // 4. Error boundaries on routes
  const hasErrorBoundary = anyFileMatches(
    files,
    /errorComponent\s*[:=]|ErrorBoundary|defaultErrorComponent/,
  );
  checks.push({
    id: "error_boundaries",
    label: "Error boundaries on routes",
    passed: hasErrorBoundary,
    weight: 10,
    detail: hasErrorBoundary
      ? "Routes recover gracefully from runtime errors."
      : "Add errorComponent to your routes so users don't see blank screens.",
    category: "polish",
  });

  // 5. Loading / pending states
  const hasLoading = anyFileMatches(
    files,
    /pendingComponent|Skeleton|isPending|isLoading|<Loader/,
  );
  checks.push({
    id: "loading_states",
    label: "Loading states present",
    passed: hasLoading,
    weight: 8,
    detail: hasLoading
      ? "Components show feedback while data loads."
      : "Add skeletons or spinners so the app doesn't feel frozen.",
    category: "polish",
  });

  // 6. SEO metadata on root
  const root = findFile(files, "src/routes/__root.tsx");
  const hasSeo = root
    ? /head\s*[:(]/.test(root.content) &&
      /title|og:title|description/.test(root.content)
    : false;
  checks.push({
    id: "seo_metadata",
    label: "SEO metadata configured",
    passed: hasSeo,
    weight: 8,
    detail: hasSeo
      ? "Title, description, and OG tags are set."
      : "Add a head() with title, description, og:title, og:image to __root.tsx.",
    category: "growth",
  });

  // 7. Responsive design (Tailwind responsive prefixes used)
  const responsiveCount = files.reduce(
    (n, f) => n + (f.path.endsWith(".tsx") ? (f.content.match(/\b(sm|md|lg|xl):[a-z-]/g) || []).length : 0),
    0,
  );
  const responsive = responsiveCount >= 10;
  checks.push({
    id: "responsive_design",
    label: "Mobile-responsive layout",
    passed: responsive,
    weight: 8,
    detail: responsive
      ? `Found ${responsiveCount} responsive class usages.`
      : "Use Tailwind's sm:/md:/lg: prefixes so the app works on phones.",
    category: "polish",
  });

  // 8. Analytics wired
  const analytics = anyFileMatches(
    files,
    /plausible|posthog|gtag|google-analytics|umami|mixpanel/i,
  );
  checks.push({
    id: "analytics",
    label: "Analytics wired",
    passed: analytics,
    weight: 6,
    detail: analytics
      ? "Visitor analytics are tracked."
      : "Connect Plausible or PostHog from Integrations to measure usage.",
    category: "growth",
  });

  // 9. RLS policies on every public table (from Shield's RLS findings)
  const rlsMissing = shield.findings.some((f) => f.ruleId === "rls-missing");
  const hasMigrations = files.some((f) => f.path.startsWith("supabase/migrations/"));
  checks.push({
    id: "rls_policies",
    label: "Row-level security on all tables",
    passed: hasMigrations ? !rlsMissing : true,
    weight: 12,
    detail: !hasMigrations
      ? "No backend tables yet — nothing to protect."
      : rlsMissing
        ? "At least one table is missing RLS. Open Petal Shield."
        : "Every table has RLS enabled.",
    category: "security",
  });

  // 10. No placeholder content on the home route
  const home =
    findFile(files, "src/routes/index.tsx") || findFile(files, "src/routes/index.jsx");
  const hasPlaceholder = home
    ? /PlaceholderIndex|REPLACE this|data-lovable-blank-page-placeholder/.test(home.content)
    : false;
  checks.push({
    id: "no_placeholder",
    label: "Real homepage content",
    passed: home ? !hasPlaceholder : false,
    weight: 8,
    detail: hasPlaceholder
      ? "Home route still contains placeholder boilerplate. Replace it."
      : home
        ? "Home route has real content."
        : "No home route found.",
    category: "polish",
  });

  const total = checks.reduce((s, c) => s + c.weight, 0);
  const earned = checks.reduce((s, c) => s + (c.passed ? c.weight : 0), 0);
  const score = Math.round((earned / total) * 100);
  const passedCount = checks.filter((c) => c.passed).length;

  return {
    score,
    level: levelFor(score),
    checks,
    passedCount,
    totalChecks: checks.length,
  };
}

export const LEVEL_LABEL: Record<ReadinessReport["level"], string> = {
  prototype: "Prototype",
  beta: "Beta",
  production: "Production",
};
