# Multi-Page Website Discoverability

Petal already builds true multi-page sites — every file in `src/routes/` becomes a real URL with its own SSR, `<head>`, and OG tags, and the Phase 2 prompt rules already tell the model to prefer separate routes over hash anchors. The gap is **users don't know to ask**. They land on the composer, type "build me a coffee shop site", and accept whatever comes back as one page.

This plan closes that gap in three small, independent surfaces. No backend changes, no new dependencies.

## What we're building

### 1. Starter prompts that lead with "pages"

`src/components/StartIdeasPanel.tsx` already curates landing-screen prompts. Today they describe a single-page site ("a warm one-page site for…"). We add a new category — **"Multi-page site"** — with 3–4 prompts that explicitly mention pages, e.g.

- "A 4-page site for a yoga studio: home, classes, instructors, and contact."
- "A consultancy site with home, services, case studies (with detail pages), and about."
- "A small SaaS marketing site: home, features, pricing, FAQ, and a /blog with post detail pages."
- "A photographer portfolio: home, gallery, about, and a contact page with form."

We also retitle one or two existing entries so the word "page" / "/about" / "/pricing" appears in the visible label, not just the description. Goal: the user *sees* the multi-page option before typing.

### 2. In-builder "Add a page" suggestion chip

Following the existing `EnableXSuggestionChip` pattern (see `EnableSeoSuggestionChip.tsx`), add **`AddPageSuggestionChip.tsx`**. It surfaces inline in the builder when:

- The project has only `index.tsx` (and maybe `__root.tsx`) under `src/routes/`, AND
- The user's last 1–2 messages mention pages, sections, navigation, "menu", "about us", "pricing", "contact", "blog", or similar.

Copy: *"Petal can split this into proper pages — better SEO, shareable URLs, real navigation. Want an About, Pricing, or Contact page?"* with a primary action "Add a page" that opens a tiny chooser (About / Pricing / Contact / Blog / FAQ / custom) and dispatches a prebuilt prompt to the composer.

This reuses the same dismiss/persist mechanics as the other suggestion chips so it doesn't nag.

### 3. Prompt-side nudge so the model offers it unprompted

In `src/server/dynamic-prompts.server.ts`, add a small snippet (triggered on landing/marketing/agency/portfolio/saas keywords) that tells the model: *if the brief implies multiple sections that could stand alone (services, about, contact, pricing, blog), proactively scaffold them as separate routes and mention in the chat reply which pages were created and that more can be added.*

This is the highest-leverage of the three — it makes every generation teach the user what's possible.

## What we're NOT doing

- **No PWA changes.** Per your call, PWA stays exactly where it is — manifest-only, opt-in, no default behavior change.
- **No route inspector / pages panel UI** in this pass. The chip + prompts cover discoverability. A full panel can come later if usage data shows it's needed.
- **No changes to routing itself** — TanStack file-based routing already does everything required.

## Files touched

- `src/components/StartIdeasPanel.tsx` — add multi-page category + prompts
- `src/components/AddPageSuggestionChip.tsx` — new, mirrors `EnableSeoSuggestionChip`
- `src/routes/builder.tsx` (or wherever suggestion chips are wired) — detection + render
- `src/server/dynamic-prompts.server.ts` — new `multiPage` snippet with keyword triggers

## Tier 2 (native shell) — separate plan

You said yes to attempting Tier 2. I'm keeping it out of this plan because it's a much bigger surface (build infra, signing, EAS-style cloud builds, App Store flow) and will need its own scoping pass. Once this discoverability plan ships, I'll come back with a dedicated Tier 2 plan covering: which runtime (almost certainly Capacitor under the hood despite the preference, with full justification of why no npm-only alternative exists), the cloud build pipeline, signing/cert handling, and the in-Petal UX for "Wrap as native app".

Approve this and I'll implement the three changes above in one pass.