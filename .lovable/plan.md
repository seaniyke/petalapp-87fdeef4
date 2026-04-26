# Why the build failed

The build for project `4979dd90…` failed with:

```
Rollup failed to resolve import "@/components/ui/button" from "src/App.tsx"
```

I traced it end-to-end against the database and the generation pipeline:

1. **`src/routes/api/builds/trigger.ts`** loads the project's files straight from the `project_files` table and POSTs them to the Railway builder unchanged.
2. The failing project has **only 7 rows** in `project_files`: `index.html`, `package.json`, `src/App.tsx`, `src/main.tsx`, `src/styles.css`, `tsconfig.json`, `vite.config.ts`.
3. None of the canonical scaffold files are present (`src/components/ui/button.tsx`, `src/lib/utils.ts`, the 30+ shadcn-style components, the `examples/*` references, `theme-provider`, etc.).
4. Worse, the stored `tsconfig.json` is **not** the scaffold's TSCONFIG — it's missing the `"paths": { "@/*": ["src/*"] }` alias entirely. Without that alias, every `@/...` import is an unresolved module to Rollup.

So even if the AI knew to use `@/components/ui/button`, Vite/Rollup had no way to resolve it because:
- the file isn't on disk in the build sandbox, and
- `tsconfig.json` doesn't define the `@/*` alias.

`applyScaffoldKit` in `src/server/scaffold-kit.ts` is the function that injects all of these (with `overwrite: true` for protected files), but today it's only called inside the `write_project` branch of `src/routes/api/generate.ts`. For this project either the initial generation took a path that bypassed it, or it ran very early before the kit included these protections. Either way, the database is the source of truth for builds, so once the scaffold is missing from a project, **every future build will fail** for that project — there's no recovery.

# The fix: re-apply the scaffold at build time

The cleanest, lowest-risk fix is to re-merge the scaffold kit into the file list **inside the build trigger**, just before we POST to Railway. This makes the build pipeline self-healing for any project — old or new — that's missing scaffold files for any reason (race condition, older code path, partial save, manual edit). It does not change what's stored in `project_files` (so the user's chat/preview history is untouched), it only ensures the build sandbox always sees the canonical scaffold.

Specifically, in **`src/routes/api/builds/trigger.ts`**, after loading `files` from the database and before calling `postBuildToRailway`, I will:

1. Look up whether the project has an attached backend (so we know whether to also inject the backend kit, matching what `/api/generate` does).
2. Run `applyScaffoldKit(files, { backend })` to merge the canonical scaffold on top — `overwrite: true` files (button.tsx, the rest of `src/components/ui/*`, `src/lib/utils.ts`, `vite.config.ts`, `tsconfig.json` with the `@/*` alias, `package.json` with the right deps) replace anything stale, and missing files get added.
3. Send the merged list to the builder.

# Defense-in-depth secondary checks

While I'm in there, two small hardening tweaks:

- **Backend metadata lookup**: I'll mirror how `/api/generate` decides whether the project has a backend (reading `projects.backend_url` / `backend_anon_key` or whatever fields the existing flow uses — I'll confirm in the code before writing). If the project has a backend, the backend kit gets injected too so the build doesn't break on missing `@/integrations/backend/*`.
- **No behavior change for healthy projects**: For projects whose stored files already match the scaffold, `applyScaffoldKit` is a no-op (the same content gets re-set in the map). This is purely additive.

# What I will NOT change

- I won't backfill `project_files` rows in the database. Builds will work without it; rewriting user data carries more risk than it solves.
- I won't change `/api/generate` — the scaffold is already supposed to be applied there. If we later want to be fully consistent we can add a small migration to re-apply scaffold to existing projects, but it's not needed to fix this build.
- I won't touch the builder service (`builder/src/*`) — the contract stays "we receive a complete file list, we materialize and build it".

# Files I plan to edit

- `src/routes/api/builds/trigger.ts` — add the scaffold re-application step (1 import + ~5 lines of logic), with a small helper to read the project's backend config if applicable.

# How I'll verify

- Re-read the trigger to confirm the merged file list still has `index.html`, that `tsconfig.json` now contains the `@/*` paths alias, and that `src/components/ui/button.tsx` is present.
- Check the build activity card in the preview after the user clicks "Try again" — the same project that just failed should now build successfully.
- Confirm no regression for healthy projects: since the merge prefers scaffold content for `overwrite: true` paths and AI content for everything else, projects already containing the scaffold get the same files back.

# KeshPay caution

Per saved preferences, KeshPay is treated as live production — but this is the Petal codebase, not KeshPay, so the standard caution applies: small focused change, no schema migration, easily reverted.