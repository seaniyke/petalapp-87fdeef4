/**
 * Layout hygiene pass.
 *
 * Failure modes this fixes (all observed on shipped Petal apps):
 *
 *   A. Viewport-locked sections — `h-screen` / `min-h-screen` / `h-[100vh]`
 *      on a *section* produces a tall band of dead black space on phones
 *      when the content inside is short. (The "giant empty rectangle"
 *      screenshots.)
 *
 *   B. Clipped hero copy — a fixed-height hero with a non-responsive
 *      `text-8xl` headline overflows on a 390px screen, so the headline is
 *      sliced in half and the search card sits on top of it.
 *
 *   C. Decorative overlays swallowing content — `<div class="absolute
 *      inset-0 bg-black/50" />` with no `pointer-events-none` / negative
 *      z-index renders ABOVE the copy and eats every tap.
 *
 *   D. Fixed headers overlapping the first section — `fixed top-0` headers
 *      remove themselves from flow, so section one renders underneath the
 *      nav. `sticky top-0` gives the same visual with correct flow.
 *
 *   E. Viewport-locked containers with no vertical padding — content is
 *      welded to the section edges.
 *
 * Pure ProjectFile[] → ProjectFile[], regex-based like the sibling passes.
 */

import type { ProjectFile } from "./generate.server";

const SCANNABLE = /\.(tsx|jsx)$/;

export interface LayoutHygieneResult {
  files: ProjectFile[];
  notes: string[];
  fixes: number;
}

/** Page-shell files legitimately want a full-height flex column. */
function isPageShell(path: string): boolean {
  return /\/(main|App|__root|root|layout|Layout)\.(tsx|jsx)$/.test(path);
}

const DECORATIVE = /^(bg-|from-|via-|to-|backdrop-|opacity-|mix-blend|bg\[|blur|rounded|border|ring|shadow|inset-0|absolute|z-|animate-|pointer-events-|transition|[-a-z]*gradient)/;

const HEADING_RAMP: Record<string, string> = {
  "text-5xl": "text-3xl sm:text-4xl md:text-5xl",
  "text-6xl": "text-4xl sm:text-5xl md:text-6xl",
  "text-7xl": "text-4xl sm:text-5xl md:text-6xl lg:text-7xl",
  "text-8xl": "text-5xl sm:text-6xl md:text-7xl lg:text-8xl",
  "text-9xl": "text-5xl sm:text-7xl md:text-8xl lg:text-9xl",
};

interface Ctx {
  path: string;
  /** true when the className belongs to a self-closing, childless element. */
  selfClosing: boolean;
  /** the tag the className sits on, lowercased (e.g. "div", "header"). */
  tag: string;
}

/** Transform one whitespace-separated class list. Returns the new list. */
function healClassList(raw: string, ctx: Ctx): string {
  let tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return raw;

  const has = (re: RegExp) => tokens.some((t) => re.test(t));
  const shell = isPageShell(ctx.path);

  tokens = tokens.map((t) => {
    // A / B — viewport-locked heights on anything that is not the page shell.
    if (!shell) {
      if (t === "h-screen" || t === "h-dvh" || t === "h-svh") return "min-h-[70svh]";
      if (t === "min-h-screen" || t === "min-h-dvh" || t === "min-h-svh") return "min-h-[70svh]";
      if (t === "h-[100vh]" || t === "h-screen!") return "min-h-[100svh]";
      if (t === "min-h-[100vh]") return "min-h-[100svh]";
      // Any hard viewport height (h-[90vh], h-[100svh], h-[80dvh], …) clips
      // its own content the moment the copy is one line longer than planned.
      const vh = /^h-\[(\d{2,3})(vh|svh|dvh)\]$/.exec(t);
      if (vh) return `min-h-[${vh[1]}${vh[2]}]`;
    }
    // Hard pixel heights on layout containers clip their own content.
    const px = /^h-\[(\d{3,4})px\]$/.exec(t);
    if (px && Number(px[1]) >= 320) return `min-h-[${px[1]}px]`;
    return t;
  });

  // B — non-responsive display type. Only ramp when the author gave no
  // breakpoint-scoped size at all, otherwise we'd fight their own ramp.
  if (!has(/^(sm|md|lg|xl):text-/)) {
    tokens = tokens.flatMap((t) => (HEADING_RAMP[t] ? HEADING_RAMP[t].split(" ") : [t]));
  }

  // C — childless full-bleed overlay: never let decoration take the tap or
  // stack above the copy.
  if (
    ctx.selfClosing &&
    tokens.includes("absolute") &&
    tokens.includes("inset-0") &&
    tokens.every((t) => DECORATIVE.test(t))
  ) {
    if (!tokens.includes("pointer-events-none")) tokens.push("pointer-events-none");
    if (!has(/^-?z-/)) tokens.push("z-0");
  }

  // D — a header taken out of flow (fixed OR absolute) overlaps section one,
  // which is exactly the "hero headline sliced off at the top" bug.
  if (
    (tokens.includes("fixed") || tokens.includes("absolute")) &&
    tokens.some((t) => t === "top-0" || t === "inset-x-0") &&
    (ctx.tag === "header" || ctx.tag === "nav")
  ) {
    tokens = tokens.map((t) => (t === "fixed" || t === "absolute" ? "sticky" : t));
    if (!tokens.includes("top-0")) tokens.push("top-0");
    if (!has(/^z-/)) tokens.push("z-40");
  }

  // E — tall container with zero vertical padding.
  if (
    has(/^min-h-\[(?:\d+svh|\d+vh|\d+dvh|\d{3,4}px)\]$/) &&
    !has(/^(py-|pt-|pb-|p-)/) &&
    ctx.tag !== "html" &&
    !ctx.selfClosing &&
    !shell
  ) {
    tokens.push("py-16", "md:py-24");
  }

  // F — a centered, viewport-tall band with `overflow-hidden` clips its own
  // heading on small screens. Horizontal clipping is all these ever need.
  if (
    !ctx.selfClosing &&
    !shell &&
    tokens.includes("overflow-hidden") &&
    has(/^min-h-/) &&
    (tokens.includes("items-center") || tokens.includes("justify-center"))
  ) {
    tokens = tokens.map((t) => (t === "overflow-hidden" ? "overflow-x-hidden" : t));
  }


  return Array.from(new Set(tokens)).join(" ");
}

/**
 * Walk every JSX element that carries a static `className="…"` (or a template
 * literal with no interpolation) and heal its class list.
 */
function healFile(path: string, content: string): { content: string; fixes: number } {
  let fixes = 0;
  // Matches `<tag ... className="…" ... >` or `… />`, capturing the tag, the
  // class list, and whether the element self-closes.
  const elementRx = /<([A-Za-z][\w.-]*)((?:[^<>"'{}]|"[^"]*"|'[^']*'|\{[^{}]*\})*?)(\/?)>/g;

  const next = content.replace(elementRx, (whole, tag: string, attrs: string, slash: string) => {
    const classRx = /className=(?:"([^"]*)"|\{`([^`${}]*)`\})/;
    const m = classRx.exec(attrs);
    if (!m) return whole;
    const raw = m[1] ?? m[2] ?? "";
    if (!raw.trim()) return whole;

    const healed = healClassList(raw, {
      path,
      selfClosing: slash === "/",
      tag: tag.toLowerCase(),
    });
    if (healed === raw.trim().replace(/\s+/g, " ")) return whole;
    fixes++;
    const replacement = m[1] !== undefined ? `className="${healed}"` : `className={\`${healed}\`}`;
    return whole.replace(m[0], replacement);
  });

  return { content: next, fixes };
}

export function enforceLayoutHygiene(input: ProjectFile[]): LayoutHygieneResult {
  const notes: string[] = [];
  let fixes = 0;
  let touched = 0;

  const files = input.map((f) => {
    if (!SCANNABLE.test(f.path)) return f;
    const out = healFile(f.path, f.content);
    if (out.fixes === 0) return f;
    fixes += out.fixes;
    touched++;
    return { ...f, content: out.content };
  });

  if (fixes > 0) {
    notes.push(
      `layout-hygiene: normalized ${fixes} layout class list(s) across ${touched} file(s) (viewport-locked sections, unresponsive display type, full-bleed overlays, fixed headers)`,
    );
  }

  return { files, notes, fixes };
}
