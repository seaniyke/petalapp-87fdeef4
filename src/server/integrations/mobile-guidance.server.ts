/**
 * Layer K — Mobile generation guidance.
 *
 * Petal already ships a mobile pipeline (Capacitor + Codemagic) that wraps
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
 *   - the existing Petal mobile primitives the model can compose from
 *
 * Pure function. No IO. Safe in client or server.
 */

import { detectMobileIntent } from "@/lib/mobile-intent";

export function renderMobileGuidanceBlock(text: string | null | undefined): string {
  const intent = detectMobileIntent(text);
  if (!intent.detected) return "";

  return `

### Mobile target detected (signal: "${intent.reason}")
The user wants this shipped as a real iOS / Android app. Petal wraps the
web app with **Capacitor** and builds signed binaries on Codemagic — the
user never installs Xcode, a JDK, or fastlane. Generate code that is
mobile-first AND Capacitor-ready.

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

**Use Capacitor plugins instead of web-only APIs**
| Need | Use | Avoid |
|---|---|---|
| Camera / photo library | \`@capacitor/camera\` | \`<input type=file capture>\` (works but ugly) |
| Push notifications | \`@capacitor/push-notifications\` | Web Push (no iOS support in webview) |
| GPS / location | \`@capacitor/geolocation\` | bare \`navigator.geolocation\` (permissions race) |
| Share sheet | \`@capacitor/share\` | \`navigator.share\` only (fails on iOS webview) |
| Haptics | \`@capacitor/haptics\` | — |
| Local storage that survives reinstall on iOS | \`@capacitor/preferences\` | \`localStorage\` for anything important |
| Open external URL | \`@capacitor/browser\` | \`window.open\` (kills app on iOS) |
| Read offline / online | \`@capacitor/network\` | \`navigator.onLine\` only |
| Filesystem | \`@capacitor/filesystem\` | File System Access API |
| Status bar styling | \`@capacitor/status-bar\` | meta theme-color only |
| App lifecycle | \`@capacitor/app\` | \`visibilitychange\` only |

Import the plugin, call it inside a \`useEffect\` or event handler, and
ALWAYS provide a graceful web fallback (Capacitor.isNativePlatform()) so
the same code works in the Lovable preview AND in the published app.

\`\`\`ts
import { Camera, CameraResultType } from "@capacitor/camera";
import { Capacitor } from "@capacitor/core";

async function takePhoto() {
  if (!Capacitor.isNativePlatform()) {
    // web fallback — file picker
    return pickFromFileInput();
  }
  const photo = await Camera.getPhoto({
    quality: 80,
    resultType: CameraResultType.Uri,
  });
  return photo.webPath;
}
\`\`\`

**Things that silently break in a webview — do not use**
- \`window.alert\` / \`window.confirm\` (looks broken on iOS). Use a Dialog.
- \`window.print\`. Use \`@capacitor/share\` to send a PDF.
- Long-running \`setInterval\` for background work — backgrounded webviews
  pause. Use server cron + push.
- Drag-and-drop file uploads as the *only* path. Always pair with a
  tap-to-pick button.
- Mouse-only events (\`onMouseEnter\`, \`onContextMenu\`). Use touch / long-press.

**Native-feel UI craft (this is what separates a real app from a website in a phone frame)**
Compose from the Petal mobile kit instead of hand-rolling — these already exist in every project:
| Need | Component |
|---|---|
| Screen shell (header + tabs + safe area) | \`MobileScreen\`, \`SafeArea\`, \`MobileHeader\`, \`BottomTabBar\` |
| Grouped settings / record lists | \`ListGroup\` + \`ListRow\` from \`@/components/mobile/list-row\` |
| 2-4 mutually exclusive views | \`SegmentedControl\` |
| Contextual actions, filters, pickers | \`ActionSheet\` (bottom sheet, opaque, scroll-locked) |
| Primary create action | \`FloatingActionButton\`; forms use \`StickyActionBar\` |
| Delete / archive on a row | \`SwipeRow\` |
| Loading / empty / error | \`MobileListSkeleton\`, \`MobileEmptyState\`, \`MobileErrorState\` |
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

If the user explicitly asks for "Expo" or "React Native" instead of
Capacitor, stop and explain that Petal currently ships native via
Capacitor, and ask whether they want to proceed with that or wait. Do
NOT silently scaffold a React Native project — Petal cannot build it.
`;
}
