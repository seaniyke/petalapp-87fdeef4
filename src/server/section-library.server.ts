/**
 * Landing-page section variant catalog.
 *
 * The single biggest reason Petal's landings rhyme with each other is
 * that the model reaches for the same hero + 3-card features + 3-tier
 * pricing every time. This module exposes a menu of concrete section
 * variants and asks the model to pick a non-repeating combination based
 * on the project brief.
 *
 * Injected as a system-prompt block (see `design-taste.server.ts`). The
 * variants are DESCRIPTIONS, not code — the model builds them using the
 * existing scaffold-kit primitives. That keeps the section library and
 * the code-generation pipeline decoupled.
 */

interface SectionVariant {
  id: string;
  section: "hero" | "social-proof" | "features" | "how-it-works" | "showcase" | "testimonials" | "pricing" | "faq" | "cta" | "footer";
  label: string;
  description: string;
}

const VARIANTS: SectionVariant[] = [
  // HERO
  { id: "hero-split", section: "hero", label: "Split", description: "Left: headline + subhead + dual CTA + trust row. Right: full-bleed product screenshot or hero image with subtle floating cards overlaid at corners." },
  { id: "hero-centered-oversized", section: "hero", label: "Centered oversized display", description: "Center-aligned oversized display heading (text-6xl md:text-8xl), italic accent word, single-line subhead, one primary CTA + one ghost link, no image above the fold." },
  { id: "hero-editorial", section: "hero", label: "Editorial magazine", description: "Small eyebrow label, huge serif display heading (multi-line), asymmetric layout with a portrait/product photo on the right taking 40% width, body copy left." },
  { id: "hero-bento", section: "hero", label: "Bento tiles", description: "Headline + subhead top, followed by a 3-tile bento grid IN THE HERO (product tile, metric tile, testimonial tile) — social proof lives inside the hero." },
  { id: "hero-video", section: "hero", label: "Video/animation loop", description: "Headline + CTA left, muted autoplay looping animation or scroll-driven canvas right; heavy motion floor." },
  { id: "hero-terminal", section: "hero", label: "Terminal / product demo", description: "For developer or AI tools: headline + subhead left, a real-looking terminal or code editor mock right with typed animation." },

  // SOCIAL PROOF
  { id: "sp-marquee", section: "social-proof", label: "Logo marquee", description: "Auto-scrolling horizontal marquee of 8-12 grayscale customer logos with 'Trusted by' eyebrow." },
  { id: "sp-logo-wall", section: "social-proof", label: "Static logo grid", description: "3-column grid of 6-9 customer logos with soft dividers, no marquee." },
  { id: "sp-stat-strip", section: "social-proof", label: "Metric strip", description: "3-4 large numbers (users, uptime, savings, rating) with tiny labels, no logos." },
  { id: "sp-testimonial-hero", section: "social-proof", label: "Anchor testimonial", description: "One giant customer quote with photo + name + company, no logos." },

  // FEATURES
  { id: "feat-bento", section: "features", label: "Bento grid", description: "Asymmetric bento (1 tall + 2 short + 1 wide) with mixed media inside tiles: screenshots, icons, small charts." },
  { id: "feat-zigzag", section: "features", label: "Zigzag alternating", description: "3-4 rows, each alternating image-left/text-right and image-right/text-left, generous py-24 between rows." },
  { id: "feat-tabs", section: "features", label: "Tabbed feature browser", description: "Left column: vertical tab list of feature names. Right column: large screenshot/animation for the active tab. Persistent, no accordion collapse." },
  { id: "feat-sticky-scroll", section: "features", label: "Sticky scroll storyteller", description: "Left column stays sticky (screenshot) while right column scrolls through 3-4 feature blocks, each swapping the sticky image." },
  { id: "feat-grid-cards", section: "features", label: "Icon grid", description: "3-column grid of 6-9 small feature cards, each an icon + title + one sentence. Only use when the product genuinely has many small features." },

  // HOW-IT-WORKS
  { id: "how-numbered-row", section: "how-it-works", label: "Numbered steps row", description: "Horizontal 3-step row with large numerals (01/02/03), title, one-sentence body. Connector line between steps on desktop." },
  { id: "how-timeline", section: "how-it-works", label: "Vertical timeline", description: "Left rail with dots, step content on the right. Better for 4-6 steps." },
  { id: "how-diagram", section: "how-it-works", label: "Diagram", description: "Central visual diagram (flow, before/after, or architecture) with 3-4 labeled callouts." },

  // SHOWCASE
  { id: "show-carousel", section: "showcase", label: "Auto-advancing carousel", description: "Full-bleed carousel of 4-6 large product shots with dot pager and left/right controls." },
  { id: "show-parallax-grid", section: "showcase", label: "Parallax grid", description: "Masonry grid of screenshots that shift subtly on scroll." },
  { id: "show-device-mock", section: "showcase", label: "Device mockup trio", description: "Desktop + tablet + phone mockups arranged in staggered depth showing the same product surface." },

  // TESTIMONIALS
  { id: "test-masonry", section: "testimonials", label: "Masonry card wall", description: "Uneven grid of 6-8 short testimonial cards with avatar, name, role, and star rating. Feels like a wall of praise." },
  { id: "test-featured-plus-mini", section: "testimonials", label: "Anchor + mini row", description: "One large featured testimonial with photo on top, row of 3 shorter quotes below." },
  { id: "test-video", section: "testimonials", label: "Video testimonial row", description: "3 video-card mockups with play buttons overlaid on customer photos." },

  // PRICING
  { id: "price-3-tier", section: "pricing", label: "3-tier cards", description: "Three vertical cards, middle one highlighted with 'Most popular' badge and different border. Includes feature checklists." },
  { id: "price-toggle", section: "pricing", label: "Monthly/yearly toggle", description: "Top toggle switches all cards between monthly and yearly with visible discount badge on yearly." },
  { id: "price-compare-table", section: "pricing", label: "Comparison table", description: "Feature-by-feature horizontal comparison table with checkmarks per plan." },
  { id: "price-single", section: "pricing", label: "Single-price focus", description: "One centered price card with big number, feature list, and one CTA. Use when the product has one plan." },
  { id: "price-usage", section: "pricing", label: "Usage-based sliders", description: "Interactive slider (seats / requests / storage) that updates a live estimate figure." },

  // FAQ
  { id: "faq-accordion", section: "faq", label: "Single-column accordion", description: "Centered max-w-3xl column of accordion rows, first item open by default." },
  { id: "faq-two-col", section: "faq", label: "Two-column list", description: "Two-column layout of Q+A pairs, no accordion — always expanded." },
  { id: "faq-grouped", section: "faq", label: "Category-grouped tabs", description: "Left rail with category tabs (Pricing, Security, Integrations), right column shows that group's accordion." },

  // CTA
  { id: "cta-banner", section: "cta", label: "Full-width banner", description: "Full-width band with contrasting background, single headline, one primary CTA + trust microcopy underneath." },
  { id: "cta-split", section: "cta", label: "Split CTA", description: "Two-column: left headline + CTA, right an image or metric card." },
  { id: "cta-newsletter", section: "cta", label: "Newsletter capture", description: "Centered email input with inline submit button and a short pitch above." },

  // FOOTER
  { id: "footer-mega", section: "footer", label: "Mega footer", description: "5-column layout: logo + tagline + social, then 4 link columns (Product, Company, Resources, Legal), copyright row with real current year." },
  { id: "footer-minimal", section: "footer", label: "Minimal", description: "One-row footer: logo left, small link row + copyright right." },
  { id: "footer-newsletter", section: "footer", label: "Footer with newsletter", description: "Top row: newsletter capture across full width. Bottom row: mega-footer link columns." },
];

function bySection(section: SectionVariant["section"]): SectionVariant[] {
  return VARIANTS.filter((v) => v.section === section);
}

/**
 * Render the section-library block. Framed as a menu the model MUST pick
 * from — not a suggestion. We deliberately do NOT tell the model which
 * variant to pick per project; that decision belongs to the model with
 * the archetype tags as context.
 */
export function renderSectionLibraryBlock(archetypeTags: string[]): string {
  const groups: Array<[string, SectionVariant["section"]]> = [
    ["HERO", "hero"],
    ["SOCIAL PROOF", "social-proof"],
    ["FEATURES", "features"],
    ["HOW IT WORKS", "how-it-works"],
    ["SHOWCASE", "showcase"],
    ["TESTIMONIALS", "testimonials"],
    ["PRICING", "pricing"],
    ["FAQ", "faq"],
    ["CTA", "cta"],
    ["FOOTER", "footer"],
  ];

  const lines: string[] = [];
  lines.push(`\n\n[Section Library — pick one variant per section, DO NOT default to the first]`);
  lines.push(`When building a landing page, you MUST pick a distinct variant for each section from the menu below. Do not default to the first item in each group — the whole point of this menu is variety. Read the project brief, pick variants that fit the archetype (${archetypeTags.join(", ") || "generic"}), and combine them so this landing does not look like the last one you shipped.`);
  lines.push(``);
  lines.push(`RULES:`);
  lines.push(`- Never ship: centered hero + 3-column feature icon grid + 3-tier pricing cards + accordion FAQ. That is the default AI landing and it is banned.`);
  lines.push(`- Rotate hero variant per project. If the brief is developer/AI, prefer hero-terminal or hero-split. If editorial/luxury, prefer hero-editorial. If consumer/creator, prefer hero-video or hero-bento.`);
  lines.push(`- Never combine feat-grid-cards + test-masonry + price-3-tier — that trio is the tell of AI-drafted output.`);
  lines.push(`- Each chosen section lives in its own file under \`src/components/sections/\`, ≤120 lines, uses semantic tokens only.`);
  lines.push(``);
  for (const [label, section] of groups) {
    lines.push(`${label}:`);
    for (const v of bySection(section)) {
      lines.push(`  • ${v.id} — ${v.label}: ${v.description}`);
    }
    lines.push(``);
  }
  return lines.join("\n");
}
