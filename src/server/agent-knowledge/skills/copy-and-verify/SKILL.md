---
name: copy-and-verify
description: Words that don't read as AI-written, and the self-check to run before you say you're done.
preload: true
---

## Copy

The fastest way a site reads as machine-written is its vocabulary, not its layout.

**Never use these words in site copy.** They are the most reliable AI tells on the web:
*Elevate · Seamless · Unleash · Next-Gen · Revolutionize · Empower · Supercharge · Transform your · Take it to the next level · In today's fast-paced world*

**Be specific instead of superlative.** Specificity is what reads as human, because only someone who knows the business could write it.

| Generic | Specific |
|---|---|
| "Lightning-fast performance" | "Pages load in under 400ms" |
| "Trusted by thousands" | "Used by 1,200 clinics" |
| "Premium quality ingredients" | "Flour milled in Cebu, ground weekly" |
| "Comprehensive solutions" | Name the three things it actually does |

**Round numbers read as invented.** "12,847 members" is believable; "10,000+ members" is a placeholder. Only use a number the user gave you — never fabricate a statistic, testimonial, client name, or review. If you have no real number, write a sentence instead of a fake one.

**Also avoid:** `Lorem ipsum` or any `[Placeholder]` text in shipped output; em-dashes in body copy (use a comma, colon, or full stop); a heading that is just the section's category name ("Our Features", "Our Services") when a real sentence would carry meaning.

**Headings should say something.** "Everything you need to run your bakery" beats "Features". If the heading could sit on any site in any industry, rewrite it.

## Self-check before you finish

Run this after the build verifies and before your closing message. Most of these are objective — a link either points somewhere real or it doesn't — so fix what fails rather than weighing it up. They are quality checks, not build gates: fix, then move on, and don't loop re-verifying.

**Composition**
- No three grid-shaped sections in a row.
- Adjacent sections differ in layout direction and background tone.
- Section headings vary in scale rather than all being identical.
- Exactly one hero. One final CTA section. No CTA in every section.

**Copy**
- No word from the banned list above appears anywhere.
- No placeholder text, no invented statistics, no fabricated contact details.
- Every heading says something specific to this business.

**Craft**
- Every `<img>` has a real `alt` describing the image, not the filename.
- Every link points somewhere real — no `href="#"` placeholders.
- Buttons have visible text contrast against whatever sits behind them.
- Every page sets a real title and meta description by whatever mechanism this target uses.

**Responsive**
- Multi-column layouts collapse to a single column on mobile.
- Nothing overflows horizontally.
- Any text sitting over an image has a scrim, overlay, or solid panel behind it.

Fix what this surfaces before you finish. If something can't be fixed within the scope the user asked for, say so plainly in your closing message rather than silently leaving it — but do not expand the work beyond what they requested to chase it.
