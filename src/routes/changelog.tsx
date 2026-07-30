import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { Sparkles, Rocket, Wand2, Smartphone, Layers, Shield, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/changelog")({
  head: () => ({
    meta: [
      { title: "What's new · Petal" },
      { name: "description", content: "Every improvement, ship, and experiment inside Petal — updated as we build." },
      { property: "og:title", content: "What's new · Petal" },
      { property: "og:description", content: "The Petal changelog and roadmap." },
      { property: "og:type", content: "website" },
    ],
  }),
  component: ChangelogPage,
});

type Entry = {
  date: string;
  tag: "Shipped" | "Improved" | "Coming next";
  icon: typeof Sparkles;
  title: string;
  body: string;
};

const ENTRIES: Entry[] = [
  {
    date: "July 2026",
    tag: "Shipped",
    icon: Sparkles,
    title: "Invite your friends, earn credits",
    body: "Every account now has a referral link. Friends who join through it skip ahead in the queue, and you both get build credits the first time they sign in. Track invites from your profile.",
  },
  {
    date: "July 2026",
    tag: "Improved",
    icon: Wand2,
    title: "Build cards you can actually read",
    body: "Each build now lands as a compact card in chat with a Details view: a full timeline of what Petal thought, read, and edited — plus a file-by-file list of changes.",
  },
  {
    date: "June 2026",
    tag: "Shipped",
    icon: Smartphone,
    title: "Mobile apps without a Mac",
    body: "Describe an app and Petal scaffolds React Native, streams a live phone preview you can open in Expo Go, and builds a signed .ipa and .apk on our cloud. No Xcode, no Expo account.",
  },
  {
    date: "June 2026",
    tag: "Improved",
    icon: Rocket,
    title: "Previews boot in seconds",
    body: "Dependencies are cached between runs, so the preview opens straight into your app instead of sitting on an install log.",
  },
  {
    date: "May 2026",
    tag: "Shipped",
    icon: Layers,
    title: "Typed server functions + Postgres",
    body: "Every project ships with a real backend: RLS-safe Postgres, file storage, auth with Google sign-in, and an AI gateway — provisioned the moment you ask for it.",
  },
  {
    date: "April 2026",
    tag: "Improved",
    icon: Wand2,
    title: "Editorial design engine",
    body: "A locked palette and type pair per project, section library, and a taste pass that refuses the usual purple-gradient template look. Generated apps look designed, not generated.",
  },
  {
    date: "March 2026",
    tag: "Shipped",
    icon: Rocket,
    title: "Domains, hosting and email in one click",
    body: "Buy a domain inside Petal or bring your own. DNS, HTTPS, rollbacks and transactional email are handled for you.",
  },
  {
    date: "February 2026",
    tag: "Shipped",
    icon: Shield,
    title: "Petal Shield",
    body: "Spend caps, secret detection, dependency scanning and runtime error tracking are on by default for every project.",
  },
  {
    date: "Next up",
    tag: "Coming next",
    icon: Sparkles,
    title: "Chrome Web Store submission",
    body: "One-click submit for Manifest V3 extensions — build, sign and ship without leaving the chat.",
  },
  {
    date: "Next up",
    tag: "Coming next",
    icon: Sparkles,
    title: "Realtime multi-user preview",
    body: "Invite a teammate into a running preview and steer the build together.",
  },
];

function ChangelogPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />

      <section className="relative overflow-hidden border-b border-border/60">
        <div className="absolute inset-0 bg-aurora opacity-70" aria-hidden />
        <div className="absolute inset-0 bg-grain opacity-30" aria-hidden />
        <div className="relative mx-auto max-w-4xl px-6 pb-16 pt-20 sm:pt-28">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-primary">The roadmap</p>
          <h1 className="mt-4 font-display text-5xl font-black leading-[0.95] tracking-[-0.035em] sm:text-6xl md:text-7xl">
            What's <span className="italic text-primary">new</span> in Petal.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
            Every ship, every fix, and what we're building next — in the open.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-16">
        <ol className="relative border-l border-border/60 pl-8">
          {ENTRIES.map((e, i) => {
            const Icon = e.icon;
            const tagStyles =
              e.tag === "Shipped"
                ? "bg-primary/15 text-primary"
                : e.tag === "Improved"
                  ? "bg-mint/40 text-foreground"
                  : "bg-butter text-foreground";
            return (
              <li key={i} className="group relative mb-12 last:mb-0">
                <span className="absolute -left-[2.6rem] grid h-9 w-9 place-items-center rounded-full border border-border bg-card shadow-[var(--shadow-soft)] transition group-hover:scale-110">
                  <Icon className="h-4 w-4 text-primary" />
                </span>
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tagStyles}`}>
                    {e.tag}
                  </span>
                  <span className="text-xs font-medium text-muted-foreground">{e.date}</span>
                </div>
                <h3 className="mt-3 font-display text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
                  {e.title}
                </h3>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">{e.body}</p>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="border-t border-border/60 px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="font-display text-3xl font-black leading-tight sm:text-4xl">
            Have an idea for what we should ship next?
          </h2>
          <p className="mt-3 text-muted-foreground">Tell Petal — every reply here shapes the roadmap.</p>
          <Link
            to="/"
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background transition hover:-translate-y-0.5"
          >
            Start building <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
