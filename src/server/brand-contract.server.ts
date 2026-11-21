/**
 * Brand + composition contract.
 *
 * Two failure modes this exists to kill, both reported from real builds:
 *
 *  1. No logo. The model reaches for a generic `<Square/>` lucide glyph next
 *     to the wordmark and leaves index.html on the framework favicon, so the
 *     shipped app reads as a placeholder rather than a product.
 *  2. Blank bands. The model calls kit blocks with an invented grouped
 *     `sectionHeader={{…}}` prop. React drops the unknown prop, the section
 *     header never renders, and the page ships with a tall empty gap.
 *
 * Deterministic repairs cover both after the fact; this block stops them
 * happening in the first place.
 */

export function renderBrandContractBlock(opts: { isInitial: boolean }): string {
  if (!opts.isInitial) return "";

  return `

### Brand Identity Contract (non-negotiable)
Every app you build is a real product with a real brand. Never ship placeholder identity.

- **Logo**: create \`src/components/brand-mark.tsx\` exporting \`<BrandMark className="…" />\`. Choose the identity that fits THIS business, in any industry: a bold typographic wordmark, a wordmark with a simple relevant SVG mark, or a confident monogram. When the person describes a logo, build exactly that.
- **Make it read and hold**: bold or semibold weight, one line, the display font, normal-to-slightly-tight letter spacing (never squeezed), high contrast against the header. A mark is one or two clean geometric shapes drawn as plain SVG paths in \`currentColor\`, relevant to the business (a salon: a lace curve or crown line; a bakery: a wheat stalk or loaf arc; a finance app: an upward stroke), legible at 16px.
- **Contrast on every surface**: the whole lockup (mark + wordmark) inherits \`text-foreground\` from its container, so it reads on light and dark canvases alike. Use the accent colour inside the mark only when that accent clearly contrasts with the header background. When the header floats over a photo, video or coloured hero, give the lockup the colour that reads on that media (e.g. \`text-white\` over a darkened photo) and switch back once the header gains its solid/glass background on scroll. Never draw the mark in a colour close to the background.
- **Keep it clean**: a mark is drawn for this brand, so skip generic placeholder glyphs (\`Square\`, \`Box\`, \`Circle\`, \`Sparkles\`), emoji, gradients inside the mark, or a tagline stacked under the name in the header.
- **Favicon**: index.html carries \`<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,…">\` using the same mark, plus \`apple-touch-icon\` and a \`theme-color\` meta.
- **App shells**: if you use a sidebar/app shell, the brand lockup MUST also be visible in the mobile top bar — a mobile header showing only a hamburger and empty space is a bug.

### Section Block Prop Contract (prevents blank bands)
Kit blocks (\`FeaturesGrid3\`, \`TestimonialsCards\`, \`FeaturesBento\`, \`PricingTable\`, \`FaqAccordion\`, …) take header copy as FLAT props:

\`\`\`tsx
<FeaturesGrid3 eyebrow="Our promise" title="Why choose us" description="…" items={[…]} />
\`\`\`

- **BANNED**: \`sectionHeader={{ … }}\`, \`header={{ … }}\`, \`heading={{ … }}\`. These props do not exist — React drops them silently and the section renders as an empty gap on the live site.
- Pass list data as \`items\` (blocks that alias it, such as \`testimonials\`, also accept the alias).
- After writing any section, re-read the block's own prop signature in \`src/components/blocks/*\` and confirm every prop you passed appears there. A prop that is not in the signature is dead code and produces a visible hole in the page.
- Never leave a \`<Container>\`/\`<Section>\` whose only children are props the block ignores — if a band has no rendered content, delete the band.`;
}
