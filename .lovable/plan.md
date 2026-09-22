# Fix the sign-in crash and the missing app icon

## 1. Why Looplane's sign-in failed

The error `signInWithPassword is not a function` is a real mismatch inside Kimble, not a one-off model mistake.

Kimble ships two versions of the backend starter code for generated apps:

- the dedicated version, whose sign-in helper is called `signInWithPassword(email, password)` and returns `{ error }`
- the shared (starter) version, whose helper is called `signIn(email, password)` and throws instead of returning `{ error }`

Every build instruction Kimble gives the AI tells it to use `signInWithPassword`, regardless of which version the app actually gets. Looplane got the shared version, so the page called a function that does not exist there. Nothing catches this: it is valid-looking code, it compiles, and it only breaks the moment a real person presses "Sign in".

Confirmed by reading Looplane's own generated files: its sign-in page calls `auth.signInWithPassword(...)`, and its shared backend file only exports `signIn`, `signUp`, `signOut`, `me`.

## 2. Why the app looks like it has no icon

Looplane does have an in-app logo (the loop mark beside the name). What it does not have is a real browser/tab icon: Kimble injects a fixed pink-to-orange square with the app's initials for every app it builds, ignoring the app's own colours and its own logo shape. So on a phone, on a bookmark, and on the tab, Looplane shows a generic pink tile that looks like no logo at all.

## The fix

### A. One sign-in API, everywhere

Bring the shared starter's auth surface fully in line with the dedicated one, so both expose the same helpers with the same return shape: `signInWithPassword`, `signUpWithPassword`, `signOut`, `resetPasswordForEmail`, `updatePassword`, plus `useAuth()` returning `{ user, loading, ... }`. Errors come back as `{ error }` instead of throwing. The old names stay as aliases so existing generated apps keep working.

### B. A safety net so this class of bug can't ship again

Add a deterministic repair pass that runs before every build is published: any call to an auth helper that does not exist in the version of the backend that app received is rewritten to the correct one, and the fix is recorded on the build. Deterministic, no AI call, no extra cost.

### C. Make the browser icon the app's own logo

Generate the tab icon from the app's actual brand: its own mark shape and its own primary colour, instead of the fixed pink gradient. Also wire the same icon into `apple-touch-icon` and the theme colour so the phone home-screen icon matches.

### D. Repair the live Looplane app

Rebuild Looplane with the fixes applied, then sign in on the deployed site end to end and confirm the dashboard loads — verified in a real browser, not just by the build passing.

## Technical notes

- `src/server/shared-backend-kit.ts` — align the exported `auth` object and `AuthProvider` with `src/server/backend-kit.ts`; keep `signIn`/`signUp` as aliases.
- New pass (e.g. `src/server/auth-api-align.server.ts`) registered in the existing pre-emit repair chain, with unit tests covering both kit variants.
- `src/server/brand-identity.server.ts` — `faviconDataUri()` takes the resolved design primary colour and the generated mark's glyph rather than the hardcoded `#ff6ea8 → #ffb86c` gradient.
- Tests added under `src/server/__tests__/`; full suite must stay green.

## Not in scope

No change to the credit engine, deployment path, AI provider setup, or the shared/dedicated backend split itself.
