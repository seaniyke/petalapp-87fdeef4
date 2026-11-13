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
  { accent: "terracotta", re: /\b(bakery|baker|bread|pastr|patisserie|cafe|caf\u00e9|coffee|restaurant|bistro|diner|kitchen|catering|deli|pizzeria|brunch|butcher|grocer)\w*/i },
  { accent: "emerald", re: /\b(sustainab|organic|garden|recycl|solar|environment|outdoor|hiking|wellness|yoga|fitness|nursery|landscap)\w*/i },
  { accent: "blue", re: /\b(clinic|hospital|health|medical|dental|doctor|patient|pharmac|bank|finance|insurance|legal|accounting|logistics|school|university|government|enterprise)\w*/i },
  { accent: "ruby", re: /\b(wine|whisky|whiskey|spirits|jewel|fashion|boutique|salon|beauty|luxur|couture|perfume)\w*/i },
  { accent: "mono", re: /\b(portfolio|architect|gallery|photograph|minimalist|editorial|magazine|journal)\w*/i },
  { accent: "indigo", re: /\b(saas|dashboard|analytic|platform|developer|software|crm|startup|workspace|automation)\w*/i },

];

// Only an explicit dark request (or a nightlife/spirits domain) selects the
// dark package. "Luxury", "premium" and "high-end" do NOT: premium brands
// (Apple, Aesop, Mercury, medspas) are overwhelmingly light, and the old rule
// turned a bright luxury clinic into a black-and-gold site.
const DARK_EDITORIAL = /\b(dark|noir|black[- ]and[- ]gold|moody|nightclub|cocktail bar|speakeasy|whisky|whiskey|spirits|michelin|cinematic)\w*/i;

/**
 * Studio packages chosen by the brief's domain, after the dark-editorial rule
 * and before the house style. First match wins.
 */
const STUDIO_RULES: Array<{ slug: string; re: RegExp; accents: Array<{ accent: string; re: RegExp }> }> = [
  {
    slug: "haven",
    re: /\b(clinic|hospital|health|medical|dental|dentist|doctor|patient|pharmac|therap|physio|care home|nursing|counsel|charity)\w*/i,
    accents: [
      { accent: "ocean", re: /\b(hospital|pharmac)\w*/i },
      { accent: "sage", re: /\b(therap|counsel|care home|nursing|charity)\w*/i },
    ],
  },
  {
    slug: "atelier",
    re: /\b(salon|beauty|spa|skincare|nail|barber|lash|brow|boutique|wedding|bridal|florist|flower|hotel|retreat|resort|wellness)\w*/i,
    accents: [
      { accent: "sage", re: /\b(spa|wellness|retreat|florist|flower|skincare)\w*/i },
      { accent: "bronze", re: /\b(barber|hotel|resort|boutique)\w*/i },
    ],
  },
  {
    slug: "meridian",
    re: /\b(saas|dashboard|analytic|developer|fintech|crm|startup|ai (tool|product|platform)|admin panel|software)\w*/i,
    accents: [
      { accent: "lime", re: /\b(fintech|crypto|trading|money)\w*/i },
      { accent: "coral", re: /\b(creator|social|community|marketing)\w*/i },
    ],
  },
];

/**
 * Explicit style words lock the look regardless of domain. Checked after the
 * dark-editorial rule. Words a brief expander might add on its own
 * ("vibrant", "modern", "bold") are deliberately absent.
 */
const EXPLICIT_LOOK_RULES: Array<{ slug: string; re: RegExp }> = [
  { slug: "brutalist", re: /\b(brutalis[tm]|monospace|terminal[- ]style|hacker[- ]style|retro[- ]computer)\w*/i },
  { slug: "monolith", re: /\b(swiss|bauhaus|international[- ]style|grid[- ]based)\b/i },
  { slug: "bloom", re: /\b(playful|pastel|bubbly|whimsical|kawaii)\b/i },
  { slug: "kinetic", re: /\b(high[- ]energy|energetic|punchy)\b/i },
];

/**
 * Look families. When a project seed is given, the look is chosen from the
 * brief's family (always including the rule-based primary pick), so similar
 * briefs on different projects get different looks while one project always
 * keeps its own. First matching family wins.
 */
type LookPick = { slug: string; accent: string };
const LOOK_FAMILIES: Array<{ id: string; re: RegExp; picks: LookPick[] }> = [
  {
    id: "care",
    re: /\b(clinic|hospital|health|medical|dental|dentist|doctor|patient|pharmac|therap|physio|care home|nursing|counsel|charity)\w*/i,
    picks: [{ slug: "haven", accent: "teal" }, { slug: "haven", accent: "ocean" }, { slug: "haven", accent: "sage" }],
  },
  {
    id: "lifestyle",
    re: /\b(salon|beauty|spa|skincare|nail|barber|lash|brow|boutique|wedding|bridal|florist|flower|hotel|retreat|resort|wellness|fashion|jewel)\w*/i,
    picks: [{ slug: "atelier", accent: "rose" }, { slug: "atelier", accent: "bronze" }, { slug: "bloom", accent: "berry" }, { slug: "monolith", accent: "graphite" }],
  },
  {
    id: "product",
    re: /\b(saas|dashboard|analytic|developer|fintech|crm|startup|ai (tool|product|platform|app)|admin panel|software|api|devtool|crypto|web3|blockchain|automation)\w*/i,
    picks: [{ slug: "meridian", accent: "cobalt" }, { slug: "brutalist", accent: "ultramarine" }, { slug: "kinetic", accent: "electric" }, { slug: "monolith", accent: "cobalt" }],
  },
  {
    id: "authority",
    re: /\b(bank|finance|insurance|legal|law firm|lawyer|attorney|accounting|logistic|freight|engineering|construction|architect|consult|government|enterprise|research)\w*/i,
    picks: [{ slug: "monolith", accent: "graphite" }, { slug: "meridian", accent: "cobalt" }, { slug: "substrate", accent: "blue" }, { slug: "monolith", accent: "signal" }],
  },
  {
    id: "food",
    re: /\b(bakery|baker|bread|pastr|patisserie|cafe|caf\u00e9|coffee|restaurant|bistro|diner|kitchen|catering|deli|pizzeria|brunch|butcher|grocer|food|snack|juice|ice cream|dessert)\w*/i,
    picks: [{ slug: "substrate", accent: "terracotta" }, { slug: "bloom", accent: "tangerine" }, { slug: "atelier", accent: "bronze" }, { slug: "kinetic", accent: "flame" }],
  },
  {
    id: "energy",
    re: /\b(fitness|gym|sports?|athlet|crossfit|dance|esports|gaming|festivals?|music|concert|events?|nightlife)\b/i,
    picks: [{ slug: "kinetic", accent: "flame" }, { slug: "kinetic", accent: "volt" }, { slug: "bloom", accent: "berry" }, { slug: "brutalist", accent: "acid" }],
  },
  {
    id: "editorial",
    re: /\b(portfolio|gallery|photograph|minimalist|editorial|magazine|journal|artist|studio)\w*/i,
    picks: [{ slug: "substrate", accent: "mono" }, { slug: "monolith", accent: "graphite" }, { slug: "atelier", accent: "bronze" }, { slug: "brutalist", accent: "orange" }],
  },
  {
    id: "outdoor",
    re: /\b(sustainab|organic|garden|recycl|solar|environment|outdoor|hiking|yoga|nursery|landscap|farm)\w*/i,
    picks: [{ slug: "substrate", accent: "emerald" }, { slug: "bloom", accent: "mint" }, { slug: "atelier", accent: "sage" }],
  },
  {
    id: "consumer",
    re: /\b(shops?|stores?|ecommerce|e-commerce|marketplace|kids|toys?|pets?|social|community|school|course|tutor|education|club)\b/i,
    picks: [{ slug: "bloom", accent: "tangerine" }, { slug: "kinetic", accent: "electric" }, { slug: "substrate", accent: "indigo" }, { slug: "atelier", accent: "rose" }],
  },
];
const DEFAULT_FAMILY: LookPick[] = [
  { slug: "substrate", accent: "indigo" },
  { slug: "meridian", accent: "cobalt" },
  { slug: "monolith", accent: "signal" },
  { slug: "bloom", accent: "berry" },
  { slug: "kinetic", accent: "electric" },
  { slug: "atelier", accent: "rose" },
];

export interface PackageIntentOptions {
  /** Per-project seed (the project id). Without it the pick is the rule-based primary. */
  seed?: string | null;
  /** A look the caller chose explicitly (public API `style.look`). Wins when installed. */
  look?: string | null;
}

type Resolved = { pkg: DesignSystemPackage; accent: string };

function seedHash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Accent for a locked package: the seed rotates among its accents, else its default. */
function lockedAccent(pkg: DesignSystemPackage, seed?: string | null): string {
  const accents = pkg.meta.accents.filter((a) => pkg.accents[a]);
  if (!seed || !accents.length) return pkg.meta.default_accent;
  return accents[seedHash(`accent:${pkg.meta.slug}:${seed}`) % accents.length]!;
}

/** The rule-based pick (no seed). Unchanged behaviour for existing briefs. */
function primaryPackageForIntent(text: string, byslug: (slug: string) => DesignSystemPackage | null): Resolved | null {
  for (const rule of STUDIO_RULES) {
    if (!text || !rule.re.test(text)) continue;
    const pkg = byslug(rule.slug);
    if (!pkg) continue;
    const hit = rule.accents.find((a) => a.re.test(text));
    const accent = hit && pkg.accents[hit.accent] ? hit.accent : pkg.meta.default_accent;
    return { pkg, accent };
  }
  const house = byslug(DEFAULT_PACKAGE_SLUG);
  if (!house) return resolveDefaultPackage();
  const hit = text ? ACCENT_RULES.find((r) => r.re.test(text)) : undefined;
  const accent = hit && house.accents[hit.accent] ? hit.accent : house.meta.default_accent;
  return { pkg: house, accent };
}

export function resolvePackageForIntent(
  brief: string | null | undefined,
  opts: PackageIntentOptions = {},
): Resolved | null {
  const text = (brief ?? "").slice(0, 4000);
  const installed = listDesignSystems();
  const byslug = (slug: string) => installed.find((p) => p.meta.slug === slug) ?? null;
  const seed = opts.seed ? String(opts.seed) : null;

  // 1. An explicit caller choice wins.
  if (opts.look) {
    const chosen = byslug(opts.look);
    if (chosen) return { pkg: chosen, accent: lockedAccent(chosen, seed) };
  }

  // 2. A dark request.
  if (text && DARK_EDITORIAL.test(text)) {
    const obsidian = byslug("obsidian");
    if (obsidian) {
      const accent = /\b(gold|luxur|whisky|whiskey|spirits|fine dining|michelin)\b/i.test(text) ? "gold" : "platinum";
      return { pkg: obsidian, accent: obsidian.accents[accent] ? accent : obsidian.meta.default_accent };
    }
  }

  // 3. Explicit style words.
  if (text) {
    for (const rule of EXPLICIT_LOOK_RULES) {
      if (!rule.re.test(text)) continue;
      const pkg = byslug(rule.slug);
      if (pkg) return { pkg, accent: lockedAccent(pkg, seed) };
    }
  }

  // 4. Domain rules. Without a seed this is the whole answer.
  const primary = primaryPackageForIntent(text, byslug);
  if (!seed || !primary) return primary;

  // 5. With a seed, rotate within the brief's family (primary always a candidate).
  const family = (text && LOOK_FAMILIES.find((f) => f.re.test(text))) || null;
  const picks = family?.picks ?? DEFAULT_FAMILY;
  const candidates: Resolved[] = [primary];
  for (const p of picks) {
    const pkg = byslug(p.slug);
    if (!pkg || !pkg.accents[p.accent]) continue;
    if (candidates.some((c) => c.pkg.meta.slug === pkg.meta.slug && c.accent === p.accent)) continue;
    candidates.push({ pkg, accent: p.accent });
  }
  return candidates[seedHash(`look:${family?.id ?? "default"}:${seed}`) % candidates.length]!;
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
