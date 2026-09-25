/**
 * Design-system packages — the one authoritative loader/validator.
 *
 * A package is a folder under `./packages/<slug>/` with:
 *   design.json   (required) metadata
 *   tokens.css    (required) runtime token layer
 *   accents.json  (required) accent overrides per mode
 *   fonts.html    (required) font <link> declarations
 *   DESIGN.md     (required) AI playbook
 *   preview.html  (optional)
 *   components/*  (optional) files installed into the project on apply
 *
 * `parseDesignSystemPackage` is pure (a map of relative path → text) so it is
 * testable without a filesystem. The registry discovers packages with a Vite
 * glob, so adding a system is dropping a folder in — no code list.
 * Never throws: malformed packages come back as `{ ok: false, errors }`.
 */
import { z } from "zod";

export const REQUIRED_PACKAGE_FILES = ["design.json", "tokens.css", "accents.json", "fonts.html", "DESIGN.md"] as const;
export const DESIGN_PACKAGE_SCHEMA_VERSION = 1;

const SLUG = /^[a-z0-9][a-z0-9-]{1,63}$/;

export const designJsonSchema = z.object({
  schema_version: z.literal(DESIGN_PACKAGE_SCHEMA_VERSION),
  slug: z.string().regex(SLUG),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(600),
  when_to_use: z.string().min(1).max(600),
  version: z.string().min(1).max(32),
  internal: z.boolean().optional().default(false),
  default_accent: z.string().regex(SLUG),
  accents: z.array(z.string().regex(SLUG)).min(1),
  capabilities: z.array(z.string().min(1).max(40)).default([]),
  token_categories: z.array(z.string().min(1).max(40)).default([]),
  fonts: z.array(z.string().min(1).max(60)).default([]),
  has_components: z.boolean().default(false),
});
export type DesignJson = z.infer<typeof designJsonSchema>;

const TOKEN_NAME = /^[a-z][a-z0-9-]*$/;
const TOKEN_VALUE = /^[^;{}<>]{1,200}$/;
const accentModeSchema = z.record(z.string().regex(TOKEN_NAME), z.string().regex(TOKEN_VALUE));
export const accentsJsonSchema = z.record(
  z.string().regex(SLUG),
  z.object({ light: accentModeSchema, dark: accentModeSchema.optional() }),
);
export type AccentsJson = z.infer<typeof accentsJsonSchema>;

export interface DesignFont {
  rel: string;
  href: string;
  crossOrigin?: boolean;
}

export interface DesignSystemPackage {
  meta: DesignJson;
  tokensCss: string;
  /** Custom-property names declared in tokens.css, per block. */
  tokens: { root: Record<string, string>; dark: Record<string, string> };
  accents: AccentsJson;
  fontsHtml: string;
  fonts: DesignFont[];
  designMd: string;
  preview: string | null;
  /** Relative path under components/ → file content. */
  components: Record<string, string>;
}

export type PackageLoadResult =
  | { ok: true; pkg: DesignSystemPackage }
  | { ok: false; slug: string | null; errors: string[] };

function readBlock(css: string, selector: RegExp): Record<string, string> {
  const out: Record<string, string> = {};
  const m = selector.exec(css);
  if (!m) return out;
  const body = m[1] ?? "";
  const re = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let d: RegExpExecArray | null;
  while ((d = re.exec(body))) out[d[1]!] = d[2]!.trim();
  return out;
}

export function parseTokens(css: string) {
  return {
    root: readBlock(css, /:root\s*\{([^}]*)\}/),
    dark: readBlock(css, /\.dark\s*\{([^}]*)\}/),
  };
}

const ALLOWED_FONT_HOSTS = /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|api\.fontshare\.com|rsms\.me)\//;

export function parseFontsHtml(html: string): { fonts: DesignFont[]; errors: string[] } {
  const fonts: DesignFont[] = [];
  const errors: string[] = [];
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];
  const stripped = html.replace(/<link\b[^>]*>/gi, "").replace(/<!--[\s\S]*?-->/g, "").trim();
  if (stripped) errors.push("fonts.html may only contain <link> tags");
  for (const tag of tags) {
    const rel = /\brel=["']([^"']+)["']/i.exec(tag)?.[1];
    const href = /\bhref=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!rel || !href) { errors.push(`fonts.html link missing rel/href: ${tag}`); continue; }
    if (!/^(stylesheet|preconnect|preload)$/.test(rel)) { errors.push(`fonts.html unsupported rel "${rel}"`); continue; }
    if (!ALLOWED_FONT_HOSTS.test(href)) { errors.push(`fonts.html host not allowed: ${href}`); continue; }
    fonts.push({ rel, href, ...(/\bcrossorigin\b/i.test(tag) ? { crossOrigin: true } : {}) });
  }
  if (!fonts.some((f) => f.rel === "stylesheet")) errors.push("fonts.html declares no stylesheet");
  return { fonts, errors };
}

/** Validate one package from its files. Pure. */
export function parseDesignSystemPackage(files: Record<string, string>, folder?: string): PackageLoadResult {
  const errors: string[] = [];
  for (const req of REQUIRED_PACKAGE_FILES) {
    if (typeof files[req] !== "string" || !files[req]!.trim()) errors.push(`missing required file ${req}`);
  }
  if (errors.length) return { ok: false, slug: folder ?? null, errors };

  let metaRaw: unknown;
  try { metaRaw = JSON.parse(files["design.json"]!); } catch { return { ok: false, slug: folder ?? null, errors: ["design.json is not valid JSON"] }; }
  const meta = designJsonSchema.safeParse(metaRaw);
  if (!meta.success) {
    return { ok: false, slug: folder ?? null, errors: meta.error.issues.map((i) => `design.json ${i.path.join(".")}: ${i.message}`) };
  }
  if (folder && meta.data.slug !== folder) errors.push(`design.json slug "${meta.data.slug}" does not match folder "${folder}"`);

  let accentsRaw: unknown;
  try { accentsRaw = JSON.parse(files["accents.json"]!); } catch { return { ok: false, slug: meta.data.slug, errors: ["accents.json is not valid JSON"] }; }
  const accents = accentsJsonSchema.safeParse(accentsRaw);
  if (!accents.success) {
    return { ok: false, slug: meta.data.slug, errors: accents.error.issues.map((i) => `accents.json ${i.path.join(".")}: ${i.message}`) };
  }
  const accentIds = Object.keys(accents.data);
  for (const id of meta.data.accents) if (!accentIds.includes(id)) errors.push(`accent "${id}" listed in design.json but missing from accents.json`);
  for (const id of accentIds) if (!meta.data.accents.includes(id)) errors.push(`accent "${id}" in accents.json is not listed in design.json`);
  if (!meta.data.accents.includes(meta.data.default_accent)) errors.push(`default_accent "${meta.data.default_accent}" is not a listed accent`);

  const tokensCss = files["tokens.css"]!;
  if (/@import|<\/?style|url\(\s*["']?javascript:/i.test(tokensCss)) errors.push("tokens.css may not contain @import, <style> or script urls");
  const tokens = parseTokens(tokensCss);
  if (!Object.keys(tokens.root).length) errors.push("tokens.css has no :root tokens");

  const { fonts, errors: fontErrors } = parseFontsHtml(files["fonts.html"]!);
  errors.push(...fontErrors);

  const components: Record<string, string> = {};
  for (const [p, c] of Object.entries(files)) {
    if (!p.startsWith("components/")) continue;
    const rel = p.slice("components/".length);
    if (!/^[A-Za-z0-9_\-/]+\.(tsx|ts|css)$/.test(rel) || rel.includes("..")) { errors.push(`invalid component path ${p}`); continue; }
    components[rel] = c;
  }
  if (meta.data.has_components && !Object.keys(components).length) errors.push("has_components is true but components/ is empty");
  if (!meta.data.has_components && Object.keys(components).length) errors.push("components/ present but has_components is false");

  if (errors.length) return { ok: false, slug: meta.data.slug, errors };
  return {
    ok: true,
    pkg: {
      meta: meta.data,
      tokensCss,
      tokens,
      accents: accents.data,
      fontsHtml: files["fonts.html"]!,
      fonts,
      designMd: files["DESIGN.md"]!,
      preview: typeof files["preview.html"] === "string" && files["preview.html"]!.trim() ? files["preview.html"]! : null,
      components,
    },
  };
}

/** True when `accent` belongs to the package. */
export function isValidAccent(pkg: DesignSystemPackage, accent: string): boolean {
  return pkg.meta.accents.includes(accent) && !!pkg.accents[accent];
}
