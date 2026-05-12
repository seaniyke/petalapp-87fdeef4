/**
 * Deterministic visual edits.
 *
 * Given a short natural-language instruction like "make it bigger and red",
 * compute a set of Tailwind class operations and apply them to the
 * `className="..."` attribute that defines the picked element. Zero LLM calls.
 *
 * Scope on purpose:
 * - Only handles `className="literal string"`. Skips `className={...}`,
 *   template literals, `cn(...)`, etc. — too risky to rewrite.
 * - Only handles a small, bulletproof vocabulary. Anything we can't parse
 *   confidently returns null so the caller falls back to the LLM path.
 */

export type ClassOp =
  | { kind: "add"; token: string }
  | { kind: "remove"; token: string }
  /** Replace any token matching this prefix-regex with the given token. */
  | { kind: "replacePrefix"; prefix: RegExp; token: string }
  /** Step a numeric scale up/down (e.g. text-sm → text-base). */
  | { kind: "stepScale"; family: ScaleFamily; direction: "up" | "down" };

export type QuickEditPlan = {
  /** Human-readable summary, e.g. "bigger, red, rounded". */
  summary: string;
  ops: ClassOp[];
};

type ScaleFamily = "text-size" | "padding" | "margin" | "rounded" | "shadow" | "gap";

const TEXT_SIZES = ["text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-2xl", "text-3xl", "text-4xl", "text-5xl", "text-6xl", "text-7xl", "text-8xl", "text-9xl"];
const PADDINGS = ["p-0", "p-1", "p-2", "p-3", "p-4", "p-5", "p-6", "p-8", "p-10", "p-12", "p-16"];
const MARGINS = ["m-0", "m-1", "m-2", "m-3", "m-4", "m-5", "m-6", "m-8", "m-10", "m-12", "m-16"];
const ROUNDEDS = ["rounded-none", "rounded-sm", "rounded", "rounded-md", "rounded-lg", "rounded-xl", "rounded-2xl", "rounded-3xl", "rounded-full"];
const SHADOWS = ["shadow-none", "shadow-sm", "shadow", "shadow-md", "shadow-lg", "shadow-xl", "shadow-2xl"];
const GAPS = ["gap-0", "gap-1", "gap-2", "gap-3", "gap-4", "gap-5", "gap-6", "gap-8", "gap-10"];

const SCALES: Record<ScaleFamily, string[]> = {
  "text-size": TEXT_SIZES,
  padding: PADDINGS,
  margin: MARGINS,
  rounded: ROUNDEDS,
  shadow: SHADOWS,
  gap: GAPS,
};

/** Tailwind color names we understand without a shade number. */
const COLOR_NAMES = [
  "slate", "gray", "zinc", "neutral", "stone",
  "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan",
  "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose",
];

const NAMED_COLOR_ALIASES: Record<string, string> = {
  white: "white",
  black: "black",
  transparent: "transparent",
};

/**
 * Try to parse a short instruction into a deterministic plan.
 * Returns null if anything is ambiguous — caller should then fall back to LLM.
 */
export function tryParseQuickEdit(rawInstruction: string): QuickEditPlan | null {
  const text = rawInstruction.trim().toLowerCase();
  if (!text) return null;
  // Short asks only — anything long is probably layout/logic, not styling.
  if (text.length > 120) return null;

  const ops: ClassOp[] = [];
  const summary: string[] = [];

  // Strip filler words.
  const cleaned = text
    .replace(/\b(please|can you|could you|make it|make this|make the|the|it|this|a bit|slightly|more|much|very|really|just)\b/g, " ")
    .replace(/[.!?,;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = cleaned.split(" ").filter(Boolean);
  if (tokens.length === 0) return null;

  // Track whether any rule matched. If none, return null.
  let matched = false;

  // Detect background-target: "background red", "bg blue".
  const isBackgroundTarget = /\b(background|bg)\b/.test(cleaned);

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    // Size adjustments
    if (t === "bigger" || t === "larger" || t === "huge" || t === "big") {
      ops.push({ kind: "stepScale", family: "text-size", direction: "up" });
      summary.push("bigger");
      matched = true;
      continue;
    }
    if (t === "smaller" || t === "tiny" || t === "small") {
      ops.push({ kind: "stepScale", family: "text-size", direction: "down" });
      summary.push("smaller");
      matched = true;
      continue;
    }

    // Weight
    if (t === "bold" || t === "bolder") {
      ops.push({ kind: "replacePrefix", prefix: /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/, token: "font-bold" });
      ops.push({ kind: "add", token: "font-bold" });
      summary.push("bold");
      matched = true;
      continue;
    }
    if (t === "thinner" || t === "lighter") {
      // "lighter" can also mean color — only treat as weight if no color word nearby.
      if (!hasColorWordNearby(tokens, i)) {
        ops.push({ kind: "replacePrefix", prefix: /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/, token: "font-light" });
        ops.push({ kind: "add", token: "font-light" });
        summary.push("lighter weight");
        matched = true;
        continue;
      }
    }

    // Italic
    if (t === "italic") {
      ops.push({ kind: "add", token: "italic" });
      summary.push("italic");
      matched = true;
      continue;
    }

    // Casing
    if (t === "uppercase") { ops.push({ kind: "add", token: "uppercase" }); summary.push("uppercase"); matched = true; continue; }
    if (t === "lowercase") { ops.push({ kind: "add", token: "lowercase" }); summary.push("lowercase"); matched = true; continue; }
    if (t === "capitalize") { ops.push({ kind: "add", token: "capitalize" }); summary.push("capitalize"); matched = true; continue; }

    // Alignment
    if (t === "center" || t === "centered") {
      ops.push({ kind: "replacePrefix", prefix: /^text-(left|center|right|justify)$/, token: "text-center" });
      ops.push({ kind: "add", token: "text-center" });
      summary.push("centered");
      matched = true;
      continue;
    }
    if (t === "left" && (tokens[i + 1] === "align" || tokens[i + 1] === "aligned" || tokens[i - 1] === "align")) {
      ops.push({ kind: "replacePrefix", prefix: /^text-(left|center|right|justify)$/, token: "text-left" });
      ops.push({ kind: "add", token: "text-left" });
      summary.push("left-aligned");
      matched = true;
      continue;
    }
    if (t === "right" && (tokens[i + 1] === "align" || tokens[i + 1] === "aligned" || tokens[i - 1] === "align")) {
      ops.push({ kind: "replacePrefix", prefix: /^text-(left|center|right|justify)$/, token: "text-right" });
      ops.push({ kind: "add", token: "text-right" });
      summary.push("right-aligned");
      matched = true;
      continue;
    }

    // Rounded
    if (t === "rounded" || t === "round") {
      // "more rounded" → step up; bare "rounded" → rounded-xl
      const prev = tokens[i - 1];
      if (prev === "fully" || tokens[i + 1] === "fully" || /\bfull\b/.test(cleaned)) {
        ops.push({ kind: "replacePrefix", prefix: /^rounded(-\w+)?$/, token: "rounded-full" });
        ops.push({ kind: "add", token: "rounded-full" });
        summary.push("fully rounded");
      } else {
        ops.push({ kind: "replacePrefix", prefix: /^rounded(-\w+)?$/, token: "rounded-xl" });
        ops.push({ kind: "add", token: "rounded-xl" });
        summary.push("rounded");
      }
      matched = true;
      continue;
    }
    if (t === "square" || (t === "sharp" && tokens[i + 1] === "corners")) {
      ops.push({ kind: "replacePrefix", prefix: /^rounded(-\w+)?$/, token: "rounded-none" });
      summary.push("square corners");
      matched = true;
      continue;
    }

    // Shadow
    if (t === "shadow" || t === "shadowed") {
      ops.push({ kind: "replacePrefix", prefix: /^shadow(-\w+)?$/, token: "shadow-lg" });
      ops.push({ kind: "add", token: "shadow-lg" });
      summary.push("shadow");
      matched = true;
      continue;
    }
    if ((t === "no" && tokens[i + 1] === "shadow") || t === "flat") {
      ops.push({ kind: "replacePrefix", prefix: /^shadow(-\w+)?$/, token: "shadow-none" });
      summary.push("no shadow");
      matched = true;
      continue;
    }

    // Padding
    if (t === "padding" || t === "padded" || t === "spacious" || t === "roomy") {
      ops.push({ kind: "stepScale", family: "padding", direction: "up" });
      summary.push("more padding");
      matched = true;
      continue;
    }
    if (t === "compact" || t === "tighter" || t === "tight") {
      ops.push({ kind: "stepScale", family: "padding", direction: "down" });
      summary.push("tighter");
      matched = true;
      continue;
    }

    // Colors
    const colorMatch = matchColorToken(t);
    if (colorMatch) {
      const prefix = isBackgroundTarget ? "bg" : "text";
      const token = `${prefix}-${colorMatch}`;
      ops.push({ kind: "replacePrefix", prefix: new RegExp(`^${prefix}-(${COLOR_NAMES.join("|")})-\\d+$`), token });
      if (isBackgroundTarget) {
        ops.push({ kind: "replacePrefix", prefix: /^bg-(white|black|transparent)$/, token });
      } else {
        ops.push({ kind: "replacePrefix", prefix: /^text-(white|black|transparent)$/, token });
      }
      ops.push({ kind: "add", token });
      summary.push(`${isBackgroundTarget ? "bg " : ""}${t}`);
      matched = true;
      continue;
    }

    // Skip our connector words silently.
    if (["and", "with", "background", "bg", "color", "make", "all", "&", "fully", "align", "aligned", "corners"].includes(t)) continue;

    // Anything else → bail to LLM.
    return null;
  }

  if (!matched || ops.length === 0) return null;

  return {
    summary: summary.join(", "),
    ops,
  };
}

function hasColorWordNearby(tokens: string[], i: number): boolean {
  for (let j = Math.max(0, i - 2); j <= Math.min(tokens.length - 1, i + 2); j++) {
    if (j === i) continue;
    if (matchColorToken(tokens[j])) return true;
  }
  return false;
}

function matchColorToken(t: string): string | null {
  if (NAMED_COLOR_ALIASES[t]) return NAMED_COLOR_ALIASES[t];
  if (COLOR_NAMES.includes(t)) return `${t}-500`;
  // "blue-600" style
  const m = t.match(/^(\w+)-(\d{2,3})$/);
  if (m && COLOR_NAMES.includes(m[1])) return `${m[1]}-${m[2]}`;
  return null;
}

/** Apply class ops to a className string. Returns updated string. */
export function applyOpsToClassName(input: string, ops: ClassOp[]): string {
  let tokens = input.split(/\s+/).filter(Boolean);

  for (const op of ops) {
    if (op.kind === "add") {
      if (!tokens.includes(op.token)) tokens.push(op.token);
    } else if (op.kind === "remove") {
      tokens = tokens.filter((t) => t !== op.token);
    } else if (op.kind === "replacePrefix") {
      tokens = tokens.filter((t) => !op.prefix.test(t));
    } else if (op.kind === "stepScale") {
      const scale = SCALES[op.family];
      const idx = tokens.findIndex((t) => scale.includes(t));
      if (idx === -1) {
        // No existing token in this family — pick a sensible default.
        const defaults: Record<ScaleFamily, string> = {
          "text-size": op.direction === "up" ? "text-lg" : "text-sm",
          padding: op.direction === "up" ? "p-4" : "p-2",
          margin: op.direction === "up" ? "m-4" : "m-2",
          rounded: op.direction === "up" ? "rounded-xl" : "rounded-sm",
          shadow: op.direction === "up" ? "shadow-lg" : "shadow-sm",
          gap: op.direction === "up" ? "gap-4" : "gap-2",
        };
        tokens.push(defaults[op.family]);
      } else {
        const cur = tokens[idx];
        const pos = scale.indexOf(cur);
        const next = op.direction === "up" ? Math.min(scale.length - 1, pos + 1) : Math.max(0, pos - 1);
        tokens[idx] = scale[next];
      }
    }
  }

  // De-dupe while preserving order.
  const seen = new Set<string>();
  return tokens.filter((t) => (seen.has(t) ? false : (seen.add(t), true))).join(" ");
}

/**
 * Find the className="..." attribute on or just after `sourceLine` (1-indexed)
 * in `content` and rewrite it according to ops.
 *
 * Returns null if we can't safely identify a string-literal className to edit.
 */
export function applyQuickEditToFile(
  content: string,
  sourceLine: number,
  ops: ClassOp[],
): { content: string; before: string; after: string } | null {
  const lines = content.split("\n");
  if (sourceLine < 1 || sourceLine > lines.length) return null;

  // Look from sourceLine through the next ~40 lines for a className="..."
  const startIdx = sourceLine - 1;
  const endIdx = Math.min(lines.length, startIdx + 40);
  const slice = lines.slice(startIdx, endIdx).join("\n");

  // Match className="literal" only — skip className={...} and template literals.
  const re = /className\s*=\s*"([^"\\]*(?:\\.[^"\\]*)*)"/;
  const m = slice.match(re);
  if (!m || m.index === undefined) return null;

  const before = m[1];
  const after = applyOpsToClassName(before, ops);
  if (after === before) return null;

  // Compose new content.
  const newSlice = slice.slice(0, m.index) + `className="${after}"` + slice.slice(m.index + m[0].length);
  const newLines = lines.slice(0, startIdx).concat(newSlice.split("\n")).concat(lines.slice(endIdx));
  return { content: newLines.join("\n"), before, after };
}
