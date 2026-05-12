/**
 * App Composer — Step 5 of the 500-system expansion.
 *
 * Today the generator gets two independent prompt blocks:
 *   1. archetype guardrail (semantic-router → system-catalog)
 *   2. template plan (design-director → templates.server)
 *
 * The model is then expected to mentally merge them, infer which kit blocks
 * to import, find the right example to copy from, and lay out routes. That's
 * a lot of inference per build.
 *
 * The composer collapses all of that into ONE structured "App Blueprint":
 *   - matched archetype + reality/capability tier
 *   - merged route list (template.routes ∪ archetype.extraRoutes)
 *   - resolved kit-block file paths (from KIT_FILES) for every block name
 *   - resolved example file paths for the closest references
 *   - explicit guardrails (DEMO banner, mobile-first, key-required)
 *
 * It also exposes `scaffoldRouteStubs(blueprint)` — minimal TanStack route
 * file shells for each route — so on initial builds the model gets a
 * pre-laid filesystem and just fills in screens, instead of inventing
 * routing from scratch and forgetting half the pages.
 */

import type { ProjectFile } from "./generate.server";
import type { ArchetypeSpec } from "./system-catalog.server";
import { renderArchetypeGuardrail } from "./system-catalog.server";
import { renderDomainPackBlock } from "./domain-packs.server";
import { routeBrief } from "./semantic-router.server";
import {
  TEMPLATES,
  pickTemplateForBrief,
  type TemplateKey,
  type TemplateSpec,
} from "./templates.server";
import { KIT_FILES } from "./scaffold-kit";

export interface AppBlueprint {
  archetype: ArchetypeSpec | null;
  template: TemplateSpec;
  routes: string[];
  /** Kit block paths resolved from template.blocks (file paths under
   *  src/components/blocks or src/components/ui). */
  kitBlockPaths: string[];
  /** Example file paths the model should study before inventing UI. */
  examplePaths: string[];
  features: string[];
  guardrails: string[];
}

/* ============================================================
 * Resolution helpers
 * ============================================================ */

/** Convert a block name like "KanbanBoard" or "PricingTable" to candidate
 *  file basenames (kanban-board, kanbanboard, kanban_board). */
function blockNameVariants(name: string): string[] {
  const kebab = name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\\s]+/g, "-")
    .toLowerCase();
  const flat = name.toLowerCase();
  return Array.from(new Set([kebab, flat, kebab.replace(/-/g, "_")]));
}

/** Resolve TemplateSpec.blocks (UI/Pascal names) into actual kit file paths. */
function resolveKitBlockPaths(blockNames: ReadonlyArray<string>): string[] {
  const blockFiles = KIT_FILES.filter(
    (f) =>
      f.path.startsWith("src/components/blocks/") ||
      f.path.startsWith("src/components/ui/"),
  );
  const out = new Set<string>();
  for (const name of blockNames) {
    const variants = blockNameVariants(name);
    for (const f of blockFiles) {
      const base = f.path.split("/").pop()!.replace(/\.tsx?$/, "");
      if (variants.includes(base)) {
        out.add(f.path);
        break;
      }
    }
  }
  return Array.from(out);
}

/** Pick example files most relevant to the blueprint by matching template
 *  key, archetype id, and block names against example basenames. */
function resolveExamplePaths(
  template: TemplateSpec,
  archetype: ArchetypeSpec | null,
): string[] {
  const examples = KIT_FILES.filter((f) =>
    f.path.startsWith("src/components/examples/"),
  );
  const needles = new Set<string>();
  // Template key tokens (e.g. "kanban-tasks" → "kanban", "tasks").
  for (const tok of template.key.split("-")) needles.add(tok);
  // Archetype id tokens.
  if (archetype) for (const tok of archetype.id.split("-")) needles.add(tok);
  // Block names → kebab tokens.
  for (const b of template.blocks) {
    for (const v of blockNameVariants(b)) {
      for (const tok of v.split("-")) if (tok.length >= 4) needles.add(tok);
    }
  }
  // Drop noise tokens.
  ["the", "card", "page", "list", "view", "demo", "shell"].forEach((n) =>
    needles.delete(n),
  );

  const scored: Array<{ path: string; score: number }> = [];
  for (const f of examples) {
    const base = f.path.split("/").pop()!.replace(/\.tsx?$/, "");
    let score = 0;
    for (const n of needles) if (base.includes(n)) score += 1;
    if (score > 0) scored.push({ path: f.path, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 6).map((s) => s.path);
}

/* ============================================================
 * Compose
 * ============================================================ */

export function composeAppBlueprint(brief: string): AppBlueprint | null {
  const semantic = routeBrief(brief);
  const archetype = semantic?.archetype ?? null;

  // Prefer the archetype's parent template; fall back to keyword scorer.
  let templateKey: TemplateKey | null = archetype?.template ?? null;
  if (!templateKey) templateKey = pickTemplateForBrief(brief);
  if (!templateKey) return null;
  const template = TEMPLATES[templateKey];
  if (!template) return null;

  // Merge routes (template + archetype extras), de-dupe, preserve order.
  const seen = new Set<string>();
  const routes: string[] = [];
  for (const r of [...template.routes, ...(archetype?.extraRoutes ?? [])]) {
    if (!seen.has(r)) {
      seen.add(r);
      routes.push(r);
    }
  }

  const kitBlockPaths = resolveKitBlockPaths(template.blocks);
  const examplePaths = resolveExamplePaths(template, archetype);

  const guardrails: string[] = [];
  if (archetype?.reality === "demo-only") {
    guardrails.push(
      'Render a visible "DEMO — simulated data" banner on the landing route. No real vendor SDKs.',
    );
  } else if (archetype?.reality === "keys-required") {
    const keys = archetype.needsKeys?.join(", ") ?? "provider keys";
    guardrails.push(
      `Real version needs: ${keys}. Render a friendly empty state pointing to Cloud → Secrets when missing, with demo data fallback.`,
    );
  }
  if (
    archetype?.capability === "mobile-pwa" ||
    archetype?.capability === "mobile-capacitor"
  ) {
    guardrails.push(
      "Mobile-first: bottom-tab nav, SafeArea wrapper, ≥44px hit areas, max-w 430px content lanes.",
    );
  }

  return {
    archetype,
    template,
    routes,
    kitBlockPaths,
    examplePaths,
    features: template.features,
    guardrails,
  };
}

/* ============================================================
 * Render to system prompt
 * ============================================================ */

export function renderBlueprintBlock(b: AppBlueprint): string {
  const out: string[] = [];
  out.push("\n\n### App Blueprint (committed for this build — execute it)");
  if (b.archetype) {
    out.push(`Archetype: ${b.archetype.label} [${b.archetype.id}] — ${b.archetype.vertical}`);
    if (b.archetype.domainNote) out.push(b.archetype.domainNote);
  }
  out.push(`Template: ${b.template.key} — ${b.template.description}`);

  out.push(`\nScaffold these routes (use these exact paths):`);
  for (const r of b.routes) out.push(`  - ${r}`);

  if (b.kitBlockPaths.length) {
    out.push(`\nReuse these kit blocks instead of inventing UI (import them, do not redefine):`);
    for (const p of b.kitBlockPaths) out.push(`  - ${p}`);
  }
  if (b.examplePaths.length) {
    out.push(
      `\nStudy these example files for layout + token usage (read, do not import — they're under src/components/examples/):`,
    );
    for (const p of b.examplePaths) out.push(`  - ${p}`);
  }

  out.push(`\nFeatures the user almost certainly wants:`);
  for (const f of b.features) out.push(`  - ${f}`);

  if (b.guardrails.length) {
    out.push(`\nGuardrails (non-negotiable):`);
    for (const g of b.guardrails) out.push(`  - ${g}`);
  }

  out.push(
    `\nDo NOT mention the template/archetype slugs in user-facing copy or comments.`,
  );

  // Append the legacy archetype guardrail block too — keeps the existing
  // reality-tier wording intact for the model.
  if (b.archetype) {
    out.push(renderArchetypeGuardrail(b.archetype));
    // Step 6: per-vertical domain pack — injected only when matched, so
    // prompt size stays flat regardless of how many packs we add.
    out.push(renderDomainPackBlock(b.archetype));
  }
  return out.join("\n");
}

/* ============================================================
 * Pre-stub TanStack route files for initial builds
 * ============================================================ */

/** Convert a route path like "/projects/$id/tasks/$taskId" to its TanStack
 *  file-route filename: src/routes/projects.$id.tasks.$taskId.tsx */
function routePathToFile(routePath: string): string {
  if (routePath === "/" || routePath === "") return "src/routes/index.tsx";
  const parts = routePath
    .replace(/^\//, "")
    .split("/")
    .filter(Boolean)
    .map((seg) => seg.replace(/[^a-zA-Z0-9$_-]/g, ""));
  return `src/routes/${parts.join(".")}.tsx`;
}

function routeIdFromPath(routePath: string): string {
  return routePath.replace(/[^a-zA-Z0-9]/g, "_") || "index";
}

function componentName(routePath: string): string {
  if (routePath === "/" || routePath === "") return "HomePage";
  const segs = routePath.replace(/^\//, "").split("/").filter(Boolean);
  const pascal = segs
    .map((s) =>
      s
        .replace(/[$]/g, "")
        .split(/[-_]/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(""),
    )
    .join("");
  return `${pascal || "Page"}Page`;
}

function stubContent(routePath: string, blueprint: AppBlueprint): string {
  const comp = componentName(routePath);
  const blueprintNote =
    `// Petal scaffold stub — fill this in.\n` +
    `// Route: ${routePath} · Template: ${blueprint.template.key}` +
    (blueprint.archetype ? ` · Archetype: ${blueprint.archetype.id}` : "") +
    `\n// Reuse blocks from src/components/blocks/* and study examples in src/components/examples/*.\n`;
  // Minimal head() per the route-architecture rules.
  const title = comp.replace(/Page$/, "") || "Home";
  return `import { createFileRoute } from "@tanstack/react-router";

${blueprintNote}
export const Route = createFileRoute("${routePath}")({
  head: () => ({
    meta: [
      { title: "${title}" },
      { name: "description", content: "${title} page." },
    ],
  }),
  component: ${comp},
});

function ${comp}() {
  return (
    <main className="min-h-screen bg-background p-6">
      <h1 className="text-2xl font-semibold tracking-tight">${title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Replace this stub with the real ${routePath} screen.</p>
    </main>
  );
}
`;
}

/** Pre-laid TanStack route files. ONLY for initial builds (currentFiles empty)
 *  — stubs are non-overwriting so subsequent edits keep the model's work. */
export function scaffoldRouteStubs(blueprint: AppBlueprint): ProjectFile[] {
  const files: ProjectFile[] = [];
  const seen = new Set<string>();
  for (const r of blueprint.routes) {
    const path = routePathToFile(r);
    if (seen.has(path)) continue;
    seen.add(path);
    files.push({ path, content: stubContent(r, blueprint) });
  }
  return files;
}

/** One-shot helper used by the generate route. */
export function buildBlueprintFor(
  brief: string,
): { blueprint: AppBlueprint; promptBlock: string } | null {
  const blueprint = composeAppBlueprint(brief);
  if (!blueprint) return null;
  return { blueprint, promptBlock: renderBlueprintBlock(blueprint) };
}

// Silence unused-import warnings when route id helpers grow callers later.
void routeIdFromPath;
