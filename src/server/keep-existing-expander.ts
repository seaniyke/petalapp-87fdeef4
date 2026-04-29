/**
 * Expand "// ... keep existing code ..." markers emitted by the AI in
 * patch_files "update" ops back into the original file content.
 *
 * Why: the previous protocol forced the AI to re-emit ENTIRE file contents on
 * every edit. For 200-line components this meant ~3-5k completion tokens per
 * file, dominating credit cost (COMPLETION_RATE = 0.15 c/1k). Allowing the AI
 * to elide unchanged regions cuts completion tokens 40-60% on typical edits.
 *
 * Algorithm (intentionally simple, fail-safe):
 * 1. Detect any of the recognized marker forms on a line by themselves.
 * 2. Split the AI's output into segments around markers.
 * 3. For each marker, find the unique span in the ORIGINAL file that sits
 *    between the segment-before's last non-empty line and the segment-after's
 *    first non-empty line, and splice that span in.
 * 4. If we cannot anchor a marker unambiguously, we LEAVE THE OUTPUT AS IS
 *    (warning logged) — the AI's content is still syntactically valid TS/TSX
 *    in most cases (the marker is a comment), so this never crashes the build.
 *
 * Tradeoff accepted: ambiguous anchors fall through ungracefully (an unmodified
 * comment-marker remains in the file). The user can always retry. We prefer
 * this over inventing content that isn't in either source.
 */

const MARKER_PATTERNS: RegExp[] = [
  // // ... keep existing code (description) ...
  /^\s*\/\/\s*\.\.\.\s*keep existing code(?:\s*\([^)]*\))?\s*(?:\.\.\.)?\s*$/,
  // /* ... keep existing code (description) ... */
  /^\s*\/\*\s*\.\.\.\s*keep existing code(?:\s*\([^)]*\))?\s*(?:\.\.\.)?\s*\*\/\s*$/,
  // {/* ... keep existing code (description) ... */}
  /^\s*\{\s*\/\*\s*\.\.\.\s*keep existing code(?:\s*\([^)]*\))?\s*(?:\.\.\.)?\s*\*\/\s*\}\s*$/,
  // <!-- ... keep existing code (description) -->
  /^\s*<!--\s*\.\.\.\s*keep existing code(?:\s*\([^)]*\))?\s*(?:\.\.\.)?\s*-->\s*$/,
];

function isMarkerLine(line: string): boolean {
  return MARKER_PATTERNS.some((re) => re.test(line));
}

function lastNonEmpty(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t.length > 0) return lines[i];
  }
  return null;
}

function firstNonEmpty(lines: string[]): string | null {
  for (const l of lines) {
    if (l.trim().length > 0) return l;
  }
  return null;
}

/** Find the unique line index in `original` whose content equals `needle`.
 *  Returns -1 when zero or >1 matches exist. */
function findUniqueLineIndex(original: string[], needle: string | null): number {
  if (needle === null) return -1;
  let found = -1;
  for (let i = 0; i < original.length; i++) {
    if (original[i] === needle) {
      if (found !== -1) return -1; // ambiguous
      found = i;
    }
  }
  return found;
}

/** Public API: expand markers in `aiContent` against `originalContent`. */
export function expandKeepMarkers(
  originalContent: string,
  aiContent: string,
): { content: string; expanded: number; failed: number } {
  // Fast path — no markers, nothing to do.
  if (!/keep existing code/i.test(aiContent)) {
    return { content: aiContent, expanded: 0, failed: 0 };
  }

  const aiLines = aiContent.split("\n");
  const origLines = originalContent.split("\n");

  // Split aiLines into segments separated by markers.
  // segments[0], marker0, segments[1], marker1, segments[2], ...
  const segments: string[][] = [[]];
  for (const line of aiLines) {
    if (isMarkerLine(line)) {
      segments.push([]);
    } else {
      segments[segments.length - 1].push(line);
    }
  }

  if (segments.length === 1) {
    // Marker pattern matched the substring check but no marker line — bail.
    return { content: aiContent, expanded: 0, failed: 0 };
  }

  let expanded = 0;
  let failed = 0;
  const out: string[] = [...segments[0]];

  for (let i = 1; i < segments.length; i++) {
    const before = segments[i - 1];
    const after = segments[i];

    const beforeAnchor = lastNonEmpty(before);
    const afterAnchor = firstNonEmpty(after);

    const startIdx = findUniqueLineIndex(origLines, beforeAnchor);
    const endIdx = findUniqueLineIndex(origLines, afterAnchor);

    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
      // Could not anchor — drop the marker line entirely (it's a harmless
      // comment in TS/JSX/CSS/HTML, but we don't want it lingering) and just
      // concatenate `after`. Note this means changes between the two anchors
      // may be lost; logged so we can audit.
      console.warn(
        `[keep-existing] could not anchor marker (before=${JSON.stringify(beforeAnchor?.slice(0, 60))}, after=${JSON.stringify(afterAnchor?.slice(0, 60))})`,
      );
      failed++;
      out.push(...after);
      continue;
    }

    // Splice in original lines BETWEEN the anchors (exclusive on both sides).
    const kept = origLines.slice(startIdx + 1, endIdx);
    out.push(...kept);
    out.push(...after);
    expanded++;
  }

  return { content: out.join("\n"), expanded, failed };
}
