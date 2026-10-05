/**
 * One-click connector sign-in (Phase 1, step 2).
 *
 * One flow for every OAuth provider: signed state -> provider consent ->
 * callback exchanges the code -> tokens stored encrypted per project.
 * A provider is "ready" only when its developer-app credentials are set as
 * secrets; until then the hub shows it as coming soon. Workerd-safe
 * (Web Crypto only).
 */

export type OAuthProvider = {
  id: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientIdEnv: string;
  clientSecretEnv: string;
  extraAuthParams?: Record<string, string>;
  /** Stripe returns the connected account id instead of a user name. */
  accountField?: string;
};

export const OAUTH_PROVIDERS: Record<string, OAuthProvider> = {
  stripe_connect: {
    id: "stripe_connect",
    authorizeUrl: "https://connect.stripe.com/oauth/authorize",
    tokenUrl: "https://connect.stripe.com/oauth/token",
    scopes: ["read_write"],
    clientIdEnv: "STRIPE_CONNECT_CLIENT_ID",
    clientSecretEnv: "STRIPE_SECRET_KEY",
    extraAuthParams: { response_type: "code" },
    accountField: "stripe_user_id",
  },
  github: {
    id: "github",
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["repo", "read:user"],
    clientIdEnv: "GITHUB_CONNECT_CLIENT_ID",
    clientSecretEnv: "GITHUB_CONNECT_CLIENT_SECRET",
  },
  ...Object.fromEntries(
    (
      [
        ["google_analytics", ["https://www.googleapis.com/auth/analytics.readonly"]],
        ["google_search_console", ["https://www.googleapis.com/auth/webmasters.readonly"]],
        ["google_calendar", ["https://www.googleapis.com/auth/calendar.events"]],
        ["google_business", ["https://www.googleapis.com/auth/business.manage"]],
      ] as const
    ).map(([id, scopes]) => [
      id,
      {
        id,
        authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        scopes: [...scopes],
        clientIdEnv: "GOOGLE_CONNECT_CLIENT_ID",
        clientSecretEnv: "GOOGLE_CONNECT_CLIENT_SECRET",
        extraAuthParams: { response_type: "code", access_type: "offline", prompt: "consent" },
      } satisfies OAuthProvider,
    ]),
  ),
};

export function providerReady(id: string, env: Record<string, string | undefined> = process.env): boolean {
  const p = OAUTH_PROVIDERS[id];
  return !!p && !!env[p.clientIdEnv] && !!env[p.clientSecretEnv] && !!env.CONNECTOR_TOKEN_KEY;
}

/* ---------------- crypto ---------------- */

const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function keyBytes(secret: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(secret)));
}

async function hmac(secret: string, data: string) {
  const k = await crypto.subtle.importKey("raw", await keyBytes(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}

export type StatePayload = { u: string; p: string; c: string; r: string; exp: number };

export async function signState(secret: string, payload: StatePayload): Promise<string> {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyState(secret: string, state: string, now = Date.now()): Promise<StatePayload | null> {
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expected = await hmac(secret, body);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(fromB64u(body))) as StatePayload;
    return p.exp > now ? p : null;
  } catch {
    return null;
  }
}

async function aesKey(secret: string) {
  return crypto.subtle.importKey("raw", await keyBytes(secret), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptToken(secret: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), enc.encode(plain));
  return `${b64u(iv)}.${b64u(ct)}`;
}

export async function decryptToken(secret: string, blob: string): Promise<string> {
  const [iv, ct] = blob.split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64u(iv) }, await aesKey(secret), fromB64u(ct));
  return new TextDecoder().decode(pt);
}

/* ---------------- flow ---------------- */

export function buildAuthorizeUrl(p: OAuthProvider, clientId: string, redirectUri: string, state: string) {
  const u = new URL(p.authorizeUrl);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", p.scopes.join(" "));
  u.searchParams.set("state", state);
  for (const [k, v] of Object.entries(p.extraAuthParams ?? {})) u.searchParams.set(k, v);
  return u.toString();
}

export async function exchangeCode(p: OAuthProvider, code: string, redirectUri: string, env = process.env) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: env[p.clientIdEnv] ?? "",
    client_secret: env[p.clientSecretEnv] ?? "",
  });
  const res = await fetch(p.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Token exchange failed [${res.status}]: ${text}`);
  const json = JSON.parse(text) as Record<string, unknown>;
  if (json.error) throw new Error(`Token exchange failed: ${String(json.error_description ?? json.error)}`);
  return json;
}

export const CALLBACK_PATH = "/api/public/connectors/callback";
