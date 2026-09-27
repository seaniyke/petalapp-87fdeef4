# Pause mobile apps, API backends and Chrome extensions for launch

## Goal
For launch, Kimble builds web apps only. Mobile apps, API-only backends and Chrome extensions become three product switches that are **off**. While they are off:
- Customers never see these three features anywhere.
- The builder never builds them.

Nothing gets deleted. Turning a switch on later brings the feature back.

## What changes

**1. Three product switches, all off**
Add three switches next to the existing "paused feature" switch (the one used for the investor page): mobile apps, API backends and Chrome extensions. All three start off. Turning them on is a code change, so nobody can turn them on by accident from the admin screen.

**2. Nothing about them on screen**
While a switch is off, everything for that feature is hidden:
- **Home page and marketing:** the feature pages and their sections, start-idea examples, template and industry-pack entries, the docs, changelog and waitlist wording, and the invite email text.
- **Builder:** the target picker ("Build a mobile app / extension / backend"), the phone preview and the "Test on phone" QR code, the mobile publish screen and mobile app panel, and the mobile and extension sections in project settings.
- **Command menu and navigation:** any entries that point to these features.

The feature pages still exist if someone types the exact address, but they show a "Not available" page, and no link on the site points to them.

**3. The builder only builds web apps**
The builder decides at a single point what kind of app to build. When a switch is off, every request is treated as a web app at that point. This covers a stored old choice from the browser, a request header, or the builder guessing it from the prompt. So a mobile, extension or backend instruction can never reach the builder while its switch is off.

If someone asks for a mobile app, the builder makes a web app that works well on phones. It says so in one line and never offers a feature that is switched off.

**4. Removed from the builder's instructions**
The mobile, extension and API-backend instructions stay in the codebase but are not sent to the builder while their switch is off. That includes the mobile building blocks list, the Expo/Snack live preview, and the store build instructions.

**5. Checks**
- A test sends "build me a Chrome extension", "build an iOS app" and "build a REST API" and confirms each one runs as a web build with no mobile, extension or backend instructions.
- A scan of every customer-facing page confirms no mention of mobile apps, Expo, the App Store or Play Store, or Chrome extensions.
- Run all tests, the type check and the production build, then rebuild the build-server bundle.

## Not changing
- Billing, how the builder works, or its safety checks.
- The database, and existing projects (an old mobile project simply opens as a web project).
- Server code for mobile builds and Expo is kept but can't be reached.
- The word "API" in normal places, such as Cloud or developer settings and connecting services. Only the "build an API backend" option is hidden.

## Technical details
- `src/lib/site-flags.ts`: add `MOBILE_APPS_ENABLED`, `API_BACKENDS_ENABLED`, `CHROME_EXTENSIONS_ENABLED` = false, plus `isTargetEnabled(id)`.
- `src/lib/build-targets.ts`: `BUILD_TARGETS` shown in the UI are filtered by `isTargetEnabled`. `getBuildTarget` maps a disabled id (mobile/ios/android/web-mobile/backend/extension) to `web`.
- `src/lib/target-inference.ts` `resolveBuildTarget`: the final result is passed through `isTargetEnabled` → `web`. This is the only engine entry point (`generate.ts` ~2386). Also guard `generate.ts` ~1522 (the mobile branch) and `project-archetype.ts`.
- UI gating: `BuildTargetChips`, `DevicePreviewFrame` (PhoneFrame/SnackPreview not rendered), `MobilePublishSheet`, `MobileAppPanel`, `MobilePreviewFallback`, `ProjectSettingsSheet`, `builder.tsx`, `CommandPalette`, `start-ideas.ts`, `feature-pages.ts` (mobile/extensions entries filtered), `routes/index.tsx`, `templates.tsx`, `docs.tsx`, `changelog.tsx`, `privacy.tsx`, `invest.tsx`, `waitlist-invite.tsx`, `intent-registry.ts`/`integration-request-intent.ts` (no mobile/extension suggestions).
- Server-only modules (`expo.functions.ts`, `mobile-builds.functions.ts`, `admin-mobile-signing.functions.ts`): each handler returns "not available" while its switch is off.
- New test `src/server/__tests__/disabled-targets.test.ts`, added to the vitest include list. Rebuild the agent-core bundle and bump `AGENT_CORE_VERSION`. Add a rule to `AGENTS.md` and a memory for "web-only at launch".
