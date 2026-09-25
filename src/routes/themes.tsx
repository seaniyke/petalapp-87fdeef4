/**
 * /themes — reusable feature/section snippets. Composition only: nothing here
 * chooses colours, fonts or accents (the design-system package owns those).
 * Theme presets were removed; re-theming uses the deterministic package engine.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Puzzle, Sparkles, ArrowRight } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { useAuth } from "@/lib/auth";
import { SNIPPETS, type Snippet } from "@/lib/themes-and-snippets";

export const Route = createFileRoute("/themes")({
  head: () => ({
    meta: [
      { title: "Snippets · Kimble" },
      {
        name: "description",
        content:
          "Drop ready-made sections and features — pricing tables, contact forms, kanban boards — into any Kimble project.",
      },
      { property: "og:title", content: "Kimble Snippets" },
      {
        property: "og:description",
        content:
          "Extend any project with one click using ready-made section and feature snippets.",
      },
    ],
  }),
  component: ThemesPage,
});

type SnippetCat = "All" | Snippet["category"];

function ThemesPage() {
  const navigate = useNavigate();
  const { user, isReady } = useAuth();
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
            <Sparkles className="h-3.5 w-3.5" /> Snippets
          </p>
          <h1 className="mt-2 font-display text-4xl md:text-5xl">
            Extend any project, instantly
          </h1>
          <p className="mt-3 text-muted-foreground">
            Drop in a battle-tested feature snippet — pricing tables, contact
            forms, kanban boards, and more. Your project keeps its own look.
          </p>
        </header>

        {/* Snippets */}
        {(
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
