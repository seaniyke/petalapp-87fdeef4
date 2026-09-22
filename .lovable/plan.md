# What that chat actually means for Kimble

I read the whole thing and checked each of its 26 suggestions against what Kimble already has. The honest headline: Kimble already has most of it. Only four things in that list are genuinely missing, and one of them is worth real money.

## Already built (no work needed)

- Visual identities: 25 of them (editorial, brutalist, luxury gold, noir, glass, medical, kids, cyberpunk and more), picked automatically from the brief.
- Starting structures: 70 (restaurant, real estate, job board, telehealth, invoicing, coworking, and so on).
- Section patterns: a catalogue of hero / proof / features / pricing / FAQ / CTA variants written specifically to stop the "hero then three cards then three cards" look.
- Motion: a shared motion kit with reduced-motion built in.
- Copy honesty: a live check that blocks fake testimonials, fake stats and marketing filler.
- Project memory, change-only editing, build verification, self-repair, version history with restore, real screenshots reviewed by a vision model at phone and desktop widths, and website research from a URL.

So the audit that chat is asking for is done, and the answer is: the engines exist.

## Genuinely missing (worth doing)

**1. Picture intelligence — the real gap.**
Right now every app's images are made from scratch or filled with a grey placeholder. There is no library Kimble can search. This is the single biggest quality and cost lever: a curated, tagged picture library means better-looking apps and far cheaper builds, because the most expensive part of a build stops being image generation.
Plan: build a picture library where every image carries subject, industry, mood, colour, orientation and whether people appear — then have the builder search it first and only create a new image when nothing fits.

**2. Icon vocabulary.**
Icons are described in instructions but never chosen from a known list, so a build can reach for one that does not exist. Plan: a fixed, searchable icon set the builder picks from by meaning.

**3. You can edit the resources without a code change.**
Identities, structures and section patterns are baked into the code. You can already edit pricing and economics from the admin screen; you cannot edit these. Plan: move them behind the same admin screen so you can add an identity or a starting structure yourself.

**4. Visual review is thinner than it reads.**
Screenshots are only reviewed at two widths and only after the build. Plan: add a tablet width and re-check after a repair, so a fix that breaks something else gets caught.

## Deliberately not doing

- No second builder architecture. What that chat calls "agent tools", "self-healing" and "deterministic verification" already exist here — rebuilding them would be a rewrite with no user-visible gain.
- No 100-component library as a separate thing. The section patterns plus the existing kits already cover this; a parallel library would only create drift.
- Not chasing every one of the 26 items. Several are marketing descriptions of things Kimble does differently and better.

## Order of work

1. Picture library with searchable tags, and the builder wired to search before generating.
2. Icon vocabulary.
3. Admin editing for identities, structures and section patterns.
4. Tablet width plus after-repair recheck in visual review.

Each step ships on its own and is verified with real builds, not just passing checks.

## Technical notes

- Picture library: new table with tag columns plus a text search index; the picture step queries it before falling back to generation; the existing procedural placeholder stays as the last resort. Metadata written at ingest time, not at build time.
- Icons: a generated allow-list from the installed icon package, injected as a search tool rather than a prompt dump, plus a build-time check that every icon used exists.
- Admin-managed resources: the current hardcoded records become seeded rows behind the existing admin patterns, read through a cached loader so build latency does not change.
- Visual review: add a 834px capture and a second review pass gated to runs where a repair actually changed files, to avoid doubling vision cost on clean builds.
