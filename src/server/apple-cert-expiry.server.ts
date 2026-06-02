/**
 * Apple signing-credential expiry parsers.
 *
 * Two artifacts carry an expiry date:
 *
 * - **`.mobileprovision`** (Apple provisioning profile) — a CMS/PKCS7-signed
 *   blob with a plaintext plist inside. The plist exposes
 *   `<key>ExpirationDate</key><date>YYYY-MM-DDTHH:MM:SSZ</date>`, which we
 *   pull out with a tight regex. No ASN.1 parsing needed.
 *
 * - **`.p12`** (Apple distribution certificate) — full ASN.1/PKCS12.
 *   Parsing in the Worker runtime requires `node-forge` plus the cert
 *   password. Out of scope for now; we expose a stub so callers compile
 *   and the daily cron only warns on whichever date is present.
 *
 * Returning `null` means "couldn't determine an expiry" — the caller MUST
 * treat that as a soft success (no warning) rather than crashing the upload.
 */

export function parseProvisioningProfileExpiry(base64: string): Date | null {
  try {
    const bytes = Buffer.from(base64, "base64");
    // The plist is UTF-8 inside the CMS envelope. Decoding the whole thing
    // as latin1 is safe — we only need ASCII-range bytes to find the tags.
    const text = bytes.toString("latin1");
    const start = text.indexOf("<?xml");
    const end = text.indexOf("</plist>");
    if (start === -1 || end === -1) return null;
    const plist = text.slice(start, end);
    const m = plist.match(
      /<key>ExpirationDate<\/key>\s*<date>([^<]+)<\/date>/,
    );
    if (!m) return null;
    const d = new Date(m[1]);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/**
 * Placeholder for `.p12` expiry extraction. Requires `node-forge` or
 * equivalent ASN.1 decode + PKCS12 unwrap with the user-supplied password.
 * Left as `null` so callers don't depend on it yet.
 */
export function parseP12NotAfter(_base64: string, _password: string): Date | null {
  return null;
}
