/**
 * Client helpers for `/api/subdomain` — claim/check/release a Petal subdomain
 * (`<slug>.buildwithpetal.com`) for a project.
 */
import { supabase } from "@/integrations/supabase/client";

export const PETAL_ROOT_DOMAIN = "buildwithpetal.com";

export type CheckResult = {
  available: boolean;
  reason: string | null;
  hostname?: string;
};

export type ClaimResult = {
  hostname: string;
  slug: string;
  status: "active" | "verifying" | "pending" | "failed";
};

type Action = "check" | "claim" | "release";

async function call<T>(action: Action, body: unknown): Promise<T> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const resp = await fetch(`/api/subdomain?action=${action}`, {
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

export const checkSubdomain = (projectId: string, slug: string) =>
  call<CheckResult>("check", { projectId, slug });

export const claimSubdomain = (projectId: string, slug: string) =>
  call<ClaimResult>("claim", { projectId, slug });

export const releaseSubdomain = (projectId: string) =>
  call<{ ok: true }>("release", { projectId });

/**
 * Pure suggestion helper — mirrors `suggestSlugFromTitle` on the server so
 * the UI can pre-fill an editable default without a round-trip.
 */
export function suggestSlugFromTitle(title: string | null | undefined): string {
  const base = (title ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 40);
  const rand = Math.random().toString(36).slice(2, 8);
  if (base.length === 0) return `petal-app-${rand}`;
  if (base.length < 3) return `${base}-${rand}`.slice(0, 40);
  return base;
}
