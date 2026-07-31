/**
 * Kit-block prop contract repair.
 *
 * Root cause this addresses: the model regularly calls kit section blocks
 * with a grouped `sectionHeader={{ eyebrow, title, description }}` object —
 * an API none of the blocks accept. React silently drops the unknown prop,
 * the block renders its `<Section>` with no header, and the page ships with
 * a tall empty band exactly where the section title should be. That is the
 * "big blank gaps" failure users report.
 *
 * This pass flattens those grouped objects back into the real prop contract:
 *
 *   <FeaturesGrid3 sectionHeader={{ eyebrow: "Our Promise", title: "Why us" }} />
 *   →
 *   <FeaturesGrid3 eyebrow={"Our Promise"} title={"Why us"} />
 *
 * It is deliberately conservative: it only rewrites when EVERY key inside the
 * object maps to a known header prop, so real data props are never touched.
 */

import type { ProjectFile } from "./generate.server";

/** Grouped props the model invents for section headers. */
const GROUPED_PROPS = ["sectionHeader", "header", "heading", "sectionHeading"];

/** Inner key → real block prop. */
const KEY_MAP: Record<string, string> = {
  eyebrow: "eyebrow",
  label: "eyebrow",
  kicker: "eyebrow",
  tag: "eyebrow",
  title: "title",
  heading: "title",
  headline: "title",
  description: "description",
  subtitle: "description",
  subhead: "description",
  subheading: "description",
  body: "description",
};

interface Attr {
  key: string;
  value: string;
}

/**
 * Split an object-literal body into top-level `key: value` pairs.
 * Returns null when the body is not a simple flat literal we can rewrite.
 */
function splitObjectBody(body: string): Attr[] | null {
  const out: Attr[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  const parts: string[] = [];

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));

  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    const colon = findTopLevelColon(part);
    if (colon < 0) return null;
    const key = part.slice(0, colon).trim().replace(/^["'`]|["'`]$/g, "");
    const value = part.slice(colon + 1).trim();
    if (!key || !value) return null;
    const mapped = KEY_MAP[key];
    if (!mapped) return null; // unknown key → not a section header, bail out
    out.push({ key: mapped, value });
  }
  return out.length > 0 ? out : null;
}

function findTopLevelColon(part: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < part.length; i++) {
    const ch = part[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") depth--;
    else if (ch === ":" && depth === 0) return i;
  }
  return -1;
}

/** Find the index just past the JSX expression container opened at `open`. */
function matchBrace(src: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function flattenInFile(src: string): { content: string; changes: number } {
  let out = src;
  let changes = 0;

  for (const prop of GROUPED_PROPS) {
    const re = new RegExp(`\\b${prop}=\\{\\{`, "g");
    let guard = 0;
    // Re-scan after each rewrite so indices stay valid. `from` lets us step
    // over an occurrence we can't flatten instead of abandoning the whole
    // prop — later, perfectly valid call sites in the same file used to be
    // skipped because one earlier occurrence had an unknown key.
    let from = 0;
    for (;;) {
      if (guard++ > 200) break;
      re.lastIndex = from;
      const m = re.exec(out);
      if (!m) break;
      const openOuter = m.index + prop.length + 1; // the `{` of `={{`
      const closeOuter = matchBrace(out, openOuter);
      if (closeOuter < 0) break;
      const inner = out.slice(openOuter + 1, closeOuter).trim();
      if (!inner.startsWith("{") || !inner.endsWith("}")) {
        from = closeOuter + 1;
        continue;
      }
      const attrs = splitObjectBody(inner.slice(1, -1));
      if (!attrs) {
        // Not a header-shaped object — skip just this occurrence.
        from = closeOuter + 1;
        continue;
      }
      const replacement = attrs.map((a) => `${a.key}={${a.value}}`).join(" ");
      out = out.slice(0, m.index) + replacement + out.slice(closeOuter + 1);
      changes++;
      from = m.index + replacement.length;
    }
  }

  return { content: out, changes };
}


export function fixBlockProps(files: ProjectFile[]): {
  files: ProjectFile[];
  notes: string[];
} {
  const notes: string[] = [];
  let total = 0;
  let touched = 0;

  const next = files.map((f) => {
    if (!/\.(tsx|jsx)$/.test(f.path)) return f;
    if (!GROUPED_PROPS.some((p) => f.content.includes(`${p}={{`))) return f;
    const { content, changes } = flattenInFile(f.content);
    if (changes === 0) return f;
    total += changes;
    touched++;
    return { ...f, content };
  });

  if (total > 0) {
    notes.push(
      `block-props: flattened ${total} grouped section-header prop(s) across ${touched} file(s)`,
    );
  }
  return { files: next, notes };
}
