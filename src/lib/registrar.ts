/**
 * Client helpers for the registrar (Buy a domain) flow.
 */
import { supabase } from "@/integrations/supabase/client";

export type DomainSearchResult = {
  hostname: string;
  available: boolean;
  /** What the user pays in USD cents (wholesale × 1.25). null if unavailable. */
  priceCents: number | null;
};

async function authedFetch(path: string, body: unknown): Promise<Response> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Not signed in");
  return fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

export async function searchDomains(query: string): Promise<DomainSearchResult[]> {
  const resp = await authedFetch("/api/registrar/search", { query });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `Search failed (${resp.status})`);
  }
  return (await resp.json()) as DomainSearchResult[];
}

export async function purchaseDomain(args: {
  projectId: string;
  hostname: string;
  currency: string;
  returnUrl: string;
}): Promise<{ authorizationUrl: string; reference: string }> {
  const resp = await authedFetch("/api/registrar/purchase", args);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `Couldn't start checkout (${resp.status})`);
  }
  return (await resp.json()) as { authorizationUrl: string; reference: string };
}

/** Pretty-print USD cents as $X.XX. */
export function formatUsdCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
