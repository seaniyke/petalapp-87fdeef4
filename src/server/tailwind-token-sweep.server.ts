/**
 * Phase 7 — Tailwind token sweep.
 *
 * Failure mode this kills: a generated `.tsx` references a semantic Tailwind
 * utility (`bg-brand`, `text-accent-foreground`, `border-ring-strong`) or an
 * arbitrary-value var (`bg-[hsl(var(--surface-elevated))]`) whose CSS custom
 * property was never declared in `src/styles.css`. In Tailwind v4 this
 * generates NO CSS, so the element renders transparent/borderless — a silent
 * "invisible block" white-screen.
 *
 * Strategy:
 *   1. Parse `src/styles.css` to learn which `--color-X` / raw `--name`
 *      tokens exist.
 *   2. Scan all `.tsx` / `.jsx` className literals for utility references.
 *   3. For every unknown token, inject a sensible default into both `:root`
 *      and `.dark`, plus a `--color-X` mapping inside `@theme inline` for
 *      named-utility tokens. Derivations point at existing tokens so theme
 *      switches still work.
 *
 * Pure ProjectFile[] → ProjectFile[]. Only `src/styles.css` is mutated.
 * Never rewrites a `.tsx`.
 */

import type { ProjectFile } from "./generate.server";

const STYLES_PATH = "src/styles.css";
const SCANNABLE = /\.(tsx|jsx)$/;

// Tailwind utility prefixes that consume a color-family token.
const COLOR_UTIL_PREFIXES = [
  "bg",
  "text",
  "border",
  "ring",
  "from",
  "via",
  "to",
  "fill",
  "stroke",
  "outline",
  "decoration",
  "divide",
  "placeholder",
  "accent",
  "caret",
  "shadow",
];

// className extractor — pulls every string-literal class list out of source.
// Matches `className="…"`, `className={'…'}`, `className={\`…\`}`, `cn("…", "…")`,
// `clsx("…")`, `cva("…")`. We just yank all single/double/backtick strings that
// follow these markers — over-collecting is fine because the token regex below
// is itself strict.
const CLASSNAME_HOST_RE =
  /\b(?:className|class|cn|clsx|cva|tv|twMerge)\s*[=({,][\s\S]{0,2000}?(?=[)};]|$)/g;
const STRING_LIT_RE = /["'`]([^"'`\n]{1,400})["'`]/g;

// Named utility: prefix-token, with optional modifiers (/40, !, etc.) and
// arbitrary-value tail filtered out (handled separately).
// Examples we want to catch: bg-brand, text-accent-foreground, border-ring,
// from-brand-50 (treat "brand-50" as the token name), shadow-elegant.
// We intentionally allow digits + hyphens in the token; the denylist below
// filters Tailwind core scale names.
const NAMED_UTIL_RE = new RegExp(
  `(?<![A-Za-z0-9-])(?:${COLOR_UTIL_PREFIXES.join("|")})-([a-z][a-z0-9]*(?:-[a-z0-9]+)*)(?:\\/\\d+)?(?![A-Za-z0-9_-])`,
  "g",
);
const FONT_UTIL_RE = /(?<![A-Za-z0-9-])font-([a-z][a-z0-9-]*)(?![A-Za-z0-9_-])/g;
// `bg-[hsl(var(--surface))]`, `text-[color:var(--foo)]`, etc.
const ARBITRARY_VAR_RE = /\bvar\(--([a-z][a-z0-9-]+)\)/g;

// Tailwind core color scale names — never auto-inject these.
const TAILWIND_CORE_COLORS = new Set([
  "inherit",
  "current",
  "transparent",
  "black",
  "white",
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
]);

// Tailwind built-in non-color tokens (size scales, etc.) that share our prefixes.
const TAILWIND_NON_TOKEN = new Set([
  // border widths
  "0", "2", "4", "8",
  // text sizes
  "xs", "sm", "base", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl",
  // text alignment-ish
  "left", "right", "center", "justify", "start", "end",
  // text weight / style
  "thin", "extralight", "light", "normal", "medium", "semibold", "bold", "extrabold", "black",
  "italic", "uppercase", "lowercase", "capitalize",
  // text decoration
  "underline", "overline", "wavy", "dashed", "dotted", "solid", "double",
  // shadow sizes
  "inner", "none",
  // ring sizes
  "1", "3",
  // from/via/to positions (`from-50%`) — numeric, handled by lookahead, but the
  // bare "current" / "transparent" already in TAILWIND_CORE_COLORS.
  // stroke widths
]);

// Font tokens shipped by Tailwind by default.
const TAILWIND_CORE_FONTS = new Set(["sans", "serif", "mono"]);

interface ParsedStyles {
  /** Tokens declared in `@theme` / `@theme inline` (without the prefix). */
  themeColorTokens: Set<string>;
  themeFontTokens: Set<string>;
  /** Raw `--name` tokens declared anywhere in the file. */
  rawVars: Set<string>;
  /** Original styles.css content. */
  content: string;
}

function parseStyles(content: string): ParsedStyles {
  const themeColorTokens = new Set<string>();
  const themeFontTokens = new Set<string>();
  const rawVars = new Set<string>();

  // Collect any --name: ... declaration anywhere.
  const declRe = /--([a-zA-Z0-9-]+)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(content))) rawVars.add(m[1]);

  // Walk @theme blocks (including @theme inline) and pull --color-* / --font-*.
  const themeBlockRe = /@theme(?:\s+inline)?\s*\{([\s\S]*?)\}/g;
  let block: RegExpExecArray | null;
  while ((block = themeBlockRe.exec(content))) {
    const body = block[1];
    const inner = /--(color|font|radius|shadow)-([a-zA-Z0-9-]+)\s*:/g;
    let t: RegExpExecArray | null;
    while ((t = inner.exec(body))) {
      if (t[1] === "color") themeColorTokens.add(t[2]);
      else if (t[1] === "font") themeFontTokens.add(t[2]);
    }
  }

  return { themeColorTokens, themeFontTokens, rawVars, content };
}

function deriveColorValue(name: string, knownRaw: Set<string>): string {
  const n = name.toLowerCase();
  const pick = (...candidates: string[]): string => {
    for (const c of candidates) if (knownRaw.has(c)) return `var(--${c})`;
    return "var(--foreground)";
  };
  if (/(foreground|fg|content|on-)/.test(n)) return pick("foreground", "primary-foreground");
  if (/(muted|subtle|soft|placeholder)/.test(n)) return pick("muted", "muted-foreground");
  if (/(destructive|danger|error|warn)/.test(n)) return pick("destructive", "foreground");
  if (/(border|ring|outline|divide|stroke)/.test(n)) return pick("border", "muted");
  if (/(surface|panel|elevated|sheet|overlay)/.test(n)) return pick("card", "background");
  if (/(card|popover|tooltip)/.test(n)) return pick("card", "background");
  if (/(accent|brand|primary|cta|action|highlight|glow)/.test(n)) return pick("primary", "accent");
  if (/(secondary)/.test(n)) return pick("secondary", "muted");
  if (/(input|field)/.test(n)) return pick("input", "border");
  if (/(background|bg|base)/.test(n)) return pick("background", "card");
  return pick("foreground");
}

function deriveFontValue(name: string, knownRaw: Set<string>): string {
  if (knownRaw.has("font-sans")) return `var(--font-sans)`;
  if (/(mono|code)/i.test(name)) return `ui-monospace, SFMono-Regular, Menlo, monospace`;
  if (/(serif|display|heading|title)/i.test(name))
    return `ui-serif, Georgia, Cambria, "Times New Roman", serif`;
  return `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
}

function extractClassLiterals(source: string): string[] {
  const out: string[] = [];
  let host: RegExpExecArray | null;
  const hostRe = new RegExp(CLASSNAME_HOST_RE.source, "g");
  while ((host = hostRe.exec(source))) {
    const chunk = host[0];
    const litRe = new RegExp(STRING_LIT_RE.source, "g");
    let lit: RegExpExecArray | null;
    while ((lit = litRe.exec(chunk))) out.push(lit[1]);
  }
  return out;
}

function isCoreToken(token: string): boolean {
  if (TAILWIND_NON_TOKEN.has(token)) return true;
  // Pure numeric scale (e.g. "500").
  if (/^\d+$/.test(token)) return true;
  // Numbered Tailwind color: head segment matches a core palette and tail is numeric.
  const head = token.split("-")[0];
  if (TAILWIND_CORE_COLORS.has(head)) return true;
  return false;
}

export interface TailwindSweepResult {
  files: ProjectFile[];
  notes: string[];
  addedTokens: string[];
  addedThemeMappings: string[];
}

export function sweepTailwindTokens(input: ProjectFile[]): TailwindSweepResult {
  const stylesIdx = input.findIndex((f) => f.path === STYLES_PATH);
  if (stylesIdx < 0) {
    return { files: input, notes: [], addedTokens: [], addedThemeMappings: [] };
  }
  const styles = input[stylesIdx];
  const parsed = parseStyles(styles.content);

  // Collect referenced tokens.
  const referencedColors = new Set<string>();
  const referencedFonts = new Set<string>();
  const referencedRaw = new Set<string>();

  for (const f of input) {
    if (!SCANNABLE.test(f.path)) continue;
    const lits = extractClassLiterals(f.content);
    const blob = lits.join(" ");
    // Named color utilities.
    let m: RegExpExecArray | null;
    const colorRe = new RegExp(NAMED_UTIL_RE.source, "g");
    while ((m = colorRe.exec(blob))) {
      const tok = m[1];
      if (!isCoreToken(tok)) referencedColors.add(tok);
    }
    const fontRe = new RegExp(FONT_UTIL_RE.source, "g");
    while ((m = fontRe.exec(blob))) {
      const tok = m[1];
      if (!TAILWIND_CORE_FONTS.has(tok) && !TAILWIND_NON_TOKEN.has(tok)) {
        referencedFonts.add(tok);
      }
    }
    // Arbitrary var() refs — scan the WHOLE file, not just class literals,
    // because they can appear in style props too.
    const varRe = new RegExp(ARBITRARY_VAR_RE.source, "g");
    while ((m = varRe.exec(f.content))) referencedRaw.add(m[1]);
  }

  const missingColors = [...referencedColors].filter(
    (t) => !parsed.themeColorTokens.has(t),
  );
  const missingFonts = [...referencedFonts].filter(
    (t) => !parsed.themeFontTokens.has(t),
  );
  const missingRaw = [...referencedRaw].filter(
    (t) =>
      !parsed.rawVars.has(t) &&
      // Don't re-inject ones we're already going to add via the color path.
      !missingColors.includes(t),
  );

  if (missingColors.length === 0 && missingFonts.length === 0 && missingRaw.length === 0) {
    return { files: input, notes: [], addedTokens: [], addedThemeMappings: [] };
  }

  const knownRaw = new Set(parsed.rawVars);
  // Pretend we know the about-to-add raw tokens so derivations don't loop.
  for (const c of missingColors) knownRaw.add(c);

  // Build the new rules.
  const rootAdditions: string[] = [];
  const darkAdditions: string[] = [];
  const themeAdditions: string[] = [];
  const addedTokens: string[] = [];
  const addedThemeMappings: string[] = [];

  for (const tok of missingColors) {
    const val = deriveColorValue(tok, new Set(parsed.rawVars));
    rootAdditions.push(`  --${tok}: ${val};`);
    darkAdditions.push(`  --${tok}: ${val};`);
    themeAdditions.push(`  --color-${tok}: var(--${tok});`);
    addedTokens.push(tok);
    addedThemeMappings.push(`--color-${tok}`);
  }
  for (const tok of missingRaw) {
    const val = deriveColorValue(tok, new Set(parsed.rawVars));
    rootAdditions.push(`  --${tok}: ${val};`);
    darkAdditions.push(`  --${tok}: ${val};`);
    addedTokens.push(tok);
  }
  for (const tok of missingFonts) {
    const val = deriveFontValue(tok, new Set(parsed.rawVars));
    themeAdditions.push(`  --font-${tok}: ${val};`);
    addedTokens.push(`font-${tok}`);
    addedThemeMappings.push(`--font-${tok}`);
  }

  // Inject into styles.css.
  let content = styles.content;

  const injectInto = (selector: RegExp, additions: string[]): boolean => {
    if (additions.length === 0) return false;
    const match = selector.exec(content);
    if (!match) return false;
    // Find the matching `}` for this block.
    const openIdx = match.index + match[0].length - 1; // position of `{`
    let depth = 1;
    let closeIdx = -1;
    for (let i = openIdx + 1; i < content.length; i++) {
      if (content[i] === "{") depth++;
      else if (content[i] === "}") {
        depth--;
        if (depth === 0) {
          closeIdx = i;
          break;
        }
      }
    }
    if (closeIdx < 0) return false;
    const insertion = `\n  /* petal:auto — token sweep */\n${additions.join("\n")}\n`;
    content = content.slice(0, closeIdx) + insertion + content.slice(closeIdx);
    return true;
  };

  // :root
  const rootOk = injectInto(/:root\s*\{/, rootAdditions);
  if (!rootOk && rootAdditions.length > 0) {
    content += `\n:root {\n${rootAdditions.join("\n")}\n}\n`;
  }
  // .dark
  if (darkAdditions.length > 0) {
    const darkOk = injectInto(/\.dark\s*\{/, darkAdditions);
    if (!darkOk) {
      content += `\n.dark {\n${darkAdditions.join("\n")}\n}\n`;
    }
  }
  // @theme inline (preferred — leaves @theme blocks untouched).
  if (themeAdditions.length > 0) {
    const themeOk = injectInto(/@theme\s+inline\s*\{/, themeAdditions);
    if (!themeOk) {
      // Fall back to any @theme block.
      const themeOk2 = injectInto(/@theme\s*\{/, themeAdditions);
      if (!themeOk2) {
        content += `\n@theme inline {\n${themeAdditions.join("\n")}\n}\n`;
      }
    }
  }

  const out = input.slice();
  out[stylesIdx] = { path: styles.path, content };

  const notes: string[] = [];
  if (missingColors.length) {
    notes.push(
      `tailwind-tokens: injected ${missingColors.length} missing color token(s) (${missingColors.slice(0, 4).join(", ")}${missingColors.length > 4 ? "…" : ""})`,
    );
  }
  if (missingRaw.length) {
    notes.push(
      `tailwind-tokens: injected ${missingRaw.length} missing raw var(s) (${missingRaw.slice(0, 4).join(", ")}${missingRaw.length > 4 ? "…" : ""})`,
    );
  }
  if (missingFonts.length) {
    notes.push(
      `tailwind-tokens: injected ${missingFonts.length} missing font token(s) (${missingFonts.join(", ")})`,
    );
  }

  return { files: out, notes, addedTokens, addedThemeMappings };
}
