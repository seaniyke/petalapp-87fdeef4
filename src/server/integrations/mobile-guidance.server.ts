/**
 * Layer K — Mobile generation guidance.
 *
 * Kimble already ships a mobile pipeline (Capacitor + Codemagic) that wraps
 * the React web app into a signed iOS / Android binary. What was missing
 * was the *generation-time* knowledge: when the user wants a real mobile
 * app, the LLM needs different rules than for a desktop web app.
 *
 * This module produces a system-prompt block (only when mobile intent is
 * detected) that teaches the model:
 *   - mobile-first layout primitives (safe-area, bottom nav, sticky CTA)
 *   - Capacitor plugin equivalents for common web APIs (camera, geo, share,
 *     push, haptics, filesystem, browser, storage, network)
 *   - which web APIs to AVOID because they fail or feel wrong in a webview
 *   - the existing Kimble mobile primitives the model can compose from
 *
 * Pure function. No IO. Safe in client or server.
 */

import { detectMobileIntent } from "@/lib/mobile-intent";

export function renderMobileGuidanceBlock(
  text: string | null | undefined,
  opts?: { force?: boolean },
): string {
  const intent = detectMobileIntent(text);
  // `force` is set when the resolved build target is already mobile: later
  // turns ("add a filter") carry no mobile wording, and without this the
  // guidance drops out and the app drifts back to a desktop layout.
  if (!intent.detected && !opts?.force) return "";
  const signal = intent.detected ? intent.reason : "build target = mobile";

  return `

### Mobile target detected (signal: "${signal}")
The user wants this shipped as a real iOS / Android app. Petal wraps the
web app in an open-source native shell and builds signed binaries on a Mac runner — the
user never installs Xcode, a JDK, or fastlane. Generate code that is
mobile-first and uses the \`native\` bridge for phone features.

**Inside the phone app the website never shows (required)**
- Wrap the \`/\` route's content in \`AppSurfaceSwitch\` (\`@/components/mobile/app-surface-switch\`): browser visitors get the landing page; the app skips it — signed out → \`MobileAuthScreen\` (\`@/components/mobile/mobile-auth-screen\`, pass appName, transparent logo, and only the sign-in handlers the app really has), signed in → the app home.
- Never render marketing nav, hero, pricing or footer when \`native.isApp()\` is true.

**Layout rules**
- Mobile-first breakpoints: design at 390×844, scale up.
- Use \`pt-[env(safe-area-inset-top)]\` and \`pb-[env(safe-area-inset-bottom)]\`
  on full-screen containers. Never let primary CTAs sit under the home
  indicator.
- Primary navigation = bottom tab bar (5 max). Secondary = top header
  with back button. Avoid hover-only affordances.
- Tap targets ≥ 44×44 CSS px. Buttons get \`active:scale-[0.98]\` not hover.
- Lists are virtualised (or paginated) past ~50 rows.
- Reuse \`src/components/mobile/*\` primitives when they exist — don't
  duplicate scaffolding.

**Talk to the phone only through \`native\` from \`@/lib/native\`**
Every mobile project already has it. NEVER import \`@capacitor/*\` or any
native npm package — the app ships without them and the store build adds
the shell. Each call works in the preview too (web fallback), so no guards.
| Need | Use | Avoid |
|---|---|---|
| Fingerprint / Face ID unlock | \`await native.biometrics.isAvailable()\`, \`await native.biometrics.authenticate("Unlock")\` (true only when passed) | building your own prompt |
| Haptic tap / success buzz | \`native.haptics.impact()\`, \`native.haptics.success()\` | — |
| Share sheet | \`await native.share({ title, text, url })\` | bare \`navigator.share\` |
| Open an outside link | \`native.openUrl(url)\` | \`window.open\` (kills app on iOS) |
| Small saved settings | \`native.storage.get/set\` | \`localStorage\` for anything important |
| Platform-specific UI | \`native.platform()\` (\`ios\`/\`android\`/\`web\`), \`native.isApp()\` | user-agent sniffing |
| Photo pick | \`<input type="file" accept="image/*">\` behind a tap button | drag-and-drop only |

**Things that silently break in a webview — do not use**
- \`window.alert\` / \`window.confirm\` (looks broken on iOS). Use a Dialog.
- \`window.print\`. Use \`native.share\` to send a link.
- Long-running \`setInterval\` for background work — backgrounded webviews
  pause. Use server cron + push.
- Drag-and-drop file uploads as the *only* path. Always pair with a
  tap-to-pick button.
- Mouse-only events (\`onMouseEnter\`, \`onContextMenu\`). Use touch / long-press.

**Native-feel UI craft (this is what separates a real app from a website in a phone frame)**
Compose from the Petal mobile kit instead of hand-rolling — these already exist in every project. Import from the exact module named below; there is NO file-per-component layout, so \`@/components/mobile/mobile-empty-state\` does not exist:
| Need | Component |
|---|---|
| Screen shell (header + tabs + safe area) | \`MobileScreen\` (\`@/components/mobile/mobile-screen\`), \`SafeArea\`, \`MobileHeader\`, \`BottomTabBar\` |
| Grouped settings / record lists | \`ListGroup\` + \`ListRow\` from \`@/components/mobile/list-row\` |
| 2-4 mutually exclusive views | \`SegmentedControl\` |
| Contextual actions, filters, pickers | \`ActionSheet\` (bottom sheet, opaque, scroll-locked) |
| Primary create action | \`FloatingActionButton\`; forms use \`StickyActionBar\` (both from \`@/components/mobile/fab\`) |
| Delete / archive on a row | \`SwipeRow\` |
| Loading / empty / error | \`MobileListSkeleton\`, \`MobileEmptyState\`, \`MobileErrorState\` (all three from \`@/components/mobile/mobile-states\`) |
| Refresh | \`PullToRefresh\` |

Hard rules for every mobile screen:
- NEVER put a desktop data table on a phone. Records are \`ListRow\`s or cards with label/value pairs. No horizontal scrolling grids.
- Every list surface ships all three states (skeleton → empty with a primary action → error with retry). A bare spinner is a defect.
- One primary action per screen, thumb-reachable: FAB, sticky bottom bar, or the header's right slot. Never a primary CTA stranded at the top of a long scroll.
- Modals are bottom sheets, not centered desktop dialogs. Sheets are opaque (\`bg-card\`), z-50, scrim behind, body scroll locked, dismissible by scrim tap and Escape.
- Type scale: screen title text-[22px]/semibold, row title text-[15px], secondary text-[13px] muted. Numbers \`tabular-nums\`. No text-xs body copy.
- Feedback is instant: \`active:scale-[0.98]\` on tappables, optimistic UI on toggles, and a toast for anything that mutates data. Buttons disable while pending.
- Spacing: 16px screen gutters, 12-16px between cards, rounded-2xl surfaces, hairline \`divide-border\` inside grouped lists.
- Scroll: content scrolls under a sticky header; the tab bar never scrolls away; add \`pb-24\` so the last row clears the tab bar.
- Seed 8-20 realistic rows so screens look inhabited — never 3 placeholder items.

**App identity**
- App icon: design at 1024×1024, square, no transparency.
- Splash screen: solid background + centered logo, no text.
- Bundle id format: \`com.<owner>.<app>\` (lowercase, no dashes in the
  middle segment).

If the user explicitly asks for "Expo" or "React Native", build the app
exactly as described above and say in one sentence that Petal ships
native through its own shell — one React codebase, real App Store and Play
Store binaries. Never scaffold an Expo / React Native project: Petal's
build pipeline cannot compile it and the turn will be wasted.
`;
}
