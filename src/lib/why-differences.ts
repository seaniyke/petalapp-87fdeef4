/**
 * Data for the "why Petal" differentiator pages.
 *
 * This lives outside the route file on purpose: TanStack Start splits a route
 * module into shared/server/client chunks, and a module-scope constant used by
 * BOTH the loader and the component has to be a real export or the split build
 * emits `does not provide an export named 'DIFFERENCES'` — which aborts
 * hydration for the entire app, not just this page.
 */
import { Store, Wallet, Bot, Code2, type LucideIcon } from "lucide-react";

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
    eyebrow: "AI review team",
    title: "Several AI reviewers check your app",
    titleItalic: "before Petal builds it.",
    lede: "Petal uses different AI reviewers for planning, design, security, and testing. No human reviewer is involved.",
    icon: Bot,
    blocks: [
      {
        heading: "Each AI reviewer has one job",
        body: "Separate AI reviewers look at the plan, design, data, security, mobile layout, and testing. Petal combines their feedback before it starts building.",
      },
      {
        heading: "Problems are caught early",
        body: "If an AI reviewer spots a security risk or a screen that will not fit on a phone, Petal must address it before the build continues.",
      },
      {
        heading: "Fixes stay focused",
        body: "After the build, Petal sends each problem to the right AI reviewer. It fixes the affected part instead of rebuilding your whole app.",
      },
    ],
    proof: [
      { stat: "AI", label: "Reviews the work" },
      { stat: "Before", label: "Checks start before the build" },
      { stat: "Focused", label: "Fixes only what needs fixing" },
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
