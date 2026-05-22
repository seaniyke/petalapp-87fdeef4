## Goal

Let users pick what they're building (Web app, Android, iOS, Backend/API, Chrome extension) as a chip under the composer — like Google AI Studio. Petal then scaffolds the right stack and shows a preview that *looks* and *behaves* like that target (iOS frame with notch + status bar, Android pill, web browser chrome, JSON response viewer for APIs).

## Research summary — how peers do it

| Tool | Mobile stack | Live preview | Real device | Store path |
|---|---|---|---|---|
| **Bolt.new** | Expo (React Native + Expo Router) | Expo Snack web-player in iframe (react-native-web) | Expo Go via QR | Export → EAS Build → App Store / Play |
| **Rork** | Expo / Expo Router; "Max" tier also SwiftUI | Web preview (react-native-web) | "Rork Companion" app or Expo Go via QR | EAS Build (Android APK), cloud-Mac compile (iOS) |
| **a0.dev** | Expo + React Native | Web preview + QR | a0 mobile app or Expo Go | EAS Build to App Store / Play |
| **Antigravity** | Native Android (Kotlin/Compose) | Gradle build → APK | APK sideload | APK download / Play |

Pattern is consistent across the React-Native crowd: **Expo + Snack web-player in an iframe wrapped in a device frame** is the standard mobile preview. Native (Kotlin/Swift) requires a real toolchain — no live web preview.

## Phased plan

### Milestone 1 — Chip selector + intent routing  (ships first, ~1 day)

- Add `BuildTargetChips` row under the composer on `/` and `/builder`. Options:
  - **Web app** (default — current behavior)
  - **Android app** (Expo / RN)
  - **iOS app** (Expo / RN)
  - **Backend / API** (server-only TanStack routes)
  - **Chrome extension** (MV3)
- Selection persists per-project (`projects.build_target` column) and gets injected into the system prompt as a hard constraint ("This project targets Android via Expo. Use react-native + expo-router, not react-dom").
- For mobile targets, swap the starter template (`src/lib/templates/expo-starter.ts`) so the first build scaffolds an Expo app instead of a TanStack web app.
- For Backend / Extension, swap to the matching scaffold and hide the visual preview pane (show a request inspector / extension popup mock instead).

### Milestone 2 — Device-frame preview wrapper  (~1 day)

- Add `<DevicePreviewFrame target="ios" | "android" | "web">` that wraps the existing preview iframe with:
  - **iOS**: 19.5:9 viewport, rounded corners, Dynamic Island notch, status bar (time / signal / battery), home indicator
  - **Android**: 20:9 viewport, status bar, 3-button or gesture nav bar
  - **Web**: existing chrome
- Set iframe viewport via `preview_ui--set_preview_device_viewport` automatically when the chip is mobile.
- "Open in browser" / "Rotate" / "Show keyboard" controls.

### Milestone 3 — Expo Snack web-player integration  (~2 days)

- Wire `snack-sdk` to mirror project files into a Snack session and load `webPreviewURL` into the device frame iframe (this is exactly the Bolt/Rork pattern, documented in `expo/snack` repo).
- Stream file changes from Petal's writes into the Snack session so hot-reload works.
- Fallback: if Snack is unreachable, render `react-native-web` directly via a Vite plugin (degraded but offline-capable).

### Milestone 4 — Real device + store publish  (~2-3 days)

- "Test on phone" button → generates QR code that opens the preview in **Expo Go** (free, no account).
- "Publish to App Store / Play" wires into **EAS Build** via the user's Expo account (OAuth). Same flow Bolt and Rork use.
- For Android, also offer raw `.apk` download via `eas build --profile preview --platform android`.
- iOS requires the user's Apple Developer account ($99/yr) — surface this clearly before they start.

## What ships today vs later

I'd recommend shipping **Milestone 1 + a stub Milestone 2** in the first PR so the chips are real and previews already look like phones, even before Snack is wired. Milestones 3-4 are separate PRs because each touches infra (Snack session manager, EAS OAuth flow) and needs its own testing pass.

## Open decisions for you

1. **Stack for iOS/Android**: Expo/React Native (one codebase, web preview works) — or Capacitor (wraps the existing web app) — or native (Kotlin/Swift, no live preview)? Bolt/Rork/a0 all chose Expo for a reason; I recommend the same.
2. **Snack hosting**: use hosted `snack.expo.dev` (free, rate-limited) or self-host the web-player (more work, no limits)?
3. **Backend chip preview**: render a Postman-style request inspector, or just open the `/api/...` routes panel we already have?

## Technical details (skip if non-technical)

- New table column: `projects.build_target text check (build_target in ('web','android','ios','backend','extension')) default 'web'`.
- New module: `src/lib/build-targets.ts` — registry of `{ id, label, icon, systemPromptAddendum, starterFiles, previewMode }`.
- New component: `src/components/BuildTargetChips.tsx` (composer row) + `src/components/DevicePreviewFrame.tsx` (preview wrapper).
- Server: `src/server/generate.server.ts` reads `project.build_target` and prepends the matching addendum to `SYSTEM_PROMPT_CREATE` / `SYSTEM_PROMPT_PATCH`.
- Snack: `src/lib/snack-session.ts` wraps `snack-sdk` and reconciles Petal's file writes into Snack files (debounced 250ms).
- Memory: persist "Petal supports multi-target builds; selected target rides every request as `x-petal-target` header and is mirrored into the system prompt".
