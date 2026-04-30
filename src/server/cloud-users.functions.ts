/**
 * Cloud panel — Users view server function.
 * Lists auth users from the project's managed Supabase backend.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertOwnsProject,
  getManagedBackendForProject,
  makeManagedClient,
} from "./cloud-managed-client.server";

const Input = z.object({
  projectId: z.string().uuid(),
  page: z.number().int().min(1).max(50).default(1),
  perPage: z.number().int().min(1).max(50).default(20),
});

export type CloudAuthUser = {
  id: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  provider: string | null;
};

export type CloudUsersResult = {
  available: boolean;
  reason?: "NO_BACKEND" | "NOT_READY" | "ERROR";
  total: number;
  users: CloudAuthUser[];
};

export const listProjectUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => Input.parse(data))
  .handler(async ({ data, context }): Promise<CloudUsersResult> => {
    const { supabase, userId } = context;
    await assertOwnsProject(supabase, data.projectId, userId);

    let info;
    try {
      info = await getManagedBackendForProject(data.projectId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "ERROR";
      return {
        available: false,
        reason: msg === "NO_BACKEND" || msg === "NOT_MANAGED" ? "NO_BACKEND" : "NOT_READY",
        total: 0,
        users: [],
      };
    }

    const client = makeManagedClient(info);
    try {
      const { data: page, error } = await client.auth.admin.listUsers({
        page: data.page,
        perPage: data.perPage,
      });
      if (error) throw error;
      const users: CloudAuthUser[] = (page.users ?? []).map((u) => ({
        id: u.id,
        email: u.email ?? null,
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at ?? null,
        provider:
          (u.app_metadata as { provider?: string } | null)?.provider ?? null,
      }));
      // listUsers doesn't return a total — use length as a hint.
      return { available: true, total: users.length, users };
    } catch (e) {
      console.error("[cloud-users] list failed", e);
      return { available: false, reason: "ERROR", total: 0, users: [] };
    }
  });
