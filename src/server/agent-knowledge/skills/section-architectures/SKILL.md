---
name: section-architectures
description: A menu of named section layouts to commit to, instead of defaulting to three equal cards.
triggers: landing, marketing, homepage, home page, pricing, testimonial, faq, footer, section, portfolio, features, about page
targets: website
---

Left to itself, an AI builds the same section every time: an eyebrow, a centered heading, and three equal cards each with an icon, a bold line, and a paragraph. It is the single most recognisable "nobody designed this" pattern on the web.

The fix is not more creativity. It is **commitment**. For each section, pick ONE architecture below and build it fully. Do not blend two — a blend always averages back toward the three-card default.

Use the template's existing components and semantic tokens (`bg-card`, `bg-muted`, `text-muted-foreground`, `border-border`). Never hardcode colors.

The components named below (`Card`, `Button`, `Accordion`, `Badge`) are the usual ones, but **check `template.json`'s `shadcn_components` first** — templates differ. If one is missing, build the section with plain elements and the same tokens rather than importing something that isn't there.

---

## FEATURES — what it does

### A. Bento Grid
*For 4–6 features of clearly unequal importance.*

One cell dominates; the others support. Cells hold **different kinds of content** — a screenshot in one, a statistic in another, a short quote in a third.

```
grid grid-cols-1 md:grid-cols-3 gap-4 auto-rows-[minmax(180px,auto)]
  primary cell:   md:col-span-2 md:row-span-2  bg-card border rounded-xl p-8
  support cells:  bg-card border rounded-xl p-6
```

⚠ Fails when every cell is the same size with the same icon-heading-paragraph. If all six cells look alike, this is a 3-card grid wearing a costume — make one cell twice the size and give it a real visual.

### B. Stacked Showcase
*For 2–3 major features that each deserve room.*

Full-width rows, alternating side. Text one side, visual the other; next row reversed.

```
space-y-16 md:space-y-24
  row: grid grid-cols-1 lg:grid-cols-2 gap-10 items-center
    text side:   heading + 2 sentences + optional 3 check bullets
    visual side: real image, rounded-xl border
```

Use `lg:order-1` / `lg:order-2` to flip the visual, keeping text first in the DOM for screen readers.

⚠ The alternation must be visible on desktop. Reversing only in source order changes nothing on screen.

### C. Single Spotlight
*For one defining feature, a product shot, or a demo.*

Minimal text, one large visual that IS the section.

```
max-w-5xl mx-auto text-center
  eyebrow + heading (max-w-2xl mx-auto) + one sentence
  visual: rounded-xl border overflow-hidden shadow-lg
```

---

## PROOF — who trusts it

### D. Logo Strip
*Only when the user supplied real client or brand names.* Never invent logos.

```
py-10 border-y border-border
  small uppercase label, text-xs tracking-wide text-muted-foreground
  flex flex-wrap items-center justify-center gap-10
  each logo: h-7 opacity-60 grayscale hover:opacity-100 hover:grayscale-0 transition
```

### E. Testimonial Cascade
*For service businesses where a human voice sells.*

Asymmetric — one quote is featured, the rest support. Not a row of identical cards.

```
grid grid-cols-1 lg:grid-cols-3 gap-6
  featured: lg:col-span-2  bg-muted rounded-xl p-8
            quote text-xl md:text-2xl leading-relaxed
            author row: avatar + name + role, text-sm
  support:  bg-card border rounded-xl p-6, quote text-base
```

⚠ Three identical centered testimonial cards is the #1 proof-section default. One card must dominate. Only use real names the user gave you.

### F. Metric Bar
*For genuinely impressive numbers the user provided.*

```
py-14 border-y border-border
  grid grid-cols-2 lg:grid-cols-4 gap-8 text-center
  number: text-4xl md:text-5xl font-semibold tracking-tight tabular-nums
  label:  text-sm text-muted-foreground mt-2
```

---

## PROCESS — how it works

### G. Numbered Steps
*For 3–5 steps, especially uneven ones.* Vertical, with a connecting rule.

```
relative space-y-12  (vertical line: absolute left-6 inset-y-0 w-px bg-border)
  step: flex gap-6 items-start
    numeral: size-12 rounded-full border-2 bg-background grid place-items-center relative z-10
    content: heading text-lg font-medium + one or two sentences
```

### H. Horizontal Flow
*Only for a genuinely simple 3-step process.*

```
grid grid-cols-1 md:grid-cols-3 gap-8
  step: icon (size-10) + heading + one sentence
```

⚠ This is the highest-risk architecture in this document — it is three boxes with icons, i.e. exactly the default. Use it only for a real 3-step sequence. Four or more steps, or steps of unequal weight: use **G** instead.

---

## RESULTS — case studies

### I. Card Gallery
*For visual portfolio work.* **Vary the aspect ratios** — uniform tiles read as a stock grid.

```
grid grid-cols-1 lg:grid-cols-2 gap-6
  card: group relative rounded-xl overflow-hidden  (alternate aspect-[4/3] and aspect-[3/4])
    img: object-cover w-full h-full transition group-hover:scale-105
    overlay: absolute inset-x-0 bottom-0 p-6 bg-gradient-to-t from-black/70 to-transparent
             name text-white, result line text-white/70 text-sm
```

### J. Single Deep Dive
*For one flagship story.* Full-width image, then challenge on one side and results on the other.

---

## PRICING

### K. Clean Tiers
*For 2–3 plans.*

```
grid grid-cols-1 md:grid-cols-3 gap-6 items-start
  card: rounded-xl border p-8
  recommended: border-primary/40 ring-1 ring-primary/20 bg-primary/5 + small pill badge
    price: text-4xl font-semibold + /mo in text-muted-foreground
    features: max 6–8, lead with what differs between plans
    Button className="w-full mt-8"
```

`items-start` matters — the recommended card being slightly taller is the point.

⚠ Fifteen features in tiny text is unreadable. Cap at 6–8 and lead with the differentiators, not the items every plan shares.

### L. Comparison Table
*For complex products.* Minimal plan cards, then a detailed feature matrix below.

---

## OBJECTIONS

### M. FAQ Accordion
*For 5–8 real questions.* Prefer the template's `Accordion` component when `template.json` lists it; only hand-roll one if it doesn't.

```
max-w-3xl mx-auto
  Accordion type="single" collapsible
  question: text-base font-medium, left-aligned
  answer:   text-muted-foreground leading-relaxed
```

---

## CLOSING

### N. Full-Width CTA Banner
*The universal closer.*

```
py-16 md:py-20 bg-primary text-primary-foreground text-center
  heading text-3xl md:text-4xl font-semibold tracking-tight
  one sentence, opacity-90, max-w-xl mx-auto
  ONE Button, variant that contrasts with bg-primary
```

⚠ One heading, one button. A CTA banner with three buttons, a form, and social links converts worse than a bare one. Check the button is visible against `bg-primary` — this is the most common contrast bug in the whole build.

### O. Split CTA
Visual one side, heading and button the other.

---

## FOOTER

### P. Minimal Strip
*For single-goal landing pages.* Logo left, essential links center, socials right, copyright below.

### Q. Structured Footer
*For multi-page sites.* Brand column plus three or four link columns, then a bottom bar with copyright and legal links.

Every footer link must point somewhere real. A category with no page is plain text, not a dead link.

---

## VISUAL BREAKS

- **R. Full-bleed image** — `h-[40vh] md:h-[55vh] object-cover`, no text.
- **S. Giant statement** — one number or one sentence, `text-5xl md:text-7xl`, generous space, nothing else.
- **T. Marquee strip** — a slow continuous scroll of names or tags, `py-6 border-y`.

---

## Before you move on

For each section, confirm: I picked one architecture and built it fully · it doesn't repeat the previous section's shape · its content is real, not placeholder · one cell or card dominates where the architecture calls for it.

If you have used a 3-equal-column grid twice already on this page, you may not use one again. Pick a different architecture.
