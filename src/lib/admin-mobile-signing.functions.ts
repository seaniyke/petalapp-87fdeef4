/**
 * Server functions for the admin mobile-signing dashboard.
 *
 * Kept in `src/lib/` (not a `.server.ts` file) so the route can import the
 * function reference safely. Module-level access to `supabaseAdmin` is fine
 * here because TanStack Start replaces the handler body with an RPC stub in
 * client bundles — the admin client never ships to the browser.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type AdminMobileSigningRow = {
  project_id: string;
  project_title: string | null;
  owner_email: string | null;
  apple_team_id: string | null;
  apple_bundle_id: string | null;
  apple_provisioning_profile_not_after: string | null;
  apple_p12_not_after: string | null;
  has_android: boolean;
  updated_at: string;
};

export const listMobileSigningProfiles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) {
      return { rows: [] as AdminMobileSigningRow[], unauthorized: true as const };
    }

    const { data: profiles, error } = await supabaseAdmin
      .from("mobile_signing_profiles")
      .select(
        "project_id, apple_team_id, apple_bundle_id, apple_provisioning_profile_not_after, apple_p12_not_after, android_keystore_ciphertext, updated_at",
      );
    if (error) throw new Error(error.message);

    const ids = (profiles ?? []).map((p) => p.project_id);
    if (!ids.length) return { rows: [] as AdminMobileSigningRow[] };

    const { data: projects } = await supabaseAdmin
      .from("projects")
      .select("id, title, owner_id")
      .in("id", ids);
    const projById = new Map((projects ?? []).map((p) => [p.id, p]));

    const ownerIds = Array.from(
      new Set((projects ?? []).map((p) => p.owner_id).filter(Boolean) as string[]),
    );
    const ownerEmailById = new Map<string, string>();
    if (ownerIds.length) {
      // 1000 is the SDK cap; signing-profile owners are a tiny slice so this
      // single page comfortably covers them.
      const { data: usersPage } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      for (const u of usersPage?.users ?? []) {
        if (u.id && u.email && ownerIds.includes(u.id)) {
          ownerEmailById.set(u.id, u.email);
        }
      }
    }

    const rows: AdminMobileSigningRow[] = (profiles ?? []).map((p) => {
      const proj = projById.get(p.project_id);
      return {
        project_id: p.project_id,
        project_title: proj?.title ?? null,
        owner_email: proj?.owner_id ? ownerEmailById.get(proj.owner_id) ?? null : null,
        apple_team_id: p.apple_team_id,
        apple_bundle_id: p.apple_bundle_id,
        apple_provisioning_profile_not_after: p.apple_provisioning_profile_not_after,
        apple_p12_not_after: p.apple_p12_not_after,
        has_android: !!p.android_keystore_ciphertext,
        updated_at: p.updated_at,
      };
    });

    // Sort by soonest expiry; missing expiries sink to the bottom.
    rows.sort((a, b) => {
      const av = a.apple_provisioning_profile_not_after
        ? new Date(a.apple_provisioning_profile_not_after).getTime()
        : Number.POSITIVE_INFINITY;
      const bv = b.apple_provisioning_profile_not_after
        ? new Date(b.apple_provisioning_profile_not_after).getTime()
        : Number.POSITIVE_INFINITY;
      return av - bv;
    });

    return { rows };
  });
