# Reduce and refine the Petal landing page

The current signed-out page contains roughly 7,200 visible characters and several sections that repeat the same story: differentiators, features, the whole stack, community, process, marketplace, pricing, and FAQ. The redesign will follow Vercel’s restraint—short claims, strong hierarchy, thin structural rules, and product proof doing more work than prose—without copying Vercel’s branding.

## Locked direction

- **Design:** Minimalist composer focus
- **Palette:** Petal’s warm white, white surfaces, dark ink, and coral used sparingly for key actions
- **Typography:** Space Grotesk for headings and DM Sans for body copy, scoped to the landing page
- **Layout:** Product-first, full-width sections with a strict grid
- **Tone:** Clear, confident, concise; no editorial italics, decorative gradients, blobs, or oversized sales paragraphs

## Page structure

1. **Quiet header**
   - Keep the Petal logo and essential navigation.
   - Simplify visual treatments and preserve sign-in, account, and mobile-menu behavior.

2. **Composer-led first screen**
   - Replace the current multi-line editorial headline and badge with one short product promise and one supporting sentence.
   - Make the working prompt composer the dominant element.
   - Convert starter cards into three or four compact prompt pills.
   - Preserve attachments, voice input, modes, keyboard submission, authentication handoff, and the signed-in greeting/project state.

3. **Immediate product proof**
   - Keep the real app demonstration directly below the composer.
   - Remove decorative framing that competes with the product.
   - Follow it with a compact row of verifiable Petal facts only; no invented usage metrics or customer logos.

4. **Condensed value story**
   - Merge the overlapping “difference,” “features,” and “whole stack” material into one concise section.
   - Give each core differentiator one headline and one short line: build the full stack, specialist review, own the code, and sell the result.
   - Keep links to the existing detailed pages for visitors who want depth.

5. **Short conversion path**
   - Reduce “How it works” to three compact steps.
   - Use one focused marketplace band and one concise pay-as-you-build statement.
   - Keep only the most decision-relevant FAQ items.
   - Finish with one clear action and the existing footer essentials.

## Copy discipline

- Cut total signed-out landing-page copy by about 55–65%.
- Limit each major section to one claim, one supporting sentence, and one action where needed.
- Remove repeated claims about real apps, deployment, ownership, agents, and expiring credits.
- Use plain product language; avoid hype, filler labels, and generic AI phrasing.
- Preserve Petal’s distinct marketplace and buy-once-credit positioning.

## Technical implementation

- Recompose `src/routes/index.tsx` while preserving its existing data loading, composer behavior, signed-in state, navigation targets, and page metadata.
- Simplify `src/components/StartIdeasPanel.tsx` into compact prompt choices.
- Restyle or reduce `src/components/WholeStackSection.tsx`; detailed content remains available through existing supporting pages.
- Add scoped landing typography and restrained surface tokens in `src/styles.css`.
- Load Space Grotesk and DM Sans through the existing document font link.
- Keep existing semantic color tokens and accessible focus, contrast, and reduced-motion behavior.

## Validation

- Verify signed-out and signed-in landing states.
- Test prompt submission, starter prompts, attachments, voice control, navigation, and mobile menu.
- Review at 430×660 mobile and 1440×900 desktop sizes for copy density, text fit, and section rhythm.
- Confirm the first viewport shows the product composer clearly and the next product proof remains visible.

## Out of scope

No changes to authentication rules, billing logic, marketplace mechanics, builder behavior, or backend data.
