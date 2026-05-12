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
 *   2. Trim-trailing-whitespace match — collapse `\s+$` per line.
 *   3. Normalize-leading-indent match — strip common leading indent from
 *      both haystack and needle, match, then re-anchor by line numbers.
 *   4. Collapse-internal-whitespace match — replace runs of whitespace with
 *      a single space; useful for prettier reflows / wrapped JSX.
 *   5. First+last anchor match — use the first non-empty line and last
 *      non-empty line of the needle as anchors; require both to occur exactly
 *      once and in order, then replace the entire span between them.
 *
 * Every strategy must produce a SINGLE unique match. Multiple matches → skip.
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

/** Strategy 2: trim trailing whitespace per line in both sides. */
function tryTrimTrailing(haystack: string, needle: string, replace: string): FuzzyResult {
  const norm = (s: string) => s.split("\n").map((l) => l.replace(/[ \t]+$/g, "")).join("\n");
  const h = norm(haystack);
  const n = norm(needle);
  if (countOccurrences(h, n) !== 1) return null;
  // We matched against normalized text; we must splice into the ORIGINAL
  // haystack at the equivalent position. Walk lines in lock-step.
  const idx = h.indexOf(n);
  // Find the same starting line in original haystack.
  const linesBefore = h.slice(0, idx).split("\n").length - 1;
  const needleLines = n.split("\n").length;
  const origLines = haystack.split("\n");
  const before = origLines.slice(0, linesBefore).join("\n");
  const after = origLines.slice(linesBefore + needleLines).join("\n");
  const joiner1 = before ? "\n" : "";
  const joiner2 = after ? "\n" : "";
  return { content: `${before}${joiner1}${replace}${joiner2}${after}`, strategy: "trim-trailing" };
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

/** Strategy 4: collapse all runs of whitespace to a single space, then
 *  match. We can't safely splice if internal whitespace differs, so this
 *  strategy only confirms uniqueness — and only fires when the original
 *  literal was found 0 times. We then locate the anchor span via the
 *  first+last line anchor strategy below. */
function tryFirstLastAnchor(haystack: string, needle: string, replace: string): FuzzyResult {
  const lines = needle.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;
  const first = lines[0];
  const last = lines[lines.length - 1];
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
    tryFirstLastAnchor(haystack, needle, replace)
  );
}
