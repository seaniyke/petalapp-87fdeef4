/**
 * Data for the "why Petal" differentiator pages.
 *
 * This lives outside the route file on purpose: TanStack Start splits a route
 * module into shared/server/client chunks, and a module-scope constant used by
 * BOTH the loader and the component has to be a real export or the split build
 * emits `does not provide an export named 'DIFFERENCES'` — which aborts
 * hydration for the entire app, not just this page.
 */
import { Store, Wallet, Users, Code2, type LucideIcon } from "lucide-react";

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

export const DIFFERENCES: Record<string, Difference> = {
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

export const ORDER = ["marketplace", "pay-as-you-build", "agent-board", "own-your-code"] as const;
