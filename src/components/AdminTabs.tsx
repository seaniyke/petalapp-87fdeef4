/**
 * Persistent sub-navigation rendered under SiteHeader on every /admin/* page.
 * Active tab is highlighted via TanStack Router's pathname.
 */
import { Link, useRouterState } from "@tanstack/react-router";

type Tab = { to: "/admin" | "/admin/users" | "/admin/projects" | "/admin/ledgers" | "/admin/billing" | "/admin/ai-providers" | "/admin/pipeline" | "/admin/failures" | "/admin/digest" | "/admin/qa"; label: string; exact?: boolean };

const TABS: Tab[] = [
  { to: "/admin", label: "Overview", exact: true },
  { to: "/admin/users", label: "Users" },
  { to: "/admin/projects", label: "Projects" },
  { to: "/admin/ledgers", label: "Ledgers" },
  { to: "/admin/billing", label: "Billing" },
  { to: "/admin/ai-providers", label: "AI Providers" },
  { to: "/admin/pipeline", label: "Pipeline" },
  { to: "/admin/failures", label: "Failures" },
  { to: "/admin/digest", label: "Digest" },
  { to: "/admin/qa", label: "Catalog QA" },
];

export function AdminTabs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="border-b border-border/60 bg-background/60 backdrop-blur">
      <div className="mx-auto max-w-6xl overflow-x-auto px-4 sm:px-6">
        <nav className="flex min-w-max items-center gap-1 py-2">
          {TABS.map((t) => {
            const active = t.exact ? pathname === t.to : pathname.startsWith(t.to);
            return (
              <Link
                key={t.to}
                to={t.to}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
