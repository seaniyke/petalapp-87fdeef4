## Status of the previous audit plan

All 8 P0s from `.lovable/plan.md` are shipped:

- P0-A server-side `project_files` persistence — `src/routes/api/generate.ts`, `src/server/generate.server.ts`
- P0-B runtime error bridge for CDN/Railway — `src/server/preview-guard.server.ts`, `src/routes/api/public/track-runtime-error.ts`, `petal_runtime_errors` table
- P0-C builder watchdog + auto-retry — `src/routes/api/builds/watchdog.ts`, `use-build-activity.ts`, `project_builds.retry_count`
- P0-D multi-cycle autofix default-on — `src/routes/api/generate.ts`
- P0-E WebContainer → CDN fallback — `WebContainerPreview.tsx`, `builder.tsx`
- P0-F continuation tier model escalation + tail anchor — `src/server/stream-continuation.server.ts`
- P0-G Snack SDK 52 + asset placeholder — `src/components/SnackPreview.tsx`
- P0-H installDeps concurrency gate — `src/lib/webcontainer.ts`

Audit doc: `/mnt/documents/petal-audit.md`. P1/P2 backlog noted but not seeded as tracker tasks. Nothing from Phase 2 is outstanding.

## What's missing for true full-stack parity

The audit's P1/P2 list is where competitors pull ahead on *full-stack* output. Petal today generates good frontend + Cloud-wired Supabase, but generated apps frequently miss: server functions written end-to-end (route + handler + types + client call), schema-aware queries, auth-gated routes wired into the layout tree, file uploads, background jobs/webhooks, payments, email — and the verifier never typechecks against the live DB schema. This plan turns those gaps into shippable work.

## Goal

Make a single Petal turn produce a complete vertical slice — DB migration + RLS + server function + typed client call + UI + auth gating + tests of the happy path — and verify it before saving.

## Phase 1 — Full-stack scaffolding the generator can rely on

1. **Vertical-slice generator template** (`src/server/scaffold-kit-blocks*.ts`): add a `fullstack_feature` block that emits, in one shot, the four-file pattern competitors hard-bake: `migrations/*.sql` (table+GRANT+RLS), `lib/<feature>.functions.ts` (`createServerFn` + Zod), `lib/<feature>.server.ts` (admin queries), and `routes/<feature>.tsx` (loader + component). Wire it into `dynamic-prompts.server.ts` so the model is steered to this shape when intent is "build feature X".
2. **Schema-aware prompt injection**: read `src/integrations/supabase/types.ts` (already auto-generated) and inject the relevant table types into the prompt's "available data" section so generated server fns reference real columns, not hallucinated ones. Cap by token budget; pick tables by name match against the user prompt.
3. **Auth-gated layout pattern**: standardize `src/routes/_authenticated.tsx` usage. Generator must place protected feature routes under `_authenticated/` and never call `requireSupabaseAuth` fns from public loaders (the known SSR 401 trap). Add a verifier rule for this.

## Phase 2 — Verifier upgrades (catch full-stack breakage before save)

4. **Real `tsc --noEmit` tier** on changed files only, worker-pooled. Today esbuild parses but doesn't typecheck — so server fns calling `supabase.from('wrong_table')` ship green. Promote from P2 to P1.
5. **Server-fn contract verifier**: AST-walk every `createServerFn` change to enforce: `.inputValidator` before `.handler`, Zod schema present on POST, no `process.env.*` read at module scope, no `client.server.ts` import from non-server file. Issues feed the existing autofix loop.
6. **RLS sanity check**: for every `CREATE TABLE public.*` in a new migration, require matching `GRANT` + `ENABLE ROW LEVEL SECURITY` + at least one `CREATE POLICY`. Reject the migration in the same pass that catches truncation.
7. **Auth-middleware call-site check**: any serverFn with `requireSupabaseAuth` must not be invoked from a loader on a non-`_authenticated/` route. Static check on the route tree.

## Phase 3 — Capability blocks (parity with Lovable/Bolt/v0)

8. **File upload block**: storage bucket migration + signed-URL server fn + client uploader component, behind a single intent ("let users upload …").
9. **Webhook block**: `routes/api/public/<name>.ts` with HMAC verification template + `supabaseAdmin` write, gated by a generated secret request via `add_secret`.
10. **Cron/background job block**: pg_cron + `routes/api/public/cron/<name>.ts` pattern already used internally — expose to user-app generation.
11. **Payments + email**: lean on existing Paystack/Stripe/Resend integration definitions in `src/server/integrations/registry.server.ts`; add intent → install → scaffold flow so "add Stripe checkout" produces working server route + client button in one turn.

## Phase 4 — Streaming + diff UX (competitor parity)

12. **Per-file streaming preview**: as each file finishes parsing, push it into WebContainer for HMR instead of waiting for the full turn. Cuts time-to-first-pixel by ~40% per Bolt's blog.
13. **Interactive file diff before commit**: surface the diff drawer (data already in `turn.events`) with accept/reject per file. Today it's all-or-nothing via partial revert.

## Out of scope this loop

Visual edits / click-to-source (separate Vite plugin workstream), full RN scaffold replacement, WebContainer → Fly.io migration. Same boundaries as the previous plan.

## Order of work after approval

1. Seed Phase 1–4 items as tracker tasks.
2. Ship Phase 1 (#1–#3) first — biggest leverage; everything else gets better once the generator emits real vertical slices.
3. Ship Phase 2 verifier upgrades (#4–#7) so the new templates self-heal.
4. Ship Phase 3 capability blocks (#8–#11) one block per turn, each behind an intent flag.
5. Ship Phase 4 (#12–#13) last — pure UX polish on top of a now-reliable generator.
6. Stop after each phase for review.

## Verification per phase

- Phase 1: prompt "build a todo app with auth" → generated turn contains migration + serverFn + protected route + UI, runs green in preview without manual edits.
- Phase 2: intentionally inject `supabase.from('bogus')` mid-stream → tsc tier flags it, autofix corrects, final file is clean.
- Phase 3: each block has a smoke test prompt that produces a working end-to-end flow.
- Phase 4: measure time-to-first-render on a 6-file generation; diff drawer accept/reject persists correctly via `replace_project_files` RPC.
