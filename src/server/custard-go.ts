/**
 * Custard Go — instant phone preview, pure rules.
 *
 * Custard Go is one signed companion app (Capacitor shell with the store-safe
 * phone add-ons pre-installed). It scans a QR and loads a project's preview
 * address, so the project runs with real Face ID, haptics, share and push
 * without compiling a binary per project. The same QR works without the app:
 * a phone camera opens the address in the browser, where `petal_app=1` shows
 * the app screens instead of the website.
 */
import { EMBED_ROOT, previewHost } from "./embed-preview";

export const CUSTARD_GO_SCHEME = "custardgo";
export const APP_PARAM = "petal_app";

/** The preview address phones open: app screens, never the landing page. */
export function phonePreviewUrl(projectId: string): string {
  return `https://${previewHost(projectId)}/?${APP_PARAM}=1`;
}

/** Deep link that opens the address straight inside Custard Go. */
export function custardGoLink(projectId: string): string {
  return `${CUSTARD_GO_SCHEME}://open?url=${encodeURIComponent(phonePreviewUrl(projectId))}`;
}

/** Custard Go loads only Custard preview addresses (never arbitrary sites). */
export function isAllowedPreviewUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname.endsWith(`.${EMBED_ROOT}`) && u.hostname.startsWith("preview--");
  } catch {
    return false;
  }
}

export function qrImageUrl(data: string, size = 320): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=8&data=${encodeURIComponent(data)}`;
}
