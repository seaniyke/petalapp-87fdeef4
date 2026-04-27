// Dependency-free browser capability checks. Keep this file safe to import on
// every browser, including iOS Safari, before any WebContainer code is loaded.

export function detectUnsupportedWebContainerBrowser(): string | null {
  if (typeof navigator === "undefined") return null;

  const ua = navigator.userAgent;
  const nav = navigator as Navigator & { maxTouchPoints?: number };

  // iOS / iPadOS — all browsers there are WebKit. WebContainers technically
  // boot on newer iOS builds, but installing full projects over mobile reliably
  // times out, and loading WebContainer code can fail before we can fallback.
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1);
  if (isIOS) {
    return "Live preview isn't supported on iOS — open this project on desktop Chrome, Edge, or Firefox to run it.";
  }

  const isAndroid = /Android/.test(ua);
  const isChromium = /Chrome|Chromium|Edg/.test(ua) && !/OPR\//.test(ua);
  if (isAndroid && !isChromium) {
    return "Live preview needs Chrome on Android. Try opening this project on desktop for the best experience.";
  }

  if (typeof SharedArrayBuffer === "undefined") {
    return "Your browser doesn't support SharedArrayBuffer, which is required to run the preview. Try desktop Chrome, Edge, or Firefox.";
  }

  return null;
}