/**
 * Aider-style flexible search/replace cascade.
 *
 * The model frequently emits a `search` snippet that is *almost* the file
 * content but differs by trivial things (whitespace, indentation, a stale
 * comment, a renamed identifier in one line). A literal `indexOf` fails and
 * we burn a 3-attempt model retry loop just to re-anchor.
 *
 * This module tries a cascade of progressively more tolerant matchers.
 * The FIRST one that produces a unique match wins; we splice the replace
 * payload in at the matched span and return the new content. If nothing
 * matches uniquely we return null and the caller falls back to its existing
 * "snippet did not match" retry path.
 *
 * Strategy order (cheapest + safest first):
 *   1. Literal match (already tried by caller, skipped here).
 *   2. Trim-trailing-whitespace match — collapse `[ \t]+$` per line.
 *   3. Normalize-leading-indent match — strip common leading indent from
 *      both haystack and needle, match, then re-anchor by line numbers.
 *   4. Collapse-internal-whitespace match — every run of whitespace becomes
 *      a single space; rescues prettier reflows and wrapped JSX.
 *   5. First+last anchor match — use the first non-empty line and last
 *      non-empty line of the needle as anchors, and additionally require the
 *      interior to still look like the needle before replacing the span.
 *
 * Every strategy must produce a SINGLE unique match. Multiple matches → skip.
 *
 * ## Splicing correctness
 *
 * Strategies 2 and 4 match against a *normalized* copy of the file, so the
 * match offsets do not line up with the original text. Earlier versions
 * spliced by whole line numbers, which silently destroyed content when a
 * needle started or ended mid-line (e.g. searching for `size="lg"` inside a
 * JSX tag wiped the rest of that line). We now carry an index map built
 * during normalization and splice the ORIGINAL string at exact character
 * offsets, so a partial-line match replaces exactly what it matched.
 */

export type FuzzyResult = {
  content: string;
  strategy: string;
} | null;

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    n++;
    i += needle.length;
  }
  return n;
}

/**
 * Normalized text plus, for every normalized character, the original span it
 * came from. `srcStart[i]` is where normalized char `i` begins in the source
 * and `srcEnd[i]` is where it ends — they differ whenever a run of source
 * characters collapsed into one.
 */
interface Normalized {
  text: string;
  srcStart: number[];
  srcEnd: number[];
}

/** Drop trailing spaces/tabs at the end of every line. */
function normTrimTrailing(source: string): Normalized {
  const text: string[] = [];
  const srcStart: number[] = [];
  const srcEnd: number[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === " " || ch === "\t") {
      // Look ahead: is this run only followed by more blanks then EOL/EOF?
      let j = i;
      while (j < source.length && (source[j] === " " || source[j] === "\t")) j++;
      if (j >= source.length || source[j] === "\n" || source[j] === "\r") {
        i = j; // trailing run — drop it entirely
        continue;
      }
    }
    text.push(ch);
    srcStart.push(i);
    srcEnd.push(i + 1);
    i += 1;
  }
  return { text: text.join(""), srcStart, srcEnd };
}

/** Collapse every run of whitespace into a single space. */
function normCollapseWs(source: string): Normalized {
  const text: string[] = [];
  const srcStart: number[] = [];
  const srcEnd: number[] = [];
  let i = 0;
  while (i < source.length) {
    if (/\s/.test(source[i])) {
      let j = i;
      while (j < source.length && /\s/.test(source[j])) j++;
      text.push(" ");
      srcStart.push(i);
      srcEnd.push(j);
      i = j;
      continue;
    }
    text.push(source[i]);
    srcStart.push(i);
    srcEnd.push(i + 1);
    i += 1;
  }
  return { text: text.join(""), srcStart, srcEnd };
}

/**
 * Shared driver for the normalization-based strategies: normalize both sides,
 * require a single match, then splice the ORIGINAL haystack at the mapped
 * character offsets.
 */
function matchViaNormalizer(
  haystack: string,
  needle: string,
  replace: string,
  normalize: (s: string) => Normalized,
  strategy: string,
): FuzzyResult {
  const h = normalize(haystack);
  const n = normalize(needle);
  // A needle that normalizes to nothing (or a lone space) would match
  // everywhere — refuse rather than corrupt the file.
  if (n.text.trim().length === 0) return null;
  if (countOccurrences(h.text, n.text) !== 1) return null;

  const start = h.text.indexOf(n.text);
  const endExclusive = start + n.text.length;
  const origStart = h.srcStart[start];
  const origEnd = h.srcEnd[endExclusive - 1];
  if (origStart === undefined || origEnd === undefined) return null;

  return {
    content: haystack.slice(0, origStart) + replace + haystack.slice(origEnd),
    strategy,
  };
}

/** Strategy 2: trim trailing whitespace per line in both sides. */
function tryTrimTrailing(haystack: string, needle: string, replace: string): FuzzyResult {
  return matchViaNormalizer(haystack, needle, replace, normTrimTrailing, "trim-trailing");
}

/** Strategy 4: collapse all runs of whitespace to a single space. */
function tryCollapseWhitespace(haystack: string, needle: string, replace: string): FuzzyResult {
  return matchViaNormalizer(haystack, needle, replace, normCollapseWs, "collapse-whitespace");
}

/** Strategy 3: strip common leading indent from needle, then match against
 *  every contiguous slice of haystack with that indent stripped. */
function tryStripLeadingIndent(haystack: string, needle: string, replace: string): FuzzyResult {
  const needleLines = needle.split("\n");
  // Drop fully-blank leading/trailing lines for indent calc.
  const meaningful = needleLines.filter((l) => l.trim().length > 0);
  if (meaningful.length === 0) return null;
  const commonIndent = meaningful.reduce((min, l) => {
    const m = l.match(/^[ \t]*/);
    const indent = m ? m[0].length : 0;
    return Math.min(min, indent);
  }, Infinity);
  if (!isFinite(commonIndent) || commonIndent === 0) return null;
  const stripped = needleLines
    .map((l) => (l.length >= commonIndent ? l.slice(commonIndent) : l))
    .join("\n");
  // Now look for `stripped` in haystack with leading indent stripped per
  // candidate window. Cheap implementation: find candidate start lines that
  // match the first stripped needle line ignoring indent.
  const hayLines = haystack.split("\n");
  const firstNeedle = stripped.split("\n")[0].trimStart();
  if (!firstNeedle) return null;
  const needleLineCount = stripped.split("\n").length;
  let matchStart = -1;
  let matchIndent = "";
  for (let i = 0; i + needleLineCount <= hayLines.length; i++) {
    const candidate = hayLines.slice(i, i + needleLineCount);
    const candFirstTrim = candidate[0].trimStart();
    if (candFirstTrim !== firstNeedle) continue;
    const indentMatch = candidate[0].match(/^[ \t]*/);
    const indent = indentMatch ? indentMatch[0] : "";
    const reindented = stripped
      .split("\n")
      .map((l) => (l.length ? indent + l : l))
      .join("\n");
    if (candidate.join("\n") === reindented) {
      if (matchStart !== -1) return null; // ambiguous
      matchStart = i;
      matchIndent = indent;
    }
  }
  if (matchStart === -1) return null;
  const replaceLines = replace.split("\n");
  const reIndentedReplace = replaceLines
    .map((l) => (l.length ? matchIndent + l : l))
    .join("\n");
  const before = hayLines.slice(0, matchStart).join("\n");
  const after = hayLines.slice(matchStart + needleLineCount).join("\n");
  const joiner1 = before ? "\n" : "";
  const joiner2 = after ? "\n" : "";
  return {
    content: `${before}${joiner1}${reIndentedReplace}${joiner2}${after}`,
    strategy: "strip-indent",
  };
}

/**
 * How much of the needle's interior survives inside the anchored span?
 *
 * The anchor strategy is the loosest one we have: it replaces EVERYTHING
 * between two matching lines. Without a similarity check, a needle whose
 * first and last lines happen to appear in the file (`return (` … `);`) would
 * blow away an unrelated region. Requiring most interior lines to still be
 * present keeps the loose strategy from being destructive.
 */
function interiorSimilarity(span: string, needle: string): number {
  const interior = needle
    .split("\n")
    .slice(1, -1)
    .map((l) => l.trim())
    .filter((l) => l.length > 2);
  if (interior.length === 0) return 1;
  const hits = interior.filter((l) => span.includes(l)).length;
  return hits / interior.length;
}

/** Strategy 5: first + last non-empty line as anchors. */
function tryFirstLastAnchor(haystack: string, needle: string, replace: string): FuzzyResult {
  const lines = needle.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;
  const first = lines[0];
  const last = lines[lines.length - 1];
  // Very short anchors ("}", ");") are far too generic to trust.
  if (first.trim().length < 4 || last.trim().length < 3) return null;
  if (countOccurrences(haystack, first) !== 1) return null;
  if (countOccurrences(haystack, last) !== 1) return null;
  const firstIdx = haystack.indexOf(first);
  const lastIdx = haystack.indexOf(last, firstIdx);
  if (lastIdx === -1) return null;
  const spanEnd = lastIdx + last.length;
  // Sanity cap: anchored span must not be wildly larger than the needle —
  // protect against accidentally swallowing huge chunks of unrelated code.
  const span = haystack.slice(firstIdx, spanEnd);
  if (span.length > needle.length * 3 + 200) return null;
  if (interiorSimilarity(span, needle) < 0.6) return null;
  return {
    content: haystack.slice(0, firstIdx) + replace + haystack.slice(spanEnd),
    strategy: "first-last-anchor",
  };
}

/**
 * Try the cascade. Returns null if no strategy produced a unique, safe match.
 * Caller should still treat null as "snippet did not match" and surface its
 * normal retry/fallback path.
 */
export function fuzzyReplace(
  haystack: string,
  needle: string,
  replace: string,
): FuzzyResult {
  if (!needle) return null;
  // Strategy 1 (literal) is the caller's responsibility.
  return (
    tryTrimTrailing(haystack, needle, replace) ??
    tryStripLeadingIndent(haystack, needle, replace) ??
    tryCollapseWhitespace(haystack, needle, replace) ??
    tryFirstLastAnchor(haystack, needle, replace)
  );
}
