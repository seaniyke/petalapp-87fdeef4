/**
 * Phase 2 — Design System Contract enforcement.
 *
 * The contract (see `design-system.server.ts`) is only worth committing if it
 * is checked. This is a deterministic lint over the emitted files: no model
 * call, no network, safe to run on every turn.
 *
 * It reports; it does not rewrite. The caller decides whether to feed the
 * findings back to the model as a repair instruction (structural turns) or to
 * log them (small edits).
 */

import type { ProjectFile } from "@/server/generate.server";
import type { PicDesignSystem } from "@/server/pic/pic-types";
import { TOKENS_START, TOKENS_END } from "@/server/design-systems/apply";

export interface DesignLintFinding {
  path: string;
  rule: string;
  severity: "error" | "warning";
  message: string;
  /** First offending snippet, trimmed. */
  sample?: string;
}

export interface DesignLintReport {
  findings: DesignLintFinding[];
  errorCount: number;
  warningCount: number;
  /** True when nothing blocking was found. */
  ok: boolean;
}

const CODE_EXT = /\.(tsx|jsx)$/;

/** Tailwind palette utilities that bypass the semantic token layer. */
const RAW_COLOR_UTILITY =
  /\b(?:bg|text|border|ring|from|via|to|fill|stroke|divide|outline|shadow)-(?:white|black|slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-(?:50|100|200|300|400|500|600|700|800|900|950))?\b/g;

const HEX_COLOR = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g;
const INLINE_STYLE_COLOR = /style=\{\{[^}]*\b(?:color|background(?:Color)?)\s*:/;
const ARBITRARY_FONT = /font-\[['"]?([A-Za-z][\w \-]*)['"]?\]/g;

/** Utilities that are semantic and therefore always allowed. */
const ALLOWED_TOKENS = new Set([
  "background",
  "foreground",
  "card",
  "popover",
  "primary",
  "secondary",
  "muted",
  "accent",
  "destructive",
  "success",
  "warning",
  "border",
  "input",
  "ring",
]);

function isTokenUtility(match: string): boolean {
  const parts = match.split("-");
  return parts.some((p) => ALLOWED_TOKENS.has(p));
}

function stripNoise(src: string): string {
  // Drop imports, comments and svg path data so we don't flag library code
  // or icon geometry as design violations.
  return src
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\bd="[^"]*"/g, "");
}

function firstMatch(re: RegExp, src: string): string | undefined {
  re.lastIndex = 0;
  const m = re.exec(src);
  return m ? m[0] : undefined;
}

/**
 * Lint emitted files against the committed contract.
 *
 * @param files    Files about to be written (or already written) this turn.
 * @param design   The committed contract. When null the lint is a no-op.
 * @param opts.skip Paths owned by the kit/library that the model does not author.
 */
export function lintDesignSystem(
  files: ProjectFile[],
  design: PicDesignSystem | null,
  opts: { skip?: (path: string) => boolean } = {},
): DesignLintReport {
  const findings: DesignLintFinding[] = [];
  if (!design) return { findings, errorCount: 0, warningCount: 0, ok: true };

  const skip = opts.skip ?? ((p: string) => /(^|\/)(components\/ui|node_modules)\//.test(p));

  const stylesFile = files.find((f) => /src\/(styles|index)\.css$/.test(f.path));
  if (stylesFile) {
    const css = stylesFile.content;
    const missing = ["--background", "--foreground", "--primary", "--muted-foreground", "--border"].filter(
      (token) => !css.includes(token),
    );
    if (missing.length) {
      findings.push({
        path: stylesFile.path,
        rule: "tokens/missing",
        severity: "error",
        message: `Design tokens missing from the stylesheet: ${missing.join(", ")}. Write the committed :root block.`,
      });
    }
    // Package projects: the marked design-system block is the token source.
    // Package tokens (var(--kimble-*) and the semantic roles it sets) are
    // legitimate; a missing or broken block means the package was bypassed.
    if (design.package) {
      const a = css.indexOf(TOKENS_START);
      const b = css.indexOf(TOKENS_END);
      if (a < 0 || b < a) {
        findings.push({
          path: stylesFile.path,
          rule: "package/tokens-block",
          severity: "error",
          message: `The ${design.package.systemId} design-system token block is missing or broken. It is installed by Kimble — do not edit or remove it.`,
        });
      }
    }
    for (const font of [design.typography.displayFont, design.typography.bodyFont]) {
      if (font && !css.includes(font) && !files.some((f) => f.content.includes(font))) {
        findings.push({
          path: stylesFile.path,
          rule: "typography/font-missing",
          severity: "warning",
          message: `Committed font "${font}" is never referenced. Load it and wire it to a font token.`,
        });
      }
    }
  }

  for (const file of files) {
    if (!CODE_EXT.test(file.path) || skip(file.path)) continue;
    const src = stripNoise(file.content);

    const rawColors = (src.match(RAW_COLOR_UTILITY) ?? []).filter((m) => !isTokenUtility(m));
    if (rawColors.length) {
      findings.push({
        path: file.path,
        rule: "color/raw-utility",
        severity: "error",
        message: `${rawColors.length} raw Tailwind colour utilit${rawColors.length === 1 ? "y" : "ies"} bypass the token layer. Use semantic classes instead.`,
        sample: Array.from(new Set(rawColors)).slice(0, 6).join(", "),
      });
    }

    const hexes = src.match(HEX_COLOR) ?? [];
    if (hexes.length) {
      findings.push({
        path: file.path,
        rule: "color/hardcoded-hex",
        severity: "error",
        message: `Hardcoded hex colour${hexes.length === 1 ? "" : "s"} found. Move the value into a design token.`,
        sample: Array.from(new Set(hexes)).slice(0, 6).join(", "),
      });
    }

    if (INLINE_STYLE_COLOR.test(src)) {
      findings.push({
        path: file.path,
        rule: "color/inline-style",
        severity: "warning",
        message: "Inline style colour found. Colours belong to the token layer.",
      });
    }

    const arbitraryFont = firstMatch(ARBITRARY_FONT, src);
    if (arbitraryFont) {
      findings.push({
        path: file.path,
        rule: "typography/arbitrary-font",
        severity: "warning",
        message: `Arbitrary font utility "${arbitraryFont}" bypasses the committed type system.`,
      });
    }

    // Interactive elements must be reachable and focus-visible.
    if (/<button\b/.test(src) && !/focus-visible:/.test(src) && !/className=\{?\s*cn\(/.test(src)) {
      findings.push({
        path: file.path,
        rule: "a11y/focus-visible",
        severity: "warning",
        message: "Bare <button> without a focus-visible style. Use the Button component or add a focus ring.",
      });
    }

    if (/<img\b(?![^>]*\balt=)/.test(src)) {
      findings.push({
        path: file.path,
        rule: "a11y/img-alt",
        severity: "warning",
        message: "<img> without alt text.",
      });
    }
  }

  const errorCount = findings.filter((f) => f.severity === "error").length;
  return { findings, errorCount, warningCount: findings.length - errorCount, ok: errorCount === 0 };
}

/** Turn findings into a compact repair instruction for the model. */
export function renderDesignLintFeedback(report: DesignLintReport, cap = 12): string {
  if (!report.findings.length) return "";
  const lines = report.findings
    .slice(0, cap)
    .map((f) => `- [${f.severity}] ${f.path} · ${f.rule}: ${f.message}${f.sample ? ` (${f.sample})` : ""}`);
  const extra = report.findings.length > cap ? `\n…and ${report.findings.length - cap} more.` : "";
  return `## DESIGN CONTRACT VIOLATIONS\nThe committed design system was not followed. Fix every item, changing only what is listed:\n${lines.join("\n")}${extra}`;
}
