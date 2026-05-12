/**
 * /packs — gallery of industry packs (multi-page, opinionated starters).
 *
 * Heavier than /templates: each pack here is a full website brief with a
 * page list, palette, typography, and Cloud features. Click-through goes
 * to /packs/$slug for the full breakdown before launching the builder.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { Sparkles, ArrowRight } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { INDUSTRY_PACKS } from "@/lib/industry-packs";

export const Route = createFileRoute("/packs")({
  head: () => ({
    meta: [
      { title: "Industry Packs · Petal" },
      {
        name: "description",
        content:
          "Opinionated multi-page starters for restaurants, real estate, fitness studios, consultancies and newsletters. Full briefs, palettes, and Cloud features included.",
      },
      { property: "og:title", content: "Petal Industry Packs" },
      {
        property: "og:description",
        content:
          "Full website briefs tuned per industry — pages, palette, typography, and Cloud features picked for you.",
      },
    ],
  }),
  component: PacksGallery,
});

function PacksGallery() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-6 py-12">
        <header className="max-w-2xl">
          <p className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-primary">
            <Sparkles className="h-3.5 w-3.5" /> Industry Packs
          </p>
          <h1 className="mt-2 font-display text-4xl md:text-5xl">
            Whole websites, opinionated for your industry
          </h1>
          <p className="mt-3 text-muted-foreground">
            Multi-page briefs tuned for a specific kind of business. Each
            pack ships with the page list, palette, typography pairing, and
            the Cloud features Petal will turn on for you.
          </p>
        </header>

        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {INDUSTRY_PACKS.map((pack) => (
            <li key={pack.slug}>
              <Link
                to="/packs/$slug"
                params={{ slug: pack.slug }}
                className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[var(--shadow-soft)]"
              >
                {/* Palette swatch strip */}
                <div className="flex h-20 w-full">
                  {pack.palette.map((c) => (
                    <div
                      key={c.name}
                      className="flex-1"
                      style={{ background: c.sample }}
                      title={c.name}
                    />
                  ))}
                </div>
                <div className="flex flex-1 flex-col gap-3 p-5">
                  <div className="flex items-center gap-2">
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-muted text-foreground/80">
                      <pack.Icon className="h-4.5 w-4.5" />
                    </span>
                    <h3 className="font-display text-lg leading-tight">{pack.name}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">{pack.tagline}</p>
                  <div className="mt-auto flex items-center justify-between pt-3 text-xs text-muted-foreground">
                    <span>{pack.pages.length} pages</span>
                    <span className="inline-flex items-center gap-1 text-foreground transition group-hover:gap-1.5">
                      View pack <ArrowRight className="h-3.5 w-3.5" />
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
