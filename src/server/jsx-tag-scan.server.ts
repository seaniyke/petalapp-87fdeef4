/**
 * Shared JSX opening-tag scanner.
 *
 * Every regex of the shape `/<input\b([^>]*?)\/?>/` is WRONG the moment an
 * attribute value contains a `>` — which happens constantly:
 *
 *   <Input onChange={(e) => onSearch?.(e.target.value)} />
 *                        ^ `[^>]*?` stops here
 *   <Route path="/" element={<Home />} />
 *
 * A repair pass that appends an attribute at that false boundary produces
 * `onChange={(e) = aria-label="…"> …` and the build dies with TS1005/TS1382.
 * Every attribute-rewriting pass must locate the real tag end with this
 * scanner instead.
 */

export interface ScannedTag {
  /** Index of the `<`. */
  start: number;
  /** Index just PAST the closing `>`. */
  end: number;
  /** Tag name as written. */
  name: string;
  /** Raw attribute text between the tag name and the `/`/`>`. */
  attrs: string;
  /** True when the tag is self-closing (`… />`). */
  selfClosing: boolean;
}

/**
 * Find the real end of the JSX opening tag that starts at `start`
 * (which must point at `<`). Respects quotes, template literals, nested
 * braces, nested JSX inside expression containers, and comments.
 * Returns null when no terminator is found.
 */
export function scanOpeningTag(src: string, start: number): ScannedTag | null {
  if (src[start] !== "<") return null;
  const nameMatch = /^<([A-Za-z][\w.$:-]*)/.exec(src.slice(start, start + 120));
  if (!nameMatch) return null;
  const name = nameMatch[1];
  let i = start + nameMatch[0].length;
  const attrsStart = i;
  let depth = 0; // brace depth inside attribute expressions

  while (i < src.length) {
    const c = src[i];

    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === quote) break;
        i++;
      }
      i++;
      continue;
    }

    if (c === "/" && src[i + 1] === "/" && depth > 0) {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }

    if (c === "{") {
      depth++;
      i++;
      continue;
    }
    if (c === "}") {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }

    if (depth === 0) {
      if (c === "/" && src[i + 1] === ">") {
        return {
          start,
          end: i + 2,
          name,
          attrs: src.slice(attrsStart, i),
          selfClosing: true,
        };
      }
      if (c === ">") {
        return {
          start,
          end: i + 1,
          name,
          attrs: src.slice(attrsStart, i),
          selfClosing: false,
        };
      }
    }

    i++;
  }
  return null;
}

/**
 * Rewrite every opening tag whose name passes `match`. The callback receives
 * the scanned tag and returns replacement source for the WHOLE opening tag,
 * or null to leave it untouched.
 */
export function rewriteOpeningTags(
  src: string,
  match: (name: string) => boolean,
  rewrite: (tag: ScannedTag) => string | null,
): { content: string; fixes: number } {
  let out = "";
  let cursor = 0;
  let fixes = 0;
  const re = /<([A-Za-z][\w.$:-]*)/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(src)) !== null) {
    if (m.index < cursor) continue;
    if (!match(m[1])) continue;
    const tag = scanOpeningTag(src, m.index);
    if (!tag) continue;
    const replacement = rewrite(tag);
    if (replacement === null) {
      continue;
    }
    out += src.slice(cursor, tag.start) + replacement;
    cursor = tag.end;
    fixes++;
    re.lastIndex = tag.end;
  }

  if (fixes === 0) return { content: src, fixes: 0 };
  out += src.slice(cursor);
  return { content: out, fixes };
}

/**
 * Find the matching closing tag for an opening tag, honouring nesting.
 * Returns the index of the `<` of `</name>`, or -1.
 */
export function findClosingTag(src: string, name: string, from: number): number {
  const re = new RegExp(`<(/?)${name.replace(/[.$]/g, "\\$&")}\\b`, "g");
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m[1] === "/") {
      depth--;
      if (depth === 0) return m.index;
    } else {
      const t = scanOpeningTag(src, m.index);
      if (t && !t.selfClosing) depth++;
      if (t) re.lastIndex = t.end;
    }
  }
  return -1;
}
