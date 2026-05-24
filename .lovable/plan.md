Do I know what the issue is? Yes.

The landing page did build, but it rendered with React error #130 because the generated app used Petal kit components with the wrong prop contracts. Example from the broken film-production landing page:

- `FeatureIcon` was called as `<FeatureIcon name="film" />`, but the kit expects `icon={Film}`. That makes React try to render `undefined` as a component.
- `PricingTable` was given `buttonText` / `featured`, but the kit expects `cta` / `highlight`.
- `FaqAccordion` was given `faqs` with `question/answer`, but the kit expects `items` with `q/a`.
- `CtaGradientBand` was given `primaryLink`, but the kit expects `primaryCta`.

Root-cause plan:

1. Make the kit tolerant where Petal commonly generates intuitive props
   - Update the scaffolded blocks so they safely accept both the existing strict API and the common generated variants.
   - `FeatureIcon` will support string names like `film`, `camera`, `edit`, `award`, and will fall back to a safe icon instead of crashing.
   - `PricingTable`, `FaqAccordion`, `CtaGradientBand`, `FooterColumns`, and `LogosMarquee` will normalize alternate prop shapes before rendering.

2. Add a hard pre-ship validator for invalid kit usage
   - Extend the render-risk checks to detect component API mismatches that compile but crash at runtime.
   - Flag cases like missing `FeatureIcon.icon`, `PricingTable` tiers without CTA data, FAQ arrays in the wrong shape, and CTA props with the wrong names.
   - These should no longer pass as a successful build.

3. Improve the generation prompt so Petal stops producing the wrong shapes
   - Add concise, exact usage examples for the landing-page section blocks.
   - Remove ambiguity from the current manifest-only guidance, which lists exported component names but not enough prop contracts.

4. Ensure existing broken builds recover on the next rebuild
   - The build trigger already reapplies the scaffold kit before deployment, so updating the kit compatibility layer should heal the current broken project when it rebuilds.

5. Verify against the exact broken project
   - Re-run the static checks against the film-production landing page file set.
   - Confirm the specific React #130 causes above are neutralized before shipping the fix.

<presentation-actions>
  <presentation-open-history>View History</presentation-open-history>
</presentation-actions>

<presentation-actions>
<presentation-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</presentation-link>
</presentation-actions>