/**
 * App-UI design language.
 *
 * `design-taste.server.ts` + `section-library.server.ts` give landings a
 * locked palette, a locked type pair, refused clichés and a menu of section
 * variants. Product screens — dashboards, CRUD tables, forms, detail views,
 * settings, ERP consoles — got none of that: they inherited only the generic
 * mechanics floor, which is exactly why Petal's app screens have looked
 * plainer than its landings.
 *
 * This module is the app-side twin: a variant catalog for *product* surfaces
 * plus a taste block that commits the build to one shell, one density, one
 * elevation scale, and a signature product moment.
 *
 * Pure string rendering — no I/O, no model call. Injected additively into the
 * dynamic prompt suffix whenever the project is app-shaped.
 */

import { pickDesignForBrief, type DesignPick } from "./palette-presets.server";

export interface AppUiVariant {
  id: string;
  surface:
    | "shell"
    | "data-table"
    | "filters"
    | "detail"
    | "form"
    | "metrics"
    | "state"
    | "settings"
    | "activity";
  label: string;
  description: string;
}

export const APP_UI_VARIANTS: AppUiVariant[] = [
  // SHELL
  { id: "shell-sidebar", surface: "shell", label: "Collapsible sidebar", description: "Left sidebar (240px, collapses to a 56px icon rail) with grouped nav + workspace switcher at top and user menu pinned at the bottom. Content area has a slim breadcrumb bar with page title and primary action on the right." },
  { id: "shell-rail-topbar", surface: "shell", label: "Icon rail + topbar", description: "Narrow 64px icon rail on the left for top-level areas, plus a full-width topbar carrying breadcrumb, global search, notifications and avatar. Best for apps with 4-6 top-level areas and deep sub-navigation." },
  { id: "shell-command-centre", surface: "shell", label: "Command centre", description: "Dense dark-surface shell: sidebar + persistent right-hand context rail (selected record, live activity, quick actions). Keyboard-first, ⌘K command palette, everything reachable without a mouse." },
  { id: "shell-topnav", surface: "shell", label: "Top nav + sub-tabs", description: "No sidebar. Top nav for top-level areas, a second row of sub-tabs per area, content in a centered max-w-7xl container. Best for lighter tools with under 6 sections." },

  // DATA TABLE
  { id: "table-dense-grid", surface: "data-table", label: "Dense operational grid", description: "Compact rows (h-10), sticky header, sticky first column, zebra-free with hairline row borders, right-aligned numerics with tabular-nums, per-row overflow menu, row click opens detail. Column widths intentional, never all-equal." },
  { id: "table-comfortable", surface: "data-table", label: "Comfortable record list", description: "Taller rows (h-14) with a leading avatar/thumb, two-line primary cell (title + muted subtitle), status pill column, trailing chevron. Reads like a list, behaves like a table." },
  { id: "table-grouped", surface: "data-table", label: "Grouped / sectioned table", description: "Rows grouped under collapsible section headers (by status, owner, date bucket) with a per-group count and subtotal row. Ideal for ERP ledgers and pipeline views." },
  { id: "table-board", surface: "data-table", label: "Board (kanban) view", description: "Column-per-status board with draggable cards, per-column count and WIP total, and a view switcher back to the table. Only when records genuinely move through stages." },

  // FILTERS
  { id: "filter-toolbar", surface: "filters", label: "Toolbar filter bar", description: "Single row above the table: search input (with ⌘K hint), 2-4 faceted dropdowns, a date-range picker, active filters rendered as removable chips below, and a right-aligned 'New' primary button + export icon button." },
  { id: "filter-sidebar", surface: "filters", label: "Faceted sidebar", description: "Left filter panel with checkbox facets and counts, results count and sort control above the grid. Use for catalogs and inventory with many facets." },
  { id: "filter-saved-views", surface: "filters", label: "Saved views tabs", description: "Row of view tabs (All / Mine / Overdue / Archived) with counts, plus an overflow 'Filter' popover for ad-hoc conditions." },

  // DETAIL
  { id: "detail-drawer", surface: "detail", label: "Side drawer", description: "Right-side drawer (max-w-xl) over the list: header with title + status + actions, tabbed body, sticky footer actions. List stays visible behind. Best when users scan-and-peek." },
  { id: "detail-page-two-col", surface: "detail", label: "Two-column record page", description: "Full page: left column is the record body (tabs: Overview / Activity / Files), right column is a sticky 320px metadata rail (status, owner, dates, linked records). Breadcrumb + prev/next record navigation in the header." },
  { id: "detail-split", surface: "detail", label: "Master-detail split", description: "Persistent list on the left (list stays scrollable, selection highlighted), detail pane on the right. Inbox-style; best for triage workflows." },

  // FORM
  { id: "form-single-column", surface: "form", label: "Single column", description: "Max-w-2xl single column, sections separated by labelled dividers, help text under each field, sticky action bar at the bottom with Cancel + Save. Never a two-column form on mobile." },
  { id: "form-two-pane", surface: "form", label: "Form + live preview", description: "Left: form fields. Right: a sticky live preview/summary card that updates as the user types. Best for anything that produces an artifact (invoice, email, listing)." },
  { id: "form-stepper", surface: "form", label: "Stepper wizard", description: "Numbered step rail (horizontal on desktop, compact progress dots on mobile), one logical group per step, Back/Continue in a sticky footer, review step before submit." },
  { id: "form-inline-edit", surface: "form", label: "Inline record editing", description: "Fields render as read-only text until clicked, then become inputs in place with autosave and a subtle 'Saved' timestamp. No modal, no separate edit page." },

  // METRICS
  { id: "metric-kpi-row", surface: "metrics", label: "KPI row", description: "3-5 metric cards across the top: big tabular-nums value, label above, delta chip with direction colour, and a 40px sparkline. Consistent card height, no icon soup." },
  { id: "metric-hero-chart", surface: "metrics", label: "Hero chart + side stats", description: "One large primary chart (area or bar) occupying two-thirds, with a stacked stat list on the right third. Range selector in the chart header." },
  { id: "metric-bento", surface: "metrics", label: "Bento dashboard", description: "Mixed-size tiles: one large chart tile, two medium list tiles (top items, recent activity), and small KPI tiles. Every tile has a clear title and a link to its full view." },

  // STATES
  { id: "state-triad", surface: "state", label: "Empty / loading / error triad", description: "EVERY data surface ships all three: skeleton rows matching the real row height while loading; an empty state with an illustration or icon, one sentence explaining what will appear here, and the primary action button; an error state with a plain-language line and a Retry button. Never a bare spinner, never a blank panel." },
  { id: "state-first-run", surface: "state", label: "First-run onboarding", description: "When the workspace has zero records, replace the table with a short setup checklist (3-4 items with checkmarks) instead of an empty grid." },

  // SETTINGS
  { id: "settings-sectioned", surface: "settings", label: "Sectioned settings", description: "Left sub-nav of setting groups, right column of cards, each card: title + description on the left, control on the right, destructive actions isolated in a red-bordered 'Danger zone' card at the bottom." },
  { id: "settings-tabbed", surface: "settings", label: "Tabbed settings", description: "Horizontal tabs (Profile / Team / Billing / Notifications / API) with a max-w-3xl body per tab and per-tab save state." },

  // ACTIVITY
  { id: "activity-timeline", surface: "activity", label: "Activity timeline", description: "Vertical timeline with avatars, actor + verb + object lines, relative timestamps, and day dividers. Comment composer pinned at the bottom when discussion is supported." },
  { id: "activity-feed-cards", surface: "activity", label: "Feed cards", description: "Card-per-event feed with type icon, one-line summary, and expandable detail. Use when events carry payloads worth inspecting." },
];

function group(surface: AppUiVariant["surface"]): AppUiVariant[] {
  return APP_UI_VARIANTS.filter((v) => v.surface === surface);
}

const SURFACE_TITLES: Record<AppUiVariant["surface"], string> = {
  shell: "App shell",
  "data-table": "Record list / table",
  filters: "Filtering + toolbar",
  detail: "Record detail",
  form: "Create / edit form",
  metrics: "Dashboard metrics",
  state: "Empty, loading, error",
  settings: "Settings",
  activity: "Activity / history",
};

/** The variant menu, rendered as a prompt block. */
export function renderAppUiLibraryBlock(): string {
  const order: AppUiVariant["surface"][] = [
    "shell",
    "data-table",
    "filters",
    "detail",
    "form",
    "metrics",
    "state",
    "settings",
    "activity",
  ];

  const body = order
    .map((surface) => {
      const lines = group(surface)
        .map((v) => `   - ${v.id} (${v.label}): ${v.description}`)
        .join("\n");
      return `${SURFACE_TITLES[surface]}:\n${lines}`;
    })
    .join("\n\n");

  return `\n\n[App-UI variant library — pick ONE variant per surface, then build it fully]
Pick deliberately based on this product's actual workflow, state your picks in one short line of your reply, and then execute them consistently on every screen. Do not blend two shell variants, and do not fall back to "a table with three fake rows".

${body}

Rules for using this library:
  - The shell you pick applies to EVERY app route. Nav items are the real routes of this product, never "Dashboard / Analytics / Settings" filler.
  - Whatever table variant you pick, the columns are the entity's real fields, and the row count in seeded/demo data is 8-20 — never 3.
  - The state triad (state-triad) is MANDATORY on every data surface. It is not optional and not a "nice to have".
  - Detail, create, and edit surfaces must exist for the primary entity. A list with no way to open or add a record is an unfinished app.`;
}

/**
 * Product-screen taste commitments. The app-side counterpart of TASTE_BODY.
 */
const APP_TASTE_BODY = `\n\n[Reinforcement — Product UI craft (READ BEFORE WRITING ANY APP SCREEN)]
This project is an application, not a landing page. It is judged on whether it looks like a real product a team uses daily — Linear, Vercel, Stripe, Height, Attio class — not a template dashboard. Every app screen you write this turn must satisfy ALL of the following:

1. One shell, one density. Pick a shell variant and a density (compact for operational/ERP tools, comfortable for consumer-facing apps) and hold it across every route. Row heights, control heights, and paddings must be consistent app-wide: controls h-9 (compact) or h-10 (comfortable), never a mix of h-8, h-11 and h-12 on the same screen.

2. Real information density. Product screens are ALLOWED to be dense. Do not pad an app screen with landing-page whitespace. A table should show 12+ rows above the fold on a laptop. Do not wrap every field in an oversized card.

3. Typography does the hierarchy work. Page title text-xl/2xl semibold; section labels text-xs uppercase tracking-wide text-muted-foreground; body text-sm; numbers ALWAYS \`tabular-nums\` and right-aligned in tables. No text-xs body copy. Truncate long cells with \`truncate\` + a title attribute, never let a table blow out horizontally.

4. Restrained colour. The locked palette below is the whole palette. Colour carries MEANING in an app: primary = the one primary action per screen, plus semantic success/warning/danger for status only. Status is a pill with a dot, never colour-only text (accessibility). Backgrounds stay neutral surfaces; do not tint whole panels with the accent.

5. Elevation and borders, chosen once. Pick a scale and hold it: either hairline borders on flat surfaces (\`border border-border bg-card\`) OR soft shadows (\`shadow-sm\`), not both stacked. Radius is consistent (rounded-lg or rounded-xl app-wide). No glassmorphism inside data-heavy screens.

6. Every surface has its three states. Skeletons matching real row heights while loading, a designed empty state with a primary action, and an error state with a Retry. A blank white panel while data is missing is a defect.

7. Controls behave. Buttons show a pending state on submit and disable to prevent double-submit. Forms validate inline on blur with the message under the field. Destructive actions require a confirm dialog. Every icon-only button has an aria-label. Focus rings visible on every interactive element.

8. Keyboard and scan-ability. Add ⌘K search when the app has more than 3 routes. Tables support click-to-open rows. Sticky table headers on scroll. Sticky page header with the primary action.

9. Mobile is a first-class layout, not a squeeze. Below \`md\`: sidebar becomes a sheet behind a menu button; tables become stacked record cards (label + value rows), NEVER a horizontally scrolling grid; the primary action becomes a full-width button or a bottom-anchored bar; filters collapse into a sheet. Touch targets ≥44px. Check every app screen mentally at 390px before emitting.

10. Signature product moment. Every app gets ONE: a command palette, inline row editing with autosave, a live-updating summary rail, a keyboard-driven quick-add, or a well-crafted onboarding checklist. Pick one and execute it properly.

Refused app clichés — DO NOT ship any of these:
   - A dashboard whose only content is 4 identical KPI cards over one placeholder chart.
   - Nav items named "Dashboard / Analytics / Reports / Settings" when the product is about something specific.
   - Lorem ipsum, "John Doe", "Item 1/2/3", or \`$0.00\` placeholder rows.
   - A table with 3 rows and no empty/loading state.
   - Random emoji as feature icons.
   - Charts with fake, unlabelled axes, or a chart that shows the same data as the KPI above it.
   - A settings page with switches that do nothing.
If your draft violates ANY of the above, REWRITE before emitting.`;

export interface AppUiBlockResult {
  text: string;
  pick: DesignPick;
}

/**
 * Full app-UI block: product-craft commitments + locked palette/type +
 * the variant library. Mirrors `renderDesignTasteBlock` for app builds.
 */
export function renderAppUiBlock(brief: string): AppUiBlockResult {
  const pick = pickDesignForBrief(brief);
  const [bg, surface, accent, accentSoft] = pick.palette.colors;

  const lockedBlock = `\n\n[LOCKED design tokens for this project — use verbatim]
Palette: ${pick.palette.label} — ${pick.palette.vibe}
  app background / canvas : ${bg}
  panel / card surface    : ${surface}
  primary (actions, focus): ${accent}
  primary soft (hover, selected rows, chart fill): ${accentSoft}

Type pair: ${pick.fontPair.label}
  display / headings: "${pick.fontPair.display}"
  body / UI         : "${pick.fontPair.body}"

Wire these once, in \`src/styles.css\`, as semantic tokens (\`--background\`, \`--card\`, \`--primary\`, \`--primary-glow\`, \`--font-display\`, \`--font-body\`) and derive \`--foreground\`, \`--muted\`, \`--muted-foreground\`, \`--border\`, \`--ring\` from them with proper contrast in BOTH light and dark. Load the fonts with a \`<link>\` tag in the root route head — never \`@import\` a URL in CSS. Then use ONLY semantic classes (\`bg-background\`, \`text-foreground\`, \`bg-card\`, \`border-border\`, \`text-primary\`) in components. No \`text-white\`, no \`bg-black\`, no \`bg-[#...]\`, no indigo-500 fallback.

Chart palette: derive 4-6 series colours from ${accent} and ${accentSoft} (vary lightness/chroma, keep hue family). Never rainbow defaults.

Archetype tags: ${pick.archetypeTags.join(", ")}`;

  return { text: APP_TASTE_BODY + lockedBlock + renderAppUiLibraryBlock(), pick };
}

/**
 * Screen checklist — the app surfaces that must exist for a data-shaped
 * build. Kept exported so the quality gate can check for them too.
 */
export const APP_SCREEN_KEYWORDS = {
  shell: /\b(AppShell|AppLayout|DashboardLayout|Sidebar|AppSidebar|SidebarProvider)\b/,
  list: /\b(Table|DataTable|RecordList|List(View|Page)?|Grid(View)?|Board)\b/,
  detail: /\b(Detail|Record(View|Page)|Drawer|Sheet|Profile(View|Page)?)\b/,
  form: /\b(Form|Create|Edit|New[A-Z]|Dialog)\b/,
  emptyState: /\b(EmptyState|NoResults|no results|nothing here|Get started)\b/i,
  loading: /\b(Skeleton|isLoading|isPending|Loading)\b/,
  error: /\b(ErrorState|isError|Retry|try again)\b/i,
};

export function renderAppScreenChecklistBlock(): string {
  return `\n\n[App screen checklist — required for any app/dashboard/CRUD/ERP build]
The build is incomplete unless ALL of these exist as real files:
  1. App shell        (\`src/components/layout/\` — sidebar or rail, real routes, mobile sheet)
  2. Overview screen  (KPIs/metrics that reflect the seeded data, not invented numbers)
  3. List screen      (per primary entity: table or board + toolbar filters + search)
  4. Detail surface   (drawer or record page for the primary entity)
  5. Create + edit    (form variant from the library, inline validation, pending state)
  6. Empty / loading / error states on every data surface
  7. Settings         (only real, wired settings — no dead switches)
  8. Seeded demo data (8-20 realistic rows per entity, plausible names, dates, amounts, currencies)

If the product has multiple entities, screens 3-5 are repeated for the top 2-3 entities. Do not ship one entity plus five empty stubs.`;
}
