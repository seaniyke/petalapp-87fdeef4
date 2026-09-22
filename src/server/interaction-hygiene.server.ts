/**
 * Interaction hygiene pass — "the site looks right but nothing works".
 *
 * Observed on shipped Kimble apps:
 *
 *   A. `<form>` with no `onSubmit` — pressing Enter or clicking the submit
 *      button does a full-page GET, so the app appears to reset/do nothing.
 *
 *   B. Mobile hamburger button rendered with no state and no handler — tapping
 *      it does literally nothing. Not auto-fixable safely (we'd have to invent
 *      a menu), so it is reported as a defect for the repair/critic loop.
 *
 *   C. Buttons with no `onClick`, no `type="submit"` and no link wrapper —
 *      same dead-end, reported not rewritten.
 *
 * Pure ProjectFile[] → ProjectFile[] like the sibling passes.
 */

import type { ProjectFile } from "./generate.server";
import { rewriteOpeningTags } from "./jsx-tag-scan.server";


const SCANNABLE = /\.(tsx|jsx)$/;

export interface InteractionHygieneResult {
  files: ProjectFile[];
  notes: string[];
  /** Human-readable defects that need a model fix (not auto-repairable). */
  defects: Array<{ path: string; detail: string }>;
  fixes: number;
}

/** A. give every uncontrolled form a real submit handler. */
function healForms(content: string): { content: string; fixes: number } {
  // Tag ends come from the shared scanner, never `<form\b([^>]*)>`: that
  // regex ends the tag at the first `>` in the attributes, which is the arrow
  // of any `onChange={(e) => …}`, and the injected handler lands mid-expression.
  return rewriteOpeningTags(
    content,
    (name) => name === "form",
    (tag) => {
      if (/onSubmit\s*=/.test(tag.attrs)) return null;
      if (/\baction\s*=/.test(tag.attrs)) return null; // deliberate native POST
      const cleaned = tag.attrs.replace(/\s+$/, "");
      return `<form${cleaned} onSubmit={(e) => e.preventDefault()}${tag.selfClosing ? " />" : ">"}`;
    },
  );
}


/** B. hamburger that can never open anything. */
export function findDeadMobileNav(path: string, content: string): string | null {
  const mentionsHamburger =
    /\b(Menu|HamburgerMenu|AlignJustify)\b/.test(content) &&
    /(md:hidden|lg:hidden|sm:hidden)/.test(content);
  if (!mentionsHamburger) return null;
  const hasToggleState = /useState|useReducer|Sheet|Drawer|DropdownMenu|Popover|Collapsible/.test(content);
  const hasHandler = /onClick\s*=/.test(content);
  if (hasToggleState && hasHandler) return null;
  return `${path}: the mobile menu button has no open/close state or handler — tapping it does nothing. Wire a useState toggle (or the Sheet primitive) and render an actual mobile nav panel with the same links as the desktop nav, closing on link click and on Escape.`;
}

/** C. buttons that go nowhere. */
export function findDeadButtons(path: string, content: string): string | null {
  const buttons = content.match(/<(?:button|Button)\b[^>]*>/g) ?? [];
  const dead = buttons.filter(
    (b) =>
      !/onClick\s*=/.test(b) &&
      !/type\s*=\s*["']submit["']/.test(b) &&
      !/asChild/.test(b) &&
      !/\bdisabled\b/.test(b),
  );
  if (dead.length < 2) return null;
  return `${path}: ${dead.length} buttons render with no onClick, no submit type and no link — every visible control must do something real (navigate, open, submit, or change state).`;
}

export function enforceInteractionHygiene(input: ProjectFile[]): InteractionHygieneResult {
  const notes: string[] = [];
  const defects: InteractionHygieneResult["defects"] = [];
  let fixes = 0;
  let touched = 0;

  const files = input.map((f) => {
    if (!SCANNABLE.test(f.path)) return f;

    const navDefect = findDeadMobileNav(f.path, f.content);
    if (navDefect) defects.push({ path: f.path, detail: navDefect });
    const btnDefect = findDeadButtons(f.path, f.content);
    if (btnDefect) defects.push({ path: f.path, detail: btnDefect });

    const out = healForms(f.content);
    if (out.fixes === 0) return f;
    fixes += out.fixes;
    touched++;
    return { ...f, content: out.content };
  });

  if (fixes > 0) {
    notes.push(
      `interaction-hygiene: gave ${fixes} form(s) across ${touched} file(s) a real submit handler (no more full-page reload on Enter)`,
    );
  }
  if (defects.length > 0) {
    notes.push(`interaction-hygiene: flagged ${defects.length} dead-interaction defect(s)`);
  }

  return { files, notes, defects, fixes };
}
