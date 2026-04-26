/**
 * BYO backend connector — v1 of the hybrid backend story.
 *
 * Lets a user attach an existing Supabase project to one of their Petal
 * projects. The credentials are stored in `project_backends` and injected
 * into generated apps via `backend-kit.ts` on the next AI generation.
 *
 * v2 will add a managed provisioner that writes to the same table with
 * `provider='managed_supabase'`. Generated apps and downstream code are
 * unchanged — that's the point of the abstraction.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SUPABASE_URL_RE = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i;

const ConnectInput = z.object({
  projectId: z.string().uuid(),
  supabaseUrl: z
    .string()
    .trim()
    .regex(SUPABASE_URL_RE, "Must look like https://xxx.supabase.co"),
  anonKey: z.string().trim().min(20, "Anon key looks too short"),
  serviceRoleKey: z.string().trim().min(20).optional().or(z.literal("")),
});

export type BackendStatus = {
  status: "connecting" | "ready" | "failed" | "paused";
  provider: "byo_supabase" | "managed_supabase";
  supabaseUrl: string;
  anonKey: string;
  errorMessage: string | null;
} | null;

/** Strip trailing slash from a Supabase URL. */
function normalizeUrl(u: string): string {
  return u.replace(/\/+$/, "");
}

/** Verify the user owns the project. Throws Response on failure. */
async function assertOwnsProject(projectId: string, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select("id, owner_id")
    .eq("id", projectId)
    .maybeSingle();
  if (error) throw new Response(error.message, { status: 500 });
  if (!data) throw new Response("Project not found", { status: 404 });
  if (data.owner_id !== userId) throw new Response("Forbidden", { status: 403 });
}

export const connectByoBackend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ConnectInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertOwnsProject(data.projectId, context.userId);
    const url = normalizeUrl(data.supabaseUrl);

    // Validate the credentials with a lightweight call. The auth health
    // endpoint accepts the anon key as bearer and returns 200 quickly.
    let healthOk = false;
    let errorMessage: string | null = null;
    try {
      const res = await fetch(`${url}/auth/v1/health`, {
        headers: {
          apikey: data.anonKey,
          authorization: `Bearer ${data.anonKey}`,
        },
      });
      healthOk = res.ok;
      if (!healthOk) errorMessage = `Health check failed (${res.status})`;
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : "Health check failed";
    }

    if (!healthOk) {
      throw new Response(
        errorMessage ?? "Could not reach the backend with those credentials.",
        { status: 400 },
      );
    }

    const { error: upsertErr } = await supabaseAdmin
      .from("project_backends")
      .upsert(
        {
          project_id: data.projectId,
          provider: "byo_supabase",
          status: "ready",
          supabase_url: url,
          anon_key: data.anonKey,
          service_role_key: data.serviceRoleKey?.trim() || null,
          health_checked_at: new Date().toISOString(),
          error_message: null,
        },
        { onConflict: "project_id" },
      );
    if (upsertErr) throw new Response(upsertErr.message, { status: 500 });

    return {
      status: "ready" as const,
      provider: "byo_supabase" as const,
      supabaseUrl: url,
      anonKey: data.anonKey,
      errorMessage: null,
    };
  });

export const getBackendStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<BackendStatus> => {
    await assertOwnsProject(data.projectId, context.userId);
    const { data: row, error } = await supabaseAdmin
      .from("project_backends")
      .select("status, provider, supabase_url, anon_key, error_message")
      .eq("project_id", data.projectId)
      .maybeSingle();
    if (error) throw new Response(error.message, { status: 500 });
    if (!row) return null;
    // Strip service_role_key — never returned to client.
    return {
      status: row.status as BackendStatus extends null ? never : NonNullable<BackendStatus>["status"],
      provider: row.provider as NonNullable<BackendStatus>["provider"],
      supabaseUrl: row.supabase_url,
      anonKey: row.anon_key,
      errorMessage: row.error_message,
    };
  });

export const disconnectBackend = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertOwnsProject(data.projectId, context.userId);
    const { error } = await supabaseAdmin
      .from("project_backends")
      .delete()
      .eq("project_id", data.projectId);
    if (error) throw new Response(error.message, { status: 500 });
    return { ok: true };
  });

/**
 * Server-only helper used by the generate route to look up a project's
 * backend (with service_role kept server-side). Returns null when no
 * backend is connected.
 */
export async function lookupBackendForGenerate(projectId: string): Promise<{
  url: string;
  anonKey: string;
} | null> {
  const { data, error } = await supabaseAdmin
    .from("project_backends")
    .select("status, supabase_url, anon_key")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error || !data) return null;
  if (data.status !== "ready") return null;
  return { url: data.supabase_url, anonKey: data.anon_key };
}
