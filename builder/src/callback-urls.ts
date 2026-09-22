const CALLBACK_FALLBACK_ORIGIN =
  "https://project--fe869ce3-50d8-49d0-b2fe-829b0f7b4b1c.lovable.app";

/**
 * Keep control-plane callbacks available while the branded domain is serving
 * an older deployment or its edge cache is converging.
 */
export function callbackCandidates(configuredUrl: string): string[] {
  const urls = [configuredUrl];
  try {
    const stable = new URL(configuredUrl);
    stable.protocol = "https:";
    stable.host = new URL(CALLBACK_FALLBACK_ORIGIN).host;
    urls.push(stable.toString());
  } catch {
    // Preserve malformed configured values for the caller's diagnostic path.
  }
  return [...new Set(urls)];
}