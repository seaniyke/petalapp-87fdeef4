/**
 * /packs/$slug — full pack brief with palette, typography, page list, and
 * Cloud features, plus a "Build this with Petal" CTA that ships the composed
 * brief into the builder.
 */
import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Cloud, Layout, Palette, Type } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { useAuth } from "@/lib/auth";
import { getPack, packToPrompt, INDUSTRY_PACKS, type IndustryPack } from "@/lib/industry-packs";

export const Route = createFileRoute("/packs/$slug")({
  loader: ({ params }) => {
    const pack = getPack(params.slug);
    if (!pack) throw notFound();
    return { pack };
  },
  head: ({ loaderData }) => {
    const pack = loaderData?.pack;
    const title = pack ? `${pack.name} pack · Petal` : "Pack · Petal";
    const desc = pack?.tagline ?? "Industry pack starter.";
    return {
      meta: [
        { title },
        { name: "description", content: desc },
        { property: "og:title", content: title },
        { property: "og:description", content: desc },
      ],
    };
  },
  notFoundComponent: () => (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-6 py-24 text-center">
        <h1 className="font-display text-3xl">Pack not found</h1>
        <p className="mt-2 text-muted-foreground">
          That industry pack doesn't exist (yet).
        </p>
        <Link
          to="/packs"
          className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background"
        >
          <ArrowLeft className="h-4 w-4" /> Back to packs
        </Link>
      </main>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-6 py-24 text-center">
        <h1 className="font-display text-3xl">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
      </main>
    </div>
  ),
  component: PackDetail,
});

function PackDetail() {
  const { pack } = Route.useLoaderData();
  const navigate = useNavigate();
  const { user, isReady } = useAuth();

  function build() {
    const prompt = packToPrompt(pack);
    const target = `/builder?prompt=${encodeURIComponent(prompt)}&source=pack-${pack.slug}`;
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

  const others = INDUSTRY_PACKS.filter((p) => p.slug !== pack.slug).slice(0, 3);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-6 py-12">
        <Link
          to="/packs"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> All packs
        </Link>

        {/* Hero */}
        <header className="mt-6 grid gap-6 rounded-3xl border border-border bg-card p-8 md:grid-cols-[1fr,auto] md:items-end">
          <div>
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-muted">
                <pack.Icon className="h-6 w-6 text-foreground/80" />
              </span>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Industry pack
                </p>
                <h1 className="font-display text-3xl md:text-4xl">{pack.name}</h1>
              </div>
            </div>
            <p className="mt-4 max-w-xl text-muted-foreground">{pack.tagline}</p>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">{pack.blurb}</p>
          </div>
          <button
            type="button"
            onClick={build}
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:brightness-110"
          >
            Build this with Petal
            <ArrowRight className="h-4 w-4" />
          </button>
        </header>

        {/* Palette + typography */}
        <section className="mt-8 grid gap-5 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="inline-flex items-center gap-2 font-display text-lg">
              <Palette className="h-4 w-4 text-muted-foreground" /> Palette
            </h2>
            <div className="mt-4 flex gap-3">
              {pack.palette.map((c) => (
                <div key={c.name} className="flex-1 text-center">
                  <div
                    className="mx-auto h-16 w-full rounded-xl border border-border"
                    style={{ background: c.sample }}
                  />
                  <div className="mt-2 text-xs font-medium">{c.name}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {c.sample}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="inline-flex items-center gap-2 font-display text-lg">
              <Type className="h-4 w-4 text-muted-foreground" /> Typography
            </h2>
            <div className="mt-4 grid gap-3">
              <div className="rounded-xl bg-muted/40 p-4">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Display</div>
                <div className="mt-1 font-display text-2xl">{pack.typography.display}</div>
              </div>
              <div className="rounded-xl bg-muted/40 p-4">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Body</div>
                <div className="mt-1 text-base">{pack.typography.body}</div>
              </div>
            </div>
          </div>
        </section>

        {/* Pages */}
        <section className="mt-8 rounded-2xl border border-border bg-card p-6">
          <h2 className="inline-flex items-center gap-2 font-display text-lg">
            <Layout className="h-4 w-4 text-muted-foreground" /> Pages we'll build ({pack.pages.length})
          </h2>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {pack.pages.map((p) => (
              <li
                key={p.path}
                className="rounded-xl border border-border/60 bg-background/40 p-4"
              >
                <code className="text-xs font-medium text-foreground">{p.path}</code>
                <p className="mt-1.5 text-sm text-muted-foreground">{p.purpose}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Cloud features */}
        <section className="mt-8 rounded-2xl border border-border bg-card p-6">
          <h2 className="inline-flex items-center gap-2 font-display text-lg">
            <Cloud className="h-4 w-4 text-muted-foreground" /> Cloud features included
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Petal will turn these on for you as part of the build.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {pack.cloud.map((f) => (
              <span
                key={f}
                className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium capitalize"
              >
                {f}
              </span>
            ))}
          </div>
        </section>

        {/* Bottom CTA */}
        <div className="mt-10 rounded-3xl border border-border bg-gradient-to-br from-primary/10 to-transparent p-8 text-center">
          <h3 className="font-display text-2xl">Ship the {pack.name.toLowerCase()} site today</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Petal builds all {pack.pages.length} pages, the palette, the
            database tables, and turns on the right Cloud features.
          </p>
          <button
            type="button"
            onClick={build}
            className="mt-5 inline-flex items-center justify-center gap-1.5 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition hover:brightness-110"
          >
            Build this with Petal <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        {/* Other packs */}
        {others.length > 0 && (
          <section className="mt-12">
            <h3 className="font-display text-lg">Other packs</h3>
            <ul className="mt-4 grid gap-3 sm:grid-cols-3">
              {others.map((p) => (
                <li key={p.slug}>
                  <Link
                    to="/packs/$slug"
                    params={{ slug: p.slug }}
                    className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition hover:border-primary/40"
                  >
                    <span className="grid h-9 w-9 place-items-center rounded-xl bg-muted">
                      <p.Icon className="h-4 w-4" />
                    </span>
                    <div>
                      <div className="text-sm font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground line-clamp-1">{p.tagline}</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
