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

- **Logo mark**: create \`src/components/brand-mark.tsx\` exporting \`<BrandMark className="…" />\` — a hand-authored inline SVG (geometric monogram, abstract glyph, or emblem) built from theme tokens so it works in light AND dark mode. Render it in the header, the footer, and any auth/empty-state screen.
- **BANNED as a logo**: bare lucide glyphs (\`Square\`, \`Box\`, \`Circle\`, \`Hexagon\`, \`Sparkles\`, \`Shapes\`), an emoji, or a wordmark with no mark at all.
- **Favicon**: index.html must carry \`<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,…">\` using the same mark, plus \`apple-touch-icon\` and a \`theme-color\` meta. Never leave the framework default.
- **Wordmark**: the brand name next to the mark uses the display font, tight tracking, and semibold-or-heavier weight.
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
