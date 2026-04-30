/**
 * Cloudflare Zone helpers — for domains we registered through Cloudflare
 * Registrar. After registration, Cloudflare auto-creates a zone in our
 * account for the new domain (it has to, because Registrar enforces
 * Cloudflare nameservers). We then need to:
 *
 *   1. Find that zone by name.
 *   2. Add CNAME records (apex via flattening + www) pointing at
 *      CLOUDFLARE_FALLBACK_ORIGIN, our SaaS edge.
 *   3. Cloudflare for SaaS picks it up via the custom-hostname we register
 *      on our SaaS zone (see cloudflare-saas.server.ts).
 *
 * Docs:
 *   - https://developers.cloudflare.com/api/operations/zones-get
 *   - https://developers.cloudflare.com/api/operations/dns-records-for-a-zone-create-dns-record
 *   - https://developers.cloudflare.com/dns/cname-flattening/
 */

const CF_API = "https://api.cloudflare.com/client/v4";

type CfEnvelope<T> = {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: unknown[];
  result: T;
};

function getEnv() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const fallback = process.env.CLOUDFLARE_FALLBACK_ORIGIN;
  if (!token || !accountId || !fallback) {
    throw new Error("Cloudflare zone helper not configured");
  }
  return { token, accountId, fallback };
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
      `Cloudflare zone error (${res.status})`;
    throw new Error(msg);
  }
  return json.result;
}

/** Look up a zone we own by exact name. Returns null if none. */
export async function findZoneByName(name: string): Promise<{ id: string; name: string } | null> {
  const { accountId } = getEnv();
  const result = await cfFetch<Array<{ id: string; name: string }>>(
    `/zones?name=${encodeURIComponent(name)}&account.id=${encodeURIComponent(accountId)}`,
  );
  return result?.[0] ?? null;
}

/**
 * Create a Cloudflare DNS zone in our account for `name`.
 *
 * Cloudflare Registrar does NOT auto-create a zone in your account when a
 * domain is registered (the API returns `cloudflare_dns: false`). We have
 * to provision the zone ourselves before any DNS work — including SaaS
 * hostname routing — can happen.
 *
 * Idempotent: if the zone already exists in our account, we just return it.
 * Requires the API token to have `Account → Zone: Edit`.
 */
export async function ensureZoneForRegistrarDomain(name: string): Promise<{
  id: string;
  name: string;
  created: boolean;
}> {
  const existing = await findZoneByName(name);
  if (existing) return { ...existing, created: false };

  const { accountId } = getEnv();
  try {
    const result = await cfFetch<{ id: string; name: string }>("/zones", {
      method: "POST",
      body: JSON.stringify({
        name,
        account: { id: accountId },
        type: "full",
      }),
    });
    return { id: result.id, name: result.name, created: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Race: another request created it between findZoneByName and POST.
    if (/already exists|1061/i.test(msg)) {
      const after = await findZoneByName(name);
      if (after) return { ...after, created: false };
    }
    if (/zone\.create|permission/i.test(msg)) {
      throw new Error(
        `Couldn't create the DNS zone for ${name}. The Cloudflare API token is missing the "Account → Zone: Edit" permission.`,
      );
    }
    throw e;
  }
}


type DnsRecordType = "A" | "AAAA" | "CNAME" | "TXT" | "MX";

type CfDnsRecord = { id: string; name: string; type: DnsRecordType; content: string };

async function listRecords(zoneId: string, name: string): Promise<CfDnsRecord[]> {
  return cfFetch<CfDnsRecord[]>(
    `/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}`,
  );
}

async function deleteRecord(zoneId: string, recordId: string): Promise<void> {
  await cfFetch<{ id: string }>(`/zones/${zoneId}/dns_records/${recordId}`, {
    method: "DELETE",
  });
}

async function createRecord(
  zoneId: string,
  args: { name: string; type: DnsRecordType; content: string; proxied?: boolean; ttl?: number },
): Promise<CfDnsRecord> {
  return cfFetch<CfDnsRecord>(`/zones/${zoneId}/dns_records`, {
    method: "POST",
    body: JSON.stringify({
      type: args.type,
      name: args.name,
      content: args.content,
      ttl: args.ttl ?? 1, // 1 = "automatic" in CF
      proxied: args.proxied ?? true,
    }),
  });
}

/**
 * For a freshly-registered Registrar domain, point apex (`@`) and `www` at
 * our SaaS fallback origin so Cloudflare for SaaS routes traffic correctly.
 *
 * We use proxied CNAMEs at the apex (CNAME flattening is automatic on
 * Cloudflare zones) so customers don't need IP addresses. Idempotent: any
 * existing records for these names are removed first.
 */
export async function pointZoneAtSaas(args: { hostname: string }): Promise<{
  zoneId: string;
}> {
  const { fallback } = getEnv();
  // Provision the zone if Cloudflare Registrar didn't (it never does for new
  // registrations — `cloudflare_dns` stays false until we POST /zones).
  const zone = await ensureZoneForRegistrarDomain(args.hostname);

  // Replace apex + www with proxied CNAMEs to our SaaS edge.
  for (const name of [args.hostname, `www.${args.hostname}`]) {
    const existing = await listRecords(zone.id, name);
    for (const r of existing) {
      if (r.type === "A" || r.type === "AAAA" || r.type === "CNAME") {
        await deleteRecord(zone.id, r.id);
      }
    }
    await createRecord(zone.id, {
      name,
      type: "CNAME",
      content: fallback,
      proxied: true,
    });
  }

  return { zoneId: zone.id };
}
