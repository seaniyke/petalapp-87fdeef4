/**
 * Developer API keys (Custard AI developer platform) — pure rules.
 *
 * Keys look like `sk_custard_<40 base62 chars>`. Only a SHA-256 hash is
 * stored; the plain key is shown once at creation. A key can only reach the
 * projects it created (see developer_key_projects), and its scopes decide
 * whether it may read (GET) or change (everything else).
 */

export const KEY_PREFIX = "sk_custard_";
const BODY_LEN = 40;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export const SCOPES = ["projects:read", "projects:write"] as const;
export type Scope = (typeof SCOPES)[number];

export function generateKey(): string {
  const bytes = new Uint8Array(BODY_LEN);
  crypto.getRandomValues(bytes);
  let body = "";
  // 248 = largest multiple of 62 below 256 → no modulo bias.
  for (let i = 0; body.length < BODY_LEN; i++) {
    if (i >= bytes.length) {
      crypto.getRandomValues(bytes);
      i = 0;
    }
    if (bytes[i] < 248) body += ALPHABET[bytes[i] % 62];
  }
  return KEY_PREFIX + body;
}

export function looksLikeDeveloperKey(raw: string): boolean {
  return new RegExp(`^${KEY_PREFIX}[A-Za-z0-9]{${BODY_LEN}}$`).test(raw);
}

/** Short visible prefix for listings, e.g. `sk_custard_Ab12…`. */
export function displayPrefix(key: string): string {
  return key.slice(0, KEY_PREFIX.length + 4);
}

export async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Scope a request method needs: reads need projects:read, anything else projects:write. */
export function requiredScope(method: string): Scope {
  const m = method.toUpperCase();
  return m === "GET" || m === "HEAD" ? "projects:read" : "projects:write";
}

/** projects:write implies projects:read. */
export function hasScope(granted: readonly string[], needed: Scope): boolean {
  if (granted.includes(needed)) return true;
  return needed === "projects:read" && granted.includes("projects:write");
}

export function normalizeScopes(input: unknown): Scope[] | null {
  if (input === undefined) return ["projects:read", "projects:write"];
  if (!Array.isArray(input) || input.length === 0) return null;
  const out = new Set<Scope>();
  for (const s of input) {
    if (!(SCOPES as readonly string[]).includes(s)) return null;
    out.add(s as Scope);
  }
  return [...out];
}
