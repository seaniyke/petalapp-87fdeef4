/**
 * Palette integrity — the locked design must survive post-processing.
 *
 * Repair passes rewrite `src/styles.css`. When one of them emits a circular
 * declaration (`--primary: var(--primary)`) the property is invalid at
 * computed-value time and the entire brand palette silently disappears: the
 * app renders black-on-white and reads as "no design at all". When another
 * flattens semantic tokens onto `--foreground`, every surface collapses to the
 * same ink.
 *
 * This module is the deterministic guard:
 *
 *   - `findPaletteIssues` reports circular/flattened/unloaded-font problems.
 *   - `repairPaletteIntegrity` removes the offending declarations so the
 *     original design tokens take effect again.
 *
 * Pure ProjectFile[] → ProjectFile[]; only the stylesheet is touched.
 */

import type { ProjectFile } from "./generate.server";

const STYLE_PATHS = ["src/styles.css", "src/index.css", "src/app.css"];

/** Tokens that must carry a real value for an app to look designed. */
export const CORE_TOKENS = [
  "background",
  "foreground",
  "primary",
  "primary-foreground",
  "card",
  "border",
] as const;

const SYSTEM_FAMILY_RE =
  /^(ui-sans-serif|ui-serif|ui-monospace|system-ui|-apple-system|sans-serif|serif|monospace|inherit|initial|georgia|times new roman|arial|helvetica)$/i;

export interface PaletteIssue {
  kind: "circular" | "flattened" | "font-not-loaded" | "font-system";
  token: string;
  detail: string;
}

export function findStylesFile(files: ProjectFile[]): ProjectFile | undefined {
  for (const p of STYLE_PATHS) {
    const f = files.find((x) => x.path === p);
    if (f) return f;
  }
  return files.find((x) => /^src\/.*\.css$/.test(x.path));
}

interface Decl {
  token: string;
  value: string;
  /** Full matched text, used for removal. */
  raw: string;
  index: number;
}

const DECL_RE = /(^|\n)[^\S\n]*--([a-zA-Z0-9-]+)\s*:\s*([^;{}]+);/g;

function readDecls(css: string): Decl[] {
  const out: Decl[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(DECL_RE.source, "g");
  while ((m = re.exec(css))) {
    out.push({
      token: m[2],
      value: (m[3] ?? "").trim(),
      raw: m[0].replace(/^\n/, ""),
      index: m.index,
    });
  }
  return out;
}

/** `var(--x)` → "x", otherwise null. */
function refOf(value: string): string | null {
  const m = /^var\(\s*--([a-zA-Z0-9-]+)\s*(?:,[\s\S]*)?\)$/.exec(value.trim());
  return m ? m[1] : null;
}

/** Declarations whose value points at themselves, directly or one hop away. */
function circularTokens(decls: Decl[]): Decl[] {
  const lastRef = new Map<string, string | null>();
  for (const d of decls) lastRef.set(d.token, refOf(d.value));

  return decls.filter((d) => {
    const ref = refOf(d.value);
    if (!ref) return false;
    if (ref === d.token) return true;
    const hop = lastRef.get(ref);
    return hop === d.token;
  });
}

export function findPaletteIssues(files: ProjectFile[]): PaletteIssue[] {
  const styles = findStylesFile(files);
  if (!styles) return [];
  const css = styles.content;
  const decls = readDecls(css);
  const issues: PaletteIssue[] = [];

  for (const d of circularTokens(decls)) {
    issues.push({
      kind: "circular",
      token: d.token,
      detail: `--${d.token} resolves to itself (${d.value}); the browser drops it and the colour is lost`,
    });
  }

  // Flattening: a core colour token whose final declaration just points at
  // --foreground. That is how a palette turns into black-on-white.
  const finalValue = new Map<string, string>();
  for (const d of decls) finalValue.set(d.token, d.value);
  for (const tok of CORE_TOKENS) {
    if (tok === "foreground") continue;
    const v = finalValue.get(tok);
    if (v && refOf(v) === "foreground") {
      issues.push({
        kind: "flattened",
        token: tok,
        detail: `--${tok} was flattened onto --foreground, collapsing the palette to a single ink`,
      });
    }
  }

  // Typography: a declared display/body family must be a real family AND loaded.
  for (const token of ["font-display", "font-body"]) {
    const v = finalValue.get(token);
    if (!v) continue;
    const first = v.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
    if (!first) continue;
    if (SYSTEM_FAMILY_RE.test(first)) {
      issues.push({
        kind: "font-system",
        token,
        detail: `--${token} is a system stack (${first}); the locked type pair was overwritten`,
      });
      continue;
    }
    const loaded = files.some(
      (f) =>
        /fonts\.googleapis\.com|@fontsource|@font-face/i.test(f.content) &&
        f.content.replace(/\+/g, " ").toLowerCase().includes(first.toLowerCase()),
    );
    if (!loaded) {
      issues.push({
        kind: "font-not-loaded",
        token,
        detail: `--${token} declares "${first}" but nothing loads it, so the browser falls back to system sans`,
      });
    }
  }

  return issues;
}

export interface PaletteRepairResult {
  files: ProjectFile[];
  notes: string[];
  fixes: number;
}

/**
 * Strip circular and flattening declarations so the design tokens that were
 * authored earlier in the file take effect again. Font problems are left to
 * the design finisher, which owns the type pair.
 */
export function repairPaletteIntegrity(input: ProjectFile[]): PaletteRepairResult {
  const styles = findStylesFile(input);
  if (!styles) return { files: input, notes: [], fixes: 0 };

  const decls = readDecls(styles.content);
  const doomed = new Set<Decl>();
  for (const d of circularTokens(decls)) doomed.add(d);

  // Only strip a flattening declaration when an earlier, real declaration for
  // the same token exists — otherwise removing it would leave the token unset.
  const byToken = new Map<string, Decl[]>();
  for (const d of decls) {
    const list = byToken.get(d.token) ?? [];
    list.push(d);
    byToken.set(d.token, list);
  }
  for (const tok of CORE_TOKENS) {
    if (tok === "foreground") continue;
    const list = byToken.get(tok);
    if (!list || list.length < 2) continue;
    const last = list[list.length - 1];
    if (refOf(last.value) === "foreground" || refOf(last.value) === tok) doomed.add(last);
  }

  if (doomed.size === 0) return { files: input, notes: [], fixes: 0 };

  // Remove from the end so earlier indices stay valid.
  let css = styles.content;
  const ordered = [...doomed].sort((a, b) => b.index - a.index);
  for (const d of ordered) {
    const start = css.indexOf(d.raw, Math.max(0, d.index - 2));
    if (start < 0) continue;
    css = css.slice(0, start) + css.slice(start + d.raw.length);
  }

  const files = input.map((f) => (f.path === styles.path ? { ...f, content: css } : f));
  const tokens = [...new Set(ordered.map((d) => `--${d.token}`))];
  return {
    files,
    notes: [
      `palette-integrity: removed ${ordered.length} self-referential/flattening declaration(s) (${tokens.slice(0, 6).join(", ")}${tokens.length > 6 ? "…" : ""}) so the brand palette renders`,
    ],
    fixes: ordered.length,
  };
}
