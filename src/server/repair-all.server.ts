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
import { pruneJunkPages } from "./junk-page-pruner.server";
import { fixExportShape } from "./export-shape-fixer.server";

import { sweepTailwindTokens } from "./tailwind-token-sweep.server";
import { repairPaletteIntegrity } from "./palette-integrity.server";

import { stubMissingAssets } from "./asset-stubber.server";
import { enforceRuntimeContracts } from "./runtime-contract.server";
import { enforceLayoutHygiene } from "./layout-hygiene.server";
import { enforceInteractionHygiene } from "./interaction-hygiene.server";
import { enforceFrontendQuality } from "./frontend-quality.server";
import { enforceDesignFinish } from "./design-finisher.server";

import { resolveSiblingImports } from "./sibling-resolver.server";
import { repairScopeLeaks } from "./scope-repair.server";


import { fixRouterImports } from "./router-imports.server";
import { fixMissingRouterProvider } from "./router-provider.server";
import { fixTanstackRouterWithoutProvider } from "./tanstack-router-fallback.server";

import { fixCssEscapes } from "./css-escape-fixer.server";
import { fixBlockProps } from "./block-props.server";
import { fixComponentChildren } from "./component-child.server";
import { ensureBrandIdentity, ensureBrandMarkWired } from "./brand-identity.server";
import { alignAuthApi } from "./auth-api-align.server";

import { repairBuildConfigImports } from "./build-config-repair.server";
import { fixSourceEscapes } from "./source-escape-fixer.server";
import { fixMarkdownFences } from "./markdown-fence-fixer.server";

import { fixImportSyntax } from "./import-syntax-fixer.server";
import { ensureQueryProvider } from "./ensure-query-provider.server";
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

export interface RepairAllOptions {
  /**
   * Edit-turn scope lock. When present, the cosmetic stages (HYGIENE + POLISH:
   * design finisher, layout/interaction hygiene, frontend quality…) may only
   * keep their output for files the turn actually touched. Untouched files are
   * restored to their post-RESOLVE bytes, so a one-line copy edit can never
   * restyle a page the user did not ask about. Build-blocking RESOLVE fixes
   * (syntax, imports, route graph) always apply, everywhere.
   */
  scopeLock?: { touchedPaths: readonly string[] };
  /**
   * Local edit: a local failure gets a local repair. When set together with
   * `scopeLock`, EVERY stage — RESOLVE included — may only keep changes to
   * files the turn touched (plus brand-new files a resolver had to create and
   * the resolver-managed build config). Pre-existing issues in untouched files
   * are not this edit's business and are never rewritten.
   */
  localOnly?: boolean;
  /** Internal: already narrowed to the local view. */
  _viewOnly?: boolean;
}

const IMPORT_SPEC_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
const RESOLVE_EXTS = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];
/** Entry/router files a local page edit may need for route checks. */
const LOCAL_VIEW_ALWAYS = /^(index\.html|src\/(main|App|router|routes)\.(t|j)sx?|src\/(styles|index)\.css|src\/routes\/__root\.tsx)$/;

function resolveSpec(from: string, spec: string, paths: Set<string>): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = "src/" + spec.slice(2);
  else if (spec.startsWith(".")) {
    const dir = from.split("/").slice(0, -1);
    for (const part of spec.split("/")) {
      if (part === "." || part === "") continue;
      if (part === "..") dir.pop();
      else dir.push(part);
    }
    base = dir.join("/");
  } else return null;
  for (const ext of RESOLVE_EXTS) if (paths.has(base + ext)) return base + ext;
  return null;
}

/**
 * The local view for an ordinary edit: the files the edit wrote, the files
 * those import (read context for the import/scope resolvers), the entry and
 * router files, and the resolver-managed build config. Nothing else.
 */
export function localRepairView(files: ProjectFile[], touched: readonly string[]): ProjectFile[] {
  const paths = new Set(files.map((f) => f.path));
  const byPath = new Map(files.map((f) => [f.path, f]));
  const keep = new Set<string>(touched.filter((p) => paths.has(p)));
  for (const p of touched) {
    const f = byPath.get(p);
    if (!f) continue;
    for (const m of f.content.matchAll(IMPORT_SPEC_RE)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (!spec) continue;
      const hit = resolveSpec(p, spec, paths);
      if (hit) keep.add(hit);
    }
  }
  for (const f of files) {
    if (LOCAL_VIEW_ALWAYS.test(f.path) || (RESOLVER_MANAGED_PATHS as readonly string[]).includes(f.path)) {
      keep.add(f.path);
    }
  }
  return files.filter((f) => keep.has(f.path));
}

/**
 * Scaffold-owned files that Kimble's own RESOLVE-stage passes are allowed to
 * rewrite (dependency pins, tsconfig excludes, Vite aliases). They are
 * protected from the model and from cosmetic passes, never from the resolver.
 */
const RESOLVER_MANAGED_PATHS = ["package.json", "tsconfig.json", "vite.config.ts"] as const;

export function runAllRepairs(input: ProjectFile[], opts?: RepairAllOptions): RepairAllResult {
  // Ordinary edit: tidy only the edit's own files. The passes see the local
  // view (written files + what they import + entry/router + build config),
  // never the whole project, and the result is merged back.
  if (opts?.localOnly && opts.scopeLock && !opts._viewOnly) {
    const view = localRepairView(input, opts.scopeLock.touchedPaths);
    const viewPaths = new Set(view.map((f) => f.path));
    const inner = runAllRepairs(view, { ...opts, _viewOnly: true });
    const out = new Map(inner.files.map((f) => [f.path, f]));
    const merged: ProjectFile[] = [];
    for (const f of input) {
      if (!viewPaths.has(f.path)) merged.push(f);
      else merged.push(out.get(f.path) ?? f); // a view file is never dropped on an edit
    }
    // Resolver-created files are kept, but never a renamed copy of an existing
    // file (an edit does not rename files it was not asked to).
    const stem = (p: string) => p.replace(/\.(tsx|ts|jsx|js|mjs)$/g, "").replace(/\.(tsx|ts|jsx|js|mjs)$/g, "");
    const inputStems = new Set(input.map((f) => stem(f.path)));
    // ...and only when a file the edit actually wrote imports it. Stubs made
    // for imports of untouched entry files are not this edit's business.
    const pathSet = new Set(inner.files.map((f) => f.path));
    const wanted = new Set<string>();
    for (const p of opts.scopeLock.touchedPaths) {
      if (!input.some((f) => f.path === p)) continue; // must be a pre-existing file the edit changed
      const f = inner.files.find((x) => x.path === p);
      if (!f) continue;
      for (const m of f.content.matchAll(IMPORT_SPEC_RE)) {
        const spec = m[1] ?? m[2] ?? m[3];
        const hit = spec ? resolveSpec(p, spec, pathSet) : null;
        if (hit) wanted.add(hit);
      }
    }
    for (const f of inner.files) {
      if (viewPaths.has(f.path)) continue;
      if (inputStems.has(stem(f.path))) continue;
      if (!wanted.has(f.path)) continue;
      merged.push(f);
    }
    inner.notes.unshift(`local-view: tidied ${view.length} of ${input.length} file(s).`);
    return { ...inner, files: merged };
  }

  let files = input;
  const notes: string[] = [];

  // Scaffold-owned files (UI kit, examples pack, content kit, generated
  // integrations) are authored by Kimble and already parse. Heuristic repair
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



  // 0a-4. TanStack Query without a provider crashes every page that queries
  // ("No QueryClient set"). Mount it at the app root deterministically.
  const queryProvider = ensureQueryProvider(files);
  files = queryProvider.files;
  notes.push(...queryProvider.notes);

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

  // 3a-auth. Align auth helper calls with the backend kit the project got.
  //     Must run before the import resolver so nothing stubs a bogus helper.
  const authAlign = alignAuthApi(files);
  files = authAlign.files;
  for (const n of authAlign.notes) notes.push(n);

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
  // 5b. Export-shape — a page default-imported but only named-exported is a
  //     hard Rollup failure; add the missing default export instead.
  const exportShape = fixExportShape(files);
  files = exportShape.files;
  for (const n of exportShape.notes) notes.push(n);

  // 5c. Junk-page pruner — drop placeholder pages named after code concepts
  //     (Hooks, Main, UseAxe) so wiring never routes them into the app.
  const junk = pruneJunkPages(files);
  files = junk.files;
  for (const n of junk.notes) notes.push(n);

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

  // Build-config files are scaffold-owned against the MODEL, not against
  // Kimble's own deterministic resolvers. The bare-import resolver, the kit
  // dependency closure and the tsconfig/alias sync all write here on purpose —
  // restoring their input bytes at the end of this function is what shipped
  // Nordwell without `framer-motion`/`lenis` in package.json and then died with
  // `Rollup failed to resolve import "framer-motion"`. Re-baseline the pristine
  // map to the post-RESOLVE bytes for these paths so dependency installs
  // survive, while cosmetic stages below still cannot touch them.
  for (const path of RESOLVER_MANAGED_PATHS) {
    if (!pristine.has(path)) continue;
    const current = files.find((f) => f.path === path);
    if (current) pristine.set(path, current.content);
  }

  // Snapshot for the edit-turn scope lock: cosmetic stages below may not
  // change files this turn never touched.
  const postResolve = opts?.scopeLock
    ? new Map(files.map((f) => [f.path, f.content]))
    : null;
  // Local edit: the baseline is the INPUT, not post-RESOLVE, so resolver
  // passes cannot rewrite files the edit never touched either.
  const localBase =
    opts?.scopeLock && opts.localOnly ? new Map(input.map((f) => [f.path, f.content])) : null;



  // 6b. CSS escape/theme sanitizer — literal `\n` inside styles.css aborts
  //     the Tailwind v4 build ("@theme blocks must only contain…").
  const cssEsc = fixCssEscapes(files);
  files = cssEsc.files;
  for (const n of cssEsc.notes) notes.push(n);



  // 7. Tailwind token sweep — inject missing semantic tokens into styles.css.
  const tw = sweepTailwindTokens(files);
  files = tw.files;
  for (const n of tw.notes) notes.push(n);

  // 7b. Palette integrity — no earlier pass may leave a self-referential or
  //     flattened colour declaration behind. `--primary: var(--primary)` is
  //     invalid CSS and silently deletes the whole brand palette.
  const palette = repairPaletteIntegrity(files);
  files = palette.files;
  for (const n of palette.notes) notes.push(n);


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

  // 9c. Design finisher — the locked type pair is loaded (not just declared),
  //     headings/body actually use it, depth tokens exist, and the page has
  //     one honest entrance animation. Without this every build renders in
  //     system sans and reads as "plain" no matter what the director picked.
  // Edits never get unrequested design touches (entrance animations,
  // font loading) — that is first-build polish, not the user's change.
  const designFinish = opts?.localOnly ? { files, notes: [] as string[] } : enforceDesignFinish(files);
  files = designFinish.files;
  for (const n of designFinish.notes) notes.push(n);

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

  // Edit-turn scope lock: revert cosmetic-stage edits to untouched files. The
  // defect this kills is a targeted edit ("change the button label") coming
  // back with the whole landing page restyled.
  if (postResolve && opts?.scopeLock) {
    const touched = new Set(opts.scopeLock.touchedPaths);
    let reverted = 0;
    files = files.map((f) => {
      if (touched.has(f.path)) return f;
      const base = postResolve.get(f.path);
      if (base === undefined || base === f.content) return f;
      reverted++;
      return { ...f, content: base };
    });
    if (reverted > 0) {
      notes.push(
        `scope-lock: reverted cosmetic repairs on ${reverted} file${reverted === 1 ? "" : "s"} this edit did not touch.`,
      );
    }
  }

  if (localBase && opts?.scopeLock) {
    const touched = new Set(opts.scopeLock.touchedPaths);
    const managed = new Set<string>(RESOLVER_MANAGED_PATHS);
    let held = 0;
    files = files.map((f) => {
      if (touched.has(f.path) || managed.has(f.path)) return f;
      const base = localBase.get(f.path);
      if (base === undefined || base === f.content) return f; // new file or unchanged
      held++;
      return { ...f, content: base };
    });
    if (held > 0) notes.push(`local-scope: left ${held} untouched file(s) exactly as they were.`);
  }

  // Restore Kimble-owned files byte-for-byte: no heuristic pass may alter them.
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

