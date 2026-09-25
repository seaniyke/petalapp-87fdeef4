/**
 * Deterministic focused-context selection and conditional section flags.
 *
 * Given the request and the manifest, pick the smallest useful set of files
 * and decide which conditional context sections apply. Unknown conditions
 * fail CLOSED: a section is only included when there is positive evidence.
 */
import type { ProjectManifest, PageType } from "./manifest";

export interface ContextFlags {
  backend: boolean;
  database: boolean;
  commerce: boolean;
  design: boolean;
  images: boolean;
  deployment: boolean;
  forms: boolean;
}

const RE = {
  backend: /\b(log ?in|sign ?(in|up)|auth|account|user|backend|server|api|save|persist|database|db|table|supabase)\b/i,
  database: /\b(database|db|table|record|column|query|save|persist|store data|crud|list of)\b/i,
  commerce: /\b(shop|store|cart|checkout|product|order|payment|pay|price|pricing|stripe|paystack|subscription)\b/i,
  design: /\b(design|look|style|colou?r|font|typograph|theme|palette|spacing|layout|hero|button|card|modern|premium|beautiful|redesign|visual|dark|light|bigger|smaller|bold)\b/i,
  images: /\b(image|images|photo|picture|illustration|gallery|logo|icon|avatar|background|banner|hero)\b/i,
  deployment: /\b(publish|deploy|domain|go live|launch|seo|hosting)\b/i,
  forms: /\b(form|input|field|submit|contact|newsletter|sign ?up)\b/i,
};

export function detectContextFlags(
  request: string,
  manifest: ProjectManifest | null,
  opts: { isInitial: boolean },
): ContextFlags {
  const r = request || "";
  const hasBackend = !!manifest?.backend.connected;
  return {
    // Backend/db only when the project has one AND the request touches it.
    backend: hasBackend && RE.backend.test(r),
    database: hasBackend && RE.database.test(r),
    commerce: RE.commerce.test(r) || (!!manifest && manifest.pages.some((p) => p.type === "commerce") && RE.commerce.test(r)),
    design: opts.isInitial || RE.design.test(r),
    images: opts.isInitial || RE.images.test(r),
    deployment: RE.deployment.test(r),
    forms: RE.forms.test(r),
  };
}

const PAGE_WORDS: Array<[PageType, RegExp]> = [
  ["home", /\b(home ?page|homepage|landing|home|hero)\b/i],
  ["auth", /\b(log ?in|sign ?(in|up)|register|auth|password)\b/i],
  ["dashboard", /\b(dashboard|admin|analytics)\b/i],
  ["pricing", /\b(pricing|plans?)\b/i],
  ["contact", /\bcontact\b/i],
  ["about", /\b(about|story|team)\b/i],
  ["commerce", /\b(shop|store|product|cart|checkout)\b/i],
  ["blog", /\b(blog|post|article)\b/i],
  ["settings", /\b(settings|profile|account)\b/i],
  ["legal", /\b(privacy|terms)\b/i],
];

function words(s: string): string[] {
  return s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
}

export interface Selection {
  /** Files the change is about. */
  primary: string[];
  /** Direct dependencies / shared pieces needed to edit them safely. */
  supporting: string[];
  /** Style files needed to stay on-palette. */
  styles: string[];
  reasons: Record<string, string>;
}

/**
 * Rank files for an edit. Explicit targets (already resolved by the edit
 * resolver / view context) win; otherwise match page types and file names
 * against the request, then add each primary file's direct imports that are
 * app components (not the kit).
 */
export function selectContext(
  request: string,
  manifest: ProjectManifest,
  opts: { explicitTargets?: string[]; max?: number; flags?: ContextFlags } = {},
): Selection {
  const max = opts.max ?? 8;
  const reasons: Record<string, string> = {};
  const primary: string[] = [];
  const add = (p: string, why: string, list: string[]) => {
    if (!p || list.includes(p) || primary.includes(p)) return;
    list.push(p);
    reasons[p] = why;
  };

  for (const t of opts.explicitTargets ?? []) add(t, "resolved target", primary);

  if (primary.length === 0) {
    for (const [type, re] of PAGE_WORDS) {
      if (!re.test(request)) continue;
      for (const pg of manifest.pages.filter((p) => p.type === type)) add(pg.path, `page type ${type}`, primary);
      if (type === "home" && manifest.appMap.entry && !manifest.pages.some((p) => p.type === "home")) {
        add(manifest.appMap.entry, "home is the entry", primary);
      }
    }
    const req = new Set(words(request));
    for (const c of [...manifest.components, ...manifest.pages.map((p) => p.path)]) {
      const name = (c.split("/").pop() ?? "").replace(/\.(t|j)sx?$/, "");
      const nameWords = words(name);
      if (nameWords.length && nameWords.every((w) => req.has(w) || req.has(w.replace(/s$/, "")))) add(c, `name matches "${name}"`, primary);
    }
  }

  const supporting: string[] = [];
  const known = new Set(manifest.components);
  for (const p of primary) {
    for (const d of manifest.appMap.deps[p] ?? []) if (known.has(d)) add(d, `imported by ${p}`, supporting);
    // Children of the entry/router are not "supporting" by import alone.
  }
  // Navigation-affecting asks need the shared layout.
  if (/\b(nav|navbar|menu|header|footer|link)\b/i.test(request)) {
    for (const l of manifest.layouts) add(l, "shared layout", supporting);
  }

  const styles = opts.flags?.design === false ? [] : manifest.styles.slice(0, 2);
  const cappedPrimary = primary.slice(0, max);
  return {
    primary: cappedPrimary,
    supporting: supporting.slice(0, Math.max(0, max - cappedPrimary.length)),
    styles,
    reasons,
  };
}
