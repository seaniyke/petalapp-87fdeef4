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
import { isScaffoldOwnedPath } from "./scaffold-ownership.server";
import { fixMissingShadcnImports } from "./shadcn-imports.server";
import { fixArraySafety } from "./array-safety-fixer.server";
import { repairUnresolvedImports } from "./import-resolver.server";
import { repairBareImports } from "./bare-import-resolver.server";
import { closeKitDependencies, syncTsconfigExcludes } from "./kit-dep-closure.server";

import { normalizeJsxExtensions } from "./extension-normalizer.server";
import { validateRouteGraph } from "./route-graph.server";
import { wireOrphanPages } from "./orphan-page-wiring.server";

import { sweepTailwindTokens } from "./tailwind-token-sweep.server";
import { stubMissingAssets } from "./asset-stubber.server";
import { enforceRuntimeContracts } from "./runtime-contract.server";
import { enforceLayoutHygiene } from "./layout-hygiene.server";
import { enforceInteractionHygiene } from "./interaction-hygiene.server";
import { enforceFrontendQuality } from "./frontend-quality.server";
import { resolveSiblingImports } from "./sibling-resolver.server";
import { repairScopeLeaks } from "./scope-repair.server";


import { fixRouterImports } from "./router-imports.server";
import { fixMissingRouterProvider } from "./router-provider.server";
import { fixTanstackRouterWithoutProvider } from "./tanstack-router-fallback.server";

import { fixCssEscapes } from "./css-escape-fixer.server";
import { fixBlockProps } from "./block-props.server";
import { fixComponentChildren } from "./component-child.server";
import { ensureBrandIdentity, ensureBrandMarkWired } from "./brand-identity.server";
import { repairBuildConfigImports } from "./build-config-repair.server";
import { fixSourceEscapes } from "./source-escape-fixer.server";
import { fixMarkdownFences } from "./markdown-fence-fixer.server";

import { fixImportSyntax } from "./import-syntax-fixer.server";
import { fixJsxAttrLiterals } from "./jsx-attr-literal-fixer.server";

export interface RepairAllResult {
  files: ProjectFile[];
  /** Plain-language summary lines suitable for telemetry / logs. */
  notes: string[];
  /**
   * Iteration Standard #4 — the deterministic passes that actually fired on
   * this run, as stable ids (the note prefix, e.g. `shadcn-imports`). The
   * turn recorder persists these so we can see when the SAME pass keeps
   * firing turn after turn: that means the model is re-emitting a broken
   * shape and the repair is masking it, not fixing it.
   */
  firedPasses: string[];
  /**
   * v3 Phase E — the same notes, grouped by the three stages this pipeline
   * actually has. Before v3 there were ~30 undifferentiated passes and no way
   * to answer "did we fix a build error or restyle a button?" from a log line.
   *
   *   resolve — parse + import/route graph. Load-bearing: a miss here is a
   *             failed build.
   *   hygiene — runtime correctness: theme tokens, assets, prop contracts,
   *             brand mark, React contracts. A miss here is a broken render.
   *   polish  — layout, interaction and accessibility. Never load-bearing.
   *
   * Order of execution is unchanged and still enforced in one place; this is
   * the reporting contract on top of it.
   */
  stages: {
    resolve: string[];
    hygiene: string[];
    polish: string[];
  };
}

/** Note lines are `"<pass-id>: human text"`. Everything else is unlabeled. */
function passIdsFromNotes(notes: string[]): string[] {
  const ids = new Set<string>();
  for (const n of notes) {
    const m = /^([a-z0-9-]+):/i.exec(n.trim());
    if (m) ids.add(m[1].toLowerCase());
  }
  return Array.from(ids);
}

export function runAllRepairs(input: ProjectFile[]): RepairAllResult {
  let files = input;
  const notes: string[] = [];

  // Scaffold-owned files (UI kit, examples pack, content kit, generated
  // integrations) are authored by Petal and already parse. Heuristic repair
  // passes have no business rewriting them — when they do, the "fix" is what
  // breaks the build (e.g. an aria-label spliced into the middle of a JSX
  // opening tag). They stay in `files` so import-graph passes can still see
  // them, but their original bytes are restored before we return.
  const pristine = new Map(
    input.filter((f) => isScaffoldOwnedPath(f.path)).map((f) => [f.path, f.content]),
  );


  // 0. Leaked markdown fences. A stray ```lang line in code position aborts
  // the esbuild transform before ANY other pass can inspect the file, so
  // this must be the very first thing that runs.
  const fences = fixMarkdownFences(files);
  files = fences.files;
  notes.push(...fences.notes);

  // 0a. Literal escape repair for source files. A stray `\n` in code
  // position ("Syntax error \"n\"") kills the esbuild transform before any
  // other pass gets a chance, so this must run first.
  const srcEsc = fixSourceEscapes(files);
  files = srcEsc.files;
  notes.push(...srcEsc.notes);


  // 0a-2. Malformed import statements (`import { X } '…'` — no `from`) abort
  // the esbuild transform exactly like the escape bug, so heal them here too,
  // before any pass tries to read the import graph.
  const importSyntax = fixImportSyntax(files);
  files = importSyntax.files;
  notes.push(...importSyntax.notes);

  // 0a-3. Unbraced JSX attribute values (`columns=[…]`, `count=3`) abort the
  // esbuild transform too, so heal them alongside the other syntax passes.
  const attrLiterals = fixJsxAttrLiterals(files);
  files = attrLiterals.files;
  notes.push(...attrLiterals.notes);

  // Escape decoding can reveal a fence that arrived as literal `\n` bytes.
  // Run the idempotent fence pass again on the decoded source so that shape
  // cannot bypass every later repair and reach esbuild.
  const revealedFences = fixMarkdownFences(files);
  files = revealedFences.files;
  notes.push(...revealedFences.notes);



  // 0. Build-config import repair. Config files are deliberately excluded
  // from model edits and bare-import stripping, so deterministic healing is
  // the only safe path for legacy corruption such as `path is not defined`.
  const buildConfig = repairBuildConfigImports(files);
  files = buildConfig.files;
  notes.push(...buildConfig.notes);

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

  // 3b. BrandMark wiring MUST precede the import resolver: otherwise the
  //     resolver stubs `@/components/brand-mark` (or leaves the tag
  //     undeclared) and the preview dies with `Can't find variable: BrandMark`.
  const brandWire = ensureBrandMarkWired(files);
  files = brandWire.files;
  for (const n of brandWire.notes) notes.push(n);

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

  // 4c. TanStack Router consumers with no TanStack router mounted crash at
  // render with `null is not an object (evaluating 'n.stores')`. Route them
  // through a react-router-dom compatibility shim BEFORE the provider pass.
  const tanstackFallback = fixTanstackRouterWithoutProvider(files);
  files = tanstackFallback.files;
  for (const n of tanstackFallback.notes) notes.push(n);

  // 4d. Router provider guarantee. Router primitives without a mounted
  // <BrowserRouter> crash at render with
  // `Cannot destructure property 'basename' from null`.
  const routerProvider = fixMissingRouterProvider(files);
  files = routerProvider.files;
  for (const n of routerProvider.notes) notes.push(n);


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

  // 5a. Kit dependency closure — the model's page imports a scaffold module
  //     (e.g. "@/components/motion") whose kit file imports framer-motion.
  //     `repairBareImports` never sees kit files, so the package was missing
  //     from package.json and vite died on an import the user never wrote.
  const kitDeps = closeKitDependencies(files);
  files = kitDeps.files;
  for (const n of kitDeps.notes) notes.push(n);
  if (kitDeps.unpinned.length > 0) {
    notes.push(
      `kit-dep-closure: no curated pin for ${kitDeps.unpinned.join(", ")} (reachable import)`,
    );
  }
  // 5a-ii. Now that every reachable module's package is installed, stop hiding
  //        those modules from the compiler. tsconfig only excludes on-demand
  //        kit areas the app genuinely never imports.
  if (kitDeps.reached.size > 0) {
    const tsc = syncTsconfigExcludes(files, kitDeps.reached);
    files = tsc.files;
    for (const n of tsc.notes) notes.push(n);
  }


  // 5b. Sibling resolution (Quality Push A3) — the file the import meant IS
  //     in this pass, the specifier just has the wrong case/folder/extension.
  //     Deterministic rename beats spending a repair round on it.
  const siblings = resolveSiblingImports(files);
  files = siblings.files;
  if (siblings.fixes > 0) {
    notes.push(`sibling-resolver: repointed ${siblings.fixes} import(s) at the file that actually exists`);
  }

  // 5c. Scope repair (Quality Push A4) — an identifier with an unambiguous
  //     home (react hooks, lucide icons, cn, the project's router, sonner,
  //     framer-motion) is a forgotten import, not a defect worth a round.
  const scope = repairScopeLeaks(files);
  files = scope.files;
  if (scope.fixes > 0) {
    notes.push(`scope-repair: auto-imported ${scope.fixes} undeclared identifier(s)`);
  }



  // 6. Route-graph validator — wildcard 404, layout Outlet, dedupe "/", react-router→-dom.

  // 5d. Orphan-page wiring — a page file no router imports is an unreachable
  //     page. Wire it up BEFORE the route-graph pass so it sees the new routes.
  const orphan = wireOrphanPages(files);
  files = orphan.files;
  for (const n of orphan.notes) notes.push(n);

  const route = validateRouteGraph(files);
  files = route.files;
  for (const n of route.notes) notes.push(n);


  // ── end of STAGE 1: RESOLVE ───────────────────────────────────────────
  // Everything above answers "does this code parse and does every import
  // resolve?". Nothing above is cosmetic; every pass here is the difference
  // between a build and a stack trace.
  const resolveEnd = notes.length;


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

  // 9a. Kit-block prop contract — flatten invented `sectionHeader={{…}}`
  //     objects back into real props. Without this the section header never
  //     renders and the page ships with a tall blank band.
  const blockProps = fixBlockProps(files);
  files = blockProps.files;
  for (const n of blockProps.notes) notes.push(n);

  // 9a-2. Component-as-child guard — a lucide icon rendered as `{item.icon}`
  //     throws React error #31 and whites out the entire preview.
  const compChild = fixComponentChildren(files);
  files = compChild.files;
  for (const n of compChild.notes) notes.push(n);

  // 9b. Brand identity — real logo mark component, placeholder-glyph swap,
  //     and a favicon/apple-touch-icon so apps never ship unbranded.
  const brand = ensureBrandIdentity(files);
  files = brand.files;
  for (const n of brand.notes) notes.push(n);

  // 10. Runtime contract pass — DOM guard, Dialog Title, Select onValueChange, Providers.
  const rt = enforceRuntimeContracts(files);
  files = rt.files;
  for (const n of rt.notes) notes.push(n);

  // ── end of STAGE 2: HYGIENE ───────────────────────────────────────────
  // Everything between the two markers answers "will this render correctly
  // at runtime?" — theme tokens, missing assets, prop contracts, brand mark,
  // React runtime contracts.
  const hygieneEnd = notes.length;


  // 11. Layout hygiene — kill viewport-locked empty bands, clipped display
  //     type, tap-eating full-bleed overlays, and fixed headers that render
  //     on top of the first section.
  const layout = enforceLayoutHygiene(files);
  files = layout.files;
  for (const n of layout.notes) notes.push(n);

  // 12. Interaction hygiene — forms that reload the page, dead hamburgers,
  //     buttons wired to nothing.
  const interaction = enforceInteractionHygiene(files);
  files = interaction.files;
  for (const n of interaction.notes) notes.push(n);

  // 13. Frontend quality — accessibility floor, image alt text, form labels,
  //     one <h1> per page, reduced-motion escape hatch (Frontend Bible).
  const fq = enforceFrontendQuality(files);
  files = fq.files;
  for (const n of fq.notes) notes.push(n);

  // ── end of STAGE 3: POLISH ────────────────────────────────────────────
  // Layout, interaction and accessibility. Never load-bearing for the build.

  // Restore Petal-owned files byte-for-byte: no heuristic pass may alter them.
  files = files.map((f) => {
    const original = pristine.get(f.path);
    return original !== undefined && original !== f.content ? { ...f, content: original } : f;
  });

  return {
    files,
    notes,
    firedPasses: passIdsFromNotes(notes),
    stages: {
      resolve: notes.slice(0, resolveEnd),
      hygiene: notes.slice(resolveEnd, hygieneEnd),
      polish: notes.slice(hygieneEnd),
    },
  };

}

