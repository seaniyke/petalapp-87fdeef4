# The Petal Frontend Quality Bible

The standard for every app **Petal generates**. (For Petal's own interface, see `docs/petal-design-bible.md`.)

Petal does not generate "random React." It generates Petal-quality React.

Version 1.0 — 2026-08-06.

---

## 1. Foundations for every generated app

- **Design tokens first.** A semantic token layer (background, foreground, card, primary, secondary, muted, accent, destructive, border, ring) is defined in the app's global stylesheet before any component is written. Components never hardcode colours.
- **One type scale, one radius scale, one shadow scale**, declared once.
- **A real brand.** Name + logo mark + colour direction, invented if not supplied. Never a placeholder wordmark.
- **A shell.** Header, footer, and page container exist as shared components from file one.
- **Mobile-first.** Every layout is authored at 390px and expanded upward.

## 2. Typography

- Two families maximum: one display/heading, one body. A mono family only if code is shown.
- Never default to Inter or Poppins unless asked; pick a pairing that fits the domain.
- Scale: hero → page title → section title → card title → body → caption. Six steps, no improvisation.
- Line length 60–75ch for prose. Line height ≥ 1.5 for body, ≤ 1.15 for hero.
- Exactly one `<h1>` per page. Heading levels never skip.

## 3. Colour & contrast

- Every background has a declared foreground partner. No pale surface with white text, ever.
- Body text ≥ 4.5:1, large text ≥ 3:1, in every theme the app ships.
- Colour is never the only carrier of meaning — pair with icon, label, or shape.
- Accent colour is used sparingly: primary CTA, active state, one hero emphasis.

## 4. Spacing & layout

- 4-point scale only.
- Section rhythm: `py-16` mobile → `py-24` desktop. Consistent across the page.
- Max content width capped (typically 1200–1280px) with symmetric gutters.
- Grids collapse to one column below `md`. Never a 3-column grid on a phone.
- No fixed heights on content containers. Use `min-h-[100dvh]`, never `100vh`, never `h-screen` on a scrolling section.
- Text rows containing fixed-size widgets use the grid + `min-w-0` + `shrink-0` pattern so nothing clips at 390px.

## 5. Landing pages

Required sections, in this order unless the brief says otherwise:

`nav · hero · social proof · features · how it works · showcase/stats · testimonials · pricing · FAQ · final CTA · footer`

- **Hero:** one clear promise (≤ 12 words), one supporting line, one primary CTA, one secondary. Never two competing primaries. Hero must be fully visible at 390×700 without cropping.
- **Features:** 3 or 6 items, each with icon, 2–4 word title, one sentence. Parallel grammar across all.
- **Social proof:** logos or a metric row. If neither exists, a single credible testimonial — never fabricated corporate logos.
- **Testimonials:** name, role, and an avatar or initials chip. Attributed quotes only.
- **Pricing:** 2–3 tiers, one highlighted, feature list aligned across tiers, billing period stated.
- **FAQ:** 5–8 accordion items answering real objections, not restating features.
- **Footer:** nav columns, legal links, brand mark, copyright year.
- **CTAs:** the same primary action repeats at hero, mid-page, and final CTA. Verb-first labels ("Start free", not "Submit").

## 6. Dashboards

- **Structure:** persistent nav (sidebar ≥ `lg`, bottom bar or drawer below) → page header with title + primary action → KPI row → primary content → secondary panels.
- **KPI cards:** label, value, delta with direction, and a period ("vs last 30 days"). Never a naked number.
- **Tables:** sticky header, zebra or divider (not both), right-aligned numerics, tabular figures, row actions in a trailing column, sortable headers, pagination or virtualization past 50 rows. Below `md`, tables become stacked cards — never horizontal scroll as the only affordance.
- **Charts:** titled, axis-labelled, unit-stated, accessible palette, tooltips on hover *and* focus, an empty state, and a loading skeleton the same size as the chart.
- **Filters** persist in the URL so views are shareable.
- **Settings:** tabbed, deep-linkable, each section with a description and its own save affordance with a success confirmation.

## 7. Forms

- Every input has a visible `<label>`. Placeholders are never labels.
- Validate on blur and on submit, never on every keystroke.
- Errors sit adjacent to the field, in words ("Enter a valid email"), and set `aria-invalid` + `aria-describedby`.
- Correct `type`, `inputMode`, `autoComplete`, and `enterKeyHint` on every field.
- Submit disables and shows progress; success is confirmed explicitly; failure keeps the user's input.
- Required fields marked; optional fields marked when most are required.
- No form is ever generated without a working submit handler.

## 8. Buttons & controls

- One primary action per view.
- Variants: primary · secondary · outline · ghost · destructive · link. Sizes: sm 32 · default 36 · lg 44 · icon 36 (44 on touch).
- Every icon-only control has an `aria-label`.
- Every destructive action confirms, naming the consequence.
- Disabled controls explain why (tooltip or helper text).
- Every interactive element has a visible focus ring.

## 9. Icons & imagery

- One icon family, consistent stroke and size.
- Icons are never the sole label for an unfamiliar action.
- Every image has meaningful `alt`; decorative images get `alt=""` and `aria-hidden`.
- Images declare width/height or aspect ratio to prevent layout shift; below-fold images lazy-load.
- No stock-photo placeholders where real content is expected.

## 10. Loading, empty, error

Every data surface ships all three.

| State | Standard |
|---|---|
| Loading | Skeleton matching final layout. Spinners only for < 1s unknown-shape waits. Never a blank screen. |
| Empty | Icon chip → heading → one explanatory line → one primary CTA. Never an empty container. |
| Error | Plain-English headline → cause on demand → a retry or a reason retry won't help. Never a raw exception. |

## 11. Navigation

- Current location is always indicated.
- ≤ 7 top-level items; overflow goes to a menu.
- The logo returns home.
- Mobile: hamburger opens a real, working drawer with a close control, focus trap, and scroll lock. A dead hamburger is a build failure.
- Anchor links scroll smoothly and account for sticky header height.

## 12. Motion

- 120ms micro · 200ms component · 400ms page. One easing curve.
- Motion clarifies (entrances, state changes); it never gates interaction.
- Every animation is wrapped in `prefers-reduced-motion: reduce`.
- No autoplaying carousels, no parallax that breaks scroll, no more than one hero animation.

## 13. Responsiveness

- Verified at 390 · 768 · 1024 · 1440.
- Touch targets ≥ 44×44px below `lg`, with ≥ 8px separation.
- Safe-area insets respected on all fixed chrome.
- No horizontal scroll at any width.
- Text scales down at most one step per breakpoint; never below 14px for body.

## 14. Accessibility floor

Semantic landmarks (`header/nav/main/footer`) · logical heading order · keyboard reachable in a sensible order · visible focus · labelled dialogs with focus trap and Escape · live regions for async status · contrast met in every theme · no keyboard traps · skip-to-content link.

## 15. Performance budget

- LCP ≤ 2.5s on mid-tier mobile; CLS ≤ 0.1; no long task > 200ms on first load.
- Images optimized and correctly sized; fonts subset with `font-display: swap`.
- Route-level code splitting; no unused dependency shipped.
- No render-blocking third-party script above the fold.

## 16. Content

- Sentence case. Second person, present tense. No exclamation marks. No em-dash-heavy AI cadence.
- No lorem ipsum, ever. Write plausible domain copy.
- Numbers are formatted and localized; dates are unambiguous.
- Microcopy explains consequences before the user commits.

---

## 17. Generation checklist

A generated frontend is not done until:

- [ ] Tokens defined; zero hardcoded colours in components
- [ ] Real brand name + logo mark present
- [ ] Renders at 390px with no horizontal scroll and no cropped hero
- [ ] Every route reachable; every link resolves
- [ ] Every form submits and confirms
- [ ] Mobile nav opens, traps focus, and closes
- [ ] Loading, empty, and error states on every data surface
- [ ] One `<h1>` per page; headings ordered
- [ ] All icon controls labelled; all images have `alt`
- [ ] Contrast passes in every shipped theme
- [ ] No placeholder text, no TODO, no dead button
- [ ] Reduced-motion respected

*Version 1.0 — 2026-08-06.*
