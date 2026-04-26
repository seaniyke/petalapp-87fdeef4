## Scope

Fix only the issues I confirmed by reading the code — no speculative refactors. Petal's own auth (`src/lib/auth.tsx`) stays untouched. `tsc --noEmit` already passes; this hardens runtime behavior of the **generated-app scaffolding**.

## Issues being fixed

### 1. `verifyOtp` token type mismatch (highest impact)
`backend-kit.ts` hard-codes `type: "email"`, but the onboarding flow calls `signUpWithPassword` first — that produces a `"signup"` token. Two flows use OTP verification (signup vs. passwordless sign-in) and they need different `type` values.

**Change:** Make the helper accept the type explicitly, default to `"email"` (back-compat), and split into two clearly-named helpers in the docs:

```ts
// backend-kit.ts AUTH_TSX
verifyOtp: (email: string, token: string, type?: "email" | "signup" | "magiclink" | "recovery")
  => Promise<{ error: Error | null }>;
verifySignupOtp: (email: string, token: string) => Promise<{ error: Error | null }>; // sugar = verifyOtp(..., "signup")
```

Update `ONBOARDING_FLOW` to call `verifySignupOtp(email, code)`.

### 2. `/reset-password` redirect has no router in the scaffold
The recovery email redirects to `${origin}/reset-password`, but the scaffold ships a single-page `App.tsx` with no router. Without guidance, the AI may build a broken landing flow.

**Change:** Add a "Minimum router for reset-password" snippet to `BACKEND.md` showing both the `pathname`-check pattern and the hash-based alternative. Update `SYSTEM_PROMPT_INITIAL` and `SYSTEM_PROMPT_PATCH` so the rule reads: *"If you call `resetPasswordForEmail`, mount a `/reset-password` view in App.tsx — gate it on `window.location.pathname === '/reset-password'` (no router needed). Copy from `auth-reset-password.tsx`."*

### 3. `ONBOARDING_FLOW` imports `toast` from `"sonner"` directly
Contradicts our own kit rule (system prompt line 79) which says use `@/components/ui/toast`.

**Change:** swap `import { toast } from "sonner"` → `import { toast } from "@/components/ui/toast"`.

## Bonus (minor doc nit)
Update the inline comment in `ONBOARDING_FLOW`'s `case "forgot"` to clarify that the example forgot-password screen does a full-page nav, so in a non-routed app this naturally returns to `welcome` on reload.

## Files touched
- `src/server/backend-kit.ts` — `AuthCtx` type + `verifyOtp` impl + new `verifySignupOtp` helper + `BACKEND_MD` (router snippet + helper table row).
- `src/server/examples-pack.ts` — `ONBOARDING_FLOW` (toast import + `verifySignupOtp` call + comment).
- `src/server/generate.server.ts` — both system prompts (mention `verifySignupOtp` and the no-router `/reset-password` pattern).

## Out of scope (deliberate)
- Petal's internal `src/lib/auth.tsx` — untouched.
- Adding a real router to the scaffold — that's a separate, larger decision.
- Renaming/removing the existing `verifyOtp` — kept for backward compat.

## Verification
- `npx tsc --noEmit` (must still pass).
- Spot-read the rendered `AUTH_TSX` and `ONBOARDING_FLOW` strings to confirm no template-literal escaping regressed.
- Re-confirm `EXAMPLES_PACK` still registers every example file by name.

No DB migration, no new dependency, no edge function.