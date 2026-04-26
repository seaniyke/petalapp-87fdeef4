import { supabase } from "@/integrations/supabase/client";

export type ProjectDomain = {
  id: string;
  hostname: string;
  status: "pending" | "verifying" | "active" | "failed" | "offline" | "removed";
  is_primary: boolean;
  verification_txt_name: string;
  verification_txt_value: string;
  ssl_status: string | null;
  last_checked_at: string | null;
  error_message: string | null;
  created_at: string;
  provider_hostname_id: string | null;
};

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
