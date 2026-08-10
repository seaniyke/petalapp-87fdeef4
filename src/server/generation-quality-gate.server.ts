import type { ProjectFile } from "@/server/generate.server";
import type { LocalIssue } from "@/server/local-verifier";
import type { WebSubtype } from "@/lib/web-subtype";
import { findAntiSamenessIssues } from "@/server/anti-sameness.server";
import { findDeadMobileNav, findDeadButtons } from "@/server/interaction-hygiene.server";
import { lintProductPrinciples } from "@/server/product-principles.server";
import { isScaffoldOwnedPath } from "@/server/scaffold-ownership.server";


function appEntrypoint(files: ProjectFile[]): ProjectFile | undefined {
  return files.find((f) => f.path === "src/App.tsx") ?? files.find((f) => f.path === "src/pages/Home.tsx");
}

export function findGenerationQualityIssues(
  files: ProjectFile[],
  subtype?: WebSubtype,
): LocalIssue[] {
  const issues: LocalIssue[] = [];
  if (!subtype) return issues;

  // Scaffold examples are reference material, not rendered product surfaces.
  // Including them made every public tool appear to contain auth/dashboard
  // routes and dozens of dead buttons, opening an unnecessary repair cycle.
  const productFiles = files.filter((f) => !isScaffoldOwnedPath(f.path));
  const paths = productFiles.map((f) => f.path);
  const joined = productFiles.map((f) => f.content).join("\n").slice(0, 180_000);

  if (subtype === "marketing") {
    const offenders = paths.filter((p) => /(^|\/)(auth|login|sign-in|sign-up|dashboard)(\.|\/)/i.test(p));
    const shellLeak = /\b(Sidebar|DashboardLayout|SidebarShell|KpiGrid|StatCard)\b/.test(joined);
    if (offenders.length || shellLeak) {
      issues.push({
        path: appEntrypoint(files)?.path ?? "src/App.tsx",
        kind: "render-risk",
        detail: `marketing build contains app-shell/auth/dashboard surfaces${offenders.length ? `: ${offenders.slice(0, 4).join(", ")}` : ""}. Replace with a marketing header, hero, sections, CTA, and footer; remove auth/dashboard navigation from the rendered shell.`,
      });
    }
  }

  if (subtype === "app") {
    const app = appEntrypoint(files);
    if (app) {
      const hasHeroOnly = /\b(hero|headline|cta)\b/i.test(app.content) && !/\b(nav|sidebar|dashboard|settings|table|form|tabs|route|Link|NavLink)\b/.test(app.content);
      const hasSingleSection = (app.content.match(/<section\b/g) ?? []).length <= 1;
      if (hasHeroOnly && hasSingleSection) {
        issues.push({
          path: app.path,
          kind: "render-risk",
          detail: "web app build is only a marketing hero with no navigation or app shell. Replace with a usable app shell, persistent nav, dashboard content, and at least one working domain view.",
        });
      }
    }
  }

  if (subtype === "tool") {
    // A single-purpose tool fails in exactly two ways: the tool isn't
    // interactive, or the maths lives nowhere. Both are checkable.
    const hasLogicModule = files.some(
      (f) => /^src\/lib\/.+\.(ts|tsx)$/.test(f.path) && /export\s+(function|const)\s+\w+/.test(f.content),
    );
    const hasInteractive = /useState|useReducer|onChange=|onSubmit=/.test(joined);
    const entry = appEntrypoint(files);
    if (!hasInteractive) {
      issues.push({
        path: entry?.path ?? "src/App.tsx",
        kind: "render-risk",
        detail:
          "this product IS a tool, but nothing on the page is interactive. Add real inputs with state and a live computed result above the fold.",
      });
    }
    if (!hasLogicModule) {
      issues.push({
        path: entry?.path ?? "src/App.tsx",
        kind: "render-risk",
        detail:
          "the tool's domain logic is not in a typed module. Extract pure exported functions into `src/lib/<domain>.ts` and call them from the UI.",
      });
    }
    const shellLeak = paths.some((p) => /(^|\/)(auth|login|sign-in|sign-up|dashboard|admin)(\.|\/)/i.test(p));
    if (shellLeak) {
      issues.push({
        path: entry?.path ?? "src/App.tsx",
        kind: "render-risk",
        detail: "a public tool must not ship auth/dashboard/admin surfaces. Remove them and keep one public page.",
      });
    }
  }

  // The design-contract scan applies to every web product. Its landing
  // checklist self-gates, while apps/tools still receive typography, brand,
  // interior-page and banned-default checks.
  try {
    issues.push(...findAntiSamenessIssues(files));
  } catch {
    /* never block on scan failure */
  }

  // Web standards scan: dead hamburger menus and buttons wired to nothing are
  // the #1 "it looks finished but nothing works" complaint. Reported so the
  // repair loop wires them up.
  for (const f of productFiles) {
    if (!/\.(tsx|jsx)$/.test(f.path)) continue;
    const nav = findDeadMobileNav(f.path, f.content);
    if (nav) issues.push({ path: f.path, kind: "render-risk", detail: nav });
    const btn = findDeadButtons(f.path, f.content);
    if (btn) issues.push({ path: f.path, kind: "render-risk", detail: btn });
  }



  // Phase 5 — Product Principles (docs/petal-product-principles.md). Soft
  // warnings for placeholders, demo disclaimers, brand leaks, and hype copy.
  try {
    issues.push(...lintProductPrinciples(files));
  } catch {
    /* never block on scan failure */
  }

  return issues;
}