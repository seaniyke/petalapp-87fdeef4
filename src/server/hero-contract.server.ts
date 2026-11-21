/**
 * Hero Contract.
 *
 * Restrained, image-led hero for initial landing-page builds. Earlier versions
 * forced an icon pill eyebrow, a coloured/italic "highlight word" and two pill
 * buttons — template tropes that made every site look dated (Allure Bar,
 * Nov 2026). This version states the modern studio shape instead.
 */

import type { WebSubtype } from "@/lib/web-subtype";
import { classifyAppShape } from "@/lib/app-shape-classifier";

export interface HeroContractOpts {
  isInitial: boolean;
  webSubtype?: WebSubtype | null;
  brief?: string;
}

export const HERO_CONTRACT = `

### Hero Contract (home page, initial build)
Design the hero for THIS business and brief — bold centred type, a full-bleed photograph, an editorial split or a quiet type-only header are all fine. Restraint is the look.

1. **Optional kicker** — usually leave it out. If used: plain text only (\`text-sm font-medium text-muted-foreground\`, sentence case), never a pill, badge, chip or icon, and NEVER the address, location, opening hours or rating — those go in the hours/contact section or the footer.
2. **H1** — display font, \`text-hero\` (fluid, comfortable letter spacing — never squeezed), usually 2 lines on desktop and 3 on phone. One colour is the calm default; an accent word, italic or gradient is yours to use when the brand or the person's brief calls for it.
3. **Subhead** — optional, one sentence, \`text-base md:text-lg text-muted-foreground max-w-xl\`.
4. **Action** — ONE primary \`<Button size="lg">\`; an optional second action is \`<Button size="lg" variant="glass">\` or a quiet text link with an arrow.
5. **Visual** — choose the medium that tells this story best:
   - a full-bleed or split \`petal-image://\` photograph (\`object-cover\`, explicit aspect ratio);
   - living background motion — animated mesh or gradient washes, drifting light, \`<Spotlight>\`, layered glass, parallax or scroll-scaled imagery, canvas/physics motion; whatever movement fits the feeling the person wants;
   - a looping video with \`<HeroVideo>\` from \`@/components/flow\` (muted, inline, poster, scrim) using the person's video when they give one;
   - any mix of these — motion can run behind the whole page, not only the top;
   - a type-led hero with no picture is fine when the brand suits it; for SaaS, one framed product screenshot.
   The hero background runs edge to edge; text over media uses light text and a scrim so it always reads.
6. **Keep the fold focused** — when the layout direction puts a booking flow, live product moment or selector beside the headline (split screen, bento), that is welcome; otherwise supporting content lives in its own sections below.`;

const SAAS_ADDENDUM = `
- SaaS: primary action is "Get started"/"Start free"; the visual is one clean product screenshot in a simple rounded frame.`;

function looksLikeSaasBrief(brief: string): boolean {
  try {
    const shape = classifyAppShape(brief);
    return shape.category === "saas" || shape.category === "internal-tool" || shape.category === "ai-tool";
  } catch {
    return /\b(saas|b2b|crm|dashboard|analytics)\b/i.test(brief);
  }
}

export function renderHeroContractBlock(opts: HeroContractOpts): string {
  if (!opts.isInitial) return "";
  if (opts.webSubtype && opts.webSubtype !== "marketing") return "";
  return HERO_CONTRACT + (opts.brief && looksLikeSaasBrief(opts.brief) ? SAAS_ADDENDUM : "");
}
