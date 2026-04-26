/**
 * Paystack server SDK wrapper.
 *
 * One PAYSTACK_SECRET_KEY env var works for both test (sk_test_...) and
 * live (sk_live_...) keys. The same key signs webhook events with
 * HMAC-SHA512 (Paystack's standard).
 */

const PAYSTACK_API = "https://api.paystack.co";

function getSecret(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("PAYSTACK_SECRET_KEY is not configured");
  return key;
}

export function getEnvironment(): "test" | "live" {
  const key = process.env.PAYSTACK_SECRET_KEY ?? "";
  return key.startsWith("sk_live_") ? "live" : "test";
}

type InitArgs = {
  email: string;
  amountMinor: number; // kobo / pesewas / cents in the chosen currency
  currency: string;
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
};

type InitResponse = {
  status: boolean;
  message: string;
  data?: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
};

export async function initializeTransaction(args: InitArgs): Promise<{
  authorizationUrl: string;
  reference: string;
  accessCode: string;
}> {
  const res = await fetch(`${PAYSTACK_API}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getSecret()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: args.email,
      amount: args.amountMinor,
      currency: args.currency,
      reference: args.reference,
      callback_url: args.callbackUrl,
      metadata: args.metadata ?? {},
    }),
  });
  const json = (await res.json()) as InitResponse;
  if (!res.ok || !json.status || !json.data) {
    throw new Error(`Paystack initialize failed: ${json.message || res.status}`);
  }
  return {
    authorizationUrl: json.data.authorization_url,
    reference: json.data.reference,
    accessCode: json.data.access_code,
  };
}

type VerifyResponse = {
  status: boolean;
  message: string;
  data?: {
    status: "success" | "failed" | "abandoned" | string;
    reference: string;
    amount: number;
    currency: string;
    channel: string | null;
    paid_at: string | null;
    customer: { email: string };
    metadata: Record<string, unknown> | string | null;
  };
};

export async function verifyTransaction(reference: string): Promise<VerifyResponse["data"]> {
  const res = await fetch(
    `${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`,
    {
      headers: { Authorization: `Bearer ${getSecret()}` },
    },
  );
  const json = (await res.json()) as VerifyResponse;
  if (!res.ok || !json.status || !json.data) {
    throw new Error(`Paystack verify failed: ${json.message || res.status}`);
  }
  return json.data;
}

/**
 * Verify an x-paystack-signature header. Paystack signs the raw request body
 * with HMAC-SHA512 using your secret key.
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const secret = getSecret();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  const expected = Array.from(new Uint8Array(signed))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // Constant-time compare
  if (expected.length !== signatureHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  }
  return diff === 0;
}
