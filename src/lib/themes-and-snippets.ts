/**
 * Theme presets — opinionated visual directions a user can apply to any
 * existing project. Each preset describes the palette, typography, and vibe
 * so the AI can re-skin without changing functionality.
 *
 * The user picks a preset → we ship a tightly-scoped prompt to the builder
 * ("Re-theme this project with…") that doesn't touch business logic.
 */
export type ThemePreset = {
  slug: string;
  name: string;
  vibe: string;
  palette: { name: string; sample: string }[];
  fonts: { display: string; body: string };
  /** The exact prompt sent to the builder. */
  prompt: string;
};

export const THEME_PRESETS: ThemePreset[] = [
  {
    slug: "editorial-warm",
    name: "Editorial warm",
    vibe: "New Yorker meets indie magazine. Cream, ink, terracotta accents.",
    palette: [
      { name: "Cream", sample: "#FBF6EE" },
      { name: "Ink", sample: "#1A1A1A" },
      { name: "Terracotta", sample: "#C75D3C" },
    ],
    fonts: { display: "Fraunces", body: "Inter" },
    prompt:
      "Re-theme this project with an editorial warm palette: cream background (#FBF6EE), ink foreground (#1A1A1A), terracotta accent (#C75D3C). Use Fraunces for display headings and Inter for body. Generous whitespace, magazine-style asymmetric layouts, drop caps on hero copy. Do not change any functionality.",
  },
  {
    slug: "midnight-neon",
    name: "Midnight neon",
    vibe: "Late-night coding aesthetic. Deep ink, electric accents, tight type.",
    palette: [
      { name: "Midnight", sample: "#0A0B12" },
      { name: "Lime", sample: "#C5F23A" },
      { name: "Cyan", sample: "#5DD8E6" },
    ],
    fonts: { display: "Space Grotesk", body: "JetBrains Mono" },
    prompt:
      "Re-theme this project for a midnight-neon aesthetic: near-black background (#0A0B12), white text, electric lime primary (#C5F23A) and cyan secondary (#5DD8E6). Space Grotesk for display, JetBrains Mono for accents and code-feeling labels. Subtle grid lines, tight kerning. Functionality unchanged.",
  },
  {
    slug: "soft-pastel",
    name: "Soft pastel",
    vibe: "Friendly indie SaaS. Sky, mint, butter, lots of rounded corners.",
    palette: [
      { name: "Sky", sample: "#CFE4FF" },
      { name: "Mint", sample: "#CFF1DD" },
      { name: "Butter", sample: "#FFE9A8" },
    ],
    fonts: { display: "Outfit", body: "Inter" },
    prompt:
      "Re-theme this project with a soft-pastel palette: white background, sky/mint/butter accent tints, rounded-2xl everywhere, Outfit for display, Inter for body. Friendly, approachable, indie-SaaS vibes. Don't change behavior.",
  },
  {
    slug: "brutalist-mono",
    name: "Brutalist mono",
    vibe: "Hard edges, monospace, raw 90s web energy.",
    palette: [
      { name: "Paper", sample: "#FFFFFF" },
      { name: "Black", sample: "#000000" },
      { name: "Hot pink", sample: "#FF2E7E" },
    ],
    fonts: { display: "JetBrains Mono", body: "JetBrains Mono" },
    prompt:
      "Re-theme this project as brutalist-monospace: pure white background, pure black text, hot pink (#FF2E7E) accent only. Sharp corners (no border-radius), thick black borders, JetBrains Mono everywhere, raw spacing, no shadows or gradients. Keep functionality the same.",
  },
  {
    slug: "glass-aurora",
    name: "Glass aurora",
    vibe: "Apple-keynote glassmorphism with aurora gradients.",
    palette: [
      { name: "Deep blue", sample: "#0B1426" },
      { name: "Aurora pink", sample: "#FF6FA3" },
      { name: "Aurora violet", sample: "#9D6BFF" },
    ],
    fonts: { display: "SF Pro Display", body: "Inter" },
    prompt:
      "Re-theme this project with a glass-aurora aesthetic: deep blue background with subtle aurora gradients (pink → violet → cyan), frosted-glass cards with backdrop-blur and 1px white borders at low opacity, SF Pro Display vibes for headlines (use Inter as fallback), large soft shadows. Premium, hardware-keynote feel. Functionality unchanged.",
  },
  {
    slug: "earthy-organic",
    name: "Earthy organic",
    vibe: "Sustainable brand. Moss, clay, oat — natural, grown-up.",
    palette: [
      { name: "Oat", sample: "#EFE8D8" },
      { name: "Moss", sample: "#5A6B3B" },
      { name: "Clay", sample: "#A65A36" },
    ],
    fonts: { display: "Cormorant Garamond", body: "Inter" },
    prompt:
      "Re-theme with an earthy-organic palette: oat background (#EFE8D8), moss primary (#5A6B3B), clay accent (#A65A36). Cormorant Garamond for display, Inter for body. Natural, considered, sustainable-brand feel — no neon, no harsh shadows. Same functionality.",
  },
];

export type Snippet = {
  slug: string;
  name: string;
  category:
    | "Marketing"
    | "Forms"
    | "Data"
    | "Auth"
    | "Pricing"
    | "Realtime"
    | "Maps"
    | "AI"
    | "Media";
  blurb: string;
  /** Composed prompt the user's project receives in the builder. */
  prompt: string;
};

export const SNIPPETS: Snippet[] = [
  {
    slug: "logo-cloud",
    name: "Logo cloud / social proof",
    category: "Marketing",
    blurb: "A 5-7 logo grayscale strip with 'Trusted by' label.",
    prompt:
      "Add a social-proof logo cloud section: a small 'Trusted by teams at' label centered above a row of 6 grayscale partner logos with subtle hover-color. Place it directly under the hero on the home page.",
  },
  {
    slug: "feature-bento",
    name: "Bento feature grid",
    category: "Marketing",
    blurb: "A 4-cell asymmetric bento grid showcasing key features.",
    prompt:
      "Add a 'Bento' feature grid section to the home page: 4 asymmetric cards (1 large, 3 smaller) each with an icon, headline, one-line description, and a subtle illustration or screenshot mock. Use the existing accent color.",
  },
  {
    slug: "faq-accordion",
    name: "FAQ accordion",
    category: "Marketing",
    blurb: "Collapsible FAQ with 6 common questions.",
    prompt:
      "Add an FAQ section using shadcn Accordion with 6 sensible questions for this product (pricing, security, cancellation, support, integrations, refunds). Place it before the footer.",
  },
  {
    slug: "pricing-3-tier",
    name: "3-tier pricing",
    category: "Pricing",
    blurb: "Free / Pro / Team with a recommended badge and CTA.",
    prompt:
      "Add a 3-tier pricing section (Free, Pro $19/mo, Team $79/mo) with feature lists, a 'Most popular' badge on Pro, and a CTA button per tier. Wire the Pro and Team buttons to a Stripe checkout when payments are enabled.",
  },
  {
    slug: "contact-form",
    name: "Contact form (saved + emailed)",
    category: "Forms",
    blurb: "Name/email/message form that writes to db and emails the team.",
    prompt:
      "Add a /contact page with a contact form (name, email, subject, message). On submit, save to a `contact_submissions` table with RLS, send an email to the project owner via Resend, and show a friendly thank-you state.",
  },
  {
    slug: "newsletter-signup",
    name: "Newsletter signup",
    category: "Forms",
    blurb: "Email-only signup with confirmation email.",
    prompt:
      "Add a newsletter signup form (single email field) that saves to a `newsletter_subscribers` table and sends a confirmation email via Resend. Show inline success and error states.",
  },
  {
    slug: "data-table",
    name: "Sortable / filterable data table",
    category: "Data",
    blurb: "TanStack-style table with sort, filter, pagination.",
    prompt:
      "Build a sortable, filterable data table on /admin/data using TanStack Table-style patterns with shadcn primitives: column sort, global text filter, pagination, row selection, and a column visibility toggle. Wire it to the existing dataset.",
  },
  {
    slug: "kanban-board",
    name: "Kanban board",
    category: "Data",
    blurb: "Drag-and-drop column board for status tracking.",
    prompt:
      "Add a kanban board view with 3 columns (Todo, In Progress, Done). Drag-and-drop between columns with @dnd-kit, persist the new status to the database, and animate the transition.",
  },
  {
    slug: "auth-magic-link",
    name: "Magic-link auth",
    category: "Auth",
    blurb: "Passwordless email magic-link sign-in.",
    prompt:
      "Replace password auth with magic-link sign-in: a single email input on /auth, send a magic link, handle the callback, and route the user to /dashboard on success.",
  },
  {
    slug: "team-invites",
    name: "Team invites",
    category: "Auth",
    blurb: "Owner can invite teammates by email; pending invites table.",
    prompt:
      "Add team invites: an owner can invite teammates by email from /settings/team, the invite is stored in `team_invites` and an email is sent. Accepting the invite via a tokenised link adds the user to the team with a default role.",
  },
  {
    slug: "live-cursors",
    name: "Live cursors / presence",
    category: "Realtime",
    blurb: "Show other users' cursors and names in realtime on a shared page.",
    prompt:
      "Add live cursors and presence to the current page using Supabase Realtime: each connected user sees the others' cursor positions with name labels and a presence avatar stack in the top-right.",
  },
  {
    slug: "comments-thread",
    name: "Comments thread",
    category: "Realtime",
    blurb: "Threaded comments with realtime new-message updates.",
    prompt:
      "Add a threaded comments component that I can drop on any page (scoped by an `entity_id` prop). Persist to a `comments` table with RLS, support replies, and use Supabase Realtime to live-append new comments without refresh.",
  },
  {
    slug: "mapbox-picker",
    name: "Map location picker",
    category: "Maps",
    blurb: "Mapbox map with searchable address picker that returns lat/lng.",
    prompt:
      "Add a reusable `<LocationPicker />` component using Mapbox GL JS: search address with geocoder, drop a pin, return lat/lng + formatted address via onChange. Read MAPBOX_PUBLIC_TOKEN from env.",
  },
  {
    slug: "ai-chat-drawer",
    name: "AI chat drawer",
    category: "AI",
    blurb: "Slide-in AI assistant drawer wired to Petal AI Gateway.",
    prompt:
      "Add a global AI assistant: a floating button bottom-right opens a slide-in drawer with a streaming chat UI powered by Petal AI Gateway (model: google/gemini-2.5-flash). Persist conversation per user.",
  },
  {
    slug: "file-uploader",
    name: "Drag-and-drop file uploader",
    category: "Media",
    blurb: "Multi-file uploader with progress, saved to Cloud storage.",
    prompt:
      "Add a drag-and-drop file uploader component: multiple files, per-file progress, image previews, upload to a `uploads` Cloud storage bucket, persist file metadata in an `uploads` table with RLS scoped to the current user.",
  },
];
