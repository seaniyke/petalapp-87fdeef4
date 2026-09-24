# Move page writing onto the Railway build server

## Goal
The Railway build server runs the whole generation loop (AI calls, writing files, checks, repair). Kimble's web app only handles sign-in, credit checks, the handoff, Stop, progress, and saving data. Railway never holds the database admin key. It asks the web app to save things through short, signed requests.

## Size, stated honestly
- Page writing is one 7,300-line file. It reaches about 140 helper files that read or write the database.
- A single cut-over would be weeks of risk to a system that only just started passing end to end. So the work is split into phases. Each phase ships behind the existing on/off setting, and the current path keeps working until the last phase is proven.

## Phases

**Phase 1: data gateway in the web app (no change for users)**
- Add one signed endpoint: `POST /api/public/agent/ops`. It checks an HMAC signature using the existing builder shared secret, a turn ID, and a short expiry. It accepts only the operations on a fixed list. Each operation is checked against that turn's owner and project, so a leaked request can never touch another user's data.
- The operation list covers what generation actually needs: read project files, memory and blueprint; save files (`replace_project_files`); append turn events; mark the turn committed or aborted; check whether Stop was pressed; reserve, charge and refund credits (existing idempotent functions, keyed by turn); log AI calls; save pictures; trigger the build.
- Tests: bad signature, expired request, another user's project, operations not on the list, and a replayed charge (billed only once).

**Phase 2: split generation into core and adapters**
- Pull the generation loop out of `src/routes/api/generate.ts` into a core that has no hosting-specific parts. Every database or Worker touch goes through one `AgentIO` interface.
- The web app provides a direct `AgentIO`, so today's behaviour stays exactly the same. All 886 existing tests must still pass unchanged. This is the riskiest phase and gets done in small steps.

**Phase 3: run the core on Railway**
- The build server bundles the same core (shared source, bundled with esbuild into `builder/`) with a `AgentIO` that calls the Phase 1 endpoint.
- It calls OpenRouter itself. You add `OPENROUTER_API_KEY` to Railway once (I'll walk you through it). The model and routing are unchanged.
- `/agent/generate` runs the core directly instead of holding open a connection to the web app. `/agent/cancel` aborts it straight away.

**Phase 4: switch over and prove it**
- New setting `AGENT_RUNTIME=railway`. Leaving it off keeps today's path.
- Checks: one small live build; refresh partway through; Stop partway through; a build failure. All four must show the same results, credits and progress as today's path.
- Only after that: remove the old in-Worker path.

## What does not change
Completeness gate, one-repair limit, billing idempotency, truthful progress, OpenRouter as the only gateway, the model, and the edit rules.

## Known gaps after the move
- If Railway crashes mid-build, the turn is marked failed and refunded by the existing stale-turn clean-up. It is not picked back up automatically.
- The database admin key never leaves Kimble Cloud. That is why every save goes through the web app.

## Proposed order this session
Phase 1 in full, with its tests. Then Phase 2 begins. I'll stop and report before Phase 3, because it needs the Railway key and a redeploy from you.
