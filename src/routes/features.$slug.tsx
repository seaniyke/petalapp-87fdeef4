import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  Globe,
  Smartphone,
  Layers,
  Wand2,
  Eye,
  Rocket,
  ArrowRight,
  Check,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { SiteHeader } from "@/components/SiteHeader";

import webDashImg from "@/assets/feature-web-hero.jpg";
import phoneHandImg from "@/assets/feature-mobile-hero.jpg";
import backendImg from "@/assets/feature-backend-hero.jpg";
import extensionImg from "@/assets/feature-extensions-hero.jpg";
import previewImg from "@/assets/feature-preview-hero.jpg";
import shipImg from "@/assets/feature-ship-hero.jpg";

type Feature = {
  slug: string;
  eyebrow: string;
  title: string;
  accent: string;
  lede: string;
  body: string;
  image: string;
  icon: LucideIcon;
  bullets: { title: string; body: string }[];
  proof: { stat: string; label: string }[];
  samplePrompt: string;
  codeLang: string;
  codeSample: string;
};

const FEATURES: Record<string, Feature> = {
  web: {
    slug: "web",
    eyebrow: "Web apps",
    title: "Ship a full web app on",
    accent: "your domain",
    lede: "React + Tailwind + a typed backend, wired end-to-end.",
    body: "Petal writes production React with Tailwind, generates a typed backend, wires auth, database, storage and payments, and hands you a live URL — all from one chat.",
    image: webDashImg,
    icon: Globe,
    bullets: [
      { title: "Typed React + Tailwind", body: "Component library, semantic tokens, dark mode — real code, no page builder." },
      { title: "Backend included", body: "Postgres, RLS, storage, auth, edge functions — all provisioned automatically." },
      { title: "Live on your domain", body: "Preview URL out of the box, custom domain in a click." },
    ],
  },
  mobile: {
    slug: "mobile",
    eyebrow: "Mobile",
    title: "iOS + Android from",
    accent: "one prompt",
    lede: "One Expo codebase. Both stores. No Mac required.",
    body: "Describe the app — Petal scaffolds React Native with Expo, streams a live phone preview, and hands you a signed iOS .ipa and Android .apk built on Petal's cloud.",
    image: phoneHandImg,
    icon: Smartphone,
    bullets: [
      { title: "One codebase, both stores", body: "Expo + React Native — build once, ship to App Store and Play." },
      { title: "Live phone preview", body: "Scan a QR from Expo Go and see hot reload on your device in seconds." },
      { title: "Signed builds, no Mac", body: "We run EAS Build on our infra — download the .ipa or .apk and submit." },
    ],
  },
  backend: {
    slug: "backend",
    eyebrow: "Backends",
    title: "Typed APIs. Real",
    accent: "database",
    lede: "Postgres, auth, storage, edge functions — provisioned and wired.",
    body: "Petal Cloud gives every project a real Postgres database with row-level security, typed server functions, a storage bucket, and an AI gateway — no dashboards, no keys to copy.",
    image: backendImg,
    icon: Layers,
    bullets: [
      { title: "Postgres with RLS", body: "Tables, policies, migrations — versioned and safe by default." },
      { title: "Typed server functions", body: "Call the server like a function. Petal handles auth, validation, errors." },
      { title: "AI gateway built in", body: "Chat, images, embeddings — no third-party keys, no config." },
    ],
  },
  extensions: {
    slug: "extensions",
    eyebrow: "Chrome extensions",
    title: "Ship a Chrome",
    accent: "extension",
    lede: "Manifest V3 popup, worker, content script — packaged.",
    body: "Petal scaffolds a full Manifest V3 extension: a React popup, a service worker, content scripts, storage, and a signed .zip ready for the Chrome Web Store.",
    image: extensionImg,
    icon: Wand2,
    bullets: [
      { title: "Manifest V3, done right", body: "Popup, background worker, content scripts, permissions — all wired." },
      { title: "React inside the popup", body: "Same Tailwind design system as your web app." },
      { title: "Store-ready package", body: "Download the .zip and upload to the Chrome Web Store." },
    ],
  },
  preview: {
    slug: "preview",
    eyebrow: "Live preview",
    title: "See it before you",
    accent: "ship it",
    lede: "Web frame, phone frame, or API console — whichever fits.",
    body: "Every edit streams into a live preview. Web apps run in a browser frame with device switching, mobile apps render on a real phone via Expo Go, backends get an API console.",
    image: previewImg,
    icon: Eye,
    bullets: [
      { title: "Instant, not simulated", body: "Real browser, real bundler, real network — not a mock." },
      { title: "Device switching", body: "Flip between desktop, tablet, and phone frames without a rebuild." },
      { title: "QR to your phone", body: "Test a native build on your device before you leave the chat." },
    ],
  },
  ship: {
    slug: "ship",
    eyebrow: "One-click ship",
    title: "From chat to",
    accent: "public URL",
    lede: "Preview URL, custom domain, or a signed mobile build.",
    body: "Publish to a Petal subdomain in one click, connect your own domain in two, or trigger a signed mobile build. Rollbacks, versioning and analytics come free.",
    image: shipImg,
    icon: Rocket,
    bullets: [
      { title: "Instant public URL", body: "Every project gets a shareable Petal subdomain out of the box." },
      { title: "Custom domain", body: "Bring buildwithpetal.com or add a domain we register for you." },
      { title: "Signed mobile builds", body: "iOS .ipa and Android .apk built on our cloud and delivered to you." },
    ],
  },
};

export const Route = createFileRoute("/features/$slug")({
  loader: ({ params }) => {
    const f = FEATURES[params.slug];
    if (!f) throw notFound();
    return { feature: f };
  },
  head: ({ loaderData }) => {
    const f = loaderData?.feature;
    const title = f ? `${f.eyebrow} — Petal` : "Petal";
    const description = f?.lede ?? "Build real software from one chat.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
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

const ORDER = ["web", "mobile", "backend", "extensions", "preview", "ship"] as const;

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
            ← Back to Petal
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

      {/* Bullets */}
      <section className="border-t border-border/60 px-4 py-24 sm:px-6">
        <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-3">
          {feature.bullets.map((b: { title: string; body: string }) => (
            <div
              key={b.title}
              className="rounded-3xl border border-border bg-card p-8 shadow-[var(--shadow-soft)] transition hover:-translate-y-1 hover:shadow-[var(--shadow-editorial)]"
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
