# Petal Frontend UI — Gap Analysis & Capability Roadmap

Senior-engineer audit of what a 2026 AI app builder should compose vs. what Petal's scaffold currently ships. Verdict at a glance: **Petal has a strong shadcn baseline and 60+ composed blocks, but is missing almost every "wow" capability that separates Awwwards-class output from generic AI sites — real motion, scroll, 3D, gradient meshes, typography animation, command palette, data table, and the marketing-effects layer (MagicUI / Aceternity).**

This plan is a research artifact + prioritized roadmap. No code yet — once approved we pick which lanes to ship first.

---

## 1. What Petal ships today

| Category | Status | Detail |
|---|---|---|
| shadcn primitives | 🟢 Strong (38/59) | All core primitives present + hand-rolled Drawer, Calendar, Combobox, DatePicker, InputOTP, Pagination (zero-dep) |
| Icons | 🟢 Lucide ^0.460 + curated 200-icon registry, Levenshtein fuzzy match, react-icons → lucide aliasing |
| Themes | 🟢 21 named themes (editorial, brutalist, glass-morphism, cyberpunk-neon, y2k-bubble…) w/ font pairs + oklch palette |
| Typography | 🟡 Domain-driven font picks via Design Director; Google Fonts via `<link>`; no variable-font / fluid-type system |
| Section blocks | 🟢 60+ blocks (hero variants, bento, marquee logos/testimonials, pricing/comparison, FAQ, stats, dashboard shell, commerce, kanban, social feed, link-in-bio, podcast, LMS, calendar, portfolio, AI chat, donate, restaurant menu, heatmap, price ticker) |
| Animations | 🔴 Pure CSS only — `animate-pulse`, marquee keyframes, hover-scale. **No framer-motion in kit.** Design Director merely *suggests* it via prompt. |
| Forms | 🟡 All inputs + Combobox + DatePicker + MultiStepWizard + FileUploadDropzone. RHF on-demand only. No `Form` integration tested. |
| Charts | 🟡 Hand-rolled Line/Area/Bar SVG. Recharts on-demand. |
| Mobile | 🟢 SafeArea, MobileHeader, BottomTabBar, PullToRefresh, MobileScreen, MobileNav |
| Routing | 🟢 react-router-dom re-export wrapper |

## 2. What Petal is MISSING (the gap)

### Tier A — Build-killers for "beautiful" output (ship first)

1. **Real motion layer.** Zero framer-motion / Motion v12 in kit. Every Awwwards site uses it. Petal generates beautiful screenshots but dead pages.
2. **Smooth scroll (Lenis) + scroll-driven reveals.** Single biggest "feels expensive" signal on modern sites. Missing entirely.
3. **Marketing effects library (MagicUI/Aceternity surface).** Aurora text, animated beam, border beam, meteors, sparkles, particles, light rays, retro grid, flickering grid, dot pattern, ripple, magic card, shimmer button, number ticker, word rotate, morphing text, text reveal, blur fade, marquee w/ mask, orbiting circles, globe, dock, bento grid w/ depth, hero parallax, infinite moving cards. **None shipped.**
4. **Gradient meshes / noise / glass 2.0.** Only flat `GradientBlob` exists. No conic-gradient meshes, no SVG turbulence noise, no proper claymorphism, no neo-brutalist preset (theme exists but no block primitives).
5. **Typography animation primitives.** SplitText-style char/word/line wrappers, count-up KPI, kinetic typography — all absent. Heroes look static.
6. **Missing shadcn primitives (21 of 59):** Breadcrumb, Carousel (Embla), Chart (Recharts wrapper), Collapsible, Command (cmdk palette), Context Menu, Data Table (TanStack), Field, Hover Card, Input Group, Item, Menubar, Native Select, Navigation Menu (flyout), Resizable, Sidebar (full collapsible system w/ context), Spinner, Toggle, Toggle Group, Aspect Ratio, Empty.
7. **No command palette (⌘K).** Table-stakes for any SaaS/AI app in 2026.

### Tier B — "Solid" gaps (substance, not surface)

8. **TanStack Query + Zustand wiring.** On-demand only. No standard data-fetching pattern shipped → models invent ad-hoc `useEffect` + fetch.
9. **TanStack Table** + Data Table block. Petal's `Table` is HTML-only; no sort/filter/pagination/virtual rows.
10. **react-day-picker integration.** Petal's hand-rolled Calendar is functional but missing range selection, multiple months, locale, ISO weeks.
11. **Vaul Drawer.** Petal hand-rolls a non-spring drawer; mobile feel is off.
12. **nuqs** for URL-synced filters/tabs. Universal in 2026 SaaS.
13. **TipTap / Lexical** for any content-editing surface (notes, CMS, AI prompt history, comments).
14. **Shiki** for code blocks (Petal's `CodeBlock` is read-only `<pre>`, no syntax highlight).
15. **react-hook-form + zod resolver** as default in form blocks (BookingForm, DonateForm, ContactForm, auth).
16. **Sidebar (shadcn full system).** Petal's `SidebarShell` is a static layout — no collapse-to-icon, no mobile sheet swap, no nested groups with active route highlight.

### Tier C — Awwwards-class (opt-in per project)

17. **3D / WebGL primitives.** R3F + drei + postprocessing, Spline embed, OGL shaders. Currently zero. Needed for hero scenes, product showcases.
18. **GSAP + ScrollTrigger + SplitText** (now fully free post-Webflow). The choice for cinematic landing pages.
19. **Lottie / Rive** for designer-built micro-animations.
20. **Mapbox/MapLibre + react-map-gl + deck.gl** — Petal has `MapPlaceholder` SVG only.
21. **Spline / iframe 3D embeds** as a one-liner block.
22. **canvas-confetti** delight on success states.
23. **View Transitions API** wrapper for route changes (Safari 26 ships Jun 2026 — full cross-browser).

### Tier D — Plumbing & defaults

24. **Variable fonts via Fontsource** (self-hosted, no Google Fonts CDN hop, no CLS). Petal currently injects via `<link>` — slower + privacy concern.
25. **Fluid typography (Utopia-style clamp tokens)** in styles.css. Currently fixed rem values.
26. **Container queries** baked into block primitives.
27. **ThumbHash / BlurHash** placeholders for image loading.
28. **next-themes-equivalent** for TanStack (Petal's ThemeProvider is custom; misses no-flash SSR pattern).
29. **react-intersection-observer hook** as a scaffold export — currently models hand-roll IntersectionObserver each time.
30. **react-aria** for any custom widget the model invents (date range, slider thumb, combobox keyboard).
31. **axe-core/react** dev-time a11y audit hook.
32. **OG image generation via satori / @vercel/og** for shareable links.

---

## 3. Proposed Roadmap (phases, in execution order)

Each phase: scaffold-kit additions + `known-packages.ts` pins + `design-director.server.ts` triggers + a few hand-composed reference blocks. No model retries — these are deterministic capabilities the model can compose.

### **Phase 10 — Motion baseline (Tier A #1, #5)** ✅ shipped
- Hard-add `motion@^12` (Motion for React) to required deps.
- Ship `src/components/motion/` primitives: `FadeIn`, `SlideUp`, `Stagger`, `Reveal` (viewport-scroll), `Magnetic`, `Tilt`, `Parallax`, `SplitText` (chars/words/lines), `CountUp`, `WordRotate`, `MorphingText`, `BlurFade`.
- Wire into existing hero/feature/CTA blocks behind a `motion={'on'|'off'}` prop (default on).
- Design Director auto-enables expressive motion for editorial/creative/agency domains.

### **Phase 11 — Marketing FX layer (Tier A #3, #4)** ✅ shipped
- Ship `src/components/fx/`: `AnimatedBeam`, `BorderBeam`, `Meteors`, `Sparkles`, `Particles`, `LightRays`, `RetroGrid`, `FlickeringGrid`, `DotPattern`, `GridPattern`, `Ripple`, `MagicCard`, `ShimmerButton`, `RainbowButton`, `AuroraText`, `GradientText`(v2 animated), `NoiseTexture`, `OrbitingCircles`, `Marquee`(v2 with mask + 3D variant), `BentoGrid`(v2 with hover lift + glow), `HeroParallax`, `InfiniteMovingCards`.
- All zero-dependency (CSS keyframes + SVG) where possible; `motion` for the few that need it.

### **Phase 12 — Missing shadcn primitives (Tier A #6, #7)** ✅ shipped
- Add: Breadcrumb, Carousel (Embla — hard-add), Chart (Recharts wrapper — hard-add), Collapsible, Command (cmdk — hard-add), Context Menu, Data Table block (TanStack Table — hard-add), Hover Card, Input Group, Menubar, Navigation Menu, Resizable, Sidebar (full system), Spinner, Toggle, Toggle Group, Aspect Ratio, Empty, Field.
- Replace hand-rolled Calendar with react-day-picker v10 integration (keeps API).
- Replace hand-rolled Drawer with Vaul.

### **Phase 13 — Data + state defaults (Tier B #8, #9, #12)** ✅ shipped
- TanStack Query `QueryClient` + `<AppProviders>` wrapper (composes QueryClientProvider, NuqsAdapter, sonner Toaster) at `@/components/providers/app-providers`.
- Zustand example store (typed + persisted) at `@/lib/stores/example-store`.
- nuqs `useQueryState` / `useQueryStates` re-export at `@/hooks/use-query-state` (URL-synced tabs, filters, dialogs).
- `DATA_PATTERNS.md` reference doc the model copies from instead of inventing `useEffect + fetch`.
- Data Table block shipped in Phase 12 (TanStack Table) — sort/filter/pagination already wired.
- `@tanstack/react-query`, `@tanstack/react-table`, `zustand`, `nuqs` promoted to REQUIRED_DEPS so every project installs them.

### **Phase 14 — Typography system (Tier D #24, #25)** ✅ shipped
- Self-hosted variable fonts: `@fontsource-variable/inter` + `@fontsource-variable/jetbrains-mono` in REQUIRED_DEPS, `@import`-ed at the top of `STYLES_CSS`. Zero CDN hop, zero CLS.
- Font tokens: `--font-sans`, `--font-display`, `--font-serif`, `--font-mono` declared in `@theme` so the AI overrides one variable per theme instead of editing component code.
- Utopia-style fluid type scale: `--text-step--1` through `--text-step-6` (`clamp()` between 320px and 1280px viewport) + matching `.text-step-*` utility classes with paired line-height and tracking.
- Tracking presets `--tracking-tightest/-er/-light` for display type.
- `KNOWN_PACKAGES` extended with 30+ Fontsource Variable packages (instrument-serif, cormorant, space-grotesk, dm-serif-display, lora, libre-baskerville, syne, urbanist, bricolage-grotesque, archivo-black, abril-fatface, bebas-neue, etc.) — on-demand install per theme.
- `FONTS.md` reference shipped at `@/components/examples/FONTS.md` mapping domain → font-pair recipe.

### **Phase 15 — Content & code surfaces (Tier B #13, #14)** ✅ shipped
- `@/components/content/shiki-code-block` — real Shiki highlighting, lazy per-language grammars, github-light/dark via CSS vars, copy button, optional filename + line numbers.
- `@/components/content/markdown-view` — react-markdown + remark-gfm (tables, task lists, strikethrough, autolinks), fenced code routed through ShikiCodeBlock, tailwind-prose-style inline styling that respects fluid type tokens.
- `@/components/content/rich-text-editor` — TipTap (ProseMirror) WYSIWYG with StarterKit + Link + Placeholder, floating BubbleMenu toolbar (bold/italic/strike/code/H1-3/lists/quote/link), undo-redo footer.
- `shiki`, `react-markdown`, `remark-gfm`, `rehype-raw`, `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-link/placeholder/image/task-list/task-item` registered in `known-packages.ts` (on-demand only — not auto-installed; pulled in when the file is imported).

### **Phase 16 — Awwwards layer, opt-in (Tier C)** ✅ shipped (Mapbox deferred)
- `@/components/three/scene` — opinionated R3F `<Canvas>` with lights, camera, HDRI environment, optional orbit controls.
- `@/components/three/floating-mesh` — drei `<Float>` mesh with `MeshDistortMaterial` (icosahedron / torus / torusKnot / box / sphere).
- `@/components/three/hero-sphere` — one-liner hero centerpiece (absolute-positioned Scene + FloatingMesh).
- `@/components/three/spline-embed` — lazy-mounted Spline scene runtime for designer-shipped `.splinecode` URLs.
- `@/components/scroll/lenis-provider` — smooth-scroll provider, reduced-motion aware, exposes instance on `window.__lenis` for GSAP sync.
- `@/hooks/use-scroll-scene` — GSAP context scoped to a ref with auto-cleanup, re-exports `gsap` + `ScrollTrigger`.
- `@/hooks/use-horizontal-scroll` — pinned horizontal scroll track (Awwwards staple).
- `@/lib/confetti` — `celebrate()`, `celebrateCannons()`, `celebrateFrom(el)`.
- `@/lib/view-transitions` — `withViewTransition()` + `navigateWithTransition()` (Safari 26 ships June 2026 → full cross-browser).
- `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing`, `@splinetool/react-spline` + runtime, `gsap`, `lenis`, `canvas-confetti` registered in `known-packages.ts` (on-demand, not auto-installed).
- Mapbox/MapLibre `MapBlock` deferred — pulled out into a future "geo" phase since it needs env-keyed config.

### **Phase 17 — A11y + image quality (Tier D #27, #30, #31)**
- ThumbHash placeholder helper for `<img>` + lazy reveal.
- react-aria primitives for any custom widget model invents (auto-wrapped via repair-all).
- Dev-only axe-core hook.

### **Phase 18 — Design Director upgrades**
- Teach the Director when to compose FX layer (e.g. crypto + cyberpunk theme → meteors + retro grid + aurora text + shimmer buttons; SaaS + nordic-minimal → blur fade + magnetic CTAs only).
- Per-domain motion intensity (calm / standard / expressive / cinematic).
- Auto-pick MagicUI-equivalent components from prompt vibe.

---

## 4. Sequencing logic

- **10 → 11 → 12** unlocks the visible "this looks 2026" jump. Three phases = the entire perceived quality gap.
- **13 → 14 → 15** is the substance layer — apps stop feeling like demos.
- **16** is the Awwwards reach; gated per-project because heavy.
- **17 → 18** are polish + intelligence.

Each phase = its own focused PR (mirrors Phases 4–9 cadence). Each adds: scaffold files (overwrite:true), `known-packages.ts` entries with pinned versions, optionally `repair-all` integration, and Design Director triggers.

---

## 5. What I need from you

Pick one of:
- **(A)** "Ship Phase 10 next" — start with motion baseline (highest ROI).
- **(B)** "Ship Phase 11 next" — start with MagicUI FX layer (biggest visual impact).
- **(C)** "Bundle 10+11+12 as one big visual jump" — bigger PR but the model gets the full new vocabulary at once.
- **(D)** Reorder / drop phases — tell me which.

Once you pick, I'll write the phase plan and implement.