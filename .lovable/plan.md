# Truthful failure for the "shoe website" build (no gate weakened)

## 1. Exact cause of the three 404s
Evidence (turn 7fa56bd3, `ai_call_log` + `turn_events`):
- 21:03:59 first write: OpenRouter 504 "Upstream idle timeout" → that upstream is marked failed for the turn.
- 21:06 backup-model write and 21:06:44 page write stall/fail on the remaining approved upstreams → each is marked failed.
- 21:08:16 three page calls return **404 in 19–79 ms**. That's too fast to be a real upstream attempt. OpenRouter refused them on the spot.

Root cause is in `src/server/engine/provider-policy.ts` → `codegenProviderRouting(avoid)`:
- Code writing may only use OpenInference, Azure and DeepInfra (enforced with `only`).
- Once all three are in the turn's failed list, `order` and `only` both come back **empty**, and the call is still sent.
- OpenRouter answers `only: []` with an immediate 404 ("no endpoints match your routing").
- `aiChatCompletions` (`src/server/ai-provider.server.ts`) then treats that 404 as a normal error. The bounded fallback-model retry sends it again with the same empty list, and that 404s too. That's why there are three near-instant 404s.

So nothing is wrong with the endpoint or the configuration. Kimble sent calls when it had no approved provider left to send them to.

## 2. Files and functions responsible
- `src/server/engine/provider-policy.ts` — `codegenProviderRouting` returns an empty allow-list instead of saying "exhausted".
- `src/server/ai-provider.server.ts` — `aiChatCompletions` dispatches anyway, and `shouldRetry` retries on 404.
- `src/server/engine/write.ts` — `writePlannedPages` swallows the failures (`catch { return [] }`), so the turn ends only as `requested_scope_missing` and loses the real reason.
- `src/routes/api/generate.ts` — emits `step_status done` for all 6 plan steps (seq 19–24) after **only `styles.css`** was written, and leaves `phase: polishing` as the last phase.
- `src/lib/activity-language.ts` — `humanizeActivity` throws away the server's honest message and count.
- `src/routes/builder.tsx` / `BuildDetailsSheet` / `BuildActivityCard` — the last phase stays active after `done: failed`, and the duration is measured from the resumed start ("Worked for 0s").

## 3. How the false timeline is produced
The server's own events were honest (seq 35–39):
- "Verified 1 changed file", "Parsed 1 file cleanly", "Render-risk check clean on 1 file", "RLS sanity check clean on 1 file".

`humanizeActivity` maps them by step name only and ignores the count and scope:
- `local_verifier` ok → "Ran your app end to end — all good" (it only checked one file; nothing was run).
- `esbuild_parse` ok → "Checked every file is written correctly".
- `render_risk` ok → "Checked no page crashes when it opens".
- `rls_sanity` ok → "Checked your saved data stays private".

On top of that, phase `polishing` ("Checking my work") is never closed by the terminal `turn_outcome` / `done` events, so its spinner keeps going forever.

## 4. Minimal fix
1. **Provider exhaustion is terminal, not a 404.** When no approved upstream is left, `codegenProviderRouting` reports it as exhausted. `aiChatCompletions` then returns a typed `providers_exhausted` failure **without sending anything**, and there's no fallback retry for it. Banned providers are not reopened, and no new retry is added.
2. **Keep the real reason.** `writePlannedPages` passes the exhaustion up. The turn still fails through the completeness gate exactly as today (no build, no deploy, no publish, no charge), with `reason: requested_scope_missing` and `cause: providers_exhausted`. The chat message says plainly: "The AI service couldn't write Home or the site layout. Nothing was built or charged. Send it again to finish only what's missing."
3. **Plan steps only tick when their files exist.** `step_status done` is emitted per step once that step's files are really written. Steps that were never written end as "not done".
4. **Honest check wording.** `humanizeActivity` uses the count and the paths:
   - "Checked 1 file for errors (styles.css)"
   - "Checked 1 file for crash risks"
   - "Checked 1 file for data privacy"
   - `local_verifier` says "Checked 1 changed file" and **never** "ran end to end". Only the real browser check after a build may say the app was run.
   - Missing pages get their own line: "Not written: Home, site layout".
5. **Terminal state ends the phase.** `turn_outcome: failed`, `done` (any status), a provider failure, a timeout or Stop immediately closes the active phase in the activity card, details sheet and composer. The spinner stops and the row shows "Stopped — Home and site layout weren't written". The duration uses the turn's real `started_at`/`ended_at`.
6. **Tests:**
   - Exhausted routing sends nothing, makes no retry and gives a typed failure.
   - Steps only tick when their files exist.
   - The check wording is never "all good" or "every file" when only 1 file was checked.
   - A failed `done` clears the "Checking my work" spinner.
   - The completeness gate still blocks the build.

Not changed: the completeness gate, the one-repair limit, billing and refunds, the Stop authority, the provider allow-list and bans. No stand-in page and no new AI call.

## 5. How this fits the durable Railway builder
- Everything above lives in the shared generation core and the turn events. The same code runs when generation moves onto the builder, so there's nothing to redo.
- The UI fix reads only the recorded events (`turn_outcome`, `done`). Live stream, refresh-replay and builder-run turns therefore all end the same way.
- Today the builder only keeps the `/api/generate` connection alive, and the work itself still runs on Cloudflare. The next step is the approved one: the generation core runs **on** the builder (`/agent/generate`), and Cloudflare keeps only auth, the credit floor, dispatch, cancel and event replay. I'll do that as its own change after this one, with no live build until you ask.
