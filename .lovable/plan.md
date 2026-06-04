# Succeed-by-Construction, Phase 4–9

Goal: make `vite build` + first paint succeed on every generated app, without ever asking the model to "try to fix" a class of error we can resolve deterministically.

Each phase ships one focused pass under `src/server/` and wires it into both the staged pipeline (`stage-wireup`) and the monolithic path (`api/generate.ts`), in the same place we already mount `repairUnresolvedImports`. Ordering is by ROI × dependency: earlier phases unblock more downstream traffic and have no prerequisites.

---

## Phase 4 — Bare-import resolver  *(highest ROI, no deps)*

**Kills**: `Could not resolve "framer-motion" / "recharts" / "date-fns/format" / "lucide-react"` — the #1 remaining Rollup hard-fail now that local imports are handled.

New file: `src/server/bare-import-resolver.server.ts`
- Walk every `import … from "<bare>"` across generated files.
- Diff against `package.json` deps + a curated registry of known-safe packages with pinned versions (lucide-react, framer-motion, recharts, date-fns, zod, clsx, tailwind-merge, sonner, react-hook-form, @hookform/resolvers, embla-carousel-react, cmdk, vaul, lodash-es, etc.).
- For each unknown bare specifier:
  - If in registry → inject into `package.json` `dependencies` at the pinned version, rewrite the file so `bun install` runs.
  - If a known typo of a registry entry (`lucide` → `lucide-react`, `react-icons/fa` when lucide is available) → rewrite the import.
  - If unmappable → strip the import + its named identifiers + leave a TODO comment.
- For lucide-react specifically: validate the imported icon names against the bundled icon list (it has churn). Unknown name → swap for closest match (`Sparkle` → `Sparkles`, `ArrowRightCircled` → `ArrowRight`).

## Phase 5 — Case + extension normalizer

**Kills**: macOS-passes, Linux-fails imports (`@/components/ui/Button` vs `button.tsx`); `.ts` files containing JSX.

Extends `import-resolver.server.ts`:
- When `resolveSpec` returns null, try case-insensitive match before falling through to remap/stub. If found, rewrite the import to the canonical casing.
- Scan every generated file: if its content has JSX and its extension is `.ts`/`.js`, rename to `.tsx`/`.jsx` and update every importer.

## Phase 6 — Route graph validator  ✅ shipped

**Kills**: `<Link to="/x">` runtime white-screens, duplicate `/` routes, layout components missing `<Outlet />`, bare `react-router` imports.

Shipped in `src/server/route-graph.server.ts`. Generated apps use `react-router-dom` (not TanStack file-based routing — that's Petal's own router), so the validator scans for:
- `<Route path="…">` declarations across all .tsx/.jsx files.
- `<Link to="…">`, `<Navigate to="…">`, and `navigate("…")` call sites.
- Targets with no matching `<Route>` and no `path="*"` fallback → inject a styled 404 wildcard route into the first file containing `<Routes>`.
- Two+ files declaring `<Route path="/">` → drop dupes, keep the App.tsx / router file.
- Layout components (`element={<X/>}` with nested children) that don't render `<Outlet />` → add Outlet + augment the `react-router-dom` import.
- `from "react-router"` → rewrite to `from "react-router-dom"`.

Composed in `src/server/repair-all.server.ts` step 6. Pure ProjectFile[]→ProjectFile[], no I/O.

## Phase 7 — Tailwind token sweep

**Kills**: invisible "blank" components caused by `bg-brand`, `text-accent-foreground`, `border-ring` referenced without the CSS var defined.

New file: `src/server/tailwind-token-sweep.server.ts`
- Parse `src/styles.css` to extract defined CSS custom properties (`--background`, `--primary`, etc.).
- Scan all `.tsx` for utility classes that reference tokens (`bg-X`, `text-X`, `border-X`, `ring-X`, `from-X`, `to-X`, `via-X`).
- Unknown token names → inject sensible defaults into `:root` and `.dark` in `styles.css` using the committed design palette (we already have `designSummary`).
- Detect arbitrary-value classes pointing at non-existent vars (`bg-[hsl(var(--brand))]`) → same treatment.

## Phase 8 — Asset stubber

**Kills**: broken `<img>` placeholders, missing `public/*` assets, missing `@/assets/*` imports.

New file: `src/server/asset-stubber.server.ts`
- Scan all `<img src="…">`, `backgroundImage: url(…)`, and `from "@/assets/…"` imports.
- For local refs (`/foo.jpg`, `@/assets/hero.png`):
  - Check existence. If missing → emit a procedurally-generated SVG placeholder (gradient block sized to context, brand-tinted from the design palette) at the resolved path.
- For external refs (unsplash, imgur):
  - Leave as-is but add `onError` fallback to a tiny inline data-URI gradient so a 403 doesn't render as a broken-image icon.

## Phase 9 — Runtime contract pass

**Kills**: `useContext` without Provider, controlled-component crashes, `window` at module scope, hook-rules violations, missing `DialogTitle`.

New file: `src/server/runtime-contract.server.ts` (AST-based, uses Babel which we already have):
- **Context providers**: build a map of every `createContext` declared in the project. For every `useContext(X)` / `useX()` call, walk upward from `App.tsx` and confirm a `<X.Provider>` wraps the tree. Missing → inject the provider into App.tsx with default value.
- **Module-scope DOM access**: AST-scan top-level statements for `window.`/`document.`/`localStorage.`/`navigator.` reads outside function bodies. Wrap in `typeof window !== "undefined" &&` or move inside a `useEffect`.
- **shadcn contracts**: detect controlled `<Select value=...>` without `onValueChange`; `<Dialog>` without a `DialogTitle` descendant (radix requires it); `<Form>` without a `useForm` resolver. Inject the missing piece with a sane default.
- **Hook rules**: AST-flag any `use…(` inside conditionals/loops/`&&` chains. Hoist to the top of the component.

---

## Cross-cutting work

1. **Single composition point.** All eight passes (shadcn-imports, array-safety, import-resolver, bare-import-resolver, case-normalizer, route-graph, tailwind-tokens, asset-stubber, runtime-contract) get composed into one `runAllRepairs(files)` helper called from both pipelines. Each pass returns `{ files, notes }`. Order matters and is enforced.

2. **Single test fixture set** under `src/server/__tests__/repair-fixtures/`. Every pass gets a golden test: input file with the failure, expected output after repair. New failure-mode reports add a fixture before the fix lands.

3. **Telemetry.** Each pass emits a counter so we can see real-world incidence per phase. After two weeks, dead passes (zero hits) can be pruned; hot passes get tightened.

4. **No model retries for repaired classes.** Once a pass owns a failure class, the corresponding "let the model try again" branch in `stage-scaffold` retry logic is deleted. The model only retries true generation failures (empty content, upstream errors).

---

## Sequencing & exit criteria

| Phase | Ship after | Exit when |
|-------|-----------|-----------|
| 4 | now | zero `Could not resolve "<bare>"` Rollup errors in 24h sample |
| 5 | 4 | zero case/extension errors in Linux builds |
| 6 | 5 | zero TanStack route-not-found console errors at first paint |
| 7 | 6 | zero invisible-blank reports tied to undefined tokens |
| 8 | 7 | zero broken-image reports on first paint |
| 9 | 8 | zero "X is not a function" / "Cannot read … of undefined" reports tied to provider/context |

Each phase is one PR. Each PR ships its pass, its tests, its wireup in both pipelines, and removes any now-dead retry branch it replaces.

---

## Technical notes

- All passes are pure `ProjectFile[] → ProjectFile[]`. No I/O. No model calls. Sub-5ms per file.
- Babel parser is already a dep (used by `stage-scaffold` syntax validation). Phases 6, 7, 9 share one AST per file via a tiny cache keyed on `(path, contentHash)`.
- Curated package registry (Phase 4) lives in `src/server/known-packages.ts` — one source of truth, owned by Petal, version-pinned and reviewed quarterly.
- Stubs (route, asset, import) are clearly marked with a `// Auto-generated by Petal` header so users + future maintainers know they're intentional and replaceable.
- Nothing in this plan touches the planner or scaffold prompts. The architectural bet remains: prompts handle creative intent; deterministic passes handle correctness. Prompts get tightened only when telemetry shows a pass can't recover something cleanly.
