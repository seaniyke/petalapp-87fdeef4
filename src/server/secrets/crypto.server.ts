/**
 * AES-256-GCM helpers for project secrets. Shared between the marketplace
 * installer and the mid-conversation secret-request flow so we have ONE
 * encryption format to audit.
 *
 * Key derivation: SHA-256 of `PETAL_INTEGRATION_SECRET_KEY` (any length).
 * Ciphertext format: `v1:<iv-hex>:<tag-hex>:<ct-hex>`
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function getKey(): Buffer {
  const k =
    process.env.PETAL_INTEGRATION_SECRET_KEY ??
    "dev-only-petal-integration-key-change-me";
  return createHash("sha256").update(k).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${ct.toString("hex")}`;
}

export function decryptSecret(payload: string): string | null {
  if (!payload.startsWith("v1:")) return null;
  const [, ivHex, tagHex, ctHex] = payload.split(":");
  if (!ivHex || !tagHex || !ctHex) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      getKey(),
      Buffer.from(ivHex, "hex"),
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const pt = Buffer.concat([
      decipher.update(Buffer.from(ctHex, "hex")),
      decipher.final(),
    ]);
    return pt.toString("utf8");
  } catch {
    return null;
  }
}
