/**
 * Build-target registry — what the user is asking Petal to build.
 *
 * Selected via the chip row under the composer (à la Google AI Studio's
 * "Build an Android app"). The selection rides every generate request as
 * `x-petal-target` and is mirrored into the system prompt as a hard
 * constraint so Petal scaffolds the right stack.
 *
 * Milestone 1 wiring only — the actual stack swaps (Expo scaffold,
 * Snack web-player, EAS publish) land in later milestones. For now the
 * chip drives prompt steering and preview-frame chrome.
 */
export type BuildTargetId =
  | "web"
  | "android"
  | "ios"
  | "backend"
  | "extension";

export type PreviewMode = "web" | "ios" | "android" | "api" | "extension";

export type BuildTarget = {
  id: BuildTargetId;
  label: string;
  /** Tiny one-liner shown below the chip when selected. */
  hint: string;
  /** Single emoji / glyph fallback if a Lucide icon isn't a fit. */
  glyph: string;
  /** Determines the device frame wrapped around the preview. */
  preview: PreviewMode;
  /** Hard constraint injected at the top of the system prompt. */
  systemPromptAddendum: string;
};

export const BUILD_TARGETS: BuildTarget[] = [
  {
    id: "web",
    label: "Web app",
    hint: "React + Tailwind in the browser",
    glyph: "🌐",
    preview: "web",
    systemPromptAddendum: "",
  },
  {
    id: "android",
    label: "Android app",
    hint: "Expo / React Native — ships to Play Store",
    glyph: "🤖",
    preview: "android",
    systemPromptAddendum: [
      "BUILD TARGET: Android (Expo / React Native).",
      "- Use `react-native` primitives (View, Text, Pressable, ScrollView, FlatList) — NEVER `div`, `span`, `button`, or any react-dom element.",
      "- Routing is `expo-router` file-based under `app/`.",
      "- Styling is StyleSheet.create or NativeWind — no Tailwind className utilities on RN elements.",
      "- Images use `expo-image`. Icons use `@expo/vector-icons`.",
      "- Treat the canvas as a phone screen (~390×844). No mouse-only interactions.",
      "- Do not import anything from `react-dom`, `next`, `@tanstack/react-router`, or web-only libraries.",
    ].join("\n"),
  },
  {
    id: "ios",
    label: "iOS app",
    hint: "Expo / React Native — ships to App Store",
    glyph: "",
    preview: "ios",
    systemPromptAddendum: [
      "BUILD TARGET: iOS (Expo / React Native).",
      "- Use `react-native` primitives (View, Text, Pressable, ScrollView, FlatList) — NEVER `div`, `span`, `button`, or any react-dom element.",
      "- Routing is `expo-router` file-based under `app/`.",
      "- Styling is StyleSheet.create or NativeWind — no Tailwind className utilities on RN elements.",
      "- Honor safe areas via `react-native-safe-area-context`; respect notch + home indicator.",
      "- Images use `expo-image`. Icons use `@expo/vector-icons` (SF Symbols-style).",
      "- Treat the canvas as an iPhone screen (~390×844). No mouse-only interactions.",
      "- Do not import anything from `react-dom`, `next`, `@tanstack/react-router`, or web-only libraries.",
    ].join("\n"),
  },
  {
    id: "backend",
    label: "Backend / API",
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

export function getBuildTarget(id: string | null | undefined): BuildTarget {
  return (
    BUILD_TARGETS.find((t) => t.id === id) ?? BUILD_TARGETS[0] // web fallback
  );
}

/** localStorage key (per-project). Stub until we add the DB column. */
export function buildTargetStorageKey(projectId: string | null | undefined) {
  return `petal.buildTarget.${projectId ?? "default"}`;
}
