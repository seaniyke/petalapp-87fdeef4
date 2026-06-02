/**
 * Public server functions for the secret-request workflow. These are safe
 * to call from React components — the build replaces the body with an RPC
 * stub on the client.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isValidSecretName, normalizeSecretName, createPendingSecretRequest } from "@/server/secrets/requests.server";
import { encryptSecret } from "@/server/secrets/crypto.server";

const CreateInput = z.object({
  projectId: z.string().uuid(),
  conversationId: z.string().max(200).nullable().optional(),
  secretName: z.string().min(1).max(80),
  instructions: z.string().max(2000).optional(),
  link: z.string().max(500).optional(),
});

/**
 * Called by the chat UI when it first sees a `<lov-add-secret>` tag streamed
 * by the AI. Returns the request id so the inline form can submit fulfilment.
 */
export const createSecretRequestFromChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => CreateInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const owned = await supabase
      .from("projects")
      .select("id")
      .eq("id", data.projectId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (!owned.data) throw new Error("Not your project.");
    const row = await createPendingSecretRequest({
      projectId: data.projectId,
      conversationId: data.conversationId ?? null,
      secretName: data.secretName,
      instructions: data.instructions,
      link: data.link,
    });
    return { request: row };
  });

const ListInput = z.object({ projectId: z.string().uuid() });

export const listPendingSecretRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => ListInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Ownership check via RLS-aware client.
    const owned = await supabase
      .from("projects")
      .select("id")
      .eq("id", data.projectId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (!owned.data) return { requests: [] };

    const { data: rows } = await supabaseAdmin
      .from("pending_secret_requests")
      .select("*")
      .eq("project_id", data.projectId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    return { requests: rows ?? [] };
  });

const FulfillInput = z.object({
  requestId: z.string().uuid(),
  value: z.string().min(1).max(8000),
});

export const fulfillSecretRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => FulfillInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Ownership check via RLS — read the request as the user.
    const req = await supabase
      .from("pending_secret_requests")
      .select("id, project_id, secret_name, status")
      .eq("id", data.requestId)
      .maybeSingle();
    if (!req.data) throw new Error("Request not found or not yours.");
    if (req.data.status !== "pending") {
      return { ok: true, alreadyFulfilled: true };
    }

    // Confirm project ownership defensively (RLS already covers this).
    const proj = await supabase
      .from("projects")
      .select("id")
      .eq("id", req.data.project_id)
      .eq("owner_id", userId)
      .maybeSingle();
    if (!proj.data) throw new Error("Not your project.");

    const name = normalizeSecretName(req.data.secret_name);
    if (!isValidSecretName(name)) throw new Error("Bad secret name.");

    // Store the encrypted value in `project_secrets`. Upsert so re-running
    // overwrites the previous value rather than failing on the unique key.
    const { error: upsertErr } = await supabaseAdmin
      .from("project_secrets")
      .upsert(
        {
          project_id: req.data.project_id,
          name,
          ciphertext: encryptSecret(data.value),
        },
        { onConflict: "project_id,name" },
      );
    if (upsertErr) throw upsertErr;

    await supabaseAdmin
      .from("pending_secret_requests")
      .update({ status: "fulfilled", fulfilled_at: new Date().toISOString() })
      .eq("id", req.data.id);

    return { ok: true, alreadyFulfilled: false };
  });

const CancelInput = z.object({ requestId: z.string().uuid() });

export const cancelSecretRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => CancelInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const req = await supabase
      .from("pending_secret_requests")
      .select("id, status")
      .eq("id", data.requestId)
      .maybeSingle();
    if (!req.data) throw new Error("Request not found.");
    if (req.data.status === "pending") {
      await supabaseAdmin
        .from("pending_secret_requests")
        .update({ status: "cancelled" })
        .eq("id", req.data.id);
    }
    return { ok: true };
  });
