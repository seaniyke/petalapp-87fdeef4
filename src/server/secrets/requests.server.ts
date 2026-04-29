/**
 * Server-only helpers for the mid-conversation secret request flow.
 *
 * Petal uses these when it streams a `<lov-add-secret name="..." />` tag:
 * a row is inserted into `pending_secret_requests`, the chat UI renders
 * an inline secure input, and the user fulfils it from there. Values are
 * stored as project secrets via the same path the marketplace already uses.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type PendingSecretRequest = {
  id: string;
  project_id: string;
  conversation_id: string | null;
  secret_name: string;
  instructions: string | null;
  link: string | null;
  status: "pending" | "fulfilled" | "cancelled";
  created_at: string;
  fulfilled_at: string | null;
};

const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

export function normalizeSecretName(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

export function isValidSecretName(name: string): boolean {
  return SECRET_NAME_RE.test(name);
}

/** Insert a pending request. Idempotent on (project_id, secret_name) while still pending. */
export async function createPendingSecretRequest(args: {
  projectId: string;
  conversationId?: string | null;
  secretName: string;
  instructions?: string;
  link?: string;
}): Promise<PendingSecretRequest> {
  const name = normalizeSecretName(args.secretName);
  if (!isValidSecretName(name)) {
    throw new Error("Invalid secret name; must be UPPER_SNAKE_CASE and ≤ 64 chars.");
  }

  // Reuse an open request if one already exists for the same key.
  const existing = await supabaseAdmin
    .from("pending_secret_requests")
    .select("*")
    .eq("project_id", args.projectId)
    .eq("secret_name", name)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing.data) return existing.data as PendingSecretRequest;

  const { data, error } = await supabaseAdmin
    .from("pending_secret_requests")
    .insert({
      project_id: args.projectId,
      conversation_id: args.conversationId ?? null,
      secret_name: name,
      instructions: args.instructions?.slice(0, 2000) ?? null,
      link: args.link?.slice(0, 500) ?? null,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as PendingSecretRequest;
}
