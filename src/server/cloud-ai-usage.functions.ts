/**
 * Cloud AI usage server functions.
 *
 * Aggregates `ai_call_log` for the workspace-level Cloud panel "AI" view.
 * For now AI calls aren't user-attributed, so this is admin-only and
 * workspace-wide. Non-admin callers get an empty result instead of a 403
 * so the UI can render a friendly empty state.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const InputSchema = z.object({
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(7),
});

export type AiUsageDayRow = {
  /** ISO date (YYYY-MM-DD) at UTC day boundary */
  day: string;
  /** Map of model name -> call count for that day */
  byModel: Record<string, number>;
};

export type AiUsageModelRow = {
  model: string;
  calls: number;
  provider: string;
};

export type AiUsageResult = {
  /** Whether the caller can see workspace-wide AI usage */
  authorized: boolean;
  totalRequests: number;
  modelCount: number;
  topModel: string | null;
  series: AiUsageDayRow[];
  models: AiUsageModelRow[];
};

export const getAiUsage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => InputSchema.parse(data))
  .handler(async ({ data, context }): Promise<AiUsageResult> => {
    const { userId } = context;

    // Admin-gate. Use admin client so the read isn't blocked by RLS.
    const { data: roleRow } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleRow) {
      return {
        authorized: false,
        totalRequests: 0,
        modelCount: 0,
        topModel: null,
        series: [],
        models: [],
      };
    }

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - data.days);
    since.setUTCHours(0, 0, 0, 0);

    const { data: rows, error } = await supabaseAdmin
      .from("ai_call_log")
      .select("created_at, model, provider")
      .gte("created_at", since.toISOString())
      .limit(20000);

    if (error) {
      console.error("[cloud-ai-usage] query failed", error);
      return {
        authorized: true,
        totalRequests: 0,
        modelCount: 0,
        topModel: null,
        series: [],
        models: [],
      };
    }

    const seriesMap = new Map<string, Map<string, number>>();
    const modelTotals = new Map<string, { calls: number; provider: string }>();

    for (const row of rows ?? []) {
      const model = row.model ?? "unknown";
      const provider = row.provider ?? "unknown";
      const day = new Date(row.created_at).toISOString().slice(0, 10);

      if (!seriesMap.has(day)) seriesMap.set(day, new Map());
      const dayMap = seriesMap.get(day)!;
      dayMap.set(model, (dayMap.get(model) ?? 0) + 1);

      const cur = modelTotals.get(model);
      if (cur) cur.calls += 1;
      else modelTotals.set(model, { calls: 1, provider });
    }

    // Build a contiguous date range so the chart has zeros where needed.
    const series: AiUsageDayRow[] = [];
    for (let i = data.days - 1; i >= 0; i--) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      d.setUTCHours(0, 0, 0, 0);
      const key = d.toISOString().slice(0, 10);
      const dayMap = seriesMap.get(key);
      series.push({
        day: key,
        byModel: dayMap ? Object.fromEntries(dayMap) : {},
      });
    }

    const models: AiUsageModelRow[] = Array.from(modelTotals.entries())
      .map(([model, v]) => ({ model, calls: v.calls, provider: v.provider }))
      .sort((a, b) => b.calls - a.calls);

    return {
      authorized: true,
      totalRequests: rows?.length ?? 0,
      modelCount: models.length,
      topModel: models[0]?.model ?? null,
      series,
      models,
    };
  });
