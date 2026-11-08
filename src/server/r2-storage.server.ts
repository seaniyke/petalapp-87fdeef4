/**
 * Cloudflare R2 file storage for shared-tier apps (zero egress fees).
 *
 * Files are written with a hand-rolled AWS SigV4 PUT (Web Crypto only, so it
 * runs on Workers) and served from the bucket's public URL. Every object key
 * starts with the owning project id, so one app can never overwrite another
 * app's files. Server-only.
 */

export const UPLOAD_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  allowedTypes: [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
    "application/pdf",
  ],
} as const;

const enc = new TextEncoder();

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  return hex(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

async function hmacRaw(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", k, enc.encode(msg));
}

/** Turns a user-supplied file name into a safe, short key segment. */
export function safeFileName(name: string | null | undefined): string {
  const cleaned = (name ?? "file")
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(-80);
  return cleaned || "file";
}

/** Object key: always namespaced by project. */
export function objectKeyFor(projectId: string, fileName: string, id: string): string {
  return `${projectId}/${id}-${safeFileName(fileName)}`;
}

type R2Config = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl: string;
};

export function r2Config(): R2Config | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const endpoint =
    process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  const cfg = {
    endpoint: endpoint.replace(/\/$/, ""),
    bucket: process.env.R2_BUCKET_NAME || "petal-uploads",
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    publicUrl: (process.env.R2_PUBLIC_URL || "").replace(/\/$/, ""),
  };
  if (!cfg.endpoint || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.publicUrl) return null;
  return cfg;
}

function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

/** Signed S3 request to R2 (region "auto"). */
async function signedFetch(
  cfg: R2Config,
  method: "PUT" | "DELETE",
  key: string,
  body: Uint8Array | null,
  contentType?: string,
): Promise<Response> {
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${encodeKey(key)}`);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(body ?? new Uint8Array());

  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) headers["content-type"] = contentType;

  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headers[h]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    method,
    url.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  let k = await hmacRaw(enc.encode("AWS4" + cfg.secretAccessKey), dateStamp);
  k = await hmacRaw(k, "auto");
  k = await hmacRaw(k, "s3");
  k = await hmacRaw(k, "aws4_request");
  const signature = hex(await hmacRaw(k, stringToSign));

  const { host: _host, ...sendHeaders } = headers;
  return fetch(url.toString(), {
    method,
    headers: {
      ...sendHeaders,
      Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: body as BodyInit | null,
  });
}

export type UploadResult = { key: string; url: string; size: number; contentType: string };

export async function uploadProjectFile(input: {
  projectId: string;
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}): Promise<UploadResult> {
  const cfg = r2Config();
  if (!cfg) throw new Error("File uploads are not set up yet.");
  const key = objectKeyFor(input.projectId, input.fileName, crypto.randomUUID());
  const res = await signedFetch(cfg, "PUT", key, input.bytes, input.contentType);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`R2 upload failed [${res.status}]: ${text.slice(0, 500)}`);
    throw new Error("Upload failed. Please try again.");
  }
  return {
    key,
    url: `${cfg.publicUrl}/${encodeKey(key)}`,
    size: input.bytes.byteLength,
    contentType: input.contentType,
  };
}

/** Deletes a file — only when the key belongs to this project. */
export async function deleteProjectFile(projectId: string, key: string): Promise<boolean> {
  if (!key.startsWith(projectId + "/") || key.includes("..")) return false;
  const cfg = r2Config();
  if (!cfg) throw new Error("File uploads are not set up yet.");
  const res = await signedFetch(cfg, "DELETE", key, null);
  return res.ok || res.status === 404;
}
