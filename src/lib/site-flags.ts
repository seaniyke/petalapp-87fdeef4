/**
 * Site-level visibility flags for surfaces that are paused, not deleted.
 * Flip a flag back to true to bring the surface back into the UI — the
 * underlying routes, pages and APIs stay in place either way.
 */

/** Investor round promotion is paused. `/invest` still works by direct URL. */
export const INVEST_LINKS_ENABLED = false;

/**
 * Paused build types (launch is web-only). Off = never shown anywhere and
 * never built: `isTargetEnabled` gates the single target resolution point,
 * so no mobile / API-backend / extension instructions reach the engine.
 */
export const MOBILE_APPS_ENABLED = false;
export const API_BACKENDS_ENABLED = false;
export const CHROME_EXTENSIONS_ENABLED = false;

export function isTargetEnabled(id: string | null | undefined): boolean {
  switch (id) {
    case "mobile":
    case "ios":
    case "android":
    case "web-mobile":
      return MOBILE_APPS_ENABLED;
    case "backend":
      return API_BACKENDS_ENABLED;
    case "extension":
      return CHROME_EXTENSIONS_ENABLED;
    default:
      return true;
  }
}

/** Starter-kit files that belong to a paused build type (hidden from the engine). */
export function isPausedKitPath(path: string): boolean {
  if (!MOBILE_APPS_ENABLED && (path.startsWith("src/components/mobile/") || path === "src/components/examples/mobile-app-shell.tsx")) return true;
  return false;
}
