import { isTargetEnabled } from "@/lib/site-flags";
/**
 * Build-target registry — what the user is asking Kimble to build.
 *
 * Single dropdown under the composer ("Build a web app ▾"). Selection
 * rides every generate request as `x-petal-target` and gets mirrored
 * into the system prompt as a hard constraint so Kimble scaffolds the
 * right stack.
 *
 * Mobile is intentionally ONE target — Expo / React Native is "one
 * codebase, two stores", same model as Flutter. The user picks
 * iOS-vs-Android only at the final publish step (or via the in-frame
 * device toggle for preview), not at the prompt step.
 */
export type BuildTargetId =
  | "web"
  | "mobile"
  | "web-mobile"
  | "backend"
  | "extension"
  // Legacy ids — older projects may have these in localStorage. Kept in
  // the type so `getBuildTarget` can migrate them to "mobile" without
  // a TS error. Never surfaced in the picker.
  | "android"
  | "ios";

export type PreviewMode = "web" | "mobile" | "api" | "extension";

export type BuildTarget = {
  id: BuildTargetId;
  label: string;
  /** Tiny one-liner shown in the menu under the menuLabel. */
  hint: string;
  /** Long label used in the dropdown menu ("Build a mobile app"). */
  menuLabel: string;
  /** Single emoji / glyph fallback if a Lucide icon isn't a fit. */
  glyph: string;
  /** Determines the device frame wrapped around the preview. */
  preview: PreviewMode;
  /** Hard constraint injected at the top of the system prompt. */
  systemPromptAddendum: string;
};

/** Ordered list shown in the picker. Mobile sits right after web. */
export const ALL_BUILD_TARGETS: BuildTarget[] = [
  {
    id: "web",
    label: "Web app",
    menuLabel: "Build a web app",
    hint: "React + Tailwind in the browser",
    glyph: "🌐",
    preview: "web",
    systemPromptAddendum: "",
  },
  {
    id: "mobile",
    label: "Mobile app",
    menuLabel: "Build a mobile app",
    hint: "One codebase, ships to iOS + Android",
    glyph: "📱",
    preview: "mobile",
    systemPromptAddendum: [
      "BUILD TARGET: Mobile app — one React codebase that Kimble wraps in a Capacitor native shell and builds into real iOS (.ipa) and Android (.apk/.aab) binaries.",
      "- Stack is the SAME React + Vite + Tailwind scaffold as web. Do NOT scaffold Expo, react-native, expo-router, or NativeWind — Kimble's store pipeline cannot build them.",
      "- Design for a phone first (390×844). Every screen must look intentional at that width; wider screens simply center the content in a max-w-md column.",
      "- Navigation is a fixed bottom tab bar (3-5 tabs) plus a sticky top header with back. No desktop sidebars, no top nav bars, no hover-only affordances.",
      "- Compose from the mobile primitives that ALREADY exist in the project. These are the only valid import paths — never invent one file per component:",
      "    `@/components/mobile/mobile-screen` → MobileScreen",
      "    `@/components/mobile/safe-area` → SafeArea",
      "    `@/components/mobile/mobile-header` → MobileHeader",
      "    `@/components/mobile/bottom-tab-bar` → BottomTabBar, type BottomTab",
      "    `@/components/mobile/pull-to-refresh` → PullToRefresh",
      "    `@/components/mobile/list-row` → ListGroup, ListRow",
      "    `@/components/mobile/segmented-control` → SegmentedControl",
      "    `@/components/mobile/action-sheet` → ActionSheet",
      "    `@/components/mobile/fab` → FloatingActionButton, StickyActionBar",
      "    `@/components/mobile/swipe-row` → SwipeRow",
      "    `@/components/mobile/mobile-states` → MobileListSkeleton, MobileEmptyState, MobileErrorState",
      "- Records are list rows or cards — never a desktop data table, never a horizontally scrolling grid.",
      "- Tap targets ≥ 44px, `active:scale-[0.98]` instead of hover, safe-area padding on full-screen containers.",
      "- Native capabilities go through Capacitor plugins (`@capacitor/haptics`, `@capacitor/preferences`, `@capacitor/app`, `@capacitor/status-bar`, `@capacitor/camera`, `@capacitor/geolocation`, `@capacitor/share`, `@capacitor/push-notifications`) behind a `Capacitor.isNativePlatform()` check with a working web fallback.",
      "- Never use `window.alert`/`confirm`/`print`, `window.open`, or mouse-only events — they break or look broken inside a webview.",
      "- `capacitor.config.ts` is Kimble-managed; do not emit it.",
    ].join("\n"),
  },
  {
    id: "web-mobile",
    label: "Web + Mobile",
    menuLabel: "Build web + mobile together",
    hint: "Shared backend, web app + Expo mobile app",
    glyph: "🌐📱",
    preview: "web",
    systemPromptAddendum: [
      "BUILD TARGET: Web app AND Mobile app together — one project, two clients sharing the same backend / API / types.",
      "- Web client lives at the project root (existing TanStack Start + Tailwind setup) under `src/`.",
      "- Mobile client lives under `mobile/` as an Expo / React Native app with its own `app/` (expo-router), `package.json`, and `app.json`.",
      "- Shared code (types, zod schemas, API client helpers, business logic) lives in `packages/shared/` and is imported by BOTH `src/` (web) and `mobile/` (RN). Never duplicate domain logic across the two clients.",
      "- Backend / API routes are authored ONCE under `src/routes/api/` (TanStack server routes) and consumed by both clients via the shared API client.",
      "- Web uses `div`/`span`/`button` + Tailwind. Mobile uses `View`/`Text`/`Pressable` + StyleSheet/NativeWind. NEVER mix react-dom elements into `mobile/`, NEVER import RN primitives into `src/`.",
      "- Auth/session: implement once on the backend, expose a shared hook from `packages/shared/auth` that each client adapts to its own storage (web: cookies/localStorage, mobile: expo-secure-store).",
      "- When the user asks to add a feature, add it to BOTH clients (web screen + mobile screen) unless they explicitly say web-only or mobile-only.",
    ].join("\n"),
  },
  {
    id: "backend",
    label: "Backend / API",
    menuLabel: "Build a backend / API",
    hint: "TanStack server routes — no UI",
    glyph: "⚙️",
    preview: "api",
    systemPromptAddendum: [
      "BUILD TARGET: Backend / API only.",
      "- Implement everything as TanStack server routes under `src/routes/api/` and `createServerFn` helpers.",
      "- Do NOT build pages, components, or any UI beyond a minimal `/` landing that documents the endpoints.",
      "- Validate every request body with Zod. Return JSON `Response` objects with explicit status codes.",
      "- Authenticate sensitive routes; public endpoints belong under `src/routes/api/public/` and must verify signatures or API keys.",
    ].join("\n"),
  },
  {
    id: "extension",
    label: "Chrome extension",
    menuLabel: "Build a Chrome extension",
    hint: "Manifest V3 — popup + background worker",
    glyph: "🧩",
    preview: "extension",
    systemPromptAddendum: [
      "BUILD TARGET: Chrome Extension (Manifest V3).",
      "- Produce a `manifest.json` (MV3), a `popup.html` + popup React component, a `background.ts` service worker, and a `content.ts` content script as appropriate.",
      "- The popup is constrained to ~360×500. No router — single popup view + optional options page.",
      "- Use `chrome.*` APIs (storage, tabs, runtime). Never assume a server is reachable.",
      "- Avoid heavy dependencies; bundle size matters for extensions.",
    ].join("\n"),
  },
];

/** Targets available right now (paused ones removed). */
export const BUILD_TARGETS: BuildTarget[] = ALL_BUILD_TARGETS.filter((t) => isTargetEnabled(t.id));

/**
 * Resolve an id (including legacy `ios` / `android`) to a BuildTarget.
 * Legacy mobile ids migrate transparently to the unified `mobile` entry.
 */
export function getBuildTarget(id: string | null | undefined): BuildTarget {
  if (!isTargetEnabled(id)) return BUILD_TARGETS[0];
  if (id === "ios" || id === "android") {
    return BUILD_TARGETS.find((t) => t.id === "mobile")!;
  }
  return (
    BUILD_TARGETS.find((t) => t.id === id) ?? BUILD_TARGETS[0] // web fallback
  );
}

/** Treat any phone-shaped target (current or legacy) as "mobile". */
export function isMobileTarget(id: string | null | undefined): boolean {
  if (!isTargetEnabled(id)) return false;
  return id === "mobile" || id === "ios" || id === "android";
}

/** Set of ids that are valid to persist / read from storage or URL. */
export const VALID_TARGET_IDS: readonly BuildTargetId[] = [
  "web",
  "mobile",
  "web-mobile",
  "backend",
  "extension",
  "android",
  "ios",
] as const;

/** localStorage key (per-project). Stub until we add the DB column. */
export function buildTargetStorageKey(projectId: string | null | undefined) {
  return `petal.buildTarget.${projectId ?? "default"}`;
}
