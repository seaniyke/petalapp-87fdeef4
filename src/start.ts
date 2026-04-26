import { createStart, createMiddleware } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";

/**
 * Global request middleware that sets cross-origin isolation headers on every
 * response. WebContainers (used by /builder for in-browser previews) requires:
 *   - Cross-Origin-Opener-Policy: same-origin
 *   - Cross-Origin-Embedder-Policy: require-corp
 * to enable SharedArrayBuffer.
 *
 * Trade-off: any third-party resource we embed (images, scripts, iframes) must
 * either send `Cross-Origin-Resource-Policy: cross-origin` / `Access-Control-
 * Allow-Origin` headers, or be loaded with `crossorigin="anonymous"` and arrive
 * with the right CORP header. Our app uses Google Fonts CSS + the Lovable AI
 * gateway (both CORS-enabled), and project previews run inside our own iframe
 * that gets a per-request CORP header from the WebContainer service worker, so
 * applying this globally is safe today.
 */
const crossOriginIsolation = createMiddleware().server(async ({ next }) => {
  setResponseHeader("Cross-Origin-Opener-Policy", "same-origin");
  setResponseHeader("Cross-Origin-Embedder-Policy", "require-corp");
  // Allow same-origin iframes/images to be embedded from this app under COEP.
  setResponseHeader("Cross-Origin-Resource-Policy", "same-origin");
  return next();
});

export const startInstance = createStart(() => ({
  requestMiddleware: [crossOriginIsolation],
}));
