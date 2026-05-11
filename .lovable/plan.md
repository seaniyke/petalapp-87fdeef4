## Goal

Take Petal from "builds ~25 archetypes well" to "builds ~500 distinct systems well, including web, mobile, fullstack, and aesthetics-driven sites" — without exploding prompt size or regressing first-shot quality.

## What Petal has today

- **25 templates** (`src/server/templates.server.ts`) — keyword-scored, picks one per build
- **21 themes** (`src/server/themes.server.ts`) with auto-selection from brief
- **~56 section blocks** across `scaffold-kit-blocks{,-2,-3}.ts` + atomic primitives
- **53 reference examples** in `examples-pack.ts` (auth, dashboard, hero, forms, tables, fintech)
- **Mobile primitives** in `scaffold-kit-mobile.ts` (SafeArea, tabbar, native header)
- **Auto-derived kit manifest** (`kit-manifest.server.ts`) — new primitives become visible the moment they ship
- **Brief expander** for vague prompts, **dynamic prompts** for topic reinforcement, **learning injector** for self-learning
- **High-stakes domain guard** (just shipped) for crypto/banking/trading

The pipeline is solid. The gap is **coverage breadth** and **per-domain depth**, not architecture.

## How leaders solve "build anything"

- **v0 (Vercel)**: huge block registry (~thousands), semantic match, blocks are the unit of generation
- **Bolt**: starter templates per stack + WebContainer — many narrow scaffolds beats one general one
- **Lovable**: vertical templates + per-domain examples in the system prompt
- **Replit Agent**: stack-specific scaffolds with embedded domain conventions
- **Common pattern**: the model never invents from zero — it **assembles from a library** keyed off intent

Petal already follows this pattern. We just need to grow the library 3–5× and route into it more intelligently.

## Plan

### 1. Taxonomy — define the 500 systems

Create `src/server/system-catalog.server.ts` as the source of truth. Organize by 25 verticals × ~20 archetypes each (~500). Each entry is light: id, label, parent template, route plan delta, domain notes, demo-vs-real flag.

Verticals: SaaS · Marketplaces · E-commerce · Content/Media · Education · Health/Fitness · Finance (demo) · Productivity · Social/Community · Creator tools · Local services · Real estate · Travel · Food · Events · Nonprofit · AI tools · Developer tools · Internal tools · Government/Civic · Legal · HR · Logistics · IoT/Hardware companion · Games/Entertainment.

Each archetype declares: routes, required blocks, domain-data shape, recommended theme, capability tier (`web` / `mobile-pwa` / `mobile-capacitor` / `fullstack`), reality tier (`real` / `demo-only` / `keys-required`).

### 2. Template registry — 25 → ~120 macro-templates

Templates remain the **rendered plan unit** (already shown to the model). Grow to ~120 high-leverage macros; the 500 system-catalog entries map to one of these + a small delta. Add: directory, classifieds, jobs board, two-sided rentals, subscription box, donation/crowdfunding, ticketing, membership, course-marketplace, AI agent builder, AI voice app, transcription, document Q&A, internal admin, B2B portal, vendor portal, helpdesk, knowledge base, wiki, status page, changelog, roadmap voting, feedback portal, A/B testing dashboard, IoT device dashboard, fleet/asset tracker, invoicing, expense tracker, time tracking, OKR/goals, retro board, kanban, gantt, calendar, scheduling, CMS, photography portfolio (variants for nine sub-niches), restaurant variants, salon/spa, gym booking, telehealth (demo), patient intake (demo), clinic site, real-estate broker site, coworking space, travel itinerary, tour operator, vacation rental host, recipe site, meal planner, podcast network, newsletter platform, link aggregator, alumni directory, member portal, association site, political campaign, fundraising thermometer, government services portal, civic petition, legal intake, contract signing demo, etc.

### 3. Section block library — ~56 → ~200

Add domain section blocks (each ≤120 lines, semantic-token only):
- **Commerce**: ProductGrid variants, CategoryCloud, ReviewStack, BuyBox, SizeGuide, ShippingEstimator, OrderTracker, WishlistRow
- **Content**: ArticleHero, TOC, AuthorByline, RelatedPosts, NewsletterCard, TagCloud, EditorNote
- **Media**: VideoPlayer shell, EpisodeRow, PlaylistGrid, PodcastChapter
- **Booking**: TimeSlotPicker, AvailabilityCalendar, PartySizeStepper, ConfirmationSummary
- **Education**: CurriculumOutline, LessonProgress, QuizCard, CertificateBadge, CohortRoster
- **Productivity**: KanbanColumn, GanttBar, TimelineEvent, RetroLane, OkrTree
- **Community**: ThreadHeader, ReplyTree, KarmaPill, ModBar
- **Profile/Identity**: AvatarStack, RoleBadge, MembershipTier, KycStepper (demo)
- **AI**: PromptComposer, ChatStream, CitationCard, AgentRunCard, ToolCallTrace
- **Fintech (demo only)**: BalanceHero, TxRow, SendSheet, PortfolioRow, AssetPicker
- **IoT/Ops**: DeviceTile, AlertBanner, MetricSparkline, LogTail, IncidentTimeline
- **Marketing**: AnnouncementBar, FeatureBento, MetricBand, ComparisonMatrix
- **Native-feel**: SegmentedControl, ListGroup, BottomSheet, ContextMenuMobile, PullToRefresh polish

These auto-register via the existing kit manifest — no prompt edits needed.

### 4. Examples pack — 53 → ~150 reference patterns

Add full-screen end-to-end reference flows (still no router, still presentational) for: marketplace listing flow, multi-tenant settings, AI chat with citations, voice recorder, file Q&A, kanban with DnD, calendar week view, video learning player, podcast episode, course curriculum page, donation funnel, multi-step KYC (demo), invoice editor, expense capture, OKR tree view, retro board, status page, changelog timeline, feature voting, helpdesk ticket detail, wiki editor, etc. Each becomes a copy-from seed for the model.

### 5. Aesthetics layer — 21 → ~50 themes + per-vertical pairing

Add: `editorial-serif-light`, `magazine-bold`, `swiss-grid`, `bauhaus`, `art-deco`, `memphis`, `risograph`, `claymorphism`, `acid-graphic`, `quiet-luxury`, `wabi-sabi`, `solarpunk`, `cottagecore`, `dark-academia`, `cyber-zen`, `frosted-aurora`, `paper-cut`, `editorial-photo`, `monochrome-color-pop`, `neumorphism-soft`, `print-newspaper`, `vintage-poster`, `data-dense-bloomberg`, `apple-glass-2026`, plus motion presets (`subtle`, `playful`, `dramatic`, `none`).

Add `themePairings` — each archetype declares its 3 best themes with rationale; the design director picks one. This is what makes outputs **not look like every other Petal site**.

### 6. Domain knowledge packs

New file `src/server/domain-packs.server.ts`. For each vertical, ~150-word block injected ONLY when matched: data shapes (e.g. an order vs a subscription vs an invoice), state machines (booking → confirmed → fulfilled → reviewed), terminology, common pitfalls, "what users actually expect to see on day 1". Keeps prompt small (one pack per turn, not 25).

### 7. Smarter routing — semantic, not just regex

Current scoring is keyword-only. Add a tiny embeddings-free **semantic mapper** in `system-catalog.server.ts`: lowercased brief → top-3 archetypes by token overlap + synonym table (e.g. "barber" → salon-booking, "tutor" → 1:1-booking + lessons, "shop" → ecommerce-store-variant). Falls back to keyword scoring; no model call needed for the common case. Above ~80 chars or low confidence, the existing brief expander still runs.

### 8. Mobile + native expansion

- Promote `scaffold-kit-mobile.ts` to a full mobile pack: tab-bar variants, modal sheet stack, native list groups, swipe-to-delete row, segmented control, action sheet
- Add a `mobile-app` capability tier on every archetype that makes sense mobile-first
- Add a Capacitor wiring example (already partially in mobile-builds), and a "PWA install banner" block
- Detect "mobile/iOS/Android" in brief → force mobile-first layout + bottom-tab nav

### 9. Reality / capability matrix

Every archetype declares a `realityTier`. The system prompt receives a one-line guardrail per build:
- `real` → no caveats
- `demo-only` → injects DEMO banner rule (already used by fintech)
- `keys-required` → tells the model which connector or env var unlocks the real version

This is what prevents the "looks real, isn't" failure across the new 500 systems, not just fintech.

### 10. Golden-app verification — prove the 500 actually build

Extend `src/server/__tests__/golden-apps/prompts.ts` from 10 to ~60 representative prompts (one per macro-template family). Add a CI-style script that builds them headlessly via the staged pipeline and asserts: files emitted, expected route paths exist, no `Cannot apply unknown utility class`, no missing-import errors, theme matches expected family. Anything below ~85% pass is a regression. This is the only way "we cover 500 systems" stops being a marketing claim.

### 11. Telemetry + self-learning loop closes itself

The existing self-learning digest already pulls top failure signatures into the prompt. Add per-archetype tagging when triage classifies a build, so digests can say "trading-dashboard-demo failed 4× last week with X" — operator notes then auto-flow into the next build.

## Technical detail (for implementation, not the user)

Files added: `system-catalog.server.ts`, `domain-packs.server.ts`, `theme-pairings.ts`, `semantic-router.ts`, expanded `scaffold-kit-blocks-{4,5,6}.ts`, expanded `examples-pack-{2,3}.ts`, expanded `golden-apps/prompts.ts`. Files edited: `templates.server.ts` (grow registry), `themes.server.ts` (add ~30), `dynamic-prompts.server.ts` (wire domain packs), `triage.ts` + `generate.ts` (route through semantic mapper, inject reality-tier guardrail), `pipeline-telemetry.server.ts` (tag with archetype id).

## Sequencing (so it ships in usable slices, not one mega-PR)

1. **Foundation** — `system-catalog.server.ts` + semantic router + reality-tier guardrail. Unlocks 500 IDs even before all blocks exist.
2. **Template growth** — 25 → 60 templates covering the highest-volume Lovable trends.
3. **Block + examples expansion** — bring kit + examples to ~120 / ~100, paired to new templates.
4. **Aesthetics** — add 15 themes + theme pairings.
5. **Mobile pack v2** — full native-feel coverage.
6. **Domain packs** — per-vertical knowledge injection.
7. **Golden-apps verifier** — 60 prompts, CI script, fail-the-build threshold.
8. **Continuous** — extend templates 60 → 120, blocks 120 → 200, examples 100 → 150, themes → 50.

Each step ships independently and improves quality even if later steps don't land.

## Out of scope

Real custody of crypto, real money movement, real KYC/AML, real broker order routing, native iOS/Android compilation beyond Capacitor, Figma import, hand-drawn wireframe import. These stay flagged via the reality tier and stay out of the catalog as `real`.

## Risk register

- **Prompt-size blow-up**: mitigated by per-turn injection (one domain pack, one template plan, ≤6 dynamic snippets). Hard cap stays in `context-budget.server.ts`.
- **Block sprawl**: mitigated by auto-derived kit manifest — no prompt edit needed when adding blocks.
- **Quality regression on small builds**: mitigated by golden-app gate before merge.
- **Aesthetic homogeneity**: mitigated by theme pairings + design-director randomization within the pairing set.
