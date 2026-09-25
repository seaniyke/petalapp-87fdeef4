---
name: redesign-safety
description: Changing how an existing site looks without breaking how it works — what is safe to touch and what is not.
targets: website
triggers: redesign, restyle, make it look better, modernise, modernize, revamp, refresh the design, new look, improve the design
---

When a site already works and the user wants it to look better, your job is a visual upgrade on a working system. The most common way this goes wrong is not ugly output — it is a beautiful page that no longer functions, because JSX got restructured while "cleaning it up".

**You are changing appearance, not behaviour.**

## Safe to change

`className` values · CSS in `src/custom.css` · design tokens · spacing, radius, shadow values · typography classes · **decorative** layout utilities (padding, gap, margin, alignment) · transition and animation classes.

**Structural layout is not on that list.** Anything that changes the *axis*, the *column count*, or the *order* of elements is structural — `flex`/`flex-row` → `flex-col`, `grid-cols-3` → `grid-cols-2`, moving or regrouping children. A restyle request is for visual changes only; if the user asked for colours or fonts, do not touch structure.

## Never change

- `useState` / `useEffect` / hooks and their bodies
- Event handler logic — what `onClick` *does*, as opposed to how the button looks
- Conditional rendering: ternaries, `&&` chains, early returns
- `.map()` calls, and especially `key` props
- `ref` assignments
- Data fetching, form validation, routing logic
- `aria-*` attributes (you may add missing ones, never remove)
- `data-*` attributes and `id`s — they are often referenced by JS or tests

## The grey zone

These look like styling but carry behaviour. Handle precisely:

| Pattern | What to do |
|---|---|
| `className={isActive ? 'a' : 'b'}` | Keep the ternary exactly. Change only the two class strings. |
| `style={{ display: open ? 'block' : 'none' }}` | Leave it. This is state-driven visibility, not styling. Add your styles alongside. |
| A wrapper `<div>` that looks redundant | Leave it. It may exist for layout, refs, or rendering reasons you cannot see. |
| `{items.map(i => <Card key={i.id} …/>)}` | Style inside `Card`. Never touch the map or the key. |

**When unsure whether something is style or behaviour, leave it and add your styling around it.** A slightly less elegant CSS solution that works beats an elegant refactor that introduces a bug.

## How to work

1. **Read before writing.** Read every file you intend to touch, in full.
2. **Theme changes go in `src/custom.css`.** `src/index.css` is protected — never edit it. Overriding a CSS variable means setting it in **both** `:root` and `.dark`, or dark mode breaks. HSL values are `H S% L%` — space-separated, `%` on the last two.
3. **Prefer token changes over page rewrites.** Changing colors, fonts, radius or shadow at the token level updates every page at once, keeps the site coherent, and cannot lose the user's content. Rewriting pages to restyle them is how work gets destroyed.
4. **Do not re-output whole pages** when only colors or fonts change.
5. **Change one layer at a time** — tokens, then typography, then spacing, then components — and verify the build between layers. If something breaks, you know what broke it.
6. **Respect the scope you were given.** "Make the hero look better" means the hero. Not the nav, not the footer, not the pricing table.

## Where the visible gain actually comes from

In order of impact per unit of risk:

1. **Spacing.** Cramped padding is the clearest signal of an amateur layout. Sections `py-16 md:py-24`, cards `p-6`–`p-8`, real space between a heading and its body text.
2. **Color temperature.** Pure `#fff` on pure `#000` is harsh and unconsidered. Warm or cool near-white and near-black read as chosen.
3. **Type scale.** A heading noticeably larger than body text, with tighter tracking and tighter leading at large sizes, does more than any effect.
4. **One consistent radius and one shadow step**, used everywhere, instead of five of each.
5. **States.** Hover and active feedback on everything interactive.

Atmosphere effects — grain overlays, glows, blend modes — are the *last* thing to reach for and usually unnecessary. Do not add them to fix a layout problem.

## Before you finish

The site still builds · every route still loads · forms still submit · toggles, modals and dropdowns still open and close · no console errors · nothing outside the requested scope changed.

If any of these fail, revert the last layer and diagnose before continuing. A working site that looks worse is recoverable. A broken site is not.
