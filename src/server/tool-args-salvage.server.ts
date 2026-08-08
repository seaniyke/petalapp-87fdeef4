/**
 * Salvage usable work out of a malformed / truncated tool-call payload.
 *
 * The generation pipeline used to be all-or-nothing: if the model's
 * `patch_files` / `write_project` JSON failed `JSON.parse` — typically because
 * the stream was cut off mid-array on a big multi-part request — the entire
 * turn was discarded and the user got "I couldn't pin down a safe change",
 * even though the first N ops were complete and perfectly applicable.
 *
 * This module scans the raw argument string and recovers every COMPLETE
 * element of the `ops` / `files` array, plus any top-level string fields that
 * were emitted before the cut. Partial (unterminated) elements are dropped.
 *
 * Pure, dependency-free, and safe: it never invents content, it only keeps
 * fragments that parse on their own.
 */

export type SalvagedToolArgs = {
  /** Parsed object with `ops` or `files` plus any recovered string fields. */
  parsed: Record<string, unknown>;
  /** How many array elements were recovered. */
  recovered: number;
  /** True when the raw payload looked truncated rather than plain-invalid. */
  truncated: boolean;
};

/**
 * Walk `src` from the index of an opening `[` and return every complete
 * top-level JSON object inside it. Stops at the end of the string (truncated)
 * or at the matching `]`.
 */
function collectArrayElements(src: string, openBracket: number): string[] {
  const out: string[] = [];
  let i = openBracket + 1;
  const n = src.length;

  while (i < n) {
    // Skip whitespace and separators between elements.
    while (i < n && /[\s,]/.test(src[i]!)) i++;
    if (i >= n) break;
    if (src[i] === "]") break;
    if (src[i] !== "{") break; // non-object element — not a shape we salvage

    const start = i;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let closed = false;

    for (; i < n; i++) {
      const ch = src[i]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          i++;
          closed = true;
          break;
        }
      }
    }

    if (!closed) break; // truncated element — discard it
    out.push(src.slice(start, i));
  }

  return out;
}

/** Extract a top-level `"key": "value"` string field, if it terminated. */
function extractStringField(src: string, key: string): string | undefined {
  const marker = `"${key}"`;
  const at = src.indexOf(marker);
  if (at === -1) return undefined;
  let i = at + marker.length;
  while (i < src.length && /[\s:]/.test(src[i]!)) i++;
  if (src[i] !== '"') return undefined;
  const start = i;
  i++;
  let escaped = false;
  for (; i < src.length; i++) {
    const ch = src[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") escaped = true;
    else if (ch === '"') {
      try {
        return JSON.parse(src.slice(start, i + 1)) as string;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * Attempt to rescue a truncated/invalid tool-args string.
 * Returns null when nothing usable could be recovered.
 */
export function salvagePartialToolArgs(
  rawArgs: string,
  toolName: string,
): SalvagedToolArgs | null {
  if (!rawArgs || rawArgs.length < 8) return null;
  const arrayKey = toolName === "write_project" ? "files" : "ops";
  const marker = `"${arrayKey}"`;
  const keyAt = rawArgs.indexOf(marker);
  if (keyAt === -1) return null;

  const openBracket = rawArgs.indexOf("[", keyAt + marker.length);
  if (openBracket === -1) return null;

  const chunks = collectArrayElements(rawArgs, openBracket);
  const elements: Record<string, unknown>[] = [];
  for (const chunk of chunks) {
    try {
      const value = JSON.parse(chunk) as Record<string, unknown>;
      if (value && typeof value === "object") elements.push(value);
    } catch {
      // A single unparseable element must not sink the ones around it.
    }
  }
  if (elements.length === 0) return null;

  const truncated = !rawArgs.trimEnd().endsWith("}");
  const parsed: Record<string, unknown> = { [arrayKey]: elements };
  for (const field of ["summary", "plan", "recap"]) {
    const value = extractStringField(rawArgs, field);
    if (value) parsed[field] = value;
  }

  return { parsed, recovered: elements.length, truncated };
}

/**
 * Drop structurally unusable entries from a recovered/parsed op list so one
 * malformed op can't fail a turn that also contains good ones.
 * Returns the kept ops plus a count of what was discarded.
 */
export function dropUnusableOps<T extends Record<string, unknown>>(
  ops: T[],
): { ops: T[]; dropped: number } {
  const kept = ops.filter((op) => {
    const kind = typeof op["op"] === "string" ? (op["op"] as string) : "";
    const path = typeof op["path"] === "string" ? (op["path"] as string).trim() : "";
    if (!kind || !path) return false;
    if (kind === "delete") return true;
    if (kind === "replace") {
      return typeof op["search"] === "string" && (op["search"] as string).length > 0 &&
        typeof op["replace"] === "string";
    }
    if (kind === "create" || kind === "update") return typeof op["content"] === "string";
    // Unknown op kinds (e.g. `ast-patch`) are passed through untouched — the
    // downstream applier owns their validation.
    return true;
  });
  return { ops: kept, dropped: ops.length - kept.length };
}

/** Same idea for `write_project` file entries. */
export function dropUnusableFiles<T extends Record<string, unknown>>(
  files: T[],
): { files: T[]; dropped: number } {
  const kept = files.filter(
    (f) =>
      typeof f["path"] === "string" &&
      (f["path"] as string).trim().length > 0 &&
      typeof f["content"] === "string",
  );
  return { files: kept, dropped: files.length - kept.length };
}
