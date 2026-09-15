import { getSupabaseAccessToken } from "@/lib/auth-token";

export type CreditPause = { id: string; turnId: string; projectId: string; requiredCredits: number; status: "awaiting_credits" | "parked"; createdAt: string };

async function request(path: string, init?: RequestInit) {
  const token = await getSupabaseAccessToken();
  if (!token) throw new Error("Not signed in");
  return fetch(path, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${token}` } });
}

export async function getCreditPause(projectId: string): Promise<CreditPause | null> {
  const res = await request(`/api/credit-pauses?projectId=${encodeURIComponent(projectId)}`);
  if (!res.ok) return null;
  const json = await res.json() as { pauses?: CreditPause[] };
  return json.pauses?.[0] ?? null;
}

export async function updateCreditPause(id: string, action: "park" | "resume"): Promise<{ ok: boolean; reason?: string }> {
  const res = await request("/api/credit-pauses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action }) });
  if (!res.ok) return { ok: false };
  return res.json() as Promise<{ ok: boolean; reason?: string }>;
}