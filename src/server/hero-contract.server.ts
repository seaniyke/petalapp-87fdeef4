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
Modern studio hero: one picture, one headline, one action. Restraint is the look.

1. **Optional kicker** — plain text only: \`text-xs uppercase tracking-[0.18em] text-muted-foreground\`. Never a pill, badge, chip or icon.
2. **H1** — display font, \`text-4xl sm:text-5xl lg:text-7xl leading-[1.02] tracking-tight\`, max 2 lines on desktop, 3 on phone, one colour. Never colour, italicise, highlight or gradient a single word.
3. **Subhead** — optional, one sentence, \`text-base md:text-lg text-muted-foreground max-w-xl\`.
4. **Action** — ONE primary \`<Button size="lg">\`; an optional second action is a quiet text link with an arrow, never a second filled or outlined button. Buttons are rectangles (rounded-md); never rounded-full pills.
5. **Visual** — a large, sharp \`petal-image://\` photograph (full-bleed or a 7/5 split), \`object-cover\` with an explicit aspect ratio. For SaaS: one framed product screenshot, no floating cards.
6. **Nothing else in the fold** — no booking or time-slot widgets, availability cards, tickers, marquees, product grids, stats, forms, calculators or badges. Those belong in their own sections below.`;

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
