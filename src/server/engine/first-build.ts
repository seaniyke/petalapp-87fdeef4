/**
 * First-build entry into the tool loop. There is no monolithic
 * write_project generation before the loop: the loop starts from the empty
 * workspace (or a resumed checkpoint) and writes everything with tools.
 */
import type { ProjectFile } from "@/server/generate.server";
import { renderTemplateMetadataSection } from "@/server/engine/template-contract";

/** Files a first build starts from: saved checkpoint files, else none. */
export function firstBuildSeedFiles(args: string | null | undefined): ProjectFile[] {
  if (!args) return [];
  try {
    const parsed = JSON.parse(args) as { files?: unknown };
    if (!Array.isArray(parsed.files)) return [];
    return parsed.files.filter(
      (f): f is ProjectFile =>
        !!f && typeof (f as ProjectFile).path === "string" && typeof (f as ProjectFile).content === "string",
    );
  } catch {
    return [];
  }
}

/** Appended to the stable system prefix: tools replace the structured payload. */
export const FIRST_BUILD_TOOL_NOTE =
  "\n\n### Execution mode: tools\n" +
  "There is NO write_project tool in this conversation. Build the app with the provided tools: " +
  "create_file for new files, edit_file for exact changes, read_file/list_files/search only when you need " +
  "information you do not already have, finish when done.\n" +
  "Work in units: pick the next work unit (e.g. the shared layout, then one page), read ONLY what that unit needs, " +
  "write it, let it validate, then move to the next. Inspect enough to start safely — you do not need to understand " +
  "the whole starter kit before your first write. The starter-kit API above is authoritative and complete: do not list directories " +
  "to discover the kit, and do not read sections for later units now. Reads the current unit genuinely needs may go " +
  "in one response. After each write step Petal reports the whole-workspace verification verdict; trust it instead of re-reading files. You may call finish in the same response as your last writes.\n" +
  "Batch only coherent work: files that form one dependency-safe unit (a shared module with the layout that uses it, " +
  "a page with a local component only it imports, the router with its pages) belong in one response. Pages that each " +
  "stand alone on already-written shared modules may share a response too. Write shared modules before the files that " +
  "import them; if a write fails validation, fix it before starting new work. Batch when it is coherent — neither " +
  "one file per response nor everything at once is a goal in itself.\n";

export interface FirstBuildDesign {
  /** Design-system package name, e.g. "Substrate". */
  name: string;
  /** Selected accent id, e.g. "terracotta". */
  accent: string;
  /** Display/heading family. */
  displayFont: string;
  /** Body/UI family. */
  bodyFont: string;
  /** The package's DESIGN.md playbook. */
  playbook: string;
}

/**
 * The composition contract every first build is written against. These are the
 * rules that separate "designed" from "AI default": without them the model
 * reliably emits centred heading + three equal icon cards on every section.
 *
 * Deterministic text — no AI call, no per-page cost.
 */
/**
 * Agency-grade finish: the typographic and interaction details that separate
 * a studio-made site from a merely tidy one. Deterministic text.
 */
export const FINISH_RULES = [
  "Type finish: small uppercase labels (kickers, meta lines, nav links) use text-xs tracking-[0.18em] uppercase text-muted-foreground. Display headings use tight leading (leading-[1.05] to leading-[1.1]) and tracking-tight.",
  "Headings scale with the screen and never exceed three lines on a phone: hero h1 text-4xl sm:text-5xl lg:text-7xl, section h2 text-3xl md:text-5xl. Body copy max-w-prose, text-base md:text-lg, leading-relaxed.",
  "Cards respond to the pointer: wrap the picture in overflow-hidden and give it transition-transform duration-700 ease-out group-hover:scale-[1.03]; the title gets a subtle underline or colour shift on group-hover. Whole card is one <Link className=\"group block\">.",
  "Every interactive element has transition-colors duration-300 and a visible focus-visible:ring-2 ring-ring ring-offset-2 state. Buttons never jump size on hover.",
  "Grids align: cards in one row share the same picture aspect ratio (aspect-[4/3] or aspect-[3/4]) and never offset each other vertically unless the whole section is a deliberate staggered layout.",
  "Section changes are calm: alternate only between bg-background and a near tone (bg-muted/40) with a thin border-t border-border/60 between bands — never a harsh jump between unrelated surfaces.",
  "Buttons are compact rectangles (rounded-md), never rounded-full pills. No pill-shaped badges or chips on marketing pages; labels are plain uppercase text.",
  "Header is one clean line: wordmark left, at most 5 text links, one icon or one button right. No tagline under the brand, no stacked text, no decorative mark drawings.",
  "Never colour, italicise or highlight a single word inside a heading. Headings are one colour, one style.",
  "Footer is quiet and complete: brand, the requested page links, contact line and © year, in text-sm text-muted-foreground on a border-t.",
];

export const COMPOSITION_RULES = [
  "Give every section its own layout shape. Choose per section from: full-bleed hero, split (text one side, image the other), bento grid of unequal tiles, single spotlight, numbered steps, horizontal scroll rail, editorial quote, logo or badge strip, accordion. Never blend two shapes in one section.",
  "Never place three grid-shaped sections in a row, and never make two adjacent sections share the same layout direction.",
  "Alternate surface tone every two or three sections (bg-background then bg-muted) so the page reads as bands, not one flat sheet.",
  "Vary heading scale down the page instead of giving every section the same size.",
  "Vertical rhythm: content sections py-16 md:py-24, strips py-10 md:py-14, final CTA py-16 md:py-20, footer py-12 md:py-16. Content width max-w-6xl mx-auto px-6. This padding goes on each <section> only — never on the page/layout wrapper or around the header, which must sit flush at the top of the page.",
  "Two, at most three calls to action across an entire page. The final CTA is its own section; the footer is not a CTA.",
  "Every image needs a real alt description, an explicit aspect ratio and object-cover. Text over an image always sits on a scrim.",
  "Real photography comes ONLY from the image tool: write src=\"petal-image://<cinematic-specific-prompt>\" (subject, setting, light, lens, mood — e.g. petal-image://limestone-villa-at-dusk-warm-grazing-light-wide-architectural-photo). Petal generates each one after you finish. Never write any other image URL (unsplash, picsum, pexels or any https photo link) — invented links are broken and show as empty boxes. Give every distinct picture slot (each project card, team member, room, product) its own distinct prompt — every one is made; repeat a URL only when the very same picture is shown again (e.g. a card and its detail view). Never write data:image URIs, inline SVG pictures, gradient boxes standing in for photos, or stock/unsplash/picsum URLs.",
  "Marketing sites lead with imagery, not tools: the hero is a large photograph or full-bleed visual with one headline and one primary action. Never put calculators, sliders, simulators or spec tables in the hero of a website unless the user asked for that tool.",
  "Studio, portfolio, architecture, luxury and hospitality sites are editorial: big photographs, generous negative space, few words per section, serif display headings. Keep technical detail off the homepage.",
  "Restraint over density. A website is not a dashboard: every section has one idea, a short heading, at most two short sentences, and white space around it. Fewer, larger pictures beat many small ones.",
  "Card anatomy is fixed: picture, title, one meta line (category · year or role), optionally one short sentence. No chips, badges, spec rows, numbers, credits or buttons inside a card — the whole card is the link.",
  "Never invent technical specifications, measurements, ratings, percentages or industry jargon (lux, Kelvin, CRI, Ra, ROI figures, client/architect credits) unless the user supplied them. Describe the work in plain words a client understands.",
  "No unrequested tools or widgets on websites: no calculators, tuners, sliders, simulators, configurators, live counters or charts unless the user asked for that tool by name.",
  "Shops keep checkout out of the header: the header shows a bag icon with its item count, and checkout is reached from the bag. Checkout is never a link in the header, the phone menu or the footer, and the bag appears once (the icon), not also as a text link.",
  "Every pop-up, drawer and side panel uses the kit Dialog or Sheet, so it closes with Esc, the backdrop and a close button. Never hand-build a fixed overlay.",
  "One primary action per screen. Repeat the same action (e.g. 'Start a project') instead of inventing new ones; never more than one button per card or section.",
  "The header has a solid background (bg-background with a border-b), never translucent or blurred. The phone menu uses the kit Sheet so it opens as a solid full-height panel.",
  "Header navigation lists only the requested pages (at most 5 links plus one action button). Home sections are never separate nav links or routes.",
  "Every link points somewhere real — no href=\"#\" placeholders. One <h1> per page.",
  ...FINISH_RULES,
].join("\n- ");

/**
 * The recurring mechanical failures, stated once. Webby carries the same
 * material as knowledge sections ("common typescript error patterns", "import
 * path rules", "file organization", "first-build optimization", "token
 * efficiency"); that text names Webby's own tools and its own scaffold, so
 * the behaviour is restated here against Petal's tools and scaffold instead.
 */
export const CORRECTNESS_RULES = [
  "Import every identifier you use, including every lucide-react icon and every React hook. An undefined name fails validation and the write is returned to you.",
  "Match the export style: the UI kit exports named (import { Button }), pages export default. Never guess — a mismatch is a build error.",
  "Absolute imports only, via the @/ alias. No relative ../.. chains, no file extensions, no imports of packages the scaffold does not already use.",
  "src/App.tsx is the only place that owns <BrowserRouter>. Never nest a second router inside a page or layout. Router names come from \"react-router-dom\" (or its kit re-export @/components/ui/router) — never invent another router module.",
  "Write each file once, complete, in a single create_file call. Do not emit partial files, TODO stubs or '...rest unchanged'. Use edit_file for a bounded change to a file that already exists.",
  "Write the shared layout and any shared module before the pages that import them, then emit the pages together in one response.",
].join("\n- ");

/** Words that make copy read as machine-written. */
export const COPY_RULES =
  "Write copy as the business would: concrete and specific, never superlative. " +
  'Banned words: elevate, seamless, unleash, next-gen, revolutionize, empower, supercharge, "transform your", ' +
  '"take it to the next level", "in today\'s fast-paced world". No lorem ipsum, no [placeholder], ' +
  "no invented statistics, testimonials, client names or contact details. A heading should say something " +
  'specific to this business, not name a category ("Our Features").';

function designSection(d: FirstBuildDesign): string {
  return (
    `\n### Design system: ${d.name} (accent: ${d.accent})\n` +
    `The stylesheet already defines the palette, the radius scale and the font families, and the font links are ` +
    `already installed. Use semantic Tailwind classes only — bg-background, bg-card, bg-muted, text-foreground, ` +
    `text-muted-foreground, bg-primary text-primary-foreground, border-border, rounded-lg. ` +
    `Never write a hex colour, never use text-white/bg-black, never use a numbered palette class like bg-blue-600. ` +
    `Headings use font-serif (${d.displayFont}); body, nav, buttons and data use font-sans (${d.bodyFont}).\n` +
    `Styling is already fully set up: never create or edit a stylesheet, a Tailwind config, a PostCSS config, ` +
    `a Vite config, package.json or index.html. Those writes are refused.\n\n` +
    `${d.playbook.trim()}\n`
  );
}

/** First-build rule: data-backed apps open with real saved records, never blank tables. */
export const STARTER_DATA_RULE =
  "Each list/table page loads its collection with `db.seedOnce(collection, rows)` from `@/integrations/backend/client` " +
  "instead of `db.list` on first load, passing 5-8 realistic, domain-specific rows (real-sounding names, dates, amounts, statuses). " +
  "seedOnce writes them to the database only when the collection is empty, so the app opens alive and the data is real. " +
  "seedOnce and db.list return an array of records (`rows.map(r => ({ id: r.id, ...r.data }))`); db.create/db.update return the saved record (`saved.id`, `saved.data`). " +
  "Never hardcode sample arrays in pages. " +
  "On customer-facing pages (shop, product, menu, treatments, booking, cart) visitors only browse, add to bag, book and pay: " +
  "never show add, edit or delete controls for the catalogue there, whatever the button is called (no 'Add to store', 'New formula', 'Bespoke blend' forms). " +
  "Visitors never see other people's bookings, orders or messages: seed only what the business sells, never sample bookings or orders with customer names; " +
  "after a visitor books or orders, db.create the record and show only that visitor's own confirmation from component state — never a list of everyone's bookings, and no reschedule/cancel buttons on others' records. " +
  "Owner tools exist only inside a signed-in area, and only when the user asked for one.";

export function firstBuildBrief(
  request: string,
  planned: Array<{ route: string; file: string }>,
  existing: string[],
  design?: FirstBuildDesign | null,
  data?: { shared: boolean } | null,
): string {
  const pages = planned.map((p) => `${p.route} → ${p.file}`).join(", ");
  const workspace = existing.length
    ? `The workspace already holds ${existing.length} saved files from an interrupted run: ${existing.join(", ")}. ` +
      `Do not rewrite them; write what is still missing.`
    : `No app code has been written yet. The scaffold below is already installed, so you know the workspace — ` +
      `do not list or read files before writing. Start writing immediately.`;
  return (
    `${request}\n\n${workspace}\n` +
    `Write src/App.tsx (router + shared layout with navigation and footer), every shared module the pages import, ` +
    `and every planned page, then call finish. Planned pages: ${pages}.\n` +
    renderTemplateMetadataSection() +
    (design ? designSection(design) : "") +
    `\n### Composition\n- ${COMPOSITION_RULES}\n` +
    `\n### Copy\n${COPY_RULES}\n` +
    `\n### Correctness\n- ${CORRECTNESS_RULES}\n` +
    (data?.shared ? `\n### Starter data\n${STARTER_DATA_RULE}\n` : "")
  );
}
