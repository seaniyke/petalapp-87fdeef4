/**
 * Phase 2 — Design System Contract.
 *
 * Kimble's look used to be enforced *after* the fact: the model wrote whatever
 * it wanted and a stack of codemods (token sweep, palette floor, design
 * finisher) tried to drag it back. That is why output drifted — repair can fix
 * a wrong colour, it cannot invent a coherent system.
 *
 * This module commits the system BEFORE any code is written: one document with
 * a type scale, spacing rhythm, semantic colour roles, radii, shadows,
 * navigation pattern and per-component rules. Turn 1 authors it, every later
 * turn inherits it, and `design-system-lint.server.ts` enforces it.
 *
 * Fail-open: if the model pass fails we still commit a deterministic contract
 * whose colours and fonts come from the design system package.
 */

import { resolveDefaultPackage, resolvePackageForIntent, withPackageVisuals } from "@/server/design-systems/authority";
import type {
  PicDesignSystem,
  PicUnderstanding,
  NavPattern,
  PicColorRole,
} from "@/server/pic/pic-types";
import type { DesignDirection } from "@/server/design-director.server";


function role(light: string, dark?: string): PicColorRole {
  return { light, dark: dark ?? light };
}

/** Navigation pattern implied by the product shape. */
function defaultNav(u: PicUnderstanding): NavPattern {
  if (u.platforms.includes("mobile")) return "bottom-tabs";
  if (u.surfaces.application || u.surfaces.admin) return "sidebar";
  return "top-nav";
}

const TYPE_SCALES = {
  compact: { display: "2.75rem", h1: "2rem", h2: "1.5rem", h3: "1.25rem", body: "0.9375rem", small: "0.8125rem" },
  comfortable: { display: "3.5rem", h1: "2.5rem", h2: "1.875rem", h3: "1.375rem", body: "1rem", small: "0.875rem" },
  spacious: { display: "4.5rem", h1: "3rem", h2: "2.25rem", h3: "1.5rem", body: "1.0625rem", small: "0.9375rem" },
} as const;

/**
 * Deterministic contract. Always available; used as the model's prior and as
 * the fallback when the model pass fails.
 */
export function deterministicDesignSystem(
  _brief: string,
  understanding: PicUnderstanding,
  _opts: { seed?: string } = {},
): PicDesignSystem {
  const density: PicDesignSystem["density"] =
    understanding.surfaces.application || understanding.surfaces.admin ? "compact" : "comfortable";

  const base: PicDesignSystem = {
    direction: "Kimble default",
    rationale: `Structure chosen for ${understanding.domain || understanding.productType}; colours and fonts come from the selected design system package.`,
    typography: {
      displayFont: "system-ui",
      bodyFont: "system-ui",
      scale: TYPE_SCALES[density === "compact" ? "compact" : "comfortable"],
      lineHeights: { tight: "1.1", normal: "1.5", relaxed: "1.7" },
      letterSpacing: { display: "-0.02em", body: "0" },
      headingWeight: 700,
      bodyWeight: 400,
    },
    colors: {
      background: role("oklch(0.98 0 0)"),
      foreground: role("oklch(0.2 0 0)"),
      primary: role("oklch(0.5 0.1 250)"),
      primaryForeground: role("oklch(0.99 0 0)"),
      secondary: role("oklch(0.94 0 0)"),
      accent: role("oklch(0.94 0 0)"),
      muted: role("oklch(0.94 0 0)"),
      mutedForeground: role("oklch(0.5 0 0)"),
      card: role("oklch(1 0 0)"),
      border: role("oklch(0.9 0 0)"),
      destructive: role("oklch(0.58 0.22 27)"),
      success: role("oklch(0.62 0.16 150)"),
      warning: role("oklch(0.75 0.16 80)"),
      defaultMode: "light",
    },
    spacingBase: 4,
    radius: { sm: "0.25rem", md: "0.5rem", lg: "1rem", full: "9999px" },
    shadows: {
      sm: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
      md: "0 4px 12px -2px rgb(0 0 0 / 0.08)",
      lg: "0 18px 40px -12px rgb(0 0 0 / 0.18)",
    },
    surfaces: "Cards sit on the background with a 1px border and md radius; elevated surfaces use the md shadow, never both a heavy border and a heavy shadow.",
    density,
    navPattern: defaultNav(understanding),
    mobileNav: understanding.surfaces.application ? "bottom-tabs" : "drawer",
    breakpoints: { sm: 640, md: 768, lg: 1024, xl: 1280 },
    motion: {
      level: "subtle",
      principles: "150–250ms ease-out on hover/press, opacity+translate on section entry, no infinite loops, respect prefers-reduced-motion.",
    },
    imagery: "Full-bleed photographic or gradient hero; content images always have an explicit aspect ratio and object-cover.",
    iconography: "lucide-react, 1.5px stroke, 20px inline / 24px standalone, never mixed with emoji.",
    accessibility: "Body text ≥ 4.5:1 against its surface, focus-visible ring on every interactive element, all inputs labelled, tap targets ≥ 44px.",
    components: {
      buttons: "Primary = solid primary + primary-foreground; secondary = border + transparent; ghost for tertiary. One primary per view. Heights: 36/40/44px.",
      inputs: "1px border, md radius, 40px height, visible label above, helper/error text below in small size.",
      cards: "Padding = 6 spacing units, md radius, 1px border, no nested cards.",
      navigation: `${defaultNav(understanding)} on desktop; ${understanding.surfaces.application ? "bottom tabs" : "a drawer"} on mobile. Active item is visually distinct, not just coloured text.`,
      tables: "Sticky header, muted header row, 12px vertical cell padding, zebra off, right-align numerics, tabular-nums.",
      modals: "Centred, max-w-lg, backdrop blur, explicit close affordance, focus trapped.",
      badges: "Small radius-full pills using muted/accent/success/warning roles — never raw colour utilities.",
      alerts: "Role-coloured left border + icon + title + body. Never colour alone.",
      emptyStates: "Icon + one-line explanation + primary action. Never a bare 'No data'.",
      loadingStates: "Skeletons matching final layout dimensions. Never a centred spinner on a full page.",
      errorStates: "Plain-language message + retry action. Never a raw error string.",
    },
    source: "deterministic",
  };
  // Colours, typography and radii always come from the design system package.
  // Which package + accent is a deterministic read of the brief, so a bakery
  // gets warm terracotta and a clinic gets clinical blue without an AI call.
  const def = resolvePackageForIntent(_brief) ?? resolveDefaultPackage();
  return def ? withPackageVisuals(base, def.pkg, def.accent) : base;

}

/**
 * Translate the Design Director's persisted decision into the canonical PIC
 * contract. This removes the old second aesthetic vote where PIC could choose
 * different fonts, colours, density and motion moments after the director.
 */
export function designSystemFromDirection(
  brief: string,
  understanding: PicUnderstanding,
  direction: DesignDirection,
  seed?: string,
): PicDesignSystem {
  const base = deterministicDesignSystem(brief, understanding, { seed });
  const density: PicDesignSystem["density"] =
    direction.density === "minimal"
      ? "spacious"
      : direction.density === "dense"
        ? "compact"
        : "comfortable";
  const motionLevel: PicDesignSystem["motion"]["level"] =
    direction.motion === "still"
      ? "none"
      : direction.motion === "subtle"
        ? "subtle"
        : "expressive";

  return {
    ...base,
    direction: direction.vibe,
    rationale: direction.rationale,
    // Fonts and colours stay the package's; the director owns composition only.
    typography: { ...base.typography },
    density,
    motion: {
      level: motionLevel,
      principles:
        direction.motion === "still"
          ? "No decorative motion; hierarchy, typography and composition carry the experience."
          : `${base.motion.principles} Use the committed ${direction.fx_recipe ?? " restrained"} motion language consistently.`,
    },
    imagery: `${base.imagery} Signature moves: ${direction.design_moves.join("; ")}.`,
    source: base.source,
  };
}

/**
 * Commit the design record. Deterministic: structure from the product shape
 * (and the director's composition choices), colours/fonts from the design
 * system package. No model invents a palette — the package is the authority.
 */
export async function commitDesignSystem(args: {
  brief: string;
  understanding: PicUnderstanding;
  seed?: string;
  userId?: string;
  projectId?: string | null;
  signal?: AbortSignal;
  direction?: DesignDirection | null;
}): Promise<PicDesignSystem> {
  if (args.direction) return designSystemFromDirection(args.brief, args.understanding, args.direction, args.seed);
  return deterministicDesignSystem(args.brief, args.understanding, { seed: args.seed });
}

/** CSS custom properties for `:root` / `.dark`, derived from the contract. */
export function renderDesignTokensCss(d: PicDesignSystem): string {
  const map: Array<[string, PicColorRole]> = [
    ["--background", d.colors.background],
    ["--foreground", d.colors.foreground],
    ["--card", d.colors.card],
    ["--card-foreground", d.colors.foreground],
    ["--popover", d.colors.card],
    ["--popover-foreground", d.colors.foreground],
    ["--primary", d.colors.primary],
    ["--primary-foreground", d.colors.primaryForeground],
    ["--secondary", d.colors.secondary],
    ["--secondary-foreground", d.colors.foreground],
    ["--muted", d.colors.muted],
    ["--muted-foreground", d.colors.mutedForeground],
    ["--accent", d.colors.accent],
    ["--accent-foreground", d.colors.primaryForeground],
    ["--destructive", d.colors.destructive],
    ["--destructive-foreground", d.colors.primaryForeground],
    ["--success", d.colors.success],
    ["--warning", d.colors.warning],
    ["--border", d.colors.border],
    ["--input", d.colors.border],
    ["--ring", d.colors.primary],
  ];
  const light = map.map(([k, v]) => `  ${k}: ${v.light};`).join("\n");
  const dark = map.map(([k, v]) => `  ${k}: ${v.dark};`).join("\n");
  return `:root {\n${light}\n  --radius: ${d.radius.md};\n}\n\n.dark {\n${dark}\n}`;
}

/** Prompt block the builder model must obey. */
export function renderDesignSystemBlock(d: PicDesignSystem): string {
  if (d.package) return renderStructureBlock(d);
  return `## DESIGN SYSTEM CONTRACT (committed — do not invent an alternative)
Direction: ${d.direction}
Why: ${d.rationale}

Typography
- Display: "${d.typography.displayFont}" @ ${d.typography.headingWeight}, tracking ${d.typography.letterSpacing.display}
- Body: "${d.typography.bodyFont}" @ ${d.typography.bodyWeight}
- Scale: display ${d.typography.scale.display} · h1 ${d.typography.scale.h1} · h2 ${d.typography.scale.h2} · h3 ${d.typography.scale.h3} · body ${d.typography.scale.body} · small ${d.typography.scale.small}
- Load both fonts from Google Fonts in index.html. Never substitute them.

Color roles — write these EXACT tokens into src/styles.css and use them only via semantic classes (bg-background, text-foreground, bg-primary, text-muted-foreground …). Never hardcode a hex, a Tailwind colour utility (bg-white, text-gray-500) or an inline colour.
\`\`\`css
${renderDesignTokensCss(d)}
\`\`\`
Default mode: ${d.colors.defaultMode}.

Layout
- Spacing base ${d.spacingBase}px; use multiples only. Density: ${d.density}.
- Radii: sm ${d.radius.sm} · md ${d.radius.md} · lg ${d.radius.lg}.
- Shadows: sm ${d.shadows.sm} | md ${d.shadows.md} | lg ${d.shadows.lg}.
- Surfaces: ${d.surfaces}
- Navigation: ${d.navPattern} on desktop, ${d.mobileNav} on mobile.
- Breakpoints: ${d.breakpoints.sm}/${d.breakpoints.md}/${d.breakpoints.lg}/${d.breakpoints.xl}.

Motion (${d.motion.level}): ${d.motion.principles}
Imagery: ${d.imagery}
Icons: ${d.iconography}
Accessibility: ${d.accessibility}

Component rules — every instance in the app must match:
- Buttons: ${d.components.buttons}
- Inputs: ${d.components.inputs}
- Cards: ${d.components.cards}
- Navigation: ${d.components.navigation}
- Tables: ${d.components.tables}
- Modals: ${d.components.modals}
- Badges: ${d.components.badges}
- Alerts: ${d.components.alerts}
- Empty states: ${d.components.emptyStates}
- Loading: ${d.components.loadingStates}
- Errors: ${d.components.errorStates}`;
}

/**
 * Structure-only contract for projects on a package. Colours, fonts and
 * tokens are described once, by the SELECTED DESIGN SYSTEM block.
 */
function renderStructureBlock(d: PicDesignSystem): string {
  return `## DESIGN CONTRACT — STRUCTURE (colours, fonts and tokens come from the SELECTED DESIGN SYSTEM block; never write your own palette or font links)
Layout
- Spacing base ${d.spacingBase}px; use multiples only. Density: ${d.density}.
- Surfaces: ${d.surfaces}
- Navigation: ${d.navPattern} on desktop, ${d.mobileNav} on mobile.
- Breakpoints: ${d.breakpoints.sm}/${d.breakpoints.md}/${d.breakpoints.lg}/${d.breakpoints.xl}.
- Use colours only through semantic classes (bg-background, text-foreground, bg-primary …). Never a hex, a Tailwind colour utility or an inline colour.

Motion (${d.motion.level}): ${d.motion.principles}
Imagery: ${d.imagery}
Icons: ${d.iconography}
Accessibility: ${d.accessibility}

Component rules:
- Buttons: ${d.components.buttons}
- Inputs: ${d.components.inputs}
- Cards: ${d.components.cards}
- Navigation: ${d.components.navigation}
- Tables: ${d.components.tables}
- Modals: ${d.components.modals}
- Badges: ${d.components.badges}
- Alerts: ${d.components.alerts}
- Empty states: ${d.components.emptyStates}
- Loading: ${d.components.loadingStates}
- Errors: ${d.components.errorStates}`;
}
