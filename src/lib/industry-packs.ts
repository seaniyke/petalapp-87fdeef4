/**
 * Industry Packs — opinionated, multi-page starters tuned per industry.
 *
 * Each pack composes a *richer* prompt than a single template: page list,
 * sections-per-page, theme direction, and the Cloud features Petal should
 * suggest enabling (auth/email/payments/etc). The detail page assembles this
 * into one prompt and ships the user into the builder.
 *
 * Why separate from start-ideas: templates are 1-line prompts, packs are
 * full briefs. Different surface, different intent.
 */
import {
  Utensils,
  Home as HomeIcon,
  Dumbbell,
  Briefcase,
  Mail,
  type LucideIcon,
} from "lucide-react";

export type CloudFeature =
  | "auth"
  | "database"
  | "email"
  | "payments"
  | "storage"
  | "ai"
  | "analytics";

export type IndustryPack = {
  slug: string;
  name: string;
  tagline: string;
  Icon: LucideIcon;
  /** Short marketing blurb for the gallery card. */
  blurb: string;
  /** Hex/oklch palette anchors used for the preview swatch. */
  palette: { name: string; cssVar: string; sample: string }[];
  /** Display fonts paired for the pack. */
  typography: { display: string; body: string };
  /** Pages the AI should scaffold. */
  pages: { path: string; purpose: string }[];
  /** Cloud features to auto-suggest enabling after generation. */
  cloud: CloudFeature[];
  /** Long-form composed brief sent to the builder. */
  brief: string;
};

export const INDUSTRY_PACKS: IndustryPack[] = [
  {
    slug: "restaurant",
    name: "Restaurant",
    tagline: "Menu, reservations, and a story that makes them hungry",
    Icon: Utensils,
    blurb:
      "A warm, food-forward site for an independent restaurant — full menu, online reservations, gallery, and a press section.",
    palette: [
      { name: "Terracotta", cssVar: "--accent", sample: "#C75D3C" },
      { name: "Cream", cssVar: "--background", sample: "#FBF6EE" },
      { name: "Olive", cssVar: "--muted", sample: "#5A6B3B" },
    ],
    typography: { display: "Fraunces", body: "Inter" },
    pages: [
      { path: "/", purpose: "Hero with cuisine vibe, today's specials, story teaser, CTA to reserve" },
      { path: "/menu", purpose: "Full menu by section (starters, mains, desserts, drinks) with prices and dietary tags" },
      { path: "/reservations", purpose: "Booking form (date, time, party size, name, phone, notes) saved to database" },
      { path: "/about", purpose: "Owner story, sourcing philosophy, team photos" },
      { path: "/gallery", purpose: "Lightbox grid of food + interior photos" },
      { path: "/contact", purpose: "Address, hours, phone, embedded map, contact form" },
    ],
    cloud: ["database", "email", "storage"],
    brief: `A complete restaurant website with warm, editorial design (terracotta + cream, Fraunces display font). Build these pages:

1. Home — hero with bold cuisine photography, today's specials strip, two-column "our story" teaser, prominent "Reserve a table" CTA.
2. Menu — full menu organised by section (Starters, Mains, Desserts, Drinks). Each item has name, description, price, and dietary tags (V, GF, etc).
3. Reservations — booking form (date, time, party size, name, phone, special requests). Save to the database and send a confirmation email.
4. About — owner story, sourcing philosophy, team grid.
5. Gallery — masonry grid of food + interior photos with lightbox.
6. Contact — address, hours per day, phone, embedded map, contact form.

Use a warm cream background, terracotta accent, olive secondary, and a serif display font paired with a clean sans body. Photography-led, generous whitespace, no stock-template feel.`,
  },
  {
    slug: "real-estate",
    name: "Real estate",
    tagline: "Listings, agent profiles, and lead capture that actually converts",
    Icon: HomeIcon,
    blurb:
      "A polished agency site with searchable listings, agent profiles, and a buyer-lead capture funnel.",
    palette: [
      { name: "Deep navy", cssVar: "--primary", sample: "#0F2A4A" },
      { name: "Sand", cssVar: "--background", sample: "#F4EFE6" },
      { name: "Brass", cssVar: "--accent", sample: "#B8893C" },
    ],
    typography: { display: "Playfair Display", body: "Inter" },
    pages: [
      { path: "/", purpose: "Hero with featured listing, search bar, neighborhood highlights" },
      { path: "/listings", purpose: "Searchable/filterable grid (price, beds, baths, location)" },
      { path: "/listings/$slug", purpose: "Listing detail: gallery, specs, map, agent contact, schedule a viewing" },
      { path: "/agents", purpose: "Agent grid with photo, specialty, and contact" },
      { path: "/sell", purpose: "Seller lead-capture page with valuation request form" },
      { path: "/about", purpose: "Agency story, awards, testimonials" },
    ],
    cloud: ["database", "email", "storage", "auth"],
    brief: `A premium real estate agency site with editorial typography (Playfair display, Inter body) and a confident navy + brass + sand palette.

Pages:
1. Home — full-bleed hero of a featured listing, search bar (location, price range, beds), 3 neighborhood highlight cards.
2. /listings — filterable grid (price, beds, baths, type, location) backed by a database table.
3. /listings/$slug — image gallery, specs table, embedded map, agent card, "Schedule a viewing" form.
4. /agents — agent grid with photo, name, specialty, languages, contact.
5. /sell — seller lead-capture page: free valuation form (address, beds, baths, condition) saved to db, email notification to agency.
6. /about — agency story, awards, testimonial carousel.

Use serif display + sans body, generous whitespace, large photography. Build the listings table with realistic seed data (5-8 properties).`,
  },
  {
    slug: "fitness",
    name: "Fitness studio",
    tagline: "Class schedules, trainer bios, and trial-class signups",
    Icon: Dumbbell,
    blurb:
      "An energetic studio site with a weekly class schedule, trainer profiles, membership tiers, and free-trial booking.",
    palette: [
      { name: "Electric lime", cssVar: "--primary", sample: "#C5F23A" },
      { name: "Charcoal", cssVar: "--background", sample: "#0F1112" },
      { name: "White", cssVar: "--foreground", sample: "#FFFFFF" },
    ],
    typography: { display: "Space Grotesk", body: "Inter" },
    pages: [
      { path: "/", purpose: "Bold hero, class types row, member testimonials, trial CTA" },
      { path: "/schedule", purpose: "Weekly class grid with class type, trainer, time, capacity, book button" },
      { path: "/trainers", purpose: "Trainer profiles with bio, specialties, social links" },
      { path: "/membership", purpose: "3-tier pricing (Drop-in, Monthly, Annual) with Stripe checkout" },
      { path: "/trial", purpose: "Free trial class booking form" },
    ],
    cloud: ["database", "email", "payments", "auth"],
    brief: `A high-energy fitness studio site. Dark charcoal background, electric lime primary, bold sans display (Space Grotesk).

Pages:
1. Home — bold full-height hero with motion-y headline, class-types row (HIIT, Yoga, Strength, Spin), 3 member testimonials, "Book your free trial" CTA.
2. /schedule — weekly class grid (Mon–Sun rows, time-slot columns) showing class name, trainer, capacity, "Book" button.
3. /trainers — trainer cards with photo, specialties, bio, social links.
4. /membership — 3 pricing tiers (Drop-in $25, Monthly $129, Annual $1290) with Stripe checkout and an authenticated /account page showing membership status.
5. /trial — free-trial booking form (name, email, phone, preferred class, date) saved to db and emailed to the studio.

Use bold motion, big type, gritty energy. Not soft, not corporate.`,
  },
  {
    slug: "consultancy",
    name: "Consultancy",
    tagline: "Authority, case studies, and a serious lead form",
    Icon: Briefcase,
    blurb:
      "A confident consultancy site with services, case studies, team, and a thoughtful inquiry form.",
    palette: [
      { name: "Ink", cssVar: "--foreground", sample: "#111418" },
      { name: "Bone", cssVar: "--background", sample: "#F2EFE9" },
      { name: "Signal red", cssVar: "--accent", sample: "#D33A2C" },
    ],
    typography: { display: "GT Sectra", body: "Inter" },
    pages: [
      { path: "/", purpose: "Editorial hero, services row, featured case study, client logos, CTA" },
      { path: "/services", purpose: "Service offerings with deliverables and engagement model" },
      { path: "/work", purpose: "Case study grid" },
      { path: "/work/$slug", purpose: "Case study detail with problem, approach, outcome, metrics" },
      { path: "/team", purpose: "Senior team profiles" },
      { path: "/contact", purpose: "Inquiry form (company, project type, budget, timeline, message)" },
    ],
    cloud: ["database", "email"],
    brief: `A senior, editorial consultancy site. Ink on bone background, signal-red accent, serif display (GT Sectra) + clean sans body. Confident, asymmetric layouts, generous whitespace.

Pages:
1. Home — editorial hero with a sharp positioning statement, services row, one featured case study (image left, copy right), client logo strip, "Start a project" CTA.
2. /services — 3-5 service offerings, each with deliverables, timeline, and how engagement works.
3. /work — case study grid (cover image, client, outcome metric).
4. /work/$slug — full case study: problem, approach, outcome, metrics, testimonial.
5. /team — senior profiles with bio + LinkedIn.
6. /contact — proper inquiry form (company, project type, budget bracket, timeline, message). Save to db, email the team.

Tone: confident, restrained, premium. No buzzwords.`,
  },
  {
    slug: "newsletter",
    name: "Newsletter",
    tagline: "A signup magnet and a clean archive readers come back to",
    Icon: Mail,
    blurb:
      "A newsletter site with conversion-focused signup, an archive of past issues, and per-issue pages.",
    palette: [
      { name: "Paper", cssVar: "--background", sample: "#FFFDF7" },
      { name: "Ink", cssVar: "--foreground", sample: "#0E0E10" },
      { name: "Marigold", cssVar: "--accent", sample: "#F5B042" },
    ],
    typography: { display: "Tiempos Headline", body: "Inter" },
    pages: [
      { path: "/", purpose: "Big signup hero, social proof, latest 3 issues, what-you'll-get" },
      { path: "/archive", purpose: "Full archive of past issues, sortable" },
      { path: "/issues/$slug", purpose: "Single issue with rich typography and inline signup CTA" },
      { path: "/about", purpose: "Author bio, why this newsletter exists" },
    ],
    cloud: ["database", "email"],
    brief: `A newsletter site optimised for conversion and reading. Paper background, ink type, marigold accent, serif display (Tiempos) + sans body.

Pages:
1. Home — large signup hero (email + name), social proof ("Read by 4,200 founders"), 3 latest-issue cards, "What you'll get" 3-column row, second signup CTA at bottom. Save signups to db and send confirmation via Resend.
2. /archive — full archive list of past issues with title, date, excerpt, sort by newest.
3. /issues/$slug — single issue with rich editorial typography (drop cap, pull quotes), inline signup CTA two-thirds down.
4. /about — author bio, why this newsletter exists, what to expect.

Reading-first design: max-width prose, generous line-height, real serif typography. Not a SaaS landing page in disguise.`,
  },
];

export function getPack(slug: string): IndustryPack | undefined {
  return INDUSTRY_PACKS.find((p) => p.slug === slug);
}

export function packToPrompt(pack: IndustryPack): string {
  const cloudHints =
    pack.cloud.length > 0
      ? `\n\nEnable these Cloud features as part of the build: ${pack.cloud.join(", ")}.`
      : "";
  return `${pack.brief}${cloudHints}`;
}
