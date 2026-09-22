# Kimble Builder Intelligence — audit and build plan

I read both documents in full and checked every one of the 42 items against the actual code. The headline: Kimble already has roughly three quarters of it. The document's own instruction is right — this is audit, complete, connect, improve. Not rebuild.

## The filled-in matrix

Have it, working:
- Business understanding (industry, audience, tone, goal derived from the brief)
- Visual identities — 25 of them, each bundling palette + typography + shape + surface
- Starting structures — 70, chosen automatically from the brief
- Section patterns and page narrative, with variety rules that specifically block "hero → three cards → three cards"
- Footer architectures (mega, minimal, newsletter)
- Colour palettes with contrast and readability floors
- Motion kit with reduced-motion built in
- Copy honesty (no fake testimonials, stats, awards, addresses) and anti-filler rules
- Search visibility and accessibility rules inside the build contract, plus a live accessibility check
- Project memory, change-only editing, build verification, self-repair with bounds, version history with restore, screenshots reviewed by a vision model, website research from a URL
- Code and file view, database/auth/permissions, publishing with domains and certificates

Partly there:
- Visual review runs at two widths only (phone, desktop) and only once, before any repair
- Fonts exist only inside the 25 identities — there is no standalone font library with pairings, personalities and industry fit, so "change the font" has no vocabulary to choose from
- Header architectures have no variant library the way footers do

Missing:
- **Pictures.** Every image is invented from scratch or filled with a grey placeholder. Nothing to search.
- **Icons.** Described in instructions, never chosen from a known list.
- **Decorative treatments and illustrations.** No library; no rule for when a drawing beats a photograph.
- **One resource registry.** Identities, structures, sections and patterns are hardcoded and unqueryable, which is exactly what the document's most important rule warns against.
- **Admin control of resources.** You can edit pricing and economics from the admin screen; you cannot add an identity, a structure, a font pairing or a picture.

## What we build, in order

**1. The resource registry** — the foundation everything else plugs into.
One place where each resource carries metadata: identities, structures, sections, headers, footers, fonts, palettes, pictures, icons. The builder asks for the handful that fit the brief instead of being handed everything. This is the difference between Kimble getting smarter and Kimble getting more expensive.

**2. Picture intelligence** — the biggest quality and cost lever.
A tagged library (subject, industry, mood, colour, orientation, people or not, style, licence) with three sources in priority order: the curated library, anything the customer uploaded, then generation only when nothing fits. Chosen pictures are checked in the screenshots like any other element.

**3. Icon and font vocabulary.**
A fixed icon set chosen by meaning, with one stroke style per project and a check that every icon used actually exists. Fonts become their own library with pairings and personality, so typography can change without touching the structure.

**4. Header library and decorative treatments.**
Header variants to match the footers we already have, plus a small set of gradients, grids, noise and glass surfaces with a rule for when they help and when they are noise.

**5. Deeper visual review.**
Add a tablet width, and review again after a repair so a fix that breaks something else is caught before the customer sees it.

**6. Admin control.**
Bring identities, structures, sections, fonts, icons and pictures under the existing admin screen so you add a resource without a code change.

Everything not listed — the engineering agent, verification, self-repair, memory, revisions, publishing, database work, real-time progress — stays as built. Rewriting those would cost a lot and change nothing the customer sees.

## Deliberately out of scope for now

The document's own P2 list: GitHub sync, team workflows, advanced analytics. Also the separate "platform completeness" audit it proposes at the end (invoices, referrals, tickets, impersonation, activity logs) — that is a different project and mixing it in would slow this one down.

## Technical notes

- Registry: a metadata table per resource kind with tag columns and a text search index, plus a cached server-side loader so retrieval does not add build latency. Existing hardcoded records become seeded rows; the current typed constants stay as the seed source so nothing regresses if the table is empty.
- Retrieval, not prompting: each build step queries for the top few matching resources and the model selects among them. No resource dump in the system prompt.
- Pictures: ingest-time metadata, never build-time. Selection ranks on brief match, then orientation and colour fit against the chosen identity. Procedural placeholder stays the last resort.
- Icons: allow-list generated from the installed icon package, exposed as a lookup rather than a prompt dump, with a build-time existence check.
- Fonts: family, category, personality, weights, industries, pairings, licence; the identity references a pairing id instead of embedding font names, so re-theming swaps typography without touching structure.
- Visual review: add an 834px capture, and gate the second review pass to runs where a repair actually changed files so clean builds cost the same as today.
- Each step ships and is verified with real builds, not only passing checks.
