# Kimble Test System — design playbook

Synthetic playbook for validating the package pipeline.

## Personality
Calm, cool and precise. Coastal neutrals with one clear accent.

## Typography
- Headings use `--font-display` (Sora) at `--kimble-weight-heading` with `--kimble-tracking-heading`.
- Body copy uses `--font-body` (Manrope) at `--kimble-leading-body`.

## Colour
- Surfaces: `bg-background`, raised panels `bg-card`, quiet areas `bg-muted`.
- The accent (`bg-primary`) marks one primary action per view. Never use it for large fills.
- Never hard-code colours; always use the semantic classes.

## Spacing and layout
- Rhythm is multiples of `--kimble-space-unit`. Content width is `--kimble-container`.

## Cards, buttons, forms
- Cards: `rounded-lg`, `border`, `--kimble-shadow-sm` at rest.
- Buttons: one primary, the rest outline or ghost. Focus uses `--kimble-focus-ring`.
- Inputs: full-width, visible label above, border token only.

## Motion
- Transitions use `--kimble-duration` with `--kimble-ease`. No bouncing.

## Don't
- No gradients on text. No more than one accent colour per screen.
