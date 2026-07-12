/**
 * Design-taste prompt block.
 *
 * The existing `designFloor` snippet in `dynamic-prompts.server.ts`
 * enforces mechanics (responsive breakpoints, semantic tokens, no
 * text-xs). This module layers TASTE on top: what to commit to, what
 * clichés to refuse, and which locked palette + type pair to use for
 * this specific project.
 *
 * Injected additively — never replaces `designFloor`.
 */

import { pickDesignForBrief, type DesignPick } from "./palette-presets.server";
import { renderSectionLibraryBlock } from "./section-library.server";

const TASTE_BODY = `\n\n[Reinforcement — Design taste commitments (READ BEFORE WRITING ANY VISUAL FILE)]
Petal is being judged on whether the landing looks like it was made by a person with taste, not by an AI that reached for the safe default. Every visual file you write this turn must satisfy ALL of the following:

1. Commit to ONE direction. Pick brutally-minimal OR maximalist OR retro-futuristic OR playful OR editorial OR brutalist OR art-deco OR organic — and execute it with conviction across every section. Never blend three neutral styles into "safe SaaS mush".

2. Distinctive typography, always. Never Inter + Inter. Never Poppins for both heading and body. Use the LOCKED FONT PAIR (below) verbatim — load it from Google Fonts via a \`<link>\` tag in \`src/routes/__root.tsx\`, expose it as \`--font-display\` and \`--font-body\` in \`src/styles.css\`, then use \`font-display\` and \`font-body\` in components. Display headings are DISPLAY-scale (text-5xl → text-8xl on hero), tight tracking, tight leading. Never accept default browser typography.

3. Locked palette. Use the LOCKED PALETTE (below) verbatim. Define these four hex values as semantic tokens in \`src/styles.css\` (\`--background\`, \`--surface\`, \`--primary\`, \`--primary-glow\`) using oklch conversion where possible; derive \`--foreground\`, \`--muted\`, \`--border\`, \`--card\` from them. Never inject a random indigo, purple, or blue-500 into the palette.

4. Refused clichés — DO NOT ship any of these:
   - Purple-to-pink gradient on white background.
   - Indigo-500 primary with Inter typography.
   - Centered hero with three equal-weight feature cards as the only page content.
   - Generic stock-photo placeholder ("smiling person at laptop", "team high-fiving").
   - "AI-generated" abstract 3D blob backgrounds when the product isn't 3D-related.
   - Mid-page black \`text-white bg-black\` band inside an otherwise light page.
   - Lorem ipsum in any live copy.
   - Placeholder logos rendered as gray rectangles in a row (either use real generated brand marks or skip the logo strip).
   - \`© 2024\` in the footer — the current year is passed to you separately, use it.
   - Every h1 the same size and weight across pages.

5. Depth and layered composition. Landings must have layered depth: subtle gradients on hero backgrounds using the LOCKED palette, one soft radial glow behind the headline, generous shadows on elevated cards (\`shadow-2xl shadow-primary/10\` or similar semantic-token shadow), controlled use of blur/backdrop-blur on floating pills or badges.

6. Real animation, once. If \`framer-motion\` is installed, animate the hero on mount (opacity + 20px y-translate, 0.6s ease), animate section entries as they scroll into view via IntersectionObserver, and add one signature motion element (a rotating word, a scrolling marquee, a scroll-linked reveal). Do NOT animate every card and every icon.

7. Signature moment per landing. Every landing needs ONE unforgettable moment: an oversized italic word in the hero, a bento tile with a live-looking mini-chart, a marquee of testimonial fragments, a scroll-swap sticky feature browser. Pick one, execute it well, do not sprinkle five.

8. Density matches vision. Minimalist commitment = generous whitespace, few sections, single accent. Maximalist commitment = dense compositions, layered gradients, multiple accents, mixed media in bento tiles. Do not build a maximalist hero followed by a minimalist features section.

If your draft violates ANY of the above, REWRITE before emitting. The goal is that when the user pastes the URL into a designer channel, no one guesses it was AI-generated.`;

/**
 * Full design-taste block: taste commitments + locked palette/type + section library.
 * Called once per build turn and appended to the system prompt when the
 * archetype is landing/marketing/portfolio-adjacent.
 */
export function renderDesignTasteBlock(brief: string): { text: string; pick: DesignPick } {
  const pick = pickDesignForBrief(brief);
  const [bgDeep, bgSurface, accent, accentSoft] = pick.palette.colors;

  const lockedBlock = `\n\n[LOCKED PALETTE + TYPOGRAPHY for this project — use verbatim]
Palette: "${pick.palette.label}" — ${pick.palette.vibe}
  - Deep background:  ${bgDeep}
  - Surface / card:   ${bgSurface}
  - Primary accent:   ${accent}
  - Accent glow/soft: ${accentSoft}

Wire these into \`src/styles.css\` as semantic tokens (oklch preferred):
  :root {
    --background: <${bgDeep} as oklch>;
    --surface:    <${bgSurface} as oklch>;
    --primary:    <${accent} as oklch>;
    --primary-glow: <${accentSoft} as oklch>;
    --foreground: <auto-contrast against --background>;
    --muted-foreground: <auto-contrast, lower emphasis>;
    --border: <foreground at ~12% alpha>;
    --gradient-primary: linear-gradient(135deg, var(--primary), var(--primary-glow));
    --shadow-elegant: 0 10px 30px -10px color-mix(in oklab, var(--primary) 30%, transparent);
  }

Typography pair: "${pick.fontPair.label}"
  - Display heading font: "${pick.fontPair.display}"
  - Body font: "${pick.fontPair.body}"

Load both via a single <link> tag in \`src/routes/__root.tsx\` head():
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link
    rel="stylesheet"
    href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(pick.fontPair.display).replace(/%20/g, "+")}:wght@400;500;600;700;800&family=${encodeURIComponent(pick.fontPair.body).replace(/%20/g, "+")}:wght@400;500;600;700&display=swap"
  />

In \`src/styles.css\`, expose them:
  :root {
    --font-display: "${pick.fontPair.display}", ui-sans-serif, system-ui, sans-serif;
    --font-body:    "${pick.fontPair.body}", ui-sans-serif, system-ui, sans-serif;
  }

Add matching Tailwind v4 @theme entries so \`font-display\` and \`font-body\` utility classes work:
  @theme {
    --font-display: var(--font-display);
    --font-body:    var(--font-body);
  }

Use \`font-display\` on every heading (h1-h3) and \`font-body\` on the <body>. Never mix in Inter/Poppins/system-ui as a "fallback headline" font.

Archetype tags for this project: ${pick.archetypeTags.join(", ")}`;

  const sectionBlock = renderSectionLibraryBlock(pick.archetypeTags);

  return { text: TASTE_BODY + lockedBlock + sectionBlock, pick };
}

/**
 * Landing checklist block — the sections that MUST ship for any landing.
 * Kept separate from the taste block so it can be enforced by
 * `generation-quality-gate.server.ts` too.
 */
export const LANDING_SECTION_KEYWORDS = {
  nav: /\b(NavBar|Header|SiteHeader|TopNav|Navigation)\b/,
  hero: /\b(Hero|HeroSection|LandingHero)\b/,
  socialProof: /\b(Logos|LogoCloud|LogoWall|SocialProof|Marquee|TrustBar|Stats(Strip|Row)?)\b/,
  features: /\b(Features|FeatureGrid|Bento|WhyUs|Capabilities|ValueProps)\b/,
  howItWorks: /\b(HowItWorks|Steps|Process|Timeline)\b/,
  testimonials: /\b(Testimonials?|Reviews?|Praise|Wall|Quotes?)\b/,
  pricing: /\b(Pricing|Plans|PricingTable|PricingCards?)\b/,
  faq: /\b(FAQ|Questions?|Accordion)\b/,
  cta: /\b(CTA|CallToAction|GetStarted|SignUpBanner|Newsletter)\b/,
  footer: /\b(Footer|SiteFooter|FooterSection|MegaFooter)\b/,
};

export function renderLandingChecklistBlock(): string {
  return `\n\n[Landing-page section checklist — required for any landing/marketing build]
Every landing you build must include ALL of the following sections in the composed page, each in its own component file under \`src/components/sections/\`, each ≤120 lines:
  1. NavBar / SiteHeader   (with logo, primary nav, CTA button)
  2. Hero                  (variant picked from Section Library)
  3. Social proof          (logos, marquee, stat strip, or anchor testimonial)
  4. Features              (bento, zigzag, tabs, sticky-scroll, or icon grid)
  5. How it works          (steps row, timeline, or diagram)
  6. Showcase              (carousel, parallax grid, or device mockups)
  7. Testimonials          (masonry, anchor+mini, or video row)
  8. Pricing               (only skip if the product is genuinely free)
  9. FAQ                   (accordion, two-col, or grouped)
 10. Final CTA             (banner, split, or newsletter)
 11. Footer                (mega, minimal, or newsletter)

Missing 4+ of these sections = incomplete landing. If pricing genuinely doesn't apply, replace it with a matching "Who it's for" or "Compare" section — never leave a bare 4-section landing.`;
}
