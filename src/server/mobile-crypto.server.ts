/**
 * Symmetric encryption for mobile signing materials at rest.
 *
 * AES-GCM with a project-derived key: HKDF(MASTER, info=projectId). This
 * means:
 *  - One master secret (PETAL_SIGNING_MASTER_KEY) for the whole platform.
 *  - Each project's blobs are encrypted under a unique derived key, so a
 *    leak of any single ciphertext never compromises another project.
 *  - We can rotate by re-encrypting per project without rotating the master.
 *
 * Master key format: a base64url-encoded 32 byte (256-bit) random value.
 * Generate with `openssl rand -base64 32` if you ever rotate it.
 *
 * Ciphertext format (string): `v1.<iv_b64u>.<ct_b64u>` — version tag in
 * front so we can ship a v2 scheme later without breaking decryption of
 * existing rows.
 */

function b64uToBytes(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64u(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function getMasterKeyBytes(): Uint8Array {
  const raw = process.env.PETAL_SIGNING_MASTER_KEY;
  if (!raw) throw new Error("PETAL_SIGNING_MASTER_KEY is not configured");
  return b64uToBytes(raw);
}

async function deriveProjectKey(projectId: string): Promise<CryptoKey> {
  // Copy into fresh ArrayBuffers so the WebCrypto types accept us under
  // strict TS (Uint8Array<ArrayBufferLike> is not BufferSource-compatible
  // with the strictest lib.dom typings).
  const masterBytes = getMasterKeyBytes();
  const masterBuf = new ArrayBuffer(masterBytes.byteLength);
  new Uint8Array(masterBuf).set(masterBytes);
  const master = await crypto.subtle.importKey(
    "raw",
    masterBuf,
    { name: "HKDF" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("petal.mobile.signing.v1"),
      info: new TextEncoder().encode(projectId),
    },
    master,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptForProject(
  projectId: string,
  plaintext: string,
): Promise<string> {
  const key = await deriveProjectKey(projectId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `v1.${bytesToB64u(iv)}.${bytesToB64u(new Uint8Array(ct))}`;
}

export async function decryptForProject(
  projectId: string,
  ciphertext: string,
): Promise<string> {
  const parts = ciphertext.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    throw new Error("Unsupported signing ciphertext format");
  }
  const ivBytes = b64uToBytes(parts[1]);
  const ctBytes = b64uToBytes(parts[2]);
  const ivBuf = new ArrayBuffer(ivBytes.byteLength);
  new Uint8Array(ivBuf).set(ivBytes);
  const ctBuf = new ArrayBuffer(ctBytes.byteLength);
  new Uint8Array(ctBuf).set(ctBytes);
  const key = await deriveProjectKey(projectId);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBuf }, key, ctBuf);
  return new TextDecoder().decode(pt);
}
