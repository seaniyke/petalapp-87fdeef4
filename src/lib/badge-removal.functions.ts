import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Is the badge already paid for on this project, and what does it cost? */
export const getBadgeRemoval = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ projectId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("project_badge_removals" as never)
      .select("project_id")
      .eq("project_id", data.projectId)
      .maybeSingle();
    const { economicsValue } = await import("@/server/economics-config.server");
    const credits = await economicsValue("badge_removal_credits");
    return { purchased: !!row, credits };
  });

/** Spend credits once to remove the badge from a project for good. */
export const buyBadgeRemoval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ projectId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    // Ownership check as the user (RLS applies).
    const { data: project } = await context.supabase
      .from("projects")
      .select("id, owner_id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (!project || project.owner_id !== userId) return { ok: false as const, reason: "not_found" as const };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin
      .from("project_badge_removals" as never)
      .select("project_id")
      .eq("project_id", data.projectId)
      .maybeSingle();
    if (!existing) {
      const { economicsValue } = await import("@/server/economics-config.server");
      const credits = await economicsValue("badge_removal_credits");
      const { spendCredit, refundCredit } = await import("@/server/credits.server");
      const spent = await spendCredit({
        userId,
        amount: credits,
        reason: "badge_removal" as never,
        projectId: data.projectId,
        metadata: { kind: "badge_removal" },
      });
      if (!spent.ok) return { ok: false as const, reason: spent.reason };
      const { error } = await supabaseAdmin
        .from("project_badge_removals" as never)
        .insert({ project_id: data.projectId, user_id: userId, ledger_id: spent.ledgerId, credits } as never);
      if (error) {
        // Lost a race or failed to record: give the credits back.
        await refundCredit({ userId, ledgerId: spent.ledgerId, reason: "refund" });
        const { data: again } = await supabaseAdmin
          .from("project_badge_removals" as never)
          .select("project_id")
          .eq("project_id", data.projectId)
          .maybeSingle();
        if (!again) return { ok: false as const, reason: "internal_error" as const };
      }
    }
    await supabaseAdmin.from("projects").update({ hide_petal_badge: true }).eq("id", data.projectId);
    return { ok: true as const };
  });
