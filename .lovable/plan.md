# Goal

Expand the auth toolbox shipped to **generated apps** so users who want OTP, resend, or forgot-password can build it without writing raw `supabase.auth` calls — **without** removing or changing the existing password-based flow.

Petal's own auth (`src/lib/auth.tsx`) is **not** touched. This is purely a scaffold-kit upgrade.

# What changes

## 1. `src/server/backend-kit.ts` — extend `AuthCtx` (additive only)

Add five new helpers next to the existing `signInWithPassword` / `signUpWithPassword` / `signOut`:

```ts
signInWithOtp:        (email: string) => Promise<{ error: Error | null }>;
verifyOtp:            (email: string, token: string) => Promise<{ error: Error | null }>;
resendSignupOtp:      (email: string) => Promise<{ error: Error | null }>;
resetPasswordForEmail:(email: string) => Promise<{ error: Error | null }>;
updatePassword:       (newPassword: string) => Promise<{ error: Error | null }>;
```

Implementations wrap the corresponding `supabase.auth.*` calls (`signInWithOtp`, `verifyOtp` with `type: "email"`, `resend` with `type: "signup"`, `resetPasswordForEmail` with `redirectTo: <origin>/reset-password`, `updateUser({ password })`). Same `{ error }` return shape as the existing helpers for consistency.

Nothing existing is renamed or removed. Apps already using `signInWithPassword` keep working.

## 2. `src/server/examples-pack.ts` — wire the TODO stubs + add reset-password screen

- **`onboarding-flow.tsx`** (lines 1640–1709): replace the three `// TODO: call your real …` stubs with `useAuth()` calls — `signUpWithPassword` for signup, `verifyOtp` for the OTP step, `resendSignupOtp` for resend. Keep the state machine identical.
- **`auth-forgot-password.tsx`** (around line 177): replace the `setTimeout` placeholder with `resetPasswordForEmail`.
- **New file**: `auth-reset-password.tsx` — the page users land on from the recovery email. Reads the recovery session, shows a "new password" form, calls `updatePassword`, then redirects. This is the missing half of the forgot-password loop and the knowledge guide flags it as mandatory.
- Add the new file to `EXAMPLES_PACK` and reference it from `EXAMPLES.md`.

## 3. `src/server/backend-kit.ts` — update `BACKEND_MD`

Add an "Auth helpers reference" section listing every helper available on `useAuth()`, when to use OTP vs password, and the requirement to mount `<AuthReset Password />` at `/reset-password` if `resetPasswordForEmail` is used. This is what the generation AI reads — it's the lever that gets these helpers actually used.

## 4. `src/server/generate.server.ts` — tighten the system prompt

One paragraph addition: when the project has a backend and the user asks for auth, the AI must use `useAuth()` helpers from `@/integrations/backend/auth` and must never call `supabase.auth.*` directly. Mirrors the existing "no `createClient`" rule.

# What does NOT change

- `signInWithPassword` / `signUpWithPassword` stay as the defaults — no migration for existing generated apps.
- Petal's own `src/lib/auth.tsx` is untouched.
- No DB migration. No edge functions. No Supabase config changes.
- Email templates are not scaffolded here — that's a separate flow the user can opt into later (via Cloud → Emails).

# Files touched

- **Edit**: `src/server/backend-kit.ts` (extend `AuthCtx`, expand `BACKEND_MD`)
- **Edit**: `src/server/examples-pack.ts` (wire onboarding TODOs, wire forgot-password, add reset-password example, register in `EXAMPLES_PACK`)
- **Edit**: `src/server/generate.server.ts` (one prompt paragraph)

# Verification

1. `bunx tsc --noEmit` passes.
2. Spot-check the rendered `BACKEND.md` content includes all five new helpers.
3. Spot-check that `onboarding-flow.tsx` example string compiles as TSX (no stray template-literal escapes).
4. Existing generated apps that only use `signInWithPassword` still type-check against the new `AuthCtx` shape (additive properties only).