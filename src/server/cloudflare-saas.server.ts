/**
 * Cloudflare for SaaS — Custom Hostnames API client.
 *
 * Used by /api/domains to register a customer's domain on our SaaS zone
 * (buildwithpetal.com), trigger automatic SSL via TXT validation, and poll
 * status. Only used server-side — uses the scoped CLOUDFLARE_API_TOKEN.
 *
 * Docs: https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/
 */

const CF_API = "https://api.cloudflare.com/client/v4";

export type CfHostname = {
  id: string;
  hostname: string;
  status: "active" | "pending" | "active_redeploying" | "moved" | "pending_deletion" | "pending_blocked" | "pending_migration" | "pending_provisioned" | "test_pending" | "test_active" | "test_active_apex" | "test_blocked" | "test_failed" | "provisioned" | "blocked";
  ssl: {
    method?: "txt" | "http" | "email";
    status:
      | "initializing"
      | "pending_validation"
      | "pending_issuance"
      | "pending_deployment"
      | "active"
      | "pending_deletion"
      | "deleted"
      | "deactivating"
      | "inactive"
      | "backup_issued"
      | "holding_deployment"
      | "expiring_soon";
    validation_records?: Array<{
      txt_name?: string;
      txt_value?: string;
      http_url?: string;
      http_body?: string;
    }>;
    validation_errors?: Array<{ message: string }>;
  };
  verification_errors?: string[];
};

type CfEnvelope<T> = {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: unknown[];
  result: T;
};

function getEnv() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_SAAS_ZONE_ID;
  if (!token || !zoneId) {
    throw new Error("Cloudflare for SaaS not configured");
  }
  return { token, zoneId };
}

async function cfFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { token } = getEnv();
  const res = await fetch(`${CF_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const json = (await res.json().catch(() => null)) as CfEnvelope<T> | null;
  if (!res.ok || !json?.success) {
    const msg =
      json?.errors?.map((e) => `${e.code}: ${e.message}`).join("; ") ||
      `Cloudflare API error (${res.status})`;
    throw new Error(msg);
  }
  return json.result;
}

/**
 * Register a custom hostname.
 *
 * `sslMethod`:
 *   - `"http"` (default) — correct Cloudflare for SaaS flow for normal
 *     customer hostnames. Once the A/CNAME points at Petal, Cloudflare serves
 *     the DCV token automatically and issues SSL without user-managed TXT.
 *   - `"txt"` — reserved for wildcard/pre-validation flows where HTTP DCV is
 *     not possible.
 */
export async function createCustomHostname(
  hostname: string,
  opts: { sslMethod?: "txt" | "http" } = {},
): Promise<CfHostname> {
  const { zoneId } = getEnv();
  return cfFetch<CfHostname>(`/zones/${zoneId}/custom_hostnames`, {
    method: "POST",
    body: JSON.stringify({
      hostname,
      ssl: {
        method: opts.sslMethod ?? "http",
        type: "dv",
        settings: {
          min_tls_version: "1.2",
        },
      },
    }),
  });
}

/**
 * Ask Cloudflare to re-run validation. Sending the same SSL config via PATCH
 * resets Cloudflare's validation backoff; it can also move older TXT-based
 * hostnames onto automatic HTTP DCV for non-wildcard domains.
 */
export async function recheckCustomHostname(
  id: string,
  opts: { sslMethod?: "txt" | "http" } = {},
): Promise<CfHostname> {
  const { zoneId } = getEnv();
  return cfFetch<CfHostname>(`/zones/${zoneId}/custom_hostnames/${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      ssl: {
        method: opts.sslMethod ?? "http",
        type: "dv",
        settings: {
          min_tls_version: "1.2",
        },
      },
    }),
  });
}

/** Poll a previously-registered hostname for its current status. */
export async function getCustomHostname(id: string): Promise<CfHostname> {
  const { zoneId } = getEnv();
  return cfFetch<CfHostname>(`/zones/${zoneId}/custom_hostnames/${id}`);
}

/** Remove a custom hostname when the user disconnects the domain. */
export async function deleteCustomHostname(id: string): Promise<void> {
  const { zoneId } = getEnv();
  await cfFetch<{ id: string }>(`/zones/${zoneId}/custom_hostnames/${id}`, {
    method: "DELETE",
  });
}

/**
 * Map a Cloudflare hostname status into our 6-state UI model.
 * Our UI states: pending | verifying | active | failed | offline | removed
 */
export function mapCfStatus(cf: CfHostname): {
  status: "pending" | "verifying" | "active" | "failed";
  ssl_status: string;
  error_message: string | null;
} {
  const sslStatus = cf.ssl?.status ?? "initializing";
  const errs = [
    ...(cf.ssl?.validation_errors?.map((e) => e.message) ?? []),
    ...(cf.verification_errors ?? []),
  ];
  const error_message = errs.length ? errs.join(" • ") : null;

  // Active = both hostname and SSL are active.
  if (cf.status === "active" && sslStatus === "active") {
    return { status: "active", ssl_status: sslStatus, error_message: null };
  }
  // Hostname says active but SSL still working = verifying.
  if (cf.status === "active") {
    return { status: "verifying", ssl_status: sslStatus, error_message };
  }
  // Anything containing "blocked" / "failed" = failed.
  if (cf.status.includes("blocked") || sslStatus.includes("deleted")) {
    return {
      status: "failed",
      ssl_status: sslStatus,
      error_message: error_message ?? "Hostname blocked by Cloudflare",
    };
  }
  // Anything pending = verifying (we've registered, waiting on DNS/SSL).
  return { status: "verifying", ssl_status: sslStatus, error_message };
}

/**
 * Extract the TXT validation record Cloudflare wants the user to add for SSL.
 * Returns null if Cloudflare hasn't issued one yet (it usually takes a few
 * seconds after createCustomHostname).
 */
export function extractTxtValidation(
  cf: CfHostname,
): { name: string; value: string } | null {
  const all = extractAllTxtValidations(cf);
  return all[0] ?? null;
}

/**
 * Extract ALL TXT validation records Cloudflare wants the user to add.
 * Cloudflare typically issues 2 records (RSA + ECDSA cert variants) under
 * the same `_acme-challenge.<host>` name with different values — both must
 * exist at the registrar simultaneously for SSL to validate.
 */
export function extractAllTxtValidations(
  cf: CfHostname,
): Array<{ name: string; value: string }> {
  const records = cf.ssl?.validation_records ?? [];
  const out: Array<{ name: string; value: string }> = [];
  const seen = new Set<string>();
  for (const r of records) {
    if (!r.txt_name || !r.txt_value) continue;
    const key = `${r.txt_name}\u0000${r.txt_value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: r.txt_name, value: r.txt_value });
  }
  return out;
}
