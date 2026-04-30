/**
 * Golden-app prompts — the exact natural-language input a real user would type.
 *
 * NEVER add scaffold hints, framework names, or "use Cloud" instructions. The
 * prompt should be representative of what a non-technical user actually writes.
 * If the pipeline can't infer the right scaffold from this, that IS the bug.
 */

export interface GoldenAppPrompt {
  /** Stable slug used in baselines and CLI flags. */
  id: string;
  /** Human-readable label for logs. */
  label: string;
  /** The user-facing prompt fed to the generator. */
  prompt: string;
  /** Surfaces this app exercises — used to skip apps in scoped runs. */
  tags: ReadonlyArray<
    | "crud"
    | "routing"
    | "realtime"
    | "auth"
    | "storage"
    | "payments"
    | "email"
    | "data-viz"
    | "cloud-db"
  >;
  /** Files we expect to exist after a successful generation. Substring match. */
  expectFiles: ReadonlyArray<string>;
}

export const GOLDEN_APPS: ReadonlyArray<GoldenAppPrompt> = [
  {
    id: "todo",
    label: "Todo list",
    prompt: "Build me a simple todo list app where I can add, complete, and delete tasks.",
    tags: ["crud"],
    expectFiles: ["src/routes/index.tsx"],
  },
  {
    id: "blog",
    label: "Personal blog",
    prompt: "Make a personal blog with a homepage listing posts and a detail page for each post.",
    tags: ["routing"],
    expectFiles: ["src/routes/index.tsx", "src/routes/posts"],
  },
  {
    id: "chat",
    label: "Chat app",
    prompt: "I want a chat app where two people can send messages back and forth in real time.",
    tags: ["realtime", "cloud-db"],
    expectFiles: ["src/routes/index.tsx"],
  },
  {
    id: "dashboard",
    label: "Analytics dashboard",
    prompt: "Build an analytics dashboard with a few charts showing revenue, signups, and active users.",
    tags: ["data-viz"],
    expectFiles: ["src/routes/index.tsx"],
  },
  {
    id: "marketplace",
    label: "Marketplace",
    prompt: "Create a marketplace for handmade crafts with a grid of products and a detail page for each one.",
    tags: ["routing"],
    expectFiles: ["src/routes/index.tsx"],
  },
  {
    id: "auth-roles",
    label: "Auth with roles",
    prompt: "Build an app with login, signup, and an admin-only page that only admins can see.",
    tags: ["auth", "cloud-db"],
    expectFiles: ["src/routes/auth.tsx"],
  },
  {
    id: "file-upload",
    label: "File upload",
    prompt: "Make a page where logged-in users can upload images and see their gallery.",
    tags: ["storage", "auth", "cloud-db"],
    expectFiles: ["src/routes/index.tsx"],
  },
  {
    id: "realtime-board",
    label: "Realtime board",
    prompt: "I want a shared notice board where anyone can post a sticky note and everyone sees new notes appear instantly.",
    tags: ["realtime", "cloud-db"],
    expectFiles: ["src/routes/index.tsx"],
  },
  {
    id: "payments",
    label: "Payments checkout",
    prompt: "Build a single-product landing page with a buy button that takes payment with Stripe.",
    tags: ["payments"],
    expectFiles: ["src/routes/index.tsx"],
  },
  {
    id: "email-send",
    label: "Email send",
    prompt: "Make a contact form that sends me an email when someone submits it.",
    tags: ["email"],
    expectFiles: ["src/routes/index.tsx"],
  },
] as const;
