/**
 * /themes — theme presets + reusable snippets the user can apply to any
 * project. Both surfaces ship a tightly-scoped prompt to the builder so
 * functionality is preserved.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Palette, Puzzle, Sparkles, ArrowRight } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { useAuth } from "@/lib/auth";
import { THEME_PRESETS, SNIPPETS, type Snippet } from "@/lib/themes-and-snippets";

export const Route = createFileRoute("/themes")({
  head: () => ({
    meta: [
      { title: "Themes & snippets · Petal" },
      {
        name: "description",
        content:
          "Apply opinionated theme presets and drop-in feature snippets to any Petal project — without rewriting your app.",
      },
      { property: "og:title", content: "Petal Themes & Snippets" },
      {
        property: "og:description",
        content:
          "Re-skin or extend any project with one click — theme presets and ready-made section/feature snippets.",
      },
    ],
  }),
  component: ThemesPage,
});

type Tab = "themes" | "snippets";
type SnippetCat = "All" | Snippet["category"];

function ThemesPage() {
  const navigate = useNavigate();
  const { user, isReady } = useAuth();
  const [tab, setTab] = useState<Tab>("themes");
  const [snippetCat, setSnippetCat] = useState<SnippetCat>("All");

  function ship(prompt: string, source: string) {
    const target = `/builder?prompt=${encodeURIComponent(prompt)}&source=${source}`;
    if (isReady && user) {
      window.location.href = target;
      return;
    }
    if (isReady && !user) {
      window.location.href = `/auth?mode=signup&redirect=${encodeURIComponent(target)}`;
      return;
    }
    navigate({ to: "/auth", search: { mode: "signup", redirect: target } });
  }

  const snippetCats: SnippetCat[] = useMemo(
    () => ["All", ...Array.from(new Set(SNIPPETS.map((s) => s.category)))],
    [],
  );
  const filteredSnippets = useMemo(
    () => (snippetCat === "All" ? SNIPPETS : SNIPPETS.filter((s) => s.category === snippetCat)),
    [snippetCat],
  );

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-12">
        <header className="max-w-2xl">
          <p className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-primary">
            <Sparkles className="h-3.5 w-3.5" /> Themes & Snippets
          </p>
          <h1 className="mt-2 font-display text-4xl md:text-5xl">
            Re-skin or extend any project, instantly
          </h1>
          <p className="mt-3 text-muted-foreground">
            Pick a theme preset to re-skin without changing functionality, or
            drop in a battle-tested feature snippet — pricing tables, contact
            forms, kanban boards, and more.
          </p>
        </header>

        {/* Tabs */}
        <div className="mt-8 inline-flex gap-1 rounded-full border border-border bg-card p-1">
          <button
            type="button"
            onClick={() => setTab("themes")}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition ${
              tab === "themes"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Palette className="h-3.5 w-3.5" /> Themes ({THEME_PRESETS.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("snippets")}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition ${
              tab === "snippets"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Puzzle className="h-3.5 w-3.5" /> Snippets ({SNIPPETS.length})
          </button>
        </div>

        {/* Themes */}
        {tab === "themes" && (
          <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {THEME_PRESETS.map((t) => (
              <li key={t.slug}>
                <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[var(--shadow-soft)]">
                  {/* Big palette preview */}
                  <div className="grid h-28 grid-cols-3">
                    {t.palette.map((c) => (
                      <div
                        key={c.name}
                        style={{ background: c.sample }}
                        title={`${c.name} ${c.sample}`}
                      />
                    ))}
                  </div>
                  <div className="flex flex-1 flex-col gap-3 p-5">
                    <div>
                      <h3 className="font-display text-lg leading-tight">{t.name}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">{t.vibe}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <span className="rounded-full bg-muted px-2 py-0.5">{t.fonts.display}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5">{t.fonts.body}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => ship(t.prompt, `theme-${t.slug}`)}
                      className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:brightness-110"
                    >
                      Apply theme <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        )}

        {/* Snippets */}
        {tab === "snippets" && (
          <>
            <div className="mt-6 flex flex-wrap gap-2">
              {snippetCats.map((c) => {
                const active = snippetCat === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setSnippetCat(c)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>

            <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredSnippets.map((s) => (
                <li key={s.slug}>
                  <article className="flex h-full flex-col rounded-2xl border border-border bg-card p-5 transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[var(--shadow-soft)]">
                    <div className="flex items-start justify-between">
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-muted">
                        <Puzzle className="h-4 w-4 text-foreground/80" />
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {s.category}
                      </span>
                    </div>
                    <h3 className="mt-3 font-display text-lg leading-tight">{s.name}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{s.blurb}</p>
                    <button
                      type="button"
                      onClick={() => ship(s.prompt, `snippet-${s.slug}`)}
                      className="mt-5 inline-flex items-center justify-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:brightness-110"
                    >
                      Add to project <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </article>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
