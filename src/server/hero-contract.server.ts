/**
 * Hero Contract.
 *
 * Non-negotiable hero shape injected into the system prompt on initial
 * landing-page builds. Root cause this addresses: B2B/SaaS briefs were
 * shipping with eyebrow-as-headline, bare `<a>…→` CTAs, and a DotPattern
 * occupying the entire fold (the "PipelinePilot" failure). Consumer briefs
 * were getting the Flowy treatment (real hero image, filled pill CTAs,
 * highlighted display headline). The difference was composition discipline,
 * not the kit primitives — those are already present.
 *
 * This block makes hero composition contract-grade rather than
 * suggestion-grade. It is intentionally short so it fits the prompt budget
 * and can be applied universally to all landing-page initial builds.
 */

import type { WebSubtype } from "@/lib/web-subtype";
import { classifyAppShape } from "@/lib/app-shape-classifier";

export interface HeroContractOpts {
  /** Initial build (no existing files). Contract only applies to initial builds. */
  isInitial: boolean;
  /** Detected web subtype, when known. Marketing/landing → contract applies. */
  webSubtype?: WebSubtype | null;
  /** Free-form brief, used to detect SaaS/B2B vibe. */
  brief?: string;
}

const HERO_CONTRACT = `

### Hero Contract (non-negotiable for the home page on initial build)
The home route hero must follow this shape exactly. No exceptions, no "modern minimal" reinterpretations, no swapping it for a centered text block.

1. **Eyebrow badge** — small pill with an icon + 2-4 words. Themed colored background (NOT plain border). Skip only if it would be redundant with the brand mark.
2. **H1 headline** — display font, fluid clamp \`text-4xl sm:text-5xl md:text-6xl lg:text-7xl\`, font-weight 600-800, tight tracking, max 2 lines. ONE word visually emphasized via highlight-marker span, gradient text, underline accent, or AuroraText. The H1 is the largest thing on the fold — never let the eyebrow visually compete.
3. **Subhead** — 2-3 lines, \`text-base sm:text-lg md:text-xl\`, \`text-muted-foreground\`. Real sentences, not feature bullets.
4. **CTA row** — TWO Buttons side by side, both from \`@/components/ui/button\`:
   - Primary: \`<Button size="lg">\` (filled, default variant) OR \`<ShimmerButton>\` from \`@/components/fx\`. Must read as a solid, tappable shape.
   - Secondary: \`<Button size="lg" variant="outline">\` OR \`variant="ghost"\`. Outlined pill or quiet ghost — never bare text.
   - **BANNED**: bare \`<a className="...">Learn more →</a>\`, bare \`<span>Start <ArrowRight/></span>\`, or any CTA that is only an icon + text with no button chrome. If you catch yourself writing \`Start Your Free Trial →\` as a plain link, stop and wrap it in \`<Button>\`.
5. **Hero visual** — occupies ≥ 40% of the fold height on desktop, sits beside or below the copy. MUST be one of:
   - \`<img src="petal-image://..." />\` — a real generated photograph or render. ALWAYS use this for consumer / lifestyle / wellness / fashion / food / travel.
   - A framed product mockup (\`<BrowserMockup>\` / \`<PhoneMockup>\`) WITH a \`petal-image://\` screenshot inside, plus 1-2 floating decorative cards (testimonial pull-quote, KPI tile, status pill) overlapping the frame at the corners.
   - For SaaS / dashboards / B2B: a product UI mockup PLUS at least one floating decorative card. Never just the bare mockup centered in dead space.
   - For ai-product / crypto: a 3D scene, gradient mesh, or animated beam diagram counts.
   - **BANNED**: a hero whose only visual is a background pattern (DotPattern, GridPattern, FlickeringGrid) with no foreground subject. Patterns are decoration, not the subject.
6. **Background** — soft tonal wash (gradient, MeshGradient, or solid muted background). A DotPattern/GridPattern is OK as a subtle texture but MUST sit behind a real foreground subject, never as the entire hero.
7. **Density** — hero section padding \`py-12 sm:py-16 md:py-24\`. Never \`min-h-screen\` with empty space; the fold should feel full, not airy-to-the-point-of-empty.

Mental check before you write the hero JSX: "Does this look like Stripe / Linear / Vercel / Framer's homepage, or does it look like a placeholder?" If placeholder, restart with a real hero visual and filled CTAs.`;

const SAAS_ADDENDUM = `

### SaaS / B2B hero — extra rules (this brief reads as SaaS/B2B)
- The primary CTA copy is "Start free" / "Get started" / "Start your free trial" — wrap it in a FILLED Button, not a text+arrow link.
- The hero visual is a product UI mockup. Generate the screenshot inside it as \`petal-image://product-dashboard-...-clean-modern-ui\` and frame it in BrowserMockup or a custom rounded container with a window chrome row. Add 1-2 floating decorative cards (KPI tile, notification pill, avatar stack) anchored to the mockup's corners with \`absolute\` positioning + soft shadows. The Flowy comparison: their hero photo had a floating "5 Days to Flow" status card. Yours needs the same overlay treatment on the mockup.
- Background: prefer MeshGradient or a soft brand-tinted wash. DotPattern alone is BANNED for the hero fold on SaaS briefs.`;

function looksLikeSaasBrief(brief: string): boolean {
  try {
    const shape = classifyAppShape(brief);
    return (
      shape.category === "saas" ||
      shape.category === "internal-tool" ||
      shape.category === "ai-tool"
    );
  } catch {
    return /\b(saas|b2b|crm|pipeline|dashboard|admin|workflow|automation|leads?|funnel|analytics|sales\s+team)\b/i.test(
      brief,
    );
  }
}

/**
 * Render the Hero Contract prompt block. Returns "" when not applicable
 * (patches, non-landing subtypes) so callers can blindly concatenate.
 */
export function renderHeroContractBlock(opts: HeroContractOpts): string {
  if (!opts.isInitial) return "";
  // Only marketing / unknown-subtype builds get the hero contract.
  // Dashboard apps, admin tools etc. don't have a public hero.
  if (opts.webSubtype && opts.webSubtype !== "marketing") return "";

  const saasAddendum =
    opts.brief && looksLikeSaasBrief(opts.brief) ? SAAS_ADDENDUM : "";

  return HERO_CONTRACT + saasAddendum;
}
