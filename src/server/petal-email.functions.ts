/**
 * Server functions for managing Petal Email subscriptions from the dashboard UI.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  enablePetalEmail,
  rotateApiToken,
  FREE_PLAN,
  PRO_PLAN,
} from "./petal-email.server";

const ProjectIdInput = z.object({ projectId: z.string().uuid() });

/** Get the current subscription + usage snapshot for a project. */
export const getPetalEmailStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) => ProjectIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // Verify ownership via RLS-respecting client
    const project = await supabase
      .from("projects")
      .select("id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (!project.data) throw new Error("Project not found");

    const sub = await supabaseAdmin
      .from("petal_email_subscriptions")
      .select(
        "id, plan, status, monthly_cap, daily_cap, sender_email, reply_to, custom_domain, custom_domain_verified, api_token_prefix, current_period_start, current_period_end, created_at"
      )
      .eq("project_id", data.projectId)
      .maybeSingle();

    if (!sub.data) {
      return {
        enabled: false as const,
        free: FREE_PLAN,
        pro: { monthly_cap: PRO_PLAN.monthly_cap, price_usd_cents: PRO_PLAN.price_usd_cents },
      };
    }

    // Aggregate usage for the current period
    const monthStart = new Date(sub.data.current_period_start).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    const usage = await supabaseAdmin
      .from("petal_email_usage")
      .select("usage_date, sent_count, failed_count")
      .eq("project_id", data.projectId)
      .gte("usage_date", monthStart);

    const monthly_used =
      usage.data?.reduce((s, r) => s + (r.sent_count ?? 0), 0) ?? 0;
    const daily_used =
      usage.data?.find((r) => r.usage_date === today)?.sent_count ?? 0;

    return {
      enabled: true as const,
      subscription: sub.data,
      usage: { monthly_used, daily_used },
      pro: { monthly_cap: PRO_PLAN.monthly_cap, price_usd_cents: PRO_PLAN.price_usd_cents },
    };
  });

/** Enable Petal Email for a project. Returns the API token ONCE. */
export const enablePetalEmailForProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) => ProjectIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const project = await supabase
      .from("projects")
      .select("id, owner_id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (!project.data || project.data.owner_id !== userId) {
      throw new Error("You do not own this project");
    }

    const { token, subscriptionId } = await enablePetalEmail({
      projectId: data.projectId,
      userId,
    });

    return { token, subscriptionId, sender: "noreply@buildwithpetal.com" };
  });

/** Rotate the API token. Returns the new token ONCE. */
export const rotatePetalEmailToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) => ProjectIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const project = await supabase
      .from("projects")
      .select("id, owner_id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (!project.data || project.data.owner_id !== userId) {
      throw new Error("You do not own this project");
    }
    const token = await rotateApiToken(data.projectId);
    return { token };
  });

/** Recent outbound log for the dashboard (last 50). */
export const listPetalEmailOutbound = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) => ProjectIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("petal_email_outbound")
      .select("id, recipient_email, subject, status, error_message, created_at")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { rows: rows ?? [] };
  });
