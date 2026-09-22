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
 * derived from the chosen theme, so downstream stages always have one.
 */

import { aiChatCompletions } from "@/server/ai-provider.server";
import { THEMES, pickThemeForBrief, type ThemeKey } from "@/server/themes.server";
import { MAX_USER_PROMPT_CHARS } from "@/lib/prompt-limits";
import type {
  PicDesignSystem,
  PicUnderstanding,
  NavPattern,
  PicColorRole,
} from "@/server/pic/pic-types";
import type { DesignDirection } from "@/server/design-director.server";

const MODEL = "google/gemini-3-flash-preview";

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
  brief: string,
  understanding: PicUnderstanding,
  opts: { seed?: string; theme?: ThemeKey } = {},
): PicDesignSystem {
  const themeKey = opts.theme ?? pickThemeForBrief(brief, opts.seed);
  const theme = THEMES[themeKey];
  const t = theme.tokens;

  const density: PicDesignSystem["density"] =
    understanding.surfaces.application || understanding.surfaces.admin ? "compact" : "comfortable";

  const isDark = /dark|noir|terminal|cyberpunk|monolith/.test(themeKey);

  return {
    direction: theme.description,
    rationale: `Selected for ${understanding.domain || understanding.productType} — fits ${theme.fitsWhen}.`,
    typography: {
      displayFont: theme.display_font,
      bodyFont: theme.body_font,
      scale: TYPE_SCALES[density === "compact" ? "compact" : "comfortable"],
      lineHeights: { tight: "1.1", normal: "1.5", relaxed: "1.7" },
      letterSpacing: { display: "-0.02em", body: "0" },
      headingWeight: 700,
      bodyWeight: 400,
    },
    colors: {
      background: role(t["--background"]),
      foreground: role(t["--foreground"]),
      primary: role(t["--primary"]),
      primaryForeground: role(t["--primary-foreground"]),
      secondary: role(t["--secondary"]),
      accent: role(t["--accent"]),
      muted: role(t["--muted"]),
      mutedForeground: role(t["--muted-foreground"]),
      card: role(t["--card"]),
      border: role(t["--border"]),
      destructive: role("oklch(0.58 0.22 27)"),
      success: role("oklch(0.62 0.16 150)"),
      warning: role("oklch(0.75 0.16 80)"),
      defaultMode: isDark ? "dark" : "light",
    },
    spacingBase: 4,
    radius: { sm: "0.25rem", md: t["--radius"] ?? "0.5rem", lg: "1rem", full: "9999px" },
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
  const base = deterministicDesignSystem(brief, understanding, {
    seed,
    theme: direction.theme,
  });
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
    typography: {
      ...base.typography,
      displayFont: direction.display_font,
      bodyFont: direction.body_font,
      scale: TYPE_SCALES[density],
    },
    density,
    motion: {
      level: motionLevel,
      principles:
        direction.motion === "still"
          ? "No decorative motion; hierarchy, typography and composition carry the experience."
          : `${base.motion.principles} Use the committed ${direction.fx_recipe ?? " restrained"} motion language consistently.`,
    },
    imagery: `${base.imagery} Palette mood: ${direction.palette_mood}. Signature moves: ${direction.design_moves.join("; ")}.`,
    source: "deterministic",
  };
}

const SYSTEM = `You are Kimble's design systems lead. You commit a complete design system BEFORE any code is written, so every page of the product is consistent by construction.

Rules:
- Reason from the product, its users and its domain. A clinical portal and a music festival site must not receive similar systems.
- Reject default AI aesthetics: Inter everywhere, purple/indigo gradients on white, evenly spaced identical cards, generic rounded-2xl everything.
- Colours are SEMANTIC ROLES, not a palette dump. Every role needs a light and a dark value in oklch().
- Body text must clear 4.5:1 against its surface. Check before you answer.
- The type scale must have real contrast between display and body — at least 2.5x.
- Component rules are specific and checkable ("primary button is solid primary, 40px, md radius"), never vague ("modern and clean").

Reply only by calling commit_design_system.`;

const TOOL = {
  type: "function" as const,
  function: {
    name: "commit_design_system",
    description: "Commit the design system contract for this product.",
    parameters: {
      type: "object",
      properties: {
        direction: { type: "string", description: "Named visual direction." },
        rationale: { type: "string" },
        displayFont: { type: "string" },
        bodyFont: { type: "string" },
        monoFont: { type: "string" },
        headingWeight: { type: "number" },
        scaleDisplay: { type: "string" },
        scaleH1: { type: "string" },
        scaleH2: { type: "string" },
        scaleH3: { type: "string" },
        scaleBody: { type: "string" },
        scaleSmall: { type: "string" },
        colors: {
          type: "object",
          description: "Semantic roles. Each value is an object with light and dark oklch() strings.",
          properties: {
            background: { $ref: "#/$defs/role" },
            foreground: { $ref: "#/$defs/role" },
            primary: { $ref: "#/$defs/role" },
            primaryForeground: { $ref: "#/$defs/role" },
            secondary: { $ref: "#/$defs/role" },
            accent: { $ref: "#/$defs/role" },
            muted: { $ref: "#/$defs/role" },
            mutedForeground: { $ref: "#/$defs/role" },
            card: { $ref: "#/$defs/role" },
            border: { $ref: "#/$defs/role" },
            destructive: { $ref: "#/$defs/role" },
            success: { $ref: "#/$defs/role" },
            warning: { $ref: "#/$defs/role" },
          },
        },
        defaultMode: { type: "string", enum: ["light", "dark"] },
        spacingBase: { type: "number" },
        radiusMd: { type: "string" },
        density: { type: "string", enum: ["compact", "comfortable", "spacious"] },
        navPattern: { type: "string", enum: ["top-nav", "sidebar", "tabs", "bottom-tabs", "rail"] },
        mobileNav: { type: "string", enum: ["bottom-tabs", "drawer", "top-collapse"] },
        motionLevel: { type: "string", enum: ["none", "subtle", "expressive"] },
        motionPrinciples: { type: "string" },
        surfaces: { type: "string" },
        imagery: { type: "string" },
        iconography: { type: "string" },
        componentButtons: { type: "string" },
        componentInputs: { type: "string" },
        componentCards: { type: "string" },
        componentNavigation: { type: "string" },
        componentTables: { type: "string" },
        componentEmptyStates: { type: "string" },
      },
      required: ["direction", "displayFont", "bodyFont", "colors", "navPattern", "density"],
      $defs: {
        role: {
          type: "object",
          properties: { light: { type: "string" }, dark: { type: "string" } },
          required: ["light", "dark"],
        },
      },
    },
  },
};

function pickRole(raw: unknown, fallback: PicColorRole): PicColorRole {
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as { light?: unknown; dark?: unknown };
  const light = typeof r.light === "string" && r.light.trim() ? r.light.trim() : fallback.light;
  const dark = typeof r.dark === "string" && r.dark.trim() ? r.dark.trim() : light;
  return { light, dark };
}

function str(raw: unknown, fallback: string): string {
  return typeof raw === "string" && raw.trim() ? raw.trim() : fallback;
}

/** Author the design system contract. Never throws. */
export async function commitDesignSystem(args: {
  brief: string;
  understanding: PicUnderstanding;
  seed?: string;
  userId?: string;
  projectId?: string | null;
  signal?: AbortSignal;
  /** The Design Director is the sole visual owner when present. */
  direction?: DesignDirection | null;
}): Promise<PicDesignSystem> {
  if (args.direction) {
    return designSystemFromDirection(
      args.brief,
      args.understanding,
      args.direction,
      args.seed,
    );
  }
  const prior = deterministicDesignSystem(args.brief, args.understanding, { seed: args.seed });
  if (!process.env.OPENROUTER_API_KEY) return prior;

  try {
    const res = await aiChatCompletions({
      feature: "preflight",
      lockCallerModel: true,
      signal: args.signal,
      meta: { userId: args.userId, projectId: args.projectId ?? null },
      body: {
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: `Product:
${JSON.stringify(
  {
    summary: args.understanding.summary,
    productType: args.understanding.productType,
    domain: args.understanding.domain,
    users: args.understanding.targetUsers,
    surfaces: args.understanding.surfaces,
    platforms: args.understanding.platforms,
  },
  null,
  1,
)}

Original request:
"""${(args.brief ?? "").slice(0, MAX_USER_PROMPT_CHARS)}"""

Starting point chosen by rules (improve it, or replace it if you can do better):
${JSON.stringify(
  {
    direction: prior.direction,
    displayFont: prior.typography.displayFont,
    bodyFont: prior.typography.bodyFont,
    colors: prior.colors,
    density: prior.density,
    navPattern: prior.navPattern,
  },
  null,
  1,
)}`,
          },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "commit_design_system" } },
        stream: false,
      },
    } as Parameters<typeof aiChatCompletions>[0]);

    if (!res.ok) return prior;
    const json = (await res.json()) as {
      choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }>;
    };
    const argsJson = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!argsJson) return prior;
    const raw = JSON.parse(argsJson) as Record<string, any>;
    const c = (raw.colors ?? {}) as Record<string, unknown>;

    const density = (["compact", "comfortable", "spacious"] as const).includes(raw.density)
      ? (raw.density as PicDesignSystem["density"])
      : prior.density;

    return {
      ...prior,
      direction: str(raw.direction, prior.direction),
      rationale: str(raw.rationale, prior.rationale),
      typography: {
        ...prior.typography,
        displayFont: str(raw.displayFont, prior.typography.displayFont),
        bodyFont: str(raw.bodyFont, prior.typography.bodyFont),
        monoFont: typeof raw.monoFont === "string" ? raw.monoFont.trim() : prior.typography.monoFont,
        headingWeight:
          typeof raw.headingWeight === "number" ? raw.headingWeight : prior.typography.headingWeight,
        scale: {
          display: str(raw.scaleDisplay, prior.typography.scale.display),
          h1: str(raw.scaleH1, prior.typography.scale.h1),
          h2: str(raw.scaleH2, prior.typography.scale.h2),
          h3: str(raw.scaleH3, prior.typography.scale.h3),
          body: str(raw.scaleBody, prior.typography.scale.body),
          small: str(raw.scaleSmall, prior.typography.scale.small),
        },
      },
      colors: {
        background: pickRole(c.background, prior.colors.background),
        foreground: pickRole(c.foreground, prior.colors.foreground),
        primary: pickRole(c.primary, prior.colors.primary),
        primaryForeground: pickRole(c.primaryForeground, prior.colors.primaryForeground),
        secondary: pickRole(c.secondary, prior.colors.secondary),
        accent: pickRole(c.accent, prior.colors.accent),
        muted: pickRole(c.muted, prior.colors.muted),
        mutedForeground: pickRole(c.mutedForeground, prior.colors.mutedForeground),
        card: pickRole(c.card, prior.colors.card),
        border: pickRole(c.border, prior.colors.border),
        destructive: pickRole(c.destructive, prior.colors.destructive),
        success: pickRole(c.success, prior.colors.success),
        warning: pickRole(c.warning, prior.colors.warning),
        defaultMode: raw.defaultMode === "dark" ? "dark" : raw.defaultMode === "light" ? "light" : prior.colors.defaultMode,
      },
      spacingBase: typeof raw.spacingBase === "number" && raw.spacingBase > 0 ? raw.spacingBase : prior.spacingBase,
      radius: { ...prior.radius, md: str(raw.radiusMd, prior.radius.md) },
      density,
      navPattern: (["top-nav", "sidebar", "tabs", "bottom-tabs", "rail"] as const).includes(raw.navPattern)
        ? (raw.navPattern as NavPattern)
        : prior.navPattern,
      mobileNav: (["bottom-tabs", "drawer", "top-collapse"] as const).includes(raw.mobileNav)
        ? (raw.mobileNav as PicDesignSystem["mobileNav"])
        : prior.mobileNav,
      motion: {
        level: (["none", "subtle", "expressive"] as const).includes(raw.motionLevel)
          ? raw.motionLevel
          : prior.motion.level,
        principles: str(raw.motionPrinciples, prior.motion.principles),
      },
      surfaces: str(raw.surfaces, prior.surfaces),
      imagery: str(raw.imagery, prior.imagery),
      iconography: str(raw.iconography, prior.iconography),
      components: {
        ...prior.components,
        buttons: str(raw.componentButtons, prior.components.buttons),
        inputs: str(raw.componentInputs, prior.components.inputs),
        cards: str(raw.componentCards, prior.components.cards),
        navigation: str(raw.componentNavigation, prior.components.navigation),
        tables: str(raw.componentTables, prior.components.tables),
        emptyStates: str(raw.componentEmptyStates, prior.components.emptyStates),
      },
      source: "model",
    };
  } catch (e) {
    console.warn("[design-system] falling back to rules:", e instanceof Error ? e.message : String(e));
    return prior;
  }
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
