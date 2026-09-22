/**
 * Test Lab safety, app side.
 *
 * The builder's network guard stops a test from charging a card or sending an
 * email (see `builder/src/browse-safety.ts`). This module covers the other two
 * halves of the promise:
 *
 *  - Evidence is scrubbed. Screenshots, page text and error messages from a
 *    running app can contain keys, tokens and the throwaway password Kimble
 *    typed. None of that is stored or shown.
 *  - Test accounts are identifiable. Every identity Kimble creates carries a
 *    recognisable tag, so a person can tell a test row from a real one and a
 *    cleanup pass can find them later.
 *
 * Pure functions only. The caller decides what to store.
 */

/** Marker present in every identity Kimble creates while testing. */
export const TEST_IDENTITY_TAG = "petal-verify+";

/** True for an email Kimble minted for a test run. */
export function isTestIdentity(email: string | null | undefined): boolean {
  return Boolean(email && email.toLowerCase().includes(TEST_IDENTITY_TAG));
}

const REDACTIONS: Array<{ pattern: RegExp; label: string }> = [
  // JWTs (Supabase access tokens, session cookies)
  { pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, label: "token" },
  // Modern Supabase keys
  { pattern: /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/g, label: "key" },
  // Provider keys
  { pattern: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g, label: "key" },
  { pattern: /\bAIza[0-9A-Za-z_-]{20,}/g, label: "key" },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g, label: "key" },
  { pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, label: "key" },
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi, label: "token" },
  // Anything explicitly labelled as a secret in a key=value pair
  {
    pattern:
      /\b(?:api[_-]?key|secret|password|passwd|token|authorization)\b\s*[:=]\s*["']?[^\s"'&,}]{6,}/gi,
    label: "secret",
  },
  // Postgres connection strings
  { pattern: /\bpostgres(?:ql)?:\/\/[^\s"']+/gi, label: "connection string" },
];

/**
 * Removes anything that looks like a credential from text bound for storage,
 * a prompt or the screen. Deliberately over-eager: a redacted line is a small
 * loss, a leaked key is not.
 */
export function redactSecrets(text: string | null | undefined): string {
  if (!text) return "";
  let out = text;
  for (const { pattern, label } of REDACTIONS) {
    out = out.replace(pattern, `[redacted ${label}]`);
  }
  return out;
}

/** Redaction across a list, dropping entries that become empty. */
export function redactAll(values: string[] | null | undefined): string[] {
  return (values ?? []).map((v) => redactSecrets(v)).filter(Boolean);
}

/**
 * Also hides a specific run's throwaway password, which is a valid string with
 * no recognisable shape. Pass the identity Kimble used for the run.
 */
export function redactWithIdentity(
  text: string | null | undefined,
  identity?: { password?: string } | null,
): string {
  const base = redactSecrets(text);
  const pw = identity?.password;
  if (!pw || pw.length < 6) return base;
  return base.split(pw).join("[redacted password]");
}

/** One short line for the person, listing what testing refused to do. */
export function describeSuppressed(suppressed: string[]): string | null {
  if (!suppressed.length) return null;
  return `While testing, Kimble blocked ${suppressed.length} request${
    suppressed.length === 1 ? "" : "s"
  } that would have charged money or messaged someone for real.`;
}
