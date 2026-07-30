/**
 * Composition point for all deterministic file-graph repairs.
 *
 * Order matters and is enforced here:
 *   1. extension-normalizer    — rename .ts→.tsx so subsequent passes see real files.
 *   2. shadcn-imports          — inject missing shadcn UI primitive imports.
 *   3. array-safety            — wrap possibly-undefined arrays before iteration.
 *   4. import-resolver         — remap or stub unresolved LOCAL imports.
 *   5. bare-import-resolver    — alias/install/strip unresolved BARE imports.
 *   6. route-graph             — validate <Link>/<Navigate>/navigate() vs <Route>;
 *                                rewrite react-router→react-router-dom; inject 404;
 *                                add <Outlet/> to layout components missing it.
 *
 * Each pass is pure ProjectFile[] → ProjectFile[]. Together they are the
 * "succeed-by-construction" layer described in .lovable/plan.md.
 *
 * Both the staged pipeline (stage-wireup) and the monolithic path
 * (api/generate.ts) call this helper. There must be only one place where
 * these passes run; spreading them across call sites is how we get drift.
 */

import type { ProjectFile } from "./generate.server";
import { fixMissingShadcnImports } from "./shadcn-imports.server";
import { fixArraySafety } from "./array-safety-fixer.server";
import { repairUnresolvedImports } from "./import-resolver.server";
import { repairBareImports } from "./bare-import-resolver.server";
import { normalizeJsxExtensions } from "./extension-normalizer.server";
import { validateRouteGraph } from "./route-graph.server";
import { sweepTailwindTokens } from "./tailwind-token-sweep.server";
import { stubMissingAssets } from "./asset-stubber.server";
import { enforceRuntimeContracts } from "./runtime-contract.server";
import { fixRouterImports } from "./router-imports.server";
import { fixCssEscapes } from "./css-escape-fixer.server";

export interface RepairAllResult {
  files: ProjectFile[];
  /** Plain-language summary lines suitable for telemetry / logs. */
  notes: string[];
}

export function runAllRepairs(input: ProjectFile[]): RepairAllResult {
  let files = input;
  const notes: string[] = [];

  // 1. Extension normalizer — must run FIRST so case-insensitive path
  //    matching in the import-resolver sees the post-rename layout.
  const ext = normalizeJsxExtensions(files);
  files = ext.files;
  if (ext.renamed.length > 0) {
    notes.push(
      `extension-normalizer: renamed ${ext.renamed.length} file(s) (${ext.renamed
        .slice(0, 3)
        .map((r) => `${r.from}→${r.to}`)
        .join(", ")}${ext.renamed.length > 3 ? "…" : ""})`,
    );
  }

  // 2. shadcn import autofix.
  const shadcn = fixMissingShadcnImports(files);
  files = shadcn.files;
  if (shadcn.fixes.length > 0) {
    const total = shadcn.fixes.reduce((n, f) => n + f.added.length, 0);
    notes.push(`shadcn-imports: injected ${total} import(s) across ${shadcn.fixes.length} file(s)`);
  }

  // 3. Array-safety autofix.
  const arr = fixArraySafety(files);
  files = arr.files;
  if (arr.fixes.length > 0) {
    const total = arr.fixes.reduce((n, f) => n + f.rewrites, 0);
    notes.push(`array-safety: hardened ${total} access(es) across ${arr.fixes.length} file(s)`);
  }

  // 4. Local import resolver — remap or stub unresolved `@/` and `./` imports.
  const localImports = repairUnresolvedImports(files);
  files = localImports.files;
  if (localImports.rewrites.length || localImports.stubsCreated.length) {
    notes.push(
      `import-resolver: remapped ${localImports.rewrites.length} import(s); stubbed ${localImports.stubsCreated.length} missing file(s)`,
    );
  }

  // 4b. Router import autofix must run BEFORE bare-import resolution. That
  // resolver can only install a package it can see in an import statement;
  // injecting `createFileRoute` afterward would leave package.json stale.
  const routerImports = fixRouterImports(files);
  files = routerImports.files;
  for (const n of routerImports.notes) notes.push(n);

  // 5. Bare import resolver — alias, install, or strip unresolved bare specs.
  const bare = repairBareImports(files);
  files = bare.files;
  if (
    bare.rewrites.length ||
    Object.keys(bare.addedDeps).length ||
    bare.iconFixes.length ||
    bare.stripped.length
  ) {
    const parts: string[] = [];
    if (bare.rewrites.length) parts.push(`${bare.rewrites.length} alias rewrite(s)`);
    const addedKeys = Object.keys(bare.addedDeps);
    if (addedKeys.length) parts.push(`auto-installed ${addedKeys.join(", ")}`);
    if (bare.iconFixes.length) parts.push(`fixed ${bare.iconFixes.length} icon name(s)`);
    if (bare.stripped.length) parts.push(`stripped ${bare.stripped.length} unknown import(s)`);
    notes.push(`bare-imports: ${parts.join("; ")}`);
  }

  // 6. Route-graph validator — wildcard 404, layout Outlet, dedupe "/", react-router→-dom.
  const route = validateRouteGraph(files);
  files = route.files;
  for (const n of route.notes) notes.push(n);

  // 6b. CSS escape/theme sanitizer — literal `\n` inside styles.css aborts
  //     the Tailwind v4 build ("@theme blocks must only contain…").
  const cssEsc = fixCssEscapes(files);
  files = cssEsc.files;
  for (const n of cssEsc.notes) notes.push(n);



  // 7. Tailwind token sweep — inject missing semantic tokens into styles.css.
  const tw = sweepTailwindTokens(files);
  files = tw.files;
  for (const n of tw.notes) notes.push(n);

  // 8. Asset stubber — placeholder SVGs for missing local refs; onError for external.
  const assets = stubMissingAssets(files);
  files = assets.files;
  for (const n of assets.notes) notes.push(n);

  // 9. Runtime contract pass — DOM guard, Dialog Title, Select onValueChange, Providers.
  const rt = enforceRuntimeContracts(files);
  files = rt.files;
  for (const n of rt.notes) notes.push(n);

  return { files, notes };
}
