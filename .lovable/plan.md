## What I found

Two distinct bugs, both rooted in "two systems doing one job" — same theme as the earlier audit.

### Bug 1 — "Pick an option" card appears on a successful build (image 2)

`src/routes/builder.tsx` has ONE renderer for the `message.suggestions` field (`SuggestionChecklist`, line 3326) but TWO writers feeding it:

- `onResult.extras.suggestions` — true clarifying questions / backend chips Petal wants the user to confirm.
- `onSelfCheck(v).suggestions` (line 1962) — post-build "next move" ideas like "Add appointment booking form".

Both write to the same `m.suggestions`, so the next-move list renders as a radio-style "Pick an option" card *and* the `NextStepsCard` ("READY — WHAT'S NEXT?") renders right below it. Duplicate surface, and it looks like Petal is asking a question when it isn't.

Per project memory: "Petal asks at most ONE question per reply and only when truly ambiguous." Post-build next-step ideas are not questions.

### Bug 2 — Blank preview / repeated build failures (image 1)

Looking at the last 6 builds for project `cbfeb89f` (the hospital landing page):

```
17 modules  → SignInPage.tsx broken JSX  (latest)
 8 modules  → SignInPage.tsx broken JSX
15 modules  → SignInPage.tsx broken JSX
1612 mods   → @/integrations/backend/auth missing
1591 mods   → same
1042 mods   → same
```

The model keeps scaffolding `src/pages/SignInPage.tsx` for a hospital landing page even though the project has NO backend. Each "fix" attempt then tries to "disable" the sign-in form and produces broken JSX (unclosed tags, `<Stack>` inside props, etc.). The autofixer can't recover, build fails, preview goes blank.

Root cause: nothing in the prompt or pipeline tells the model "if no backend, do not create auth pages at all." We added rules about commented-out JSX but not about scaffolding auth pages speculatively.

## Plan

### Fix 1 — Stop duplicate suggestion surface (UI only)

In `src/routes/builder.tsx`:

- Only render `SuggestionChecklist` when the assistant message text actually contains a question mark (real clarifying question). Today the title falls back to "Pick an option" when no `?` is found — that's the exact failure mode in the screenshot.
- When there's no question mark, treat `m.suggestions` as next-step ideas and let `NextStepsCard` own them (it already exists below and is the canonical post-build surface).

This is a 1-file frontend change, no business logic touched.

### Fix 2 — Stop the auth-page build loop (prompt + autofix)

Two coordinated changes:

1. **Prompt rule** in `src/server/generate.server.ts` (BACKEND / AUTH RULES section, ~line 111): add a hard rule — "If `src/integrations/backend/` does NOT exist, do NOT create any sign-in, sign-up, login, register, reset-password, or auth-* page or component. Do NOT add 'Sign in' links to navigation. Auth is a backend-gated feature; without backend, omit it entirely."

2. **Defensive autofix** in `src/server/stream-autofixer.ts`: when no backend is present, drop any newly-emitted files matching `src/pages/(SignIn|SignUp|Login|Register|ResetPassword)Page.tsx` (and similar under `src/components/auth*`) before they ever reach the build. Strip matching nav links/imports. This is the same pattern as the existing `fixBadImports` — it runs after the model and prevents the broken file from being written.

Both changes are server-side only and additive — no existing passing project is affected.

### Out of scope (intentionally)

- Not touching the broader audit work (intent registry, etc.) — those changes already landed and aren't implicated here.
- Not changing the question pipeline / triage — the question wasn't actually asked; the UI just looked like a question.
- Not redesigning `NextStepsCard` or `SuggestionChecklist`.

## Files I'll edit

- `src/routes/builder.tsx` — gate `SuggestionChecklist` on real-question detection.
- `src/server/generate.server.ts` — add no-backend = no-auth-pages rule.
- `src/server/stream-autofixer.ts` — strip auth pages when no backend; remove stale "Sign in" nav links.

After edits I'll re-read each touched file to confirm syntax, and rely on the harness build to confirm typecheck.
