import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { Store, Wallet, Users, Code2, ArrowRight, type LucideIcon } from "lucide-react";

import { SiteHeader } from "@/components/SiteHeader";

/**
 * The four things Petal does that the rest of the category does not.
 * Each entry is a real, shipped surface in this product — no roadmap copy.
 */
type Difference = {
  slug: string;
  eyebrow: string;
  /** Split so the display face can italicise the second half. */
  title: string;
  titleItalic: string;
  lede: string;
  icon: LucideIcon;
  blocks: { heading: string; body: string }[];
  proof: { stat: string; label: string }[];
  cta: { label: string; to: string };
};

const DIFFERENCES: Record<string, Difference> = {
  marketplace: {
    slug: "marketplace",
    eyebrow: "The marketplace",
    title: "Software you built,",
    titleItalic: "sold to someone who needs it.",
    lede: "Every other AI builder ends at deploy. Petal keeps going: list the app, price it, transfer it.",
    icon: Store,
    blocks: [
      {
        heading: "List in a few clicks",
        body: "Any project on your account can become a listing. Petal pulls the title, summary and a live preview from the build you already shipped, so the storefront page writes itself.",
      },
      {
        heading: "Licence or full transfer",
        body: "Sell a licence and keep the original, or hand the whole project over. On purchase the buyer gets the real files in their own workspace — not a zip, not a template, a working project they can keep editing in Petal.",
      },
      {
        heading: "You keep 80%",
        body: "Petal takes a flat 20% on paid listings. No listing fee, no monthly seller subscription, no rank-boost upsell. Earnings land in a ledger you can watch, and payouts run from there.",
      },
    ],
    proof: [
      { stat: "80%", label: "Creator share" },
      { stat: "0", label: "Listing fees" },
      { stat: "Live", label: "Preview on every listing" },
    ],
    cta: { label: "Browse the marketplace", to: "/marketplace" },
  },
  "pay-as-you-build": {
    slug: "pay-as-you-build",
    eyebrow: "Pay as you build",
    title: "Credits you buy once.",
    titleItalic: "No subscription to cancel.",
    lede: "Build in bursts. Disappear for three months. Come back and your balance is exactly where you left it.",
    icon: Wallet,
    blocks: [
      {
        heading: "Buy once, never expire",
        body: "Credit packs are a one-off purchase. They do not reset monthly, they do not lapse, and nothing gets clawed back if you take a break. There is no plan you have to keep paying to stay logged in.",
      },
      {
        heading: "Charged for work, not for asking",
        body: "A turn that changes nothing costs nothing. If Petal produces a byte-identical edit, the build is a no-op and the wallet is left alone. Failed builds that never reach your project are not billed either.",
      },
      {
        heading: "You can see the meter",
        body: "Backend hours, image generation and model spend each have a published rate, and the balance sheet shows what went where. No opaque \u201cfast requests\u201d unit that quietly costs five times more on Tuesdays.",
      },
    ],
    proof: [
      { stat: "Never", label: "Credits expire" },
      { stat: "$0", label: "Cost of a no-op turn" },
      { stat: "Optional", label: "Subscription" },
    ],
    cta: { label: "See what a build costs", to: "/billing" },
  },
  "agent-board": {
    slug: "agent-board",
    eyebrow: "The agent board",
    title: "A board of specialists",
    titleItalic: "reviews the build before code is written.",
    lede: "One model writing everything is how you get an app that looks right and behaves wrong.",
    icon: Users,
    blocks: [
      {
        heading: "Specialists, not one prompt",
        body: "Product, architecture, design, database, backend, security, responsive and QA each get their own pass. They write typed decisions and objections into a shared brief, and the brief gets reconciled before a single file is touched.",
      },
      {
        heading: "Objections actually block",
        body: "When the security specialist flags a table with no row-level policy, or the responsive specialist flags a layout that overflows at 390px, that is a binding objection. It has to be answered in the spec, not discovered by you after deploy.",
      },
      {
        heading: "Defects get an owner",
        body: "After the build, findings are classified and routed to the specialist that owns them — runtime to frontend, policy to security, dead links to architecture. Repairs are scoped instead of a blanket \u201ctry again\u201d that rewrites your whole app.",
      },
    ],
    proof: [
      { stat: "11", label: "Specialist agents" },
      { stat: "Pre-code", label: "When review happens" },
      { stat: "Scoped", label: "Repair rounds" },
    ],
    cta: { label: "Start a build", to: "/" },
  },
  "own-your-code": {
    slug: "own-your-code",
    eyebrow: "Own your code",
    title: "Real files, your repo,",
    titleItalic: "your domain.",
    lede: "Nothing here is locked behind a proprietary editor or a runtime only we can host.",
    icon: Code2,
    blocks: [
      {
        heading: "Actual React, actual TypeScript",
        body: "Petal writes the same code a senior engineer would hand you: typed components, semantic design tokens, a real router, a real schema. Open the file tree and read every line of it.",
      },
      {
        heading: "Git sync both ways",
        body: "Connect a repository and every build lands as a commit. Edit locally, push, keep building in Petal. Your history lives somewhere you control, not in a vendor database.",
      },
      {
        heading: "Ship where you like",
        body: "Publish on a Petal URL, point your own custom domain at it, or take the repo and deploy it anywhere that runs Node. Leaving is a decision, not an escape.",
      },
    ],
    proof: [
      { stat: "100%", label: "Real source you can read" },
      { stat: "2-way", label: "Git sync" },
      { stat: "Yours", label: "Custom domain" },
    ],
    cta: { label: "Build something", to: "/" },
  },
};

const ORDER = ["marketplace", "pay-as-you-build", "agent-board", "own-your-code"] as const;

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
          { title: "Unavailable — Petal" },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    const title = `${d.eyebrow} — Petal`;
    const url = `https://buildwithpetal.com/why/${params.slug}`;
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
  const Icon = difference.icon;
  const idx = ORDER.indexOf(difference.slug as (typeof ORDER)[number]);
  const rail = ORDER.filter((s) => s !== difference.slug).map((s) => DIFFERENCES[s]);

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
            ← Petal
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
