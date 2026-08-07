/**
 * Frontend quality pass — Phase 3, `docs/petal-frontend-quality-bible.md`.
 *
 * The layout and interaction passes already handle "the page is shaped wrong"
 * and "the controls do nothing". This one enforces the parts of the bible that
 * are about the accessibility floor (§14), controls (§8), imagery (§9), forms
 * (§7), typography order (§2) and motion (§12) — the defects a screenshot
 * never shows but every real user hits.
 *
 * Auto-fixed (safe, purely additive):
 *   A. Icon-only buttons/links with no accessible name → `aria-label` derived
 *      from the icon component name.
 *   B. `<img>` with no `alt` → alt derived from the file name.
 *   C. Inputs whose only label is a placeholder → `aria-label` from it.
 *   D. More than one `<h1>` in a page/route file → extras demoted to `<h2>`.
 *   E. Global stylesheet missing a `prefers-reduced-motion` escape hatch when
 *      the app animates → appended.
 *
 * Reported as defects (need a model fix, never guessed):
 *   F. Lorem ipsum / TODO placeholder copy.
 *   G. Data surfaces with no empty state.
 *
 * Pure ProjectFile[] → ProjectFile[], regex-based like its siblings.
 */

import type { ProjectFile } from "./generate.server";
import { rewriteOpeningTags, scanOpeningTag, findClosingTag } from "./jsx-tag-scan.server";

const SCANNABLE = /\.(tsx|jsx)$/;

export interface FrontendQualityResult {
  files: ProjectFile[];
  notes: string[];
  defects: Array<{ path: string; detail: string }>;
  fixes: number;
}

/* ------------------------------------------------------------------ A ---- */

const ICON_HINT = /<([A-Z][A-Za-z0-9]*)\s*(?:\/>|[^>]*\/>)/;

/** "ShoppingCart" → "shopping cart" */
function humanizeIcon(name: string): string {
  return name
    .replace(/Icon$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
}

const CONTROL_TAGS = new Set(["button", "Button", "a", "Link"]);

function labelIconOnlyControls(content: string): { content: string; fixes: number } {
  let fixes = 0;
  let src = content;
  // We walk manually because the accessible-name decision needs the tag's
  // children, which requires a real matching-close lookup (nested tags with
  // the same name would break a lazy `([\s\S]*?)</\1>` regex).
  const re = /<(button|Button|a|Link)\b/g;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(src)) !== null && guard++ < 2000) {
    const tag = scanOpeningTag(src, m.index);
    if (!tag || tag.selfClosing) continue;
    if (!CONTROL_TAGS.has(tag.name)) continue;
    const attrs = tag.attrs;
    if (/aria-label\s*=|aria-labelledby\s*=|\btitle\s*=/.test(attrs)) {
      re.lastIndex = tag.end;
      continue;
    }
    const closeAt = findClosingTag(src, tag.name, tag.end);
    if (closeAt === -1) {
      re.lastIndex = tag.end;
      continue;
    }
    const inner = src.slice(tag.end, closeAt);
    const text = inner
      .replace(/<[^>]*>/g, " ")
      .replace(/\{[^}]*\}/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length > 0) {
      re.lastIndex = tag.end;
      continue;
    }
    const icon = ICON_HINT.exec(inner);
    if (!icon) {
      re.lastIndex = tag.end;
      continue;
    }
    const opening = `<${tag.name}${attrs.replace(/\s+$/, "")} aria-label="${humanizeIcon(icon[1])}">`;
    src = src.slice(0, tag.start) + opening + src.slice(tag.end);
    fixes++;
    re.lastIndex = tag.start + opening.length;
  }
  return { content: src, fixes };
}

/* ------------------------------------------------------------------ B ---- */

function altFromSrc(attrs: string): string {
  const m = /src\s*=\s*["'`]([^"'`]+)["'`]/.exec(attrs);
  if (!m) return "";
  const base = m[1].split("/").pop() ?? "";
  return base
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addMissingAlt(content: string): { content: string; fixes: number } {
  return rewriteOpeningTags(
    content,
    (name) => name === "img",
    (tag) => {
      if (/\balt\s*=/.test(tag.attrs)) return null;
      const alt = altFromSrc(tag.attrs);
      const attr = alt ? ` alt="${alt}"` : ` alt="" aria-hidden="true"`;
      return `<img${tag.attrs.replace(/\s+$/, "")}${attr}${tag.selfClosing ? " />" : ">"}`;
    },
  );
}

/* ------------------------------------------------------------------ C ---- */

const FIELD_TAGS = new Set(["input", "textarea", "Input", "Textarea"]);

function labelPlaceholderOnlyFields(content: string): { content: string; fixes: number } {
  const hasLabels = /<(label|Label)\b/.test(content);
  return rewriteOpeningTags(
    content,
    (name) => FIELD_TAGS.has(name),
    (tag) => {
      const attrs = tag.attrs;
      if (/aria-label\s*=|aria-labelledby\s*=/.test(attrs)) return null;
      if (hasLabels && /\bid\s*=/.test(attrs)) return null; // paired with <label htmlFor>
      const ph = /placeholder\s*=\s*["'`]([^"'`]+)["'`]/.exec(attrs);
      if (!ph) return null;
      return `<${tag.name}${attrs.replace(/\s+$/, "")} aria-label="${ph[1].replace(/"/g, "'")}"${
        tag.selfClosing ? " />" : ">"
      }`;
    },
  );
}

/* ------------------------------------------------------------------ D ---- */

/**
 * Demote duplicate `<h1>`s — but ONLY in files that render a single page.
 * A file holding several route components (the multi-page App.tsx shape)
 * legitimately has one `<h1>` per page; demoting them all leaves the app
 * with zero top-level headings, which is worse than the thing we're fixing.
 */
function definesMultiplePageComponents(content: string): boolean {
  const comps = content.match(/\bfunction\s+[A-Z][A-Za-z0-9_]*\s*\(/g) ?? [];
  const arrows = content.match(/\bconst\s+[A-Z][A-Za-z0-9_]*\s*[:=]\s*(?:\([^)]*\)|[A-Za-z_$]+)\s*=>/g) ?? [];
  return comps.length + arrows.length > 1;
}

function demoteExtraH1(content: string): { content: string; fixes: number } {
  const opens = content.match(/<h1\b/g) ?? [];
  if (opens.length < 2) return { content, fixes: 0 };
  if (definesMultiplePageComponents(content)) return { content, fixes: 0 };
  let seen = 0;
  let fixes = 0;
  const next = content.replace(/<(\/?)h1\b/g, (whole, slash: string) => {
    if (!slash) {
      seen++;
      if (seen === 1) return whole;
      fixes++;
      return "<h2";
    }
    // Closing tags mirror the opening decision in document order.
    return seen > 1 ? "</h2" : whole;
  });
  return { content: next, fixes: fixes > 0 ? fixes : 0 };
}


/* ------------------------------------------------------------------ E ---- */

const REDUCED_MOTION_BLOCK = `

/* Motion respects the user's system preference (Frontend Bible §12). */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`;

function isGlobalStylesheet(path: string): boolean {
  return /(^|\/)(index|globals?|styles|app)\.css$/i.test(path);
}

/* ------------------------------------------------------------------ H/I -- */

/**
 * Overlay hygiene. Two defects show up constantly in generated apps and both
 * are visible in one screenshot: a mobile menu that renders with no background
 * (the page text reads straight through it), and two floating panels — a date
 * picker over a search form, a dropdown over an input — that land on top of
 * each other because neither declares a stacking order.
 */
const OPAQUE_BG =
  /\bbg-(background|card|popover|muted|secondary|primary|accent|sidebar|white|black|neutral-\d{2,3}|zinc-\d{2,3}|slate-\d{2,3}|gray-\d{2,3})\b/;
const HAS_Z = /\bz-(\[|\d|base|sticky|overlay|sheet|toast|auto)/;
const FLOATING = /\b(fixed|absolute)\b/;
/** Panel shapes that are chrome, not a decorative image/gradient layer. */
const PANEL_SHAPE = /\b(inset-0|inset-x-0|top-full|left-0\s|right-0\s|mt-1|mt-2|min-h-screen|h-screen|h-dvh|w-full)\b/;
const DECORATIVE = /\b(bg-gradient|pointer-events-none|object-cover|-z-10|opacity-0)\b/;

function classNameOf(attrs: string): string {
  const m = /class(?:Name)?\s*=\s*(?:["'`]([^"'`]*)["'`]|\{([\s\S]*?)\})/.exec(attrs);
  return m ? (m[1] ?? m[2] ?? "") : "";
}

/** H — an opaque floating panel with no stacking order gets one. */
function orderFloatingPanels(content: string): { content: string; fixes: number } {
  return rewriteOpeningTags(
    content,
    () => true,
    (tag) => {
      const cls = classNameOf(tag.attrs);
      if (!cls || !FLOATING.test(cls) || HAS_Z.test(cls)) return null;
      if (DECORATIVE.test(cls) || !OPAQUE_BG.test(cls) || !PANEL_SHAPE.test(cls)) return null;
      const attrs = tag.attrs.replace(
        /(class(?:Name)?\s*=\s*)(["'`])([^"'`]*)(\2)/,
        (_w, head: string, q: string, body: string) => `${head}${q}${body} z-50${q}`,
      );
      if (attrs === tag.attrs) return null;
      return `<${tag.name}${attrs.replace(/\s+$/, "")}${tag.selfClosing ? " />" : ">"}`;
    },
  );
}

const MENU_STATE = /\b(isMenuOpen|menuOpen|mobileOpen|isOpen|drawerOpen|navOpen|showMenu|isMobileMenuOpen)\b/;

/** I — a see-through menu/drawer panel. Never guessed; the model must fix it. */
function findTransparentOverlay(path: string, content: string): string | null {
  if (!MENU_STATE.test(content)) return null;
  const tags = content.match(/<[A-Za-z][^>]*class(?:Name)?\s*=[^>]*>/g) ?? [];
  for (const t of tags) {
    const cls = classNameOf(t);
    if (!FLOATING.test(cls) || DECORATIVE.test(cls)) continue;
    if (!/\b(inset-0|inset-x-0|top-full|h-screen|h-dvh|min-h-screen)\b/.test(cls)) continue;
    if (OPAQUE_BG.test(cls)) continue;
    return `${path}: a floating menu/drawer panel has no opaque background, so the page underneath reads through it and the menu is unusable. Give the panel a solid surface token (\`bg-background\` or \`bg-card\`), a stacking order (\`z-50\`), and — if it covers the page — a dimmed backdrop behind it. A blurred or transparent panel is never acceptable for navigation.`;
  }
  return null;
}

/** J — several floating panels with no stacking order will collide. */
function findLayeringCollision(path: string, content: string): string | null {
  const tags = content.match(/<[A-Za-z][^>]*class(?:Name)?\s*=[^>]*>/g) ?? [];
  let unordered = 0;
  for (const t of tags) {
    const cls = classNameOf(t);
    if (!FLOATING.test(cls) || DECORATIVE.test(cls) || HAS_Z.test(cls)) continue;
    if (!PANEL_SHAPE.test(cls)) continue;
    unordered++;
  }
  if (unordered < 2) return null;
  return `${path}: ${unordered} floating panels are positioned with no stacking order, so popovers, calendars and dropdowns render on top of each other instead of above the form. Anchor each panel to a \`relative\` parent, give it an explicit \`z-\` layer, close the others when one opens, and on small screens present the picker as a full-width sheet rather than a floating card.`;
}

/* ------------------------------------------------------------------ F/G -- */

const LOREM_RX = /\b(lorem ipsum|dolor sit amet|consectetur adipiscing)\b/i;
const TODO_RX = /\b(TODO:|FIXME:|placeholder text|Your text here)\b/;

function findPlaceholderCopy(path: string, content: string): string | null {
  if (LOREM_RX.test(content)) {
    return `${path}: contains lorem ipsum. Replace it with plausible copy written for this product's actual domain — never ship filler text.`;
  }
  if (TODO_RX.test(content)) {
    return `${path}: ships TODO/placeholder copy. Write the real sentence or remove the block.`;
  }
  return null;
}

function findMissingEmptyState(path: string, content: string): string | null {
  const rendersList = /\.map\(\s*\(?[A-Za-z_$]/.test(content);
  if (!rendersList) return null;
  const hasEmpty = /(length\s*===\s*0|length\s*<\s*1|!\w+\.length|isEmpty|EmptyState|No results|Nothing here|no items)/i.test(
    content,
  );
  if (hasEmpty) return null;
  return `${path}: renders a list with no empty state. Every data surface needs loading, empty and error states — add an empty branch with an icon, a heading, one explanatory line and a primary action.`;
}


/* ------------------------------------------------------------------------ */

export function enforceFrontendQuality(input: ProjectFile[]): FrontendQualityResult {
  const notes: string[] = [];
  const defects: FrontendQualityResult["defects"] = [];
  let ariaFixes = 0;
  let altFixes = 0;
  let fieldFixes = 0;
  let headingFixes = 0;

  const animates = input.some(
    (f) => SCANNABLE.test(f.path) && /animate-|transition-|framer-motion|motion\./.test(f.content),
  );

  let stylesheetPatched = false;

  const files = input.map((f) => {
    if (isGlobalStylesheet(f.path)) {
      if (!animates || /prefers-reduced-motion/.test(f.content) || stylesheetPatched) return f;
      stylesheetPatched = true;
      return { ...f, content: `${f.content.replace(/\s+$/, "")}\n${REDUCED_MOTION_BLOCK}` };
    }
    if (!SCANNABLE.test(f.path)) return f;

    const copyDefect = findPlaceholderCopy(f.path, f.content);
    if (copyDefect) defects.push({ path: f.path, detail: copyDefect });
    const emptyDefect = findMissingEmptyState(f.path, f.content);
    if (emptyDefect) defects.push({ path: f.path, detail: emptyDefect });

    let content = f.content;
    const a = labelIconOnlyControls(content);
    content = a.content;
    ariaFixes += a.fixes;

    const b = addMissingAlt(content);
    content = b.content;
    altFixes += b.fixes;

    const c = labelPlaceholderOnlyFields(content);
    content = c.content;
    fieldFixes += c.fixes;

    const d = demoteExtraH1(content);
    content = d.content;
    headingFixes += d.fixes;

    return content === f.content ? f : { ...f, content };
  });

  if (ariaFixes > 0) {
    notes.push(`frontend-quality: named ${ariaFixes} icon-only control(s) with aria-label`);
  }
  if (altFixes > 0) {
    notes.push(`frontend-quality: added alt text to ${altFixes} image(s)`);
  }
  if (fieldFixes > 0) {
    notes.push(`frontend-quality: labelled ${fieldFixes} placeholder-only form field(s)`);
  }
  if (headingFixes > 0) {
    notes.push(`frontend-quality: demoted ${headingFixes} duplicate <h1> so each page has one`);
  }
  if (stylesheetPatched) {
    notes.push("frontend-quality: added a prefers-reduced-motion escape hatch to the global stylesheet");
  }
  if (defects.length > 0) {
    notes.push(`frontend-quality: flagged ${defects.length} content/state defect(s)`);
  }

  return {
    files,
    notes,
    defects,
    fixes: ariaFixes + altFixes + fieldFixes + headingFixes + (stylesheetPatched ? 1 : 0),
  };
}
