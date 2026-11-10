/**
 * Signed, expiring links that let the Codemagic build machine download one
 * project's source straight from Petal (replaces the per-project GitHub
 * mirror). Pure Web Crypto — runs in the Worker and in tests.
 */
const enc = new TextEncoder();

export const SOURCE_LINK_TTL_SECONDS = 2 * 60 * 60;

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function signSourceLink(args: {
  baseUrl: string;
  projectId: string;
  secret: string;
  nowSeconds?: number;
}): Promise<string> {
  const exp = (args.nowSeconds ?? Math.floor(Date.now() / 1000)) + SOURCE_LINK_TTL_SECONDS;
  const sig = await hmacHex(args.secret, `source.${args.projectId}.${exp}`);
  const u = new URL("/api/public/mobile/source", args.baseUrl);
  u.searchParams.set("p", args.projectId);
  u.searchParams.set("e", String(exp));
  u.searchParams.set("s", sig);
  return u.toString();
}

export async function verifySourceLink(args: {
  projectId: string;
  exp: number;
  sig: string;
  secret: string;
  nowSeconds?: number;
}): Promise<boolean> {
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(args.exp) || args.exp < now) return false;
  if (args.exp > now + SOURCE_LINK_TTL_SECONDS + 60) return false;
  const expected = await hmacHex(args.secret, `source.${args.projectId}.${args.exp}`);
  if (expected.length !== args.sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ args.sig.charCodeAt(i);
  return diff === 0;
}
