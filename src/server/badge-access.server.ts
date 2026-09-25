/**
 * Who may hide the "Built with Kimble" badge.
 *
 * Badge removal is bought once per project with credits (row in
 * project_badge_removals). Legacy subscribers (plan_code !== "free") keep it
 * too, so switching subscriptions off never re-shows a badge someone paid to
 * hide. Any read error → show the badge.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function shouldHideBadge(projectId: string, ownerId: string, flag: boolean | null | undefined): Promise<boolean> {
  if (flag !== true) return false;
  try {
    const { data: bought } = await supabaseAdmin
      .from("project_badge_removals" as never)
      .select("project_id")
      .eq("project_id", projectId)
      .maybeSingle();
    if (bought) return true;
    const { data: wallet } = await supabaseAdmin
      .from("user_wallets")
      .select("plan_code")
      .eq("user_id", ownerId)
      .maybeSingle();
    return !!wallet?.plan_code && wallet.plan_code !== "free";
  } catch {
    return false;
  }
}
