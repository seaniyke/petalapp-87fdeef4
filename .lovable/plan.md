# Plan Mode v1

A user-toggled "Plan first" switch in the composer. When on, Petal proposes a scoped change plan, you approve it, then patches run — capped to the approved files. When off, behavior is unchanged.

## Why
Today the model can decide on its own to touch any file. Plan Mode caps blast radius by getting the file list approved up front and rejecting any patch that strays outside it.

## User-visible flow
1. Composer shows a small "Plan first" toggle next to Send.
2. User submits with toggle on.
3. Stream emits a `plan_proposed` event with: short summary, list of files (path + intent: edit/create/delete + 1-line reason), risk tag (low/medium/high).
4. Composer renders a Plan card with **Approve**, **Edit scope** (uncheck files), and **Cancel**.
5. On Approve → second request runs the real generation, scope-capped.
6. On Cancel → nothing applied, no charge for the patch phase.

## Server pipeline
```text
POST /api/generate { planFirst: true, ... }
  └─ planning call (gemini-2.5-flash, JSON mode, ~1s)
       → { summary, files[], risk }
  └─ SSE: plan_proposed
  └─ stream ends (plan stored in KV with TTL 5min, returns planId)

POST /api/generate/approve { planId, allowedPaths[] }
  └─ load plan from KV, intersect with user-approved paths
  └─ run normal generate pipeline
  └─ in applyOps: reject any op whose path is not in allowedPaths
       (same mechanism as DEFAULT_PROTECTED_PATHS)
  └─ stream patch_preview + ops as today
```

## Files to touch
- `src/server/plan-mode.ts` (new) — planning prompt, JSON schema, KV helpers.
- `src/server/generate.server.ts` — add `allowedPaths?: string[]` to applyOps gating; new StreamEvent variants `plan_proposed` and `plan_approved`.
- `src/routes/api/generate.ts` — branch on `planFirst`; emit plan + return early.
- `src/routes/api/generate.approve.ts` (new) — approval endpoint that resumes generation with scope cap.
- `src/components/Composer.tsx` (or wherever the send button lives) — toggle + plan card.
- `src/routes/builder.tsx` — wire `plan_proposed` SSE event into UI state.

## Storage for plans across requests
Workers are stateless. Use the existing Supabase project: a `petal_plans` table `(id uuid pk, project_id uuid, user_id uuid, payload jsonb, created_at timestamptz default now())`. Cleanup via a `created_at < now() - interval '15 min'` cron or just on-read TTL check. RLS: user can only read their own.

## Scope cap enforcement
In `applyOps`, add an optional `allowedPaths: Set<string>` arg. If set, any op whose path isn't in the set is dropped and logged via the existing `patch_preview` rejection path. This reuses the same machinery that already blocks `DEFAULT_PROTECTED_PATHS` and user `protectedGlobs`, so the safety floor is consistent.

## What's explicitly NOT in v1
- No mid-stream approval (would require Worker-side stream pausing — not worth the complexity).
- No plan editing in natural language ("change the plan to also touch X"); user just unchecks files.
- No automatic plan mode — opt-in toggle only, default off, so existing flow is untouched.
- No charge for cancelled plans beyond the ~1s flash call.

## Risk
- Pipeline regression in `applyOps` if the new optional arg is mishandled. Mitigation: arg defaults to undefined → identical to today's behavior. Existing fuzzy-replace, destructive-shrink guards, and protected-path filter all keep working.
- KV/DB latency on plan resume. Mitigation: 5-min TTL + single indexed lookup; sub-50ms on Supabase.
- Users may find it annoying. Mitigation: opt-in only.

## Acceptance
- Toggle off → byte-identical behavior to today.
- Toggle on → plan card appears, approve runs scoped patches, cancel runs nothing.
- Patch trying to touch a file not in approved list is dropped and surfaced in `patch_preview` as rejected.
