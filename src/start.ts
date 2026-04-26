import { createStart, createMiddleware } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";

/**
 * Global request middleware that sets cross-origin isolation headers on every
 * response. WebContainers (used by /builder for in-browser previews) requires
 * a cross-origin-isolated context to enable SharedArrayBuffer:
 *   - Cross-Origin-Opener-Policy: same-origin
 *   - Cross-Origin-Embedder-Policy: credentialless
 *
 * Why `credentialless` instead of `require-corp`:
 * Our deployed-preview iframe (Cloudflare Pages, e.g. petal-<id>.pages.dev) is
 * cross-origin. Under `require-corp`, browsers refuse to render a cross-origin
 * iframe unless it serves a matching CORP header — which Pages doesn't by
 * default, so the iframe renders blank. `credentialless` keeps the page
 * cross-origin-isolated (WebContainers continue to work) but allows
 * cross-origin subresources/iframes to load without credentials, no extra
 * CORP header required from the embedded site.
 *
 * Browser support: Chromium 110+, Firefox 119+, Safari 17.5+. Older browsers
 * lose cross-origin isolation gracefully and fall back to the static preview.
 */
const crossOriginIsolation = createMiddleware().server(async ({ next }) => {
  setResponseHeader("Cross-Origin-Opener-Policy", "same-origin");
  setResponseHeader("Cross-Origin-Embedder-Policy", "credentialless");
  // Allow same-origin iframes/images served by this app to be embedded.
  setResponseHeader("Cross-Origin-Resource-Policy", "same-origin");
  return next();
});

export const startInstance = createStart(() => ({
  requestMiddleware: [crossOriginIsolation],
}));
