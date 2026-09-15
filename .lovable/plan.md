# Why Petal’s generated designs still look bare — and how to fix the engine

## The honest answer

The attached document describes a **closed software-creation loop**: understand the product, choose one design direction, plan the pages and assets, build, inspect the real result, repair it, and retest.

Petal currently has many of those parts, but they do not yet operate as one authoritative loop. The dashboard and restaurant site exposed that gap: Petal can satisfy code-level checks while still shipping a thin, generic design.

## What I confirmed in the current engine

### 1. Three separate systems choose the design

A first build currently receives:

- a Design Director direction;
- a separate Project Intelligence design system;
- another independently selected palette, font pair, and section/app pattern.

These are created through different code paths and can disagree. The coding model is told each is “locked” or “committed,” but there is no final arbiter. More instructions have therefore produced less clarity, not stronger art direction.

### 2. The fallback is safe, not distinctive

Both real builds hit the Design Director timeout. The fallback deliberately chooses balanced density, subtle motion, and two general-purpose moves such as large type and elevated cards. That prevents a completely unstyled result, but it does not provide enough domain-specific composition for a premium restaurant or a serious finance product.

### 3. Current enforcement checks correctness more than taste

The new design-system check catches raw colours, missing tokens, hardcoded hex values, and some font misuse. The composition check looks for the presence of a grid, surface, large heading, emphasis, and spacing.

A page can satisfy those checks with one heading, one grid, and a few plain cards. It can therefore be compliant while still being visually weak. The restaurant and dashboard are examples of that exact failure.

### 4. Petal does not require an asset plan before coding

The document correctly puts an **asset plan before implementation**. Petal can generate images when the coding model inserts an image placeholder, but nothing first decides which images the product needs and then verifies they exist.

The restaurant model simply chose no image placeholders. As a result, no food, venue, chef, gallery, or atmosphere photography was generated, even though imagery is essential to that category.

### 5. The browser-quality loop was open, not closed

Browser verification was silently skipped on real builds because it rejected the local address used during verification. That bug is fixed in source, but the builder must redeploy before the fix affects live builds.

More importantly, even when screenshots exist, craft findings are marked advisory. The build is still marked ready, and no automatic craft-repair turn is started. Petal can therefore detect “generic layout,” “default type,” or “flat hero” and still finish without correcting them.

### 6. Product coherence is not being judged

The finance dashboard’s empty “recent transactions” panel and populated transactions page are individually valid screens, but they contradict each other. Current checks inspect syntax, routes, isolated UI states, and visible defects; they do not yet ask whether the whole product tells one coherent story using one shared dataset.

### 7. The standards document is a map, not a checklist to paste into the prompt

The useful lesson is its sequence and feedback loop, not adding all 20+ layers to every generation prompt. Petal already has many named rules. Adding more prose would increase conflicts and token pressure. The fix is to make fewer decisions authoritative, convert them into concrete plans, and verify the rendered result against them.

## What I will change

### 1. Establish one canonical design contract

- Make the product understanding produce one domain-aware design brief.
- Make the Design Director own the visual direction.
- Derive the design system, palette, typography, component rules, and section choices from that same direction instead of selecting them independently.
- Persist and reuse that single contract on later turns.
- Replace the generic timeout fallback with strong category-specific directions for products such as restaurant, fintech, booking, marketplace, healthcare, and editorial.

### 2. Add page, composition, and asset plans before code

For every initial build, record:

- each page’s purpose and dominant visual hierarchy;
- the required content blocks and primary action;
- the visual asset needed in each important section;
- the app shell, density, table/list treatment, and mobile transformation;
- shared data sources used across related screens.

The coding pass will build against this plan rather than improvising each screen independently.

### 3. Make quality checks judge outcomes, not token presence

- Landing pages: verify the actual rendered sections, content depth, imagery, visual rhythm, and category fit—not component names.
- Product screens: verify meaningful KPIs, useful data density, styled tables/lists, clear hierarchy, and complete loading/empty/error states.
- Cross-page coherence: detect contradictory seeded data and require related screens to read from one shared source.
- Keep deterministic checks for accessibility, responsiveness, semantic tokens, working controls, and route completeness.

### 4. Close the screenshot-to-repair loop

- Deploy the corrected browser verifier and confirm it captures phone, tablet, and desktop views.
- Review representative public and signed-in pages.
- Feed confident craft findings into one focused repair pass before a build is called ready.
- Rebuild and recapture the affected pages after repair.
- Fail open only when the reviewer itself is unavailable; do not silently ignore a valid craft finding.

### 5. Prove the fixes with the four real apps

- Rebuild the finance dashboard and confirm real account KPIs, coherent transactions, polished data surfaces, and strong mobile layouts.
- Rebuild the restaurant site with a complete image-led home page and category-appropriate art direction.
- Build and audit the booking app with sign-in and important UI states.
- Build and audit the marketplace across enough pages to test consistency.
- Compare before/after screenshots at 390, 820, and 1440 pixels and record the remaining defects.
- Keep the test apps until the comparison is complete, then delete them.

## Scope

This changes the engine that creates Petal users’ apps. It does not redesign Petal’s own interface, alter pricing, or replace the current build/deployment architecture.
