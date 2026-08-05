import type { ProjectFile } from "@/server/generate.server";
import type { LocalIssue } from "@/server/local-verifier";
import type { WebSubtype } from "@/lib/web-subtype";
import { findAntiSamenessIssues } from "@/server/anti-sameness.server";
import { findDeadMobileNav, findDeadButtons } from "@/server/interaction-hygiene.server";


function appEntrypoint(files: ProjectFile[]): ProjectFile | undefined {
  return files.find((f) => f.path === "src/App.tsx") ?? files.find((f) => f.path === "src/pages/Home.tsx");
}

export function findGenerationQualityIssues(
  files: ProjectFile[],
  subtype?: WebSubtype,
): LocalIssue[] {
  const issues: LocalIssue[] = [];
  if (!subtype) return issues;

  const paths = files.map((f) => f.path);
  const joined = files.map((f) => f.content).join("\n").slice(0, 180_000);

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

  // Anti-sameness scan: flags AI-default fingerprints (indigo/purple gradients,
  // Inter typography, missing landing sections). Informational notes only —
  // never blocks. Fires on marketing + fullstack (landings can appear inside
  // fullstack apps too).
  if (subtype === "marketing" || subtype === "fullstack") {
    try {
      issues.push(...findAntiSamenessIssues(files));
    } catch {
      /* never block on scan failure */
    }
  }

  // Web standards scan: dead hamburger menus and buttons wired to nothing are
  // the #1 "it looks finished but nothing works" complaint. Reported so the
  // repair loop wires them up.
  for (const f of files) {
    if (!/\.(tsx|jsx)$/.test(f.path)) continue;
    const nav = findDeadMobileNav(f.path, f.content);
    if (nav) issues.push({ path: f.path, kind: "render-risk", detail: nav });
    const btn = findDeadButtons(f.path, f.content);
    if (btn) issues.push({ path: f.path, kind: "render-risk", detail: btn });
  }



  return issues;
}