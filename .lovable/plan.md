## Root cause

Yes — the recent preview guards are band-aids. They only try to reveal a blank preview after Petal has already produced a bad build.

The deeper issue is that the generation pipeline has drifted into conflicting instructions and incomplete composition:

1. **Two routing systems are mixed**
   - The main prompt tells the builder to use a simple Vite app with `src/App.tsx` and `react-router-dom` through Petal’s UI router.
   - The newer app-composer stubs generate TanStack route files under `src/routes/*`.
   - Those files are not connected to the generated Vite entrypoint, so Petal can “build files” that never render.

2. **The blueprint stubber can create placeholder pages after generation**
   - If the model forgets a route, the server adds a stub page like “Replace this stub…” after the build.
   - That is not a real app. It can make the build appear complete while the meaningful screen is missing or unreachable.

3. **Target classification is still only a prompt hint, not an enforced architecture**
   - `web`, `mobile`, `extension`, `backend`, and `web-mobile` exist as labels/addenda, but the downstream generators and blueprint composer are still web/Vite-biased.
   - Chrome extension and mobile prompts can still fall back into ordinary web-app behavior unless the generated file set is validated by target.

4. **Verification checks syntax/imports, not whether the app actually has a visible first screen**
   - A project can pass local/esbuild checks while rendering nothing useful, rendering only an empty router, or leaving the main requested product outside the mounted app.

## Plan

### 1. Make one canonical runtime per target

For the current generated-project scaffold, keep the default **web runtime** as:

```text
index.html
src/main.tsx
src/App.tsx
src/pages/* optional
src/components/* optional
@/components/ui/router for multi-page routing
```

Then update the app-composer so it no longer creates TanStack `src/routes/*` stubs for generated Vite apps. Instead it will generate route/page guidance compatible with `src/App.tsx` and `src/pages/*`.

This removes the “files exist but nothing renders” failure mode.

### 2. Stop shipping placeholder route stubs as completed builds

Replace `scaffoldRouteStubs()` behavior with either:

- no automatic stubs, or
- real minimal page modules only when they are also wired into `App.tsx` routing.

If Petal cannot produce the real app shell, the request should fail/retry internally instead of returning a placeholder app to the user.

### 3. Add target-specific file-shape validation before final result

Add a deterministic validator after generation and autofix:

- **Marketing web / landing page** must have a visible hero on the mounted route, no dashboard/sidebar/auth shell unless explicitly requested.
- **Web app/dashboard** must have a mounted app shell, dashboard/workspace content, realistic data UI.
- **Mobile app** must emit the expected mobile/Expo shape and not raw web-only app output.
- **Chrome extension** must include `manifest.json`, popup entry, and extension-specific files; if not, retry instead of showing a web app.
- **Backend/API** must emit API/server-route structure and a minimal endpoint index, not a marketing UI.
- **Web + mobile** must include both web and mobile client structures, not just one side.

The validator should block “successful” builds that do not match the selected/inferred target.

### 4. Reconcile blueprint and subtype routing

Wire the web subtype (`marketing`, `app`, `fullstack`) into the composer/template layer, not just the system prompt:

- Marketing prompts choose marketing/site templates only.
- App prompts choose dashboard/tool templates only.
- Fullstack prompts choose platform templates with customer/admin surfaces.

Also remove auth routes from marketing templates unless the user explicitly requests auth/backend.

### 5. Add mounted-home validation

Before returning files to the UI, inspect the final file map to confirm:

- `index.html` has `#root` and loads `src/main.tsx`.
- `src/main.tsx` imports and renders `App`.
- `src/App.tsx` returns visible JSX.
- If `App.tsx` uses routes, `/` has a visible route element.
- Imported home/page components exist and are not placeholder/null.

If this fails, run a targeted internal retry to regenerate the app shell, not a preview overlay.

### 6. Keep preview guards, but demote them to last-resort diagnostics

Leave the crash/blank preview guard in place only as a safety net. It should not be the main solution, and it should not mask bad generation as success.

### 7. Verification

After implementing, verify with representative prompts:

```text
Build a landing page
Build a banking app
Build a Chrome extension that summarizes any page
Build a backend API for invoices
Build web and mobile app for food delivery
```

Expected outcome: each prompt produces the correct project category and a visible first screen, with invalid file shapes rejected before the user sees a blank or toy app.