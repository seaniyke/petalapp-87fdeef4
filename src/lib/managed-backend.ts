/**
 * Helpers for buying / managing the "Petal-managed Supabase backend" add-on.
 *
 * One slot = 30 days. After expiry the underlying Supabase project is paused;
 * a new slot reactivates it.
 */
import { supabase } from "@/integrations/supabase/client";

export const MANAGED_BACKEND_ADDON_CODE = "managed_backend_monthly";

export type BackendAddon = {
  code: string;
  name: string;
  description: string | null;
  price_cents: number;
  duration_days: number;
};

export type BackendSlot = {
  id: string;
  project_id: string;
  addon_code: string;
  purchased_at: string;
  expires_at: string;
  status: "active" | "expired" | "cancelled";
};

/** Catalog row for the managed-backend monthly add-on. */
export async function fetchBackendSlotAddon(): Promise<BackendAddon | null> {
  const { data, error } = await supabase
    .from("billing_addons")
    .select("code, name, description, price_cents, duration_days")
    .eq("code", MANAGED_BACKEND_ADDON_CODE)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return (data as BackendAddon | null) ?? null;
}

/** Slots for this project, newest expiry first. */
export async function listBackendSlots(projectId: string): Promise<BackendSlot[]> {
  const { data, error } = await supabase
    .from("backend_slots")
    .select("id, project_id, addon_code, purchased_at, expires_at, status")
    .eq("project_id", projectId)
    .order("expires_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as BackendSlot[];
}

/** Start a Paystack checkout for one 30-day backend slot. */
export async function purchaseBackendSlot(args: {
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
      itemCode: MANAGED_BACKEND_ADDON_CODE,
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
