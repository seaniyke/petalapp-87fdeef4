import { supabase } from "@/integrations/supabase/client";

export type DomainTxtRecord = { name: string; value: string };

export type ProjectDomain = {
  id: string;
  hostname: string;
  status: "pending" | "verifying" | "active" | "failed" | "offline" | "removed";
  is_primary: boolean;
  verification_txt_name: string;
  verification_txt_value: string;
  /**
   * All TXT records required for SSL validation. Cloudflare typically returns
   * 2 (RSA + ECDSA cert variants) under the same _acme-challenge name with
   * different values — both must be added at the registrar. Falls back to the
   * single legacy field when empty (older domain rows pre-migration).
   */
  verification_records: DomainTxtRecord[];
  ssl_status: string | null;
  last_checked_at: string | null;
  error_message: string | null;
  created_at: string;
  provider_hostname_id: string | null;
};

export type DomainSlot = {
  id: string;
  project_id: string;
  addon_code: string;
  purchased_at: string;
  expires_at: string;
  consumed_by_domain_id: string | null;
};

export type DomainAddon = {
  code: string;
  name: string;
  description: string | null;
  price_cents: number;
  duration_days: number;
};

/**
 * Thrown when an action requires a paid domain slot the user doesn't have.
 * The UI should open the BuyDomainSlotDialog in response.
 */
export class DomainSlotRequiredError extends Error {
  code = "no_domain_slot" as const;
  constructor(message?: string) {
    super(message ?? "A domain slot is required to add a custom domain.");
    this.name = "DomainSlotRequiredError";
  }
}

/**
 * The CNAME target customers point their domain at. Cloudflare for SaaS uses
 * our fallback hostname as the CNAME target (Free plan model).
 */
export const PETAL_DOMAIN_CNAME_TARGET = "fallback.buildwithpetal.com";

/** @deprecated Kept for back-compat — prefer PETAL_DOMAIN_CNAME_TARGET. */
export const PETAL_DOMAIN_A_RECORD = "185.158.133.1";

type Action = "list" | "add" | "verify" | "set-primary" | "remove";

async function call<T>(action: Action, body: unknown): Promise<T> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const resp = await fetch(`/api/domains?action=${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    // 402 = needs to buy a domain slot.
    if (resp.status === 402) {
      let message = "A domain slot is required.";
      try {
        const j = (await resp.json()) as { message?: string };
        if (j?.message) message = j.message;
      } catch {
        /* ignore */
      }
      throw new DomainSlotRequiredError(message);
    }
    const text = await resp.text().catch(() => "");
    throw new Error(text || `Request failed (${resp.status})`);
  }
  return (await resp.json()) as T;
}

export const listDomains = (projectId: string) =>
  call<ProjectDomain[]>("list", { projectId });

export const addDomain = (projectId: string, hostname: string) =>
  call<ProjectDomain>("add", { projectId, hostname });

export const verifyDomain = (projectId: string, domainId: string) =>
  call<ProjectDomain>("verify", { projectId, domainId });

export const setPrimaryDomain = (projectId: string, domainId: string) =>
  call<ProjectDomain>("set-primary", { projectId, domainId });

export const removeDomain = (projectId: string, domainId: string) =>
  call<{ ok: true }>("remove", { projectId, domainId });

/* -------------------- DNS sanity check -------------------- */

export type DnsCheckRecord = {
  kind: "routing" | "txt";
  type: "A" | "CNAME" | "TXT";
  host: string;
  expected: string;
  found: string[];
  status: "ok" | "missing" | "wrong";
  hint: string | null;
};

export type DnsCheckResult = {
  checkedAt: string;
  allOk: boolean;
  routing: DnsCheckRecord;
  txts: DnsCheckRecord[];
};

export async function checkDomainDns(
  projectId: string,
  domainId: string,
): Promise<DnsCheckResult> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const resp = await fetch("/api/domains/dns-check", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ projectId, domainId }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `DNS check failed (${resp.status})`);
  }
  return (await resp.json()) as DnsCheckResult;
}

/* -------------------- Domain slots (paywall helpers) -------------------- */

/** List slots for a project (unexpired or recently expired, newest first). */
export async function listDomainSlots(projectId: string): Promise<DomainSlot[]> {
  const { data, error } = await supabase
    .from("domain_slots")
    .select("id, project_id, addon_code, purchased_at, expires_at, consumed_by_domain_id")
    .eq("project_id", projectId)
    .order("expires_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as DomainSlot[];
}

/** Fetch the public catalog row for the domain-slot add-on. */
export async function fetchDomainSlotAddon(): Promise<DomainAddon | null> {
  const { data, error } = await supabase
    .from("billing_addons")
    .select("code, name, description, price_cents, duration_days")
    .eq("code", "domain_slot")
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return (data as DomainAddon | null) ?? null;
}

/**
 * Start a Paystack checkout to buy one domain slot for the given project.
 * Returns the authorization URL the caller should redirect to.
 */
export async function purchaseDomainSlot(args: {
  projectId: string;
  currency: string;
  returnUrl: string;
}): Promise<{ authorizationUrl: string; reference: string }> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const resp = await fetch("/api/billing/initialize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      purpose: "addon",
      itemCode: "domain_slot",
      currency: args.currency,
      returnUrl: args.returnUrl,
      projectId: args.projectId,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `Couldn't start checkout (${resp.status})`);
  }
  return (await resp.json()) as { authorizationUrl: string; reference: string };
}
