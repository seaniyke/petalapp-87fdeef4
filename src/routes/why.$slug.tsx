import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { useMarketplaceFeature } from "@/hooks/use-marketplace-feature";
import { DIFFERENCES, ORDER } from "@/lib/why-differences";

export const Route = createFileRoute("/why/$slug")({
  loader: ({ params }) => {
    const d = DIFFERENCES[params.slug];
    if (!d) throw notFound();
    return { difference: d };
  },
  head: ({ loaderData, params }) => {
    const d = loaderData?.difference;
    if (!d) {
      return {
        meta: [
          { title: "Unavailable — Kimble" },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    const title = `${d.eyebrow} — Kimble`;
    const url = `https://kimble.cloud/why/${params.slug}`;
    return {
      meta: [
        { title },
        { name: "description", content: d.lede },
        { property: "og:title", content: title },
        { property: "og:description", content: d.lede },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        { name: "twitter:card", content: "summary_large_image" },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: WhyPage,
  notFoundComponent: WhyNotFound,
});

function WhyNotFound() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-6 py-32 text-center">
        <h1 className="font-display text-5xl font-black tracking-[-0.04em]">Not found</h1>
        <p className="mt-4 text-muted-foreground">That page doesn't exist.</p>
        <Link
          to="/"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}

function WhyPage() {
  const { difference } = Route.useLoaderData();
  const { enabled: marketplaceEnabled, loading } = useMarketplaceFeature();
  if (difference.slug === "marketplace" && loading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <SiteHeader />
        <div className="mx-auto max-w-xl px-6 py-32 text-center text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (difference.slug === "marketplace" && !loading && !marketplaceEnabled) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <SiteHeader />
        <div className="mx-auto max-w-xl px-6 py-32 text-center">
          <h1 className="text-2xl font-bold">This page isn't available</h1>
          <Button asChild className="mt-6"><Link to="/">Back to Kimble</Link></Button>
        </div>
      </div>
    );
  }
  const Icon = difference.icon;
  const idx = ORDER.indexOf(difference.slug as (typeof ORDER)[number]);
  const rail = ORDER.filter((s) => s !== difference.slug && (marketplaceEnabled || s !== "marketplace")).map((s) => DIFFERENCES[s]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />

      {/* Editorial hero — type does the work, one accent, no hero image stock. */}
      <section className="relative overflow-hidden border-b border-border/60">
        <div className="absolute inset-x-0 top-0 h-full bg-aurora opacity-50" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-5 pb-20 pt-32 sm:px-6 sm:pb-28 sm:pt-40">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground transition hover:text-foreground"
          >
            ← Kimble
          </Link>

          <div className="mt-10 grid gap-10 lg:grid-cols-[1.35fr_1fr] lg:items-end">
            <div>
              <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.28em] text-primary">
                <Icon className="h-3.5 w-3.5" />
                {difference.eyebrow}
              </p>
              <h1 className="mt-5 max-w-4xl font-display text-[2.6rem] font-black leading-[0.92] tracking-[-0.045em] sm:text-6xl md:text-7xl">
                {difference.title} <span className="italic font-normal">{difference.titleItalic}</span>
              </h1>
            </div>
            <p className="max-w-md text-lg leading-relaxed text-muted-foreground lg:pb-3">{difference.lede}</p>
          </div>
        </div>
      </section>

      {/* Substance — numbered editorial rows, not three matching cards. */}
      <section className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-28">
        <div className="space-y-px">
          {difference.blocks.map((b, i) => (
            <article
              key={b.heading}
              className="grid gap-4 border-t border-border py-10 sm:grid-cols-[6rem_1fr] sm:gap-10 md:grid-cols-[9rem_1fr]"
            >
              <div className="font-display text-3xl font-black tabular-nums text-primary/70 sm:text-4xl">
                {String(i + 1).padStart(2, "0")}
              </div>
              <div className="max-w-2xl">
                <h2 className="font-display text-2xl font-bold tracking-[-0.02em] sm:text-3xl">{b.heading}</h2>
                <p className="mt-3 text-base leading-relaxed text-muted-foreground sm:text-lg">{b.body}</p>
              </div>
            </article>
          ))}
        </div>

        {/* Honest proof row — product facts only. */}
        <dl className="mt-14 grid gap-8 border-t border-border pt-10 sm:grid-cols-3">
          {difference.proof.map((p) => (
            <div key={p.label}>
              <dt className="font-display text-4xl font-black tracking-[-0.03em] sm:text-5xl">{p.stat}</dt>
              <dd className="mt-2 text-sm text-muted-foreground">{p.label}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-14">
          <Link
            to={difference.cta.to}
            className="inline-flex h-13 items-center gap-2 rounded-full bg-foreground px-7 py-3.5 text-sm font-semibold text-background transition hover:-translate-y-0.5"
          >
            {difference.cta.label}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Cross-link rail to the other three. */}
      <section className="border-t border-border bg-card/30">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-muted-foreground">
            The rest of the difference
          </p>
          <div className="mt-6 grid gap-px sm:grid-cols-3">
            {rail.map((d) => (
              <Link
                key={d.slug}
                to="/why/$slug"
                params={{ slug: d.slug }}
                className="group border-t border-border py-6 pr-6 transition sm:border-t-0 sm:pt-0"
              >
                <span className="font-display text-xl font-bold tracking-[-0.02em] group-hover:text-primary">
                  {d.eyebrow}
                </span>
                <span className="mt-2 block max-w-xs text-sm leading-relaxed text-muted-foreground">{d.lede}</span>
              </Link>
            ))}
          </div>
          <p className="sr-only">Page {idx + 1} of {ORDER.length}</p>
        </div>
      </section>
    </div>
  );
}
