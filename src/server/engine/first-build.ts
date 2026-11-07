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
  "in one response. After each write step Kimble reports the whole-workspace verification verdict; trust it instead of re-reading files. You may call finish in the same response as your last writes.\n" +
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
export const COMPOSITION_RULES = [
  "Give every section its own layout shape. Choose per section from: full-bleed hero, split (text one side, image the other), bento grid of unequal tiles, single spotlight, metric/stat bar, numbered steps, horizontal scroll rail, editorial quote, logo or badge strip, accordion. Never blend two shapes in one section.",
  "Never place three grid-shaped sections in a row, and never make two adjacent sections share the same layout direction.",
  "Alternate surface tone every two or three sections (bg-background then bg-muted) so the page reads as bands, not one flat sheet.",
  "Vary heading scale down the page instead of giving every section the same size.",
  "Vertical rhythm: content sections py-16 md:py-24, strips py-10 md:py-14, final CTA py-16 md:py-20, footer py-12 md:py-16. Content width max-w-6xl mx-auto px-6.",
  "Two, at most three calls to action across an entire page. The final CTA is its own section; the footer is not a CTA.",
  "Every image needs a real alt description, an explicit aspect ratio and object-cover. Text over an image always sits on a scrim.",
  "Every link points somewhere real — no href=\"#\" placeholders. One <h1> per page.",
].join("\n- ");

/**
 * The recurring mechanical failures, stated once. Webby carries the same
 * material as knowledge sections ("common typescript error patterns", "import
 * path rules", "file organization", "first-build optimization", "token
 * efficiency"); that text names Webby's own tools and its own scaffold, so
 * the behaviour is restated here against Kimble's tools and scaffold instead.
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
