/**
 * Palette floor — an app must never ship the scaffold's default purple.
 *
 * The design director picks a locked palette and the prompt asks the model to
 * wire it into `src/styles.css`. In practice the model leaves the scaffold
 * `:root` untouched, so every build renders the same indigo/purple primary on
 * white — the "no design, nothing special" failure.
 *
 * This pass is deterministic: when the palette in `styles.css` is still the
 * untouched scaffold default, it writes a real palette derived from the
 * project's own brief (or an explicitly supplied pick) into `:root` and
 * `.dark`. It never touches a palette the model actually customised.
 */

import { pickDesignForBrief, type DesignPick } from "./palette-presets.server";

/** The scaffold's default primary. Its presence means "nobody themed this". */
const SCAFFOLD_PRIMARY = /--primary:\s*oklch\(0\.55\s+0\.18\s+280\)/;

interface Rgb { r: number; g: number; b: number }

function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Perceived luminance, 0 (black) → 1 (white). */
function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Blend `amount` (0..1) of `b` into `a`. */
function mix(a: string, b: string, amount: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return toHex({
    r: x.r + (y.r - x.r) * amount,
    g: x.g + (y.g - x.g) * amount,
    b: x.b + (y.b - x.b) * amount,
  });
}

/** Readable text colour on top of `bg`. */
function onColor(bg: string): string {
  return luminance(bg) > 0.55 ? "#0d0d0f" : "#fbfbfd";
}

export interface PaletteBlocks { root: string; dark: string }

export function buildPaletteBlocks(pick: DesignPick): PaletteBlocks {
  const [c0, c1, primary, glow] = pick.palette.colors;
  const lightBase = luminance(c0) > 0.5;

  // Light theme. When the preset is dark-first we build the light surface set
  // from white so the app still has a usable light mode.
  const bg = lightBase ? c0 : "#ffffff";
  const card = lightBase ? mix(c1, "#ffffff", 0.35) : "#ffffff";
  const fg = onColor(bg);
  const muted = mix(bg, fg, 0.05);
  const border = mix(bg, fg, 0.13);

  const root = [
    `  --background: ${bg};`,
    `  --foreground: ${fg};`,
    `  --card: ${card};`,
    `  --card-foreground: ${fg};`,
    `  --popover: ${card};`,
    `  --popover-foreground: ${fg};`,
    `  --primary: ${primary};`,
    `  --primary-foreground: ${onColor(primary)};`,
    `  --primary-glow: ${glow};`,
    `  --secondary: ${muted};`,
    `  --secondary-foreground: ${fg};`,
    `  --muted: ${muted};`,
    `  --muted-foreground: ${mix(fg, bg, 0.42)};`,
    `  --accent: ${mix(glow, bg, 0.72)};`,
    `  --accent-foreground: ${fg};`,
    `  --destructive: #d0342c;`,
    `  --destructive-foreground: #ffffff;`,
    `  --border: ${border};`,
    `  --input: ${border};`,
    `  --ring: ${primary};`,
  ].join("\n");

  // Dark theme. Anchored on the preset's deep colour when it is genuinely
  // dark, otherwise on a neutral tinted with the accent.
  const dbg = lightBase ? mix("#0d0d10", primary, 0.06) : c0;
  const dcard = lightBase ? mix(dbg, "#ffffff", 0.06) : mix(c1, "#000000", 0.1);
  const dfg = onColor(dbg);
  const dborder = mix(dbg, dfg, 0.16);

  const dark = [
    `  --background: ${dbg};`,
    `  --foreground: ${dfg};`,
    `  --card: ${dcard};`,
    `  --card-foreground: ${dfg};`,
    `  --popover: ${dcard};`,
    `  --popover-foreground: ${dfg};`,
    `  --primary: ${mix(primary, "#ffffff", lightBase ? 0.12 : 0.06)};`,
    `  --primary-foreground: ${onColor(primary)};`,
    `  --primary-glow: ${glow};`,
    `  --secondary: ${mix(dbg, dfg, 0.09)};`,
    `  --secondary-foreground: ${dfg};`,
    `  --muted: ${mix(dbg, dfg, 0.09)};`,
    `  --muted-foreground: ${mix(dfg, dbg, 0.38)};`,
    `  --accent: ${mix(glow, dbg, 0.7)};`,
    `  --accent-foreground: ${dfg};`,
    `  --destructive: #e0524a;`,
    `  --destructive-foreground: #ffffff;`,
    `  --border: ${dborder};`,
    `  --input: ${dborder};`,
    `  --ring: ${mix(primary, "#ffffff", 0.12)};`,
  ].join("\n");

  return { root, dark };
}

/** Replace the body of the first `selector { … }` block. */
function replaceBlock(css: string, selector: string, body: string): string | null {
  const rx = new RegExp(`(^|\\n)(${selector})\\s*\\{`, "m");
  const m = rx.exec(css);
  if (!m) return null;
  const open = m.index + m[0].length;
  let depth = 1;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return `${css.slice(0, open)}\n${body}\n${css.slice(i)}`;
    }
  }
  return null;
}

export interface PaletteFloorResult { css: string; changed: boolean; label: string | null }

/**
 * Apply the palette floor to a stylesheet. `brief` is used only when no pick
 * is supplied, so the choice stays deterministic for a given project.
 */
export function applyPaletteFloor(css: string, brief: string, pick?: DesignPick): PaletteFloorResult {
  if (!SCAFFOLD_PRIMARY.test(css)) return { css, changed: false, label: null };
  const chosen = pick ?? pickDesignForBrief(brief);
  const blocks = buildPaletteBlocks(chosen);

  let out = replaceBlock(css, ":root", blocks.root);
  if (!out) return { css, changed: false, label: null };
  out = replaceBlock(out, "\\.dark", blocks.dark) ?? out;

  return { css: out, changed: true, label: chosen.palette.label };
}
