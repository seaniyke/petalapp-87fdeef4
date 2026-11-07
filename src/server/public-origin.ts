/**
 * The origin the build server must call back into.
 *
 * A request's own origin is only trusted when it is publicly reachable. A
 * preview/sandbox request arrives as `http://localhost:8080`; handed to the
 * VPS builder, that address points at the VPS itself and every callback fails.
 * Unreachable origins fall back to `PETAL_PUBLIC_ORIGIN` or the published app.
 */
export const DEFAULT_PUBLIC_ORIGIN = "https://petalapp.lovable.app";

export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h === "0.0.0.0") return true;
  if (/^(10|127|0)\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^(fc|fd)[0-9a-f]{2}:/.test(h) || h.startsWith("fe80:")) return true;
  return false;
}

export function trustedAppOrigin(
  requestUrl: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const fallback = (env.PETAL_PUBLIC_ORIGIN || DEFAULT_PUBLIC_ORIGIN).replace(/\/+$/, "");
  try {
    const u = new URL(requestUrl);
    if (u.protocol !== "https:" || isPrivateHost(u.hostname)) return fallback;
    return u.origin;
  } catch {
    return fallback;
  }
}
