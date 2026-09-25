/**
 * Design Intelligence — the EXISTING project's visual language, read from
 * its current CSS tokens and class usage. Deterministic, compact, structured.
 * Never a prose manual: each field is one short value.
 */
import type { ProjectFile } from "@/server/generate.server";

export interface DesignIntel {
  fonts: { display: string | null; body: string | null };
  colors: Record<string, string>;
  radius: string | null;
  typeScale: string[];
  spacing: string[];
  containers: string[];
  shadows: string[];
  cornerStyle: string[];
  buttons: string | null;
  navigation: string | null;
  hero: string | null;
  responsive: string[];
  motion: "none" | "css" | "framer-motion";
  imagery: string | null;
  accessibility: string[];
  mode: "light" | "dark" | "both" | "unknown";
}

const COLOR_KEYS = ["background", "foreground", "primary", "secondary", "accent", "muted", "border", "card"];

function top(values: string[], n: number): string[] {
  const c = new Map<string, number>();
  for (const v of values) c.set(v, (c.get(v) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([v]) => v);
}

function matchAll(src: string, re: RegExp): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  while ((m = g.exec(src))) out.push(m[1] ?? m[0]);
  return out;
}

export function extractDesignIntel(files: ProjectFile[]): DesignIntel {
  const css = files.filter((f) => f.path.endsWith(".css")).map((f) => f.content).join("\n");
  const code = files
    .filter((f) => /\.(t|j)sx$/.test(f.path) && !/^src\/components\/(ui|examples)\//.test(f.path))
    .map((f) => f.content)
    .join("\n");

  const colors: Record<string, string> = {};
  const rootBlock = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? css;
  for (const k of COLOR_KEYS) {
    const v = new RegExp(`--${k}:\\s*([^;]+);`).exec(rootBlock)?.[1]?.trim();
    if (v) colors[k] = v;
  }
  const fontVar = (name: string) =>
    new RegExp(`--font-${name}:\\s*["']?([^,;"']+)`).exec(css)?.[1]?.trim() ?? null;
  const display = fontVar("display") ?? fontVar("heading") ?? null;
  const body = fontVar("body") ?? fontVar("sans") ?? null;

  const cls = matchAll(code, /className=["'`{]([^"'`}]+)/);
  const tokens = cls.join(" ").split(/\s+/);
  const pick = (re: RegExp) => tokens.filter((t) => re.test(t));

  const hasDark = /\.dark\s*\{/.test(css) || tokens.some((t) => t.startsWith("dark:"));
  const buttonsSrc = /<(?:Button|button)\b[^>]*className=["'`]([^"'`]+)/.exec(code)?.[1] ?? null;
  const navSrc = /<(?:nav|header)\b[^>]*className=["'`]([^"'`]+)/.exec(code)?.[1] ?? null;
  const heroSrc = /<section\b[^>]*className=["'`]([^"'`]*(?:min-h-|h-screen|py-2|py-3)[^"'`]*)/.exec(code)?.[1] ?? null;

  const a11y: string[] = [];
  if (/aria-label=/.test(code)) a11y.push("aria-labels used");
  if (/\balt=/.test(code)) a11y.push("image alt text");
  if (/focus-visible:/.test(code)) a11y.push("focus-visible rings");

  const imgCount = (code.match(/<img\b/g) ?? []).length;
  return {
    fonts: { display, body },
    colors,
    radius: /--radius:\s*([^;]+);/.exec(css)?.[1]?.trim() ?? null,
    typeScale: top(pick(/^(?:[a-z]+:)?text-(xs|sm|base|lg|[2-9]?xl)$/), 5),
    spacing: top(pick(/^(?:[a-z]+:)?(py|px|gap|space-y)-\d+$/), 5),
    containers: top(pick(/^max-w-/), 3),
    shadows: top(pick(/^shadow(-|$)/), 3),
    cornerStyle: top(pick(/^rounded(-|$)/), 3),
    buttons: buttonsSrc ? buttonsSrc.split(/\s+/).slice(0, 10).join(" ") : null,
    navigation: navSrc ? navSrc.split(/\s+/).slice(0, 10).join(" ") : null,
    hero: heroSrc ? heroSrc.split(/\s+/).slice(0, 10).join(" ") : null,
    responsive: top(tokens.filter((t) => /^(sm|md|lg|xl):/.test(t)).map((t) => t.split(":")[0]!), 4),
    motion: /framer-motion|motion\/react/.test(code) ? "framer-motion" : /animate-|transition/.test(code) ? "css" : "none",
    imagery: imgCount ? `${imgCount} <img> in app code${/object-cover/.test(code) ? ", object-cover" : ""}` : null,
    accessibility: a11y,
    mode: hasDark && /--background/.test(css) ? "both" : Object.keys(colors).length ? "light" : "unknown",
  };
}

/** Compact structured render. `full` for visual work; `tokens` for other edits. */
export function renderDesignIntel(d: DesignIntel, detail: "full" | "tokens" = "full"): string {
  const lines: string[] = ["\n\nCURRENT DESIGN LANGUAGE (read from this project's files — match it unless the user asks to change it):"];
  const kv = (k: string, v: string | null | undefined | string[]) => {
    const s = Array.isArray(v) ? v.join(", ") : v;
    if (s) lines.push(`- ${k}: ${s}`);
  };
  kv("fonts", [d.fonts.display && `display ${d.fonts.display}`, d.fonts.body && `body ${d.fonts.body}`].filter(Boolean) as string[]);
  kv("colors", Object.entries(d.colors).map(([k, v]) => `${k}=${v}`));
  kv("radius", d.radius);
  kv("mode", d.mode === "unknown" ? null : d.mode);
  if (detail === "full") {
    kv("type scale", d.typeScale);
    kv("spacing", d.spacing);
    kv("containers", d.containers);
    kv("corners", d.cornerStyle);
    kv("shadows", d.shadows);
    kv("buttons", d.buttons);
    kv("navigation", d.navigation);
    kv("hero", d.hero);
    kv("breakpoints", d.responsive);
    kv("motion", d.motion === "none" ? null : d.motion);
    kv("imagery", d.imagery);
    kv("accessibility", d.accessibility);
  }
  return lines.length > 1 ? lines.join("\n") : "";
}
