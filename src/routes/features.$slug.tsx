import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, Check, Sparkles } from "lucide-react";

import { SiteHeader } from "@/components/SiteHeader";
import { FEATURES, ORDER } from "@/lib/feature-pages";


export const Route = createFileRoute("/features/$slug")({
  loader: ({ params }) => {
    const f = FEATURES[params.slug];
    if (!f) throw notFound();
    return { feature: f };
  },
  head: ({ loaderData, params }) => {
    const f = loaderData?.feature;
    const title = f ? `${f.eyebrow} — Kimble` : "Kimble";
    const description = f?.lede ?? "Build real software from one chat.";
    const origin = "https://kimble.cloud";
    const ogImage = f ? `${origin}${f.image}` : undefined;
    const url = `${origin}/features/${params.slug}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        ...(ogImage ? [{ property: "og:image", content: ogImage }] : []),
        { name: "twitter:card", content: "summary_large_image" },
        ...(ogImage ? [{ name: "twitter:image", content: ogImage }] : []),
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: FeaturePage,
  notFoundComponent: () => (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-6 py-32 text-center">
        <h1 className="font-display text-5xl font-black">Not found</h1>
        <p className="mt-4 text-muted-foreground">That feature page doesn't exist.</p>
        <Link
          to="/"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background"
        >
          Back to home
        </Link>
      </div>
    </div>
  ),
  errorComponent: ({ error, reset }) => (
    <div className="min-h-screen bg-background p-12 text-foreground">
      <h1 className="font-display text-3xl font-black">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
      <button onClick={reset} className="mt-6 rounded-full bg-foreground px-4 py-2 text-sm text-background">
        Try again
      </button>
    </div>
  ),
});


function FeaturePage() {
  const { feature } = Route.useLoaderData();
  const Icon = feature.icon;
  const currentIdx = ORDER.indexOf(feature.slug as (typeof ORDER)[number]);
  const next = FEATURES[ORDER[(currentIdx + 1) % ORDER.length]];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />

      {/* Hero — full-bleed image with editorial overlay */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0">
          <img
            src={feature.image}
            alt=""
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/70 to-background" />
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/60 to-transparent" />
        </div>

        <div className="relative mx-auto max-w-6xl px-4 py-28 sm:px-6 sm:py-40">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur transition hover:text-foreground"
          >
            ← Back to Kimble
          </Link>

          <div className="mt-8 max-w-2xl">
            <span className="inline-flex items-center gap-2 rounded-full bg-primary/15 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
              <Icon className="h-3.5 w-3.5" /> {feature.eyebrow}
            </span>
            <h1 className="mt-6 font-display text-5xl font-black leading-[0.95] tracking-[-0.035em] sm:text-6xl md:text-7xl">
              {feature.title}{" "}
              <span className="italic text-primary">{feature.accent}</span>.
            </h1>
            <p className="mt-6 text-xl leading-snug text-muted-foreground">{feature.lede}</p>
            <p className="mt-4 max-w-xl text-base text-muted-foreground/90">{feature.body}</p>

            <div className="mt-10 flex flex-wrap gap-3">
              <Link
                to="/auth"
                search={{ mode: "signup", redirect: undefined }}
                className="inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background shadow-[var(--shadow-editorial)] transition hover:-translate-y-0.5"
              >
                Start building <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/gallery"
                className="inline-flex items-center gap-2 rounded-full border border-border bg-background/60 px-6 py-3 text-sm font-medium text-foreground backdrop-blur transition hover:bg-muted"
              >
                See examples
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Proof strip */}
      <section className="border-t border-border/60 bg-foreground text-background">
        <div className="mx-auto grid max-w-6xl grid-cols-1 divide-y divide-background/10 px-4 py-14 sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:px-6">
          {feature.proof.map((p: { stat: string; label: string }) => (
            <div key={p.label} className="px-2 py-6 text-center sm:py-2">
              <p className="font-display text-4xl font-black tracking-tight sm:text-5xl">{p.stat}</p>
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-background/60">{p.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Bullets */}
      <section className="border-t border-border/60 px-4 py-24 sm:px-6">
        <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-3">
          {feature.bullets.map((b: { title: string; body: string }) => (
            <div
              key={b.title}
              className="rounded-2xl border border-border bg-card p-8 shadow-[var(--shadow-soft)] transition hover:-translate-y-1 hover:shadow-[var(--shadow-editorial)]"
            >
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-primary/15 text-primary">
                <Check className="h-4 w-4" />
              </span>
              <h3 className="mt-5 font-display text-xl font-bold">{b.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{b.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Code sample */}
      <section className="border-t border-border/60 px-4 pb-24 sm:px-6">
        <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-2 md:items-center">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">Real code, not a mock</p>
            <h2 className="mt-4 font-display text-4xl font-black leading-[1.05] tracking-[-0.02em] sm:text-5xl">
              You own every line Kimble writes.
            </h2>
            <p className="mt-5 text-base text-muted-foreground">
              No lock-in, no proprietary DSL. Kimble writes production code you can read, edit,
              extend, and export at any time. Here's a taste of what lands in your project.
            </p>
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-foreground shadow-[var(--shadow-editorial)]">
            <div className="flex items-center gap-2 border-b border-background/10 px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-background/40" />
              <span className="h-2.5 w-2.5 rounded-full bg-background/25" />
              <span className="h-2.5 w-2.5 rounded-full bg-background/15" />
              <span className="ml-3 text-[11px] font-mono uppercase tracking-widest text-background/50">
                {feature.codeLang}
              </span>
            </div>
            <pre className="overflow-x-auto px-5 py-5 text-[13px] leading-relaxed text-background/90">
              <code className="font-mono">{feature.codeSample}</code>
            </pre>
          </div>
        </div>
      </section>

      {/* In-page CTA — try this feature right now */}
      <TryItSection samplePrompt={feature.samplePrompt} eyebrow={feature.eyebrow} />



      {/* Next feature */}
      <section className="border-t border-border/60 px-4 pb-24 pt-12 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <Link
            to="/features/$slug"
            params={{ slug: next.slug }}
            className="group relative flex flex-col overflow-hidden rounded-[2rem] border border-border bg-foreground text-background md:flex-row md:items-center"
          >
            <img
              src={next.image}
              alt=""
              className="h-56 w-full object-cover opacity-80 transition duration-700 group-hover:scale-105 md:h-64 md:w-1/2"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-foreground via-foreground/60 to-transparent md:from-transparent md:via-foreground/40 md:to-foreground" />
            <div className="relative p-8 md:w-1/2 md:p-12">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-background/70">Up next</p>
              <h3 className="mt-3 font-display text-3xl font-black leading-tight sm:text-4xl">{next.eyebrow}</h3>
              <p className="mt-3 max-w-md text-sm text-background/75">{next.lede}</p>
              <span className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-background">
                Explore <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
              </span>
            </div>
          </Link>
        </div>
      </section>
    </div>
  );
}

function TryItSection({ samplePrompt, eyebrow }: { samplePrompt: string; eyebrow: string }) {
  const [value, setValue] = useState(samplePrompt);
  const navigate = useNavigate();

  function launch(e: React.FormEvent) {
    e.preventDefault();
    const prompt = value.trim();
    if (!prompt) return;
    // Route through auth (signup) with the prompt preserved as redirect payload.
    // The landing composer already handles ?prompt= — we send users to /auth so
    // they land in the builder authenticated with their idea intact.
    const redirect = `/?prompt=${encodeURIComponent(prompt)}`;
    navigate({ to: "/auth", search: { mode: "signup", redirect } });
  }

  return (
    <section className="border-t border-border/60 px-4 pb-24 sm:px-6">
      <div className="mx-auto max-w-4xl overflow-hidden rounded-[2rem] border border-border bg-card p-8 shadow-[var(--shadow-editorial)] sm:p-12">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary">
          <Sparkles className="mr-1 inline h-3 w-3" /> Try {eyebrow.toLowerCase()} now
        </p>
        <h2 className="mt-4 font-display text-3xl font-black leading-tight tracking-[-0.02em] sm:text-4xl">
          Type an idea. Kimble builds it live.
        </h2>
        <form onSubmit={launch} className="mt-6 space-y-4">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={4}
            className="w-full resize-none rounded-2xl border border-border bg-background px-5 py-4 text-base leading-relaxed text-foreground shadow-inner outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            placeholder="Describe what you want to build…"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Free to start. No credit card required.
            </p>
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background shadow-[var(--shadow-editorial)] transition hover:-translate-y-0.5"
            >
              Build it <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
