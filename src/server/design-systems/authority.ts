/**
 * The design-system package is the single authority for a project's visual
 * identity (colours, fonts, tokens, accent, components).
 *
 * - `resolveDefaultPackage` picks the package for a new project, deterministically.
 * - `visualsFromPackage` derives the colour + typography fields stored on the
 *   project's design record, so that record can never disagree with the package.
 * - `applyPackageToTree` installs tokens/fonts/components into a proposed file
 *   tree before a turn commits, so the committed revision always carries them.
 */
import type { ProjectFile } from "@/server/generate.server";
import type { PicDesignSystem, PicColorRole } from "@/server/pic/pic-types";
import { applyDesignSystem } from "./apply";
import type { DesignSystemPackage } from "./loader";
import { getDesignSystem, listDesignSystems } from "./registry";

export interface PackageSelection {
  systemId: string;
  accent: string;
}

/** The house style. Every project starts here unless the brief says otherwise. */
export const DEFAULT_PACKAGE_SLUG = "substrate";

/** The installed package every new project starts on. Deterministic. */
export function resolveDefaultPackage(): { pkg: DesignSystemPackage; accent: string } | null {
  const all = listDesignSystems().sort((a, b) => a.meta.slug.localeCompare(b.meta.slug));
  const pkg = all.find((p) => p.meta.slug === DEFAULT_PACKAGE_SLUG) ?? all[0];
  return pkg ? { pkg, accent: pkg.meta.default_accent } : null;
}

/**
 * Deterministic package + accent for a brief. No AI: a keyword match against
 * the request decides the house style's accent, and only an explicitly dark /
 * luxury / editorial brief moves off the house style altogether.
 *
 * Order matters — the first matching rule wins, so the list is ordered from
 * most specific ("wine bar") to most general ("shop").
 */
const ACCENT_RULES: Array<{ accent: string; re: RegExp }> = [
  { accent: "terracotta", re: /\b(bakery|baker|bread|pastr|patisserie|cafe|caf\u00e9|coffee|restaurant|bistro|diner|kitchen|food|catering|deli|pizzeria|brunch|farm)\b/i },
  { accent: "emerald", re: /\b(eco|green|sustainab|organic|garden|plant|nature|recycl|solar|environment|outdoor|hiking|wellness|yoga|fitness)\b/i },
  { accent: "blue", re: /\b(clinic|hospital|health|medical|dental|doctor|patient|pharmacy|bank|finance|insurance|legal|law|accounting|logistics|school|university|government|enterprise)\b/i },
  { accent: "ruby", re: /\b(wine|whisky|whiskey|spirits|jewel|fashion|boutique|salon|spa|beauty|luxur|couture|perfume)\b/i },
  { accent: "mono", re: /\b(portfolio|architect|studio|gallery|photograph|minimal|editorial|magazine|journal|type)\b/i },
  { accent: "indigo", re: /\b(saas|dashboard|analytic|platform|api|developer|software|app|crm|admin|startup|ai|data|tool)\b/i },
];

const DARK_EDITORIAL = /\b(luxur|couture|fine dining|michelin|whisky|whiskey|spirits|cinematic|noir|dark mode only|dark[- ]first|high[- ]end|premium brand|gallery|architect|photograph)\b/i;

export function resolvePackageForIntent(brief: string | null | undefined): { pkg: DesignSystemPackage; accent: string } | null {
  const text = (brief ?? "").slice(0, 4000);
  const installed = listDesignSystems();
  const byslug = (slug: string) => installed.find((p) => p.meta.slug === slug) ?? null;

  if (text && DARK_EDITORIAL.test(text)) {
    const obsidian = byslug("obsidian");
    if (obsidian) {
      const accent = /\b(gold|luxur|whisky|whiskey|spirits|fine dining|michelin)\b/i.test(text) ? "gold" : "platinum";
      return { pkg: obsidian, accent: obsidian.accents[accent] ? accent : obsidian.meta.default_accent };
    }
  }

  const house = byslug(DEFAULT_PACKAGE_SLUG);
  if (!house) return resolveDefaultPackage();
  const hit = text ? ACCENT_RULES.find((r) => r.re.test(text)) : undefined;
  const accent = hit && house.accents[hit.accent] ? hit.accent : house.meta.default_accent;
  return { pkg: house, accent };
}


/** A selection is usable only when the package is installed and the accent belongs to it. */
export function resolveSelection(sel: PackageSelection | null | undefined): { pkg: DesignSystemPackage; accent: string } | null {
  if (!sel) return null;
  const pkg = getDesignSystem(sel.systemId);
  if (!pkg || !pkg.accents[sel.accent]) return null;
  return { pkg, accent: sel.accent };
}

function firstFamily(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const m = /^\s*"([^"]+)"|^\s*'([^']+)'|^\s*([^,]+)/.exec(value);
  const name = (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
  return name && !name.startsWith("var(") ? name : fallback;
}

/** Colour + typography fields of the design record, taken from the package. */
export function visualsFromPackage(
  pkg: DesignSystemPackage,
  accent: string,
): Pick<PicDesignSystem, "typography" | "colors" | "radius" | "package"> & { direction: string } {
  const root = pkg.tokens.root;
  const dark = pkg.tokens.dark;
  const a = pkg.accents[accent] ?? { light: {}, dark: undefined };
  const pick = (name: string, fallback: string): PicColorRole => {
    const light = a.light[name] ?? root[name] ?? fallback;
    return { light, dark: a.dark?.[name] ?? dark[name] ?? light };
  };
  const fonts = pkg.meta.fonts;
  const display = firstFamily(root["kimble-font-display"], fonts[0] ?? "system-ui");
  const body = firstFamily(root["kimble-font-body"], fonts[1] ?? fonts[0] ?? "system-ui");
  return {
    direction: `${pkg.meta.name} — ${pkg.meta.description}`,
    typography: {
      displayFont: display,
      bodyFont: body,
      scale: {
        display: root["kimble-text-display"] ?? "3.5rem",
        h1: "2.5rem",
        h2: "1.875rem",
        h3: "1.375rem",
        body: root["kimble-text-base"] ?? "1rem",
        small: root["kimble-text-sm"] ?? "0.875rem",
      },
      lineHeights: { tight: root["kimble-leading-heading"] ?? "1.1", normal: "1.5", relaxed: root["kimble-leading-body"] ?? "1.7" },
      letterSpacing: { display: root["kimble-tracking-heading"] ?? "-0.02em", body: "0" },
      headingWeight: Number(root["kimble-weight-heading"]) || 700,
      bodyWeight: Number(root["kimble-weight-body"]) || 400,
    },
    colors: {
      background: pick("background", "oklch(0.98 0 0)"),
      foreground: pick("foreground", "oklch(0.2 0 0)"),
      primary: pick("primary", "oklch(0.5 0.1 250)"),
      primaryForeground: pick("primary-foreground", "oklch(0.99 0 0)"),
      secondary: pick("secondary", "oklch(0.94 0 0)"),
      accent: pick("accent", "oklch(0.94 0 0)"),
      muted: pick("muted", "oklch(0.94 0 0)"),
      mutedForeground: pick("muted-foreground", "oklch(0.5 0 0)"),
      card: pick("card", "oklch(1 0 0)"),
      border: pick("border", "oklch(0.9 0 0)"),
      destructive: pick("destructive", "oklch(0.58 0.22 27)"),
      success: pick("success", "oklch(0.62 0.16 150)"),
      warning: pick("warning", "oklch(0.75 0.16 80)"),
      defaultMode: "light",
    },
    radius: {
      sm: root["kimble-radius-sm"] ?? "0.25rem",
      md: root["radius"] ?? root["kimble-radius-md"] ?? "0.5rem",
      lg: root["kimble-radius-lg"] ?? "1rem",
      full: "9999px",
    },
    package: { systemId: pkg.meta.slug, accent },
  };
}

/** Overlay the package's visuals onto a design record. */
export function withPackageVisuals(design: PicDesignSystem, pkg: DesignSystemPackage, accent: string): PicDesignSystem {
  const v = visualsFromPackage(pkg, accent);
  const { migration: _m, ...rest } = design;
  return { ...rest, typography: v.typography, colors: v.colors, radius: v.radius, package: v.package, source: "package" };
}

export type TreeApplyResult =
  | { applied: true; files: ProjectFile[]; changedPaths: string[] }
  | { applied: false; files: ProjectFile[]; reason: string };

/**
 * Deterministically (re)install the selected package into a proposed tree.
 * Idempotent: an unchanged tree comes back byte-identical. Never throws; on
 * failure the tree is returned untouched with a reason.
 */
export function applyPackageToTree(files: ProjectFile[], design: PicDesignSystem | null | undefined): TreeApplyResult {
  const sel = resolveSelection(design?.package);
  if (!sel) return { applied: false, files, reason: design?.package ? "selected package not installed" : "no package selected" };
  const r = applyDesignSystem(files, sel.pkg, sel.accent);
  if (!r.ok) return { applied: false, files, reason: r.error };
  return { applied: true, files: r.files, changedPaths: r.changedPaths };
}
