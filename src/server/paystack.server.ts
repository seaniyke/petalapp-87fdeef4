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
  /** Paystack plan code (PLN_xxx). When set, this transaction creates a subscription. */
  plan?: string;
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
      // When `plan` is set, Paystack overrides `amount` with the plan's price
      // and creates a subscription on charge.success. We still pass amount as
      // a sanity floor so test mode doesn't reject the request.
      ...(args.plan ? { plan: args.plan } : {}),
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

export type VerifiedTransaction = {
  status: "success" | "failed" | "abandoned" | string;
  reference: string;
  amount: number;
  currency: string;
  channel: string | null;
  paid_at: string | null;
  customer: { email: string };
  metadata: Record<string, unknown> | string | null;
};

type VerifyResponse = {
  status: boolean;
  message: string;
  data?: VerifiedTransaction;
};

export async function verifyTransaction(reference: string): Promise<VerifiedTransaction | undefined> {
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

// ──────────────────────────────────────────────────────────────────────────────
// Subscriptions
// ──────────────────────────────────────────────────────────────────────────────

type PaystackOk<T> = { status: boolean; message: string; data?: T };

async function paystackGet<T>(path: string): Promise<T> {
  const res = await fetch(`${PAYSTACK_API}${path}`, {
    headers: { Authorization: `Bearer ${getSecret()}` },
  });
  const json = (await res.json()) as PaystackOk<T>;
  if (!res.ok || !json.status || json.data === undefined) {
    throw new Error(`Paystack GET ${path} failed: ${json.message || res.status}`);
  }
  return json.data;
}

async function paystackPost<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${PAYSTACK_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getSecret()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as PaystackOk<T>;
  if (!res.ok || !json.status) {
    throw new Error(`Paystack POST ${path} failed: ${json.message || res.status}`);
  }
  return (json.data ?? ({} as T)) as T;
}

export type CreatePlanArgs = {
  name: string;
  amountMinor: number;
  currency: string;
  /** monthly | annually | weekly | daily ... */
  interval: string;
};

export async function createPlan(args: CreatePlanArgs): Promise<{ plan_code: string }> {
  return paystackPost<{ plan_code: string }>("/plan", {
    name: args.name,
    amount: args.amountMinor,
    currency: args.currency,
    interval: args.interval,
  });
}

export type PaystackSubscription = {
  id: number;
  subscription_code: string;
  email_token: string;
  status: string;
  next_payment_date: string | null;
  amount: number;
  customer: { id: number; customer_code: string; email: string };
  plan: { plan_code: string; interval: string; amount: number; currency: string };
  authorization?: { authorization_code: string };
};

export async function fetchSubscription(code: string): Promise<PaystackSubscription> {
  return paystackGet<PaystackSubscription>(`/subscription/${encodeURIComponent(code)}`);
}

/**
 * Hosted page where the customer can swap card / cancel. Paystack tokenizes
 * (and refunds) a small charge during card add.
 */
export async function getSubscriptionManageLink(code: string): Promise<string> {
  const data = await paystackGet<{ link: string }>(
    `/subscription/${encodeURIComponent(code)}/manage/link`,
  );
  return data.link;
}

/**
 * Disable a subscription. Stays active until next_payment_date, then
 * subscription.disable webhook fires.
 */
export async function disableSubscription(
  code: string,
  emailToken: string,
): Promise<void> {
  await paystackPost("/subscription/disable", { code, token: emailToken });
}

/**
 * Verify variant that returns the full payload including authorization +
 * customer + (optional) subscription block. Used by the webhook on the very
 * first charge of a subscription, when subscription.create may arrive before
 * we have all the auth/customer info we need on the subscriptions row.
 */
export type FullVerifiedTransaction = VerifiedTransaction & {
  authorization?: { authorization_code: string };
  customer: { email: string; customer_code?: string; id?: number };
  plan_object?: { plan_code: string };
};

export async function verifyTransactionFull(
  reference: string,
): Promise<FullVerifiedTransaction | undefined> {
  const res = await fetch(
    `${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`,
    { headers: { Authorization: `Bearer ${getSecret()}` } },
  );
  const json = (await res.json()) as PaystackOk<FullVerifiedTransaction>;
  if (!res.ok || !json.status || !json.data) {
    throw new Error(`Paystack verify failed: ${json.message || res.status}`);
  }
  return json.data;
}
