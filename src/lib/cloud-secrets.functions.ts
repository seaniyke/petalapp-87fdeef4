/**
 * Cloud panel — Secrets view server functions.
 * Lists, creates and deletes encrypted environment secrets stored in
 * `project_secrets`. Values are never returned to the client — only names
 * and timestamps.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { encryptSecret } from "./secrets/crypto.server";
import { assertOwnsProject } from "@/server/cloud-managed-client.server";

const VALID = /^[A-Z][A-Z0-9_]{0,79}$/;
function normalize(name: string): string {
  return name.trim().toUpperCase();
}

export type CloudSecretRow = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

const ListInput = z.object({ projectId: z.string().uuid() });

export const listProjectSecrets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => ListInput.parse(data))
  .handler(async ({ data, context }): Promise<{ secrets: CloudSecretRow[] }> => {
    const { supabase, userId } = context;
    await assertOwnsProject(supabase, data.projectId, userId);

    const { data: rows, error } = await supabaseAdmin
      .from("project_secrets")
      .select("id, name, created_at, updated_at")
      .eq("project_id", data.projectId)
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);

    return {
      secrets: (rows ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    };
  });

const UpsertInput = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(80),
  value: z.string().min(1).max(8000),
});

export const upsertProjectSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => UpsertInput.parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    await assertOwnsProject(supabase, data.projectId, userId);

    const name = normalize(data.name);
    if (!VALID.test(name)) {
      throw new Error(
        "Names must be UPPERCASE, start with a letter and contain only A–Z, 0–9 or _.",
      );
    }

    const { error } = await supabaseAdmin
      .from("project_secrets")
      .upsert(
        {
          project_id: data.projectId,
          name,
          ciphertext: encryptSecret(data.value),
        },
        { onConflict: "project_id,name" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const DeleteInput = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(80),
});

export const deleteProjectSecret = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => DeleteInput.parse(data))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    await assertOwnsProject(supabase, data.projectId, userId);
    const name = normalize(data.name);
    const { error } = await supabaseAdmin
      .from("project_secrets")
      .delete()
      .eq("project_id", data.projectId)
      .eq("name", name);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
