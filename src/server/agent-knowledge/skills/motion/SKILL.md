---
name: motion
description: Locking one motion personality and a small easing set, so animation reads as designed rather than assorted.
triggers: animate, animation, motion, transition, hover, interactive, scroll, parallax, micro-interaction
---

Motion fails on a site not because there is too little of it, but because it is *assorted*. A page where a bouncy card sits next to a slow fade next to a snappy button reads as three people working separately. Consistency beats coverage every time.

## 1. Lock one personality

Pick ONE for the whole site before writing any transition.

**Precedence, highest first:** what the user asked for → the design system's playbook (it names a locked personality and duration range) → the table below → the example durations in the core prompt. The core prompt's `duration-300` / `duration-500` examples are illustrative; when a playbook locks a personality, its range wins.

| Personality | Feel | Duration | Use when |
|---|---|---|---|
| **Surgical** | Crisp, fast, no overshoot. Motion is purely functional. | 100–250ms | Dashboards, developer tools, B2B software, anything used daily |
| **Physical** | Tactile, slight overshoot and settle, objects have weight. | 300–600ms | Consumer products, apps, playful or premium brands |
| **Cinematic** | Slow, deliberate, theatrical reveals. | 500–900ms | Editorial, portfolio, luxury, storytelling pages |

Record the choice via `writeDesignIntelligence` under `animations` so later sessions don't drift into a different one.

## 2. Three curves, no more

Choose at most **three** easing curves for the entire site and reuse them everywhere. A fourth curve is a sign one of the first three was wrong.

```
Surgical   → transition-[...] duration-150 ease-out
             plus cubic-bezier(0.22,1,0.36,1) for anything that moves position
Physical   → cubic-bezier(0.16,1,0.3,1) for entries
             cubic-bezier(0.34,1.56,0.64,1) sparingly, small elements only
Cinematic  → cubic-bezier(0.16,1,0.3,1) at 500–800ms for reveals
             ease-out for hovers
```

Write custom curves as arbitrary Tailwind values: `ease-[cubic-bezier(0.16,1,0.3,1)]`.

## 3. Rules that apply to every personality

- **In CSS you write yourself, name the properties** rather than using `transition: all` — `transition: transform 200ms, opacity 200ms`. `all` animates properties you did not intend, some of them off the GPU.
  Tailwind's `transition-all` utility is a different case and is **fine to use**: the core prompt prescribes it (`transition-all duration-300` on card hovers), the shipped `Accordion` component uses it, and the post-build quality check deliberately does not flag it. Do not rewrite existing `transition-all` classes, and never edit a shared `components/ui/*` primitive to remove one.
- **Animate only `transform`, `opacity`, and `filter`.** Animating `width`, `height`, `top`, or `left` forces layout on every frame and drops frames.
- **Never start from `scale(0)`.** Begin at `scale(0.95)`–`scale(0.97)` with `opacity-0`. Nothing in the physical world appears out of literal nothing; `scale(0)` reads as a glitch.
- **Every pressable element needs press feedback.** `active:scale-[0.98]` with a fast transition. Its absence makes the UI feel unresponsive no matter how quick it actually is.
- **Anchor popovers and tooltips to their trigger** with `transform-origin`, so they grow out of the thing that summoned them. Modals are the exception — they are viewport-anchored and stay centered.
- **Stagger, don't fire everything at once.** 60–100ms between siblings. Simultaneous arrival is a data dump; sequence is a hierarchy.
- **Respect `prefers-reduced-motion`.** Reduce to an opacity fade — no transforms, no parallax, no overshoot.

## 4. Frequency gate

Motion budget is inverse to how often something is used.

| Used | Motion |
|---|---|
| Constantly (nav, core controls, keyboard actions) | None, or under 150ms. Speed *is* the experience. |
| Often (hover, toggles, list items) | Minimal, fast feedback only |
| Occasionally (modals, drawers, toasts) | Standard from your locked personality |
| Rarely (onboarding, empty states, success) | Full budget — this is where delight belongs |

An action triggered by keyboard should never animate.

## 5. What to actually animate

On a marketing page, this is enough:

- Hero content enters on load — staggered fade-up, finished within 600ms.
- Sections reveal once on scroll — fade plus a small `translate-y`, same distance every time.
- Cards lift on hover — one consistent offset (`hover:-translate-y-1`), one consistent shadow step.
- Buttons and links have hover *and* active states.
- Images scale gently inside `overflow-hidden` on hover, where the design calls for it.

**Consistency check:** every scroll reveal uses the *same* translate distance. Every card lift uses the *same* offset. Every stagger uses the *same* increment. Mixing 20px, 30px, and 60px reveals is what makes a page feel assembled rather than designed.

## Anti-patterns

Reveals so slow the user scrolls past before content appears · every element animating on a long page, so nothing reads as emphasis · parallax on more than one layer · text that disassembles character by character for no reason · hover effects on non-interactive elements · animation with no `prefers-reduced-motion` fallback.
