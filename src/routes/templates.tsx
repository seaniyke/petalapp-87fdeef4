/**
 * /templates — categorized library of starter prompts.
 *
 * Companion to the small landing-page rail (StartIdeasPanel). This page
 * surfaces the *full* catalog with a category filter and a search box, so
 * users who didn't see what they wanted on the home page can browse here.
 *
 * "Use this template" submits the prompt the same way the landing-page
 * composer does: signed-in users go straight to /builder?prompt=…, signed-out
 * users go through /auth?mode=signup&redirect=…. We don't render a textarea
 * because the prompts are intentionally fixed — users can tweak them once
 * they land in the builder.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, Sparkles, ArrowRight } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { useAuth } from "@/lib/auth";
import {
  CATEGORY_ORDER,
  START_IDEAS,
  type IdeaCategory,
  type StartIdea,
} from "@/lib/start-ideas";

export const Route = createFileRoute("/templates")({
  head: () => ({
    meta: [
      { title: "Templates · Petal" },
      {
        name: "description",
        content:
          "Production-ready starter prompts for SaaS, AI tools, local business sites, internal tools, mobile apps and more. Pick one and Petal builds it.",
      },
      { property: "og:title", content: "Petal Templates — Browse 40+ starter apps" },
      {
        property: "og:description",
        content:
          "Browse Petal's template library by category. Pick a starter, tweak the prompt, ship in minutes.",
      },
      { property: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TemplatesPage,
});

const ACCENT_BG: Record<StartIdea["accent"], string> = {
  pink: "bg-primary/10 text-primary",
  mint: "bg-mint/30 text-foreground/80",
  lilac: "bg-lilac/30 text-foreground/80",
  sky: "bg-sky/30 text-foreground/80",
  butter: "bg-butter/40 text-foreground/80",
};

type Filter = "All" | IdeaCategory;

function TemplatesPage() {
  const navigate = useNavigate();
  const { user, isReady } = useAuth();
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return START_IDEAS.filter((i) => {
      if (filter !== "All" && i.category !== filter) return false;
      if (!q) return true;
      return (
        i.title.toLowerCase().includes(q) ||
        i.prompt.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q)
      );
    });
  }, [filter, query]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { All: START_IDEAS.length };
    for (const c of CATEGORY_ORDER) {
      map[c] = START_IDEAS.filter((i) => i.category === c).length;
    }
    return map;
  }, []);

  function useTemplate(idea: StartIdea) {
    const target = `/builder?prompt=${encodeURIComponent(idea.prompt)}&source=template`;
    if (isReady && user) {
      window.location.href = target;
      return;
    }
    if (isReady && !user) {
      window.location.href = `/auth?mode=signup&redirect=${encodeURIComponent(target)}`;
      return;
    }
    // Auth not yet hydrated — assume signed-out (safe default).
    navigate({
      to: "/auth",
      search: { mode: "signup", redirect: target },
    });
  }

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-12">
        <header className="max-w-2xl">
          <p className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-primary">
            <Sparkles className="h-3.5 w-3.5" /> Templates
          </p>
          <h1 className="mt-2 font-display text-4xl md:text-5xl">
            Start from something that works
          </h1>
          <p className="mt-3 text-muted-foreground">
            {START_IDEAS.length} hand-written starter prompts across SaaS, AI
            tools, local business sites, internal tools and more. Pick one,
            tweak the wording, and Petal builds it for you.
          </p>
        </header>

        {/* Search */}
        <div className="mt-8 flex max-w-md items-center gap-2 rounded-full border border-border bg-card px-4 py-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search templates…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        {/* Category filter chips */}
        <div className="mt-5 flex flex-wrap gap-2">
          {(["All", ...CATEGORY_ORDER] as Filter[]).map((c) => {
            const active = filter === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setFilter(c)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
              >
                {c}
                <span
                  className={`rounded-full px-1.5 text-[10px] ${
                    active ? "bg-primary-foreground/20" : "bg-muted"
                  }`}
                >
                  {counts[c] ?? 0}
                </span>
              </button>
            );
          })}
        </div>

        {/* Grid */}
        {filtered.length === 0 ? (
          <div className="mt-16 rounded-3xl border border-dashed border-border bg-card/60 p-12 text-center">
            <h3 className="font-display text-2xl">No templates match</h3>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
              Try a different category or clear the search. Or describe what
              you want — Petal can build anything you can imagine.
            </p>
          </div>
        ) : (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((idea) => (
              <li key={idea.title}>
                <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[var(--shadow-soft)]">
                  <div className="flex items-start justify-between gap-3 p-5">
                    <span
                      className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${ACCENT_BG[idea.accent]}`}
                    >
                      <idea.Icon className="h-5 w-5" />
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {idea.category}
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col px-5 pb-5">
                    <h3 className="font-display text-lg leading-tight">
                      {idea.title}
                    </h3>
                    <p className="mt-2 line-clamp-4 text-sm leading-relaxed text-muted-foreground">
                      {idea.prompt}
                    </p>
                    <button
                      type="button"
                      onClick={() => useTemplate(idea)}
                      className="mt-5 inline-flex items-center justify-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:brightness-110"
                    >
                      Use this template
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
