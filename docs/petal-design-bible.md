# The Petal Design Bible

Single source of truth for Petal's interface. Every new feature must comply. Derived from what already exists in `src/styles.css` and the audited component set — this codifies the good parts and closes the drift found in `docs/petal-builder-ux-audit-v1.md`.

---

## 1. Principles

1. **Subtract before adding.** If a new control duplicates an existing one, the answer is to merge, not to add a second entry point.
2. **One fact, one surface.** A given piece of state (build status, credit balance, error) is rendered by exactly one component at a time.
3. **Human first, technical on demand.** Users see plain English. Raw logs live behind a disclosure, always with a copy button.
4. **Never fail silently.** Every async path has a timeout, a message, and either a retry or a clear reason it can't be retried.
5. **Chat is never blocked.** No build state disables the composer.
6. **Mobile is a target, not a fallback.** Every feature ships with a phone affordance or it doesn't ship.

---

## 2. Colour

All colour comes from semantic tokens in `src/styles.css` (`:root` / `.dark`), authored in OKLCH.

**Core:** `background, foreground, card, card-foreground, popover, popover-foreground, primary, primary-foreground, secondary, secondary-foreground, muted, muted-foreground, accent, accent-foreground, destructive, destructive-foreground, border, input, ring`
**Sidebar:** `sidebar-*` (8)
**Charts:** `chart-1…5`
**Pastels:** `coral, mint, butter, lilac, sky` — decorative accents only, never for text or state.

**Rules**
- Never write `text-white`, `bg-black`, `text-gray-*`, `bg-[#…]`, or `rgba()` literals in app UI. The only sanctioned exception is physical-device chrome simulation (`DevicePreviewFrame.tsx`), which mimics hardware, not Petal.
- State colours: success → `mint`, warning → `butter`, error → `destructive`. Never `bg-amber-500` / `bg-emerald-500`.
- Every colour pairing must be declared as a background/foreground token pair. No pale bubble + white text.

## 3. Typography

**Families:** `--font-display` (Fraunces) for h1–h4 only · `--font-sans` (SF Pro / Inter Tight) for everything else · `--font-mono` for code.

**Scale — the only sanctioned sizes:**

| Role | Class | Weight |
|---|---|---|
| Hero | `text-6xl` / `text-7xl` | `font-black` |
| Page title | `text-4xl` | `font-black` |
| Section title | `text-2xl` | `font-bold` |
| Card title | `text-lg` | 600 (set by base CSS) |
| Body | `text-base` | 500 (base CSS) |
| UI default | `text-sm` | 550 (base CSS) |
| Meta / caption | `text-xs` | 600 (base CSS) |

`text-3xl` and `text-5xl` are transitional only — do not introduce new usages. There is exactly **one** H1 mechanism: `heading-editorial`. Do not hand-roll `font-display text-Nxl font-black`.

Base CSS already sets weight and tracking for `text-xs` through `text-5xl` — do not add `font-medium`/`font-semibold` on those elements; it silently conflicts.

## 4. Spacing & radius

Spacing uses the Tailwind 4-point scale. Section rhythm: `space-y-3` inside a card, `space-y-6` between cards, `py-16`/`py-24` between page sections.

**Radius — three values only:**

| Element | Radius |
|---|---|
| Pills, avatars, icon buttons | `rounded-full` |
| Buttons, inputs, chips, code blocks | `rounded-xl` |
| Cards, sheets, panels, modals | `rounded-2xl` |

`rounded`, `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-3xl`, `rounded-none` are deprecated. `--radius-4xl` is retired.

## 5. Elevation

Three tokens only: `--shadow-soft` (resting cards) · `--shadow-editorial` (raised panels, popovers, sheets) · `--shadow-glow` (a single hero/primary emphasis per screen, at most).

Tailwind's `shadow-sm|md|lg|xl|2xl` are deprecated in app UI. Borders (`border-border`) are preferred over shadow for dense surfaces.

## 6. Buttons

Use `<Button>`. Raw `<button>` is permitted only for non-standard composites, and then must carry `focus-visible:ring-2 focus-visible:ring-ring` itself.

Variants: `default` (one primary per screen) · `secondary` · `outline` (default for toolbars) · `ghost` (icon-only chrome) · `destructive` · `link`.

Sizes: `sm` 32px · `default` 36px · `lg` 44px · `icon` 36px desktop / **44px on touch**.

Every icon-only button needs `aria-label`. Every destructive action needs a confirm dialog with a named consequence.

## 7. Cards & sheets

Card = `rounded-2xl border border-border bg-card shadow-[var(--shadow-soft)] p-4 sm:p-5`. Title `text-lg`, body `text-sm text-muted-foreground`.

Sheets/drawers: `rounded-2xl`, `pb-[max(1rem,env(safe-area-inset-bottom))]` via the `safe-bottom` utility (never inline-duplicated), a visible title, and a single primary action in the footer. **Sheets are mounted lazily behind their open flag** — never unconditionally.

## 8. Loading

| Situation | Pattern |
|---|---|
| Known-shape content (lists, grids, forms) | **Skeleton** matching the final layout |
| Unknown-shape / short (<1s) | Inline `Loader2` at `h-4 w-4` |
| Long operation with phases | Phase rail + headline + subcaption (`BuildActivityCard`) |
| Streaming text | `petal-shimmer` stage label |
| Full-page auth/session check | Skeleton shell, **never a blank screen** |

A bare full-screen spinner is not an acceptable loading state for any primary surface.

## 9. Empty states

Every list, grid, and panel gets: pastel icon chip → `text-lg` heading → one line of `text-sm text-muted-foreground` → one primary CTA. Never render an empty container.

## 10. Errors

**Three tiers, always in this order.**

1. **Headline** — plain English, no jargon. Banned words in tier 1: gateway, 502, esbuild, Cloudflare, ENOENT, stack, exception, undefined.
2. **"What went wrong"** — summarized cause + `file:line` when known, behind a disclosure.
3. **"Technical log"** — raw text in `<pre>` with a copy button, behind a second disclosure.

Every error declares exactly one `actionKind`: `retry` · `buy-credits` · `open-settings` · `contact` · `dismiss`. **If Petal retries automatically, the card says so and shows no retry button.** Copy and behaviour must agree.

Raw `e.message` in a toast is forbidden. All failures route through `toFriendlyError`.

## 11. Notifications

| Channel | Use for | Never for |
|---|---|---|
| Toast | Transient success, clipboard, validation | Anything with a persisted card |
| Inline card | Build outcomes, errors, plans, next steps | Momentary confirmations |
| Banner | Persistent account-level state (low balance) | Per-build status |
| Modal | Destructive confirms, blocking choices | Information |

**One channel per event.** A toast and a card for the same failure is a bug. Maximum one banner on screen.

## 12. Build status

There is exactly one status source: `useBuildStatusLabel()`. Header buttons, sheet pills, and cards all consume it — none derive their own wording from `buildStatus`.

States: `planning · building · repairing · deploying · ready · failed · stopped`. Each declares: what Petal is doing · whether the user can keep chatting (always yes) · whether preview is current · elapsed time once past 30s.

`repairing` is always labelled free. `stopped` is dismiss-only.

## 13. Chat

- Assistant: no bubble. Plain `text-[15px] leading-[1.65]` on page background.
- User: `rounded-2xl rounded-br-md bg-primary/12 ring-1 ring-primary/20 text-foreground`, max 85% width.
- One assistant turn renders **markdown + at most one action row**. Plans, checklists, and suggestions go behind a disclosure.
- Required affordances: copy message · copy code block · regenerate · edit-and-resubmit · stop generation · revert to here.
- Auto-scroll only when within 120px of the bottom; otherwise show a "jump to latest" pill.
- Code blocks: `rounded-xl bg-muted font-mono text-[13px]`, syntax theme follows light/dark.
- Composer: `Enter` = newline, `⌘/Ctrl+Enter` = send, `enterKeyHint="send"`, min height 44px, never disabled by build state.

## 14. Preview

Every preview path must declare: a timeout, a user-facing reason on failure, and a retry or an explanation of why retry won't help.

- Boot: show the last deployed build immediately, badge it "showing last deployed build".
- Embed refusal: probe server-side first; if the iframe is refused, show a reason card with "Open in new tab".
- Crash: 2 errors in 5s → crash card with Retry + Ask Petal to repair.
- Device switch resizes the wrapper only; it never remounts the iframe.
- Silent placeholder substitution (missing entry file, binary assets) must be disclosed inline.

## 15. Motion

Durations: 120ms micro (hover, press) · 200ms component (sheets, popovers) · 400ms page. Easing: `cubic-bezier(0.4, 0, 0.2, 1)`.

Named animations: `petal-meter-sheen · petal-text-shimmer · petal-float · petal-marquee · petal-blob`. Every keyframe animation must be wrapped in `@media (prefers-reduced-motion: reduce)` — no exceptions.

## 16. Responsive

**Breakpoints:** `sm` 640 (density) · `md` 768 (structure) · `lg` 1024 (comfort) · `xl` 1280 (max width).

- Structural layout may change at `md` and `lg` only.
- At `md` (768px exactly, i.e. iPad portrait), the chat sidebar must be collapsible and the tablet device preset must not exceed the available column.
- Touch targets ≥ 44×44px below `lg`.
- `safe-top`, `safe-bottom`, `safe-left`, `safe-right` utilities — never inline `env()`.
- Root shells use `h-[100dvh]`, never `100vh`.

**Z-index contract:** 10 inline sticky · 20 preview overlays · 30 app header · 40 reserved fixed chrome · 50 modals/pickers · Radix portals above.

## 17. Accessibility floor

Every icon-only control has `aria-label`. Every image has meaningful `alt` (`alt=""` only when genuinely decorative — avatars are not). Every dialog has a title. Every interactive element has a visible `focus-visible` ring. Colour is never the only carrier of state. Text contrast ≥ 4.5:1 in both themes.

## 18. Information architecture

- One action registry defines every builder action once; desktop chrome and the mobile action sheet both render from it. Feature parity is structural, not manual.
- Maximum 5 top-level affordances in the builder header: identity · view switch · primary action · overflow · account.
- Every feature reachable on desktop is reachable on mobile, and vice versa.
- Settings is tabbed and deep-linkable; it is not a scroll target of last resort.

## 19. Brand voice

Say Petal, Petal Cloud, Petal AI. Never Lovable or Supabase in user-facing copy. Sentence case everywhere except product names. Second person, present tense, no exclamation marks except a single 🎉 on genuine success. Never apologize twice for the same failure.

## 20. Compliance

A feature is not done until: it uses only sanctioned tokens, sizes, radii and shadows · it has loading, empty, and error states · it renders on a 390px phone with 44px targets · every icon control is labelled · it introduces no second entry point for an existing action · it adds no second renderer for existing state.

---

*Version 1.0 — 2026-08-06. Amend deliberately; every amendment is a migration.*
