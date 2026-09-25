/**
 * Reusable feature/section snippets. Composition only: snippet prompts never
 * choose colours, fonts or accents — the project's design-system package owns
 * those. (Theme presets were removed: re-theming goes through the
 * deterministic design-system package engine, never an AI prompt.)
 */
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
    blurb: "Slide-in AI assistant drawer wired to Kimble AI Gateway.",
    prompt:
      "Add a global AI assistant: a floating button bottom-right opens a slide-in drawer with a streaming chat UI powered by Kimble AI Gateway (model: google/gemini-2.5-flash). Persist conversation per user.",
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
