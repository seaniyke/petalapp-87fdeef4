/**
 * Cloud panel — Users management server functions.
 * Lists, searches, paginates, and acts on auth users in the project's
 * managed Supabase backend (admin API, service role).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertOwnsProject,
  getManagedBackendForProject,
  makeManagedClient,
} from "@/server/cloud-managed-client.server";

const ProjectInput = z.object({ projectId: z.string().uuid() });

const ListInput = ProjectInput.extend({
  page: z.number().int().min(1).max(500).default(1),
  perPage: z.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(200).optional(),
});

export type CloudAuthUser = {
  id: string;
  email: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  provider: string | null;
  banned: boolean;
  bannedUntil: string | null;
};

export type CloudUsersResult = {
  available: boolean;
  reason?: "NO_BACKEND" | "NOT_READY" | "ERROR";
  page: number;
  perPage: number;
  hasMore: boolean;
  total: number | null; // listUsers doesn't return totals
  users: CloudAuthUser[];
};

function mapUser(u: {
  id: string;
  email?: string | null;
  created_at: string;
  last_sign_in_at?: string | null;
  app_metadata?: { provider?: string } | null;
  banned_until?: string | null;
}): CloudAuthUser {
  const bannedUntil = u.banned_until ?? null;
  const banned = !!bannedUntil && new Date(bannedUntil).getTime() > Date.now();
  return {
    id: u.id,
    email: u.email ?? null,
    createdAt: u.created_at,
    lastSignInAt: u.last_sign_in_at ?? null,
    provider: u.app_metadata?.provider ?? null,
    banned,
    bannedUntil,
  };
}

async function backendOrUnavailable(projectId: string) {
  try {
    return { ok: true as const, info: await getManagedBackendForProject(projectId) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ERROR";
    return {
      ok: false as const,
      reason:
        msg === "NO_BACKEND" || msg === "NOT_MANAGED"
          ? ("NO_BACKEND" as const)
          : ("NOT_READY" as const),
    };
  }
}

export const listProjectUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => ListInput.parse(data))
  .handler(async ({ data, context }): Promise<CloudUsersResult> => {
    const { supabase, userId } = context;
    await assertOwnsProject(supabase, data.projectId, userId);

    const r = await backendOrUnavailable(data.projectId);
    if (!r.ok) {
      return {
        available: false,
        reason: r.reason,
        page: data.page,
        perPage: data.perPage,
        hasMore: false,
        total: null,
        users: [],
      };
    }

    const client = makeManagedClient(r.info);
    try {
      const { data: page, error } = await client.auth.admin.listUsers({
        page: data.page,
        perPage: data.perPage,
      });
      if (error) throw error;

      let users = (page.users ?? []).map(mapUser);
      const term = data.search?.toLowerCase();
      if (term) {
        users = users.filter((u) => u.email?.toLowerCase().includes(term));
      }
      return {
        available: true,
        page: data.page,
        perPage: data.perPage,
        hasMore: (page.users ?? []).length === data.perPage,
        total: null,
        users,
      };
    } catch (e) {
      console.error("[cloud-users] list failed", e);
      return {
        available: false,
        reason: "ERROR",
        page: data.page,
        perPage: data.perPage,
        hasMore: false,
        total: null,
        users: [],
      };
    }
  });

const UserActionInput = ProjectInput.extend({
  userUid: z.string().uuid(),
});

export const deleteProjectUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => UserActionInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertOwnsProject(supabase, data.projectId, userId);
    const info = await getManagedBackendForProject(data.projectId);
    const client = makeManagedClient(info);
    const { error } = await client.auth.admin.deleteUser(data.userUid);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const BanInput = UserActionInput.extend({
  /** When true, ban for 100 years; when false, unban (duration "none"). */
  ban: z.boolean(),
});

export const setProjectUserBan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => BanInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertOwnsProject(supabase, data.projectId, userId);
    const info = await getManagedBackendForProject(data.projectId);
    const client = makeManagedClient(info);
    // GoTrue accepts a duration string. "none" lifts the ban.
    const ban_duration = data.ban ? "876000h" : "none"; // ~100 years
    const { error } = await client.auth.admin.updateUserById(data.userUid, {
      ban_duration,
    } as Parameters<typeof client.auth.admin.updateUserById>[1]);
    if (error) throw new Error(error.message);
    return { ok: true, banned: data.ban };
  });

const ResetInput = ProjectInput.extend({
  email: z.string().email(),
});

export const sendProjectUserRecovery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => ResetInput.parse(data))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertOwnsProject(supabase, data.projectId, userId);
    const info = await getManagedBackendForProject(data.projectId);
    const client = makeManagedClient(info);
    // generateLink with type=recovery triggers the recovery email via the
    // managed project's configured SMTP/template.
    const { error } = await client.auth.admin.generateLink({
      type: "recovery",
      email: data.email,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
