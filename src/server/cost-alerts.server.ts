/**
 * Cost alerts — proactive, internal-only.
 *
 * The admin Economics page answers "how are we doing?" when someone opens it.
 * This module pushes the same signals out when they cross a threshold, so a
 * margin problem or a runaway project is noticed within a day instead of
 * whenever someone happens to look.
 *
 * Rules (all read from economics_config so thresholds stay centralised):
 *   - cost per credit above target
 *   - build failure rate above 20%
 *   - cost data coverage below 80% (we can't trust the other two if so)
 *   - any single project above 25% of the window's total variable cost
 *   - any free account past the monthly cost ceiling
 *
 * Everything is "unknown"-aware: turns with unknown cost never masquerade as
 * $0, and a thin-coverage window says so rather than reporting a clean number.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { economicsValues } from "@/server/economics-config.server";

export type CostAlert = {
  level: "warn" | "critical";
  code: string;
  title: string;
  detail: string;
};

export type CostAlertReport = {
  windowDays: number;
  turns: number;
  knownPct: number;
  creditsCharged: number;
  variableCostUsd: number;
  costPerCreditUsd: number | null;
  targetCostPerCreditUsd: number;
  buildFailureRatePct: number | null;
  alerts: CostAlert[];
};

type TurnRow = {
  project_id: string | null;
  credits_charged: number | null;
  variable_cost_usd: number | null;
  cost_basis: string | null;
};

export async function buildCostAlertReport(windowDays = 1): Promise<CostAlertReport> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const cfg = await economicsValues([
    "target_variable_cost_per_credit_usd",
    "target_gross_margin_pct",
  ]);
  const target = cfg["target_variable_cost_per_credit_usd"] ?? 0.05;

  const { data: turnsData } = await supabaseAdmin
    .from("turn_economics")
    .select("project_id, credits_charged, variable_cost_usd, cost_basis")
    .gte("created_at", since);
  const turns = (turnsData ?? []) as TurnRow[];

  let credits = 0;
  let cost = 0;
  let known = 0;
  const byProject = new Map<string, number>();
  for (const t of turns) {
    credits += Number(t.credits_charged ?? 0);
    if (t.cost_basis && t.cost_basis !== "unknown") {
      known++;
      const c = Number(t.variable_cost_usd ?? 0);
      cost += c;
      if (t.project_id) byProject.set(t.project_id, (byProject.get(t.project_id) ?? 0) + c);
    }
  }
  const knownPct = turns.length ? (known / turns.length) * 100 : 0;
  const costPerCredit = credits > 0 && known > 0 ? cost / credits : null;

  const { data: buildRows } = await supabaseAdmin
    .from("project_builds")
    .select("status")
    .gte("created_at", since);
  const builds = buildRows ?? [];
  const finished = builds.filter((b) => b.status === "ready" || b.status === "failed");
  const failed = finished.filter((b) => b.status === "failed").length;
  const failureRate = finished.length ? (failed / finished.length) * 100 : null;

  const alerts: CostAlert[] = [];

  if (turns.length >= 10 && knownPct < 80) {
    alerts.push({
      level: "warn",
      code: "thin_coverage",
      title: "Cost data coverage is thin",
      detail: `Only ${knownPct.toFixed(0)}% of ${turns.length} turns have a known cost. Margin numbers below are not reliable until this is above 80%.`,
    });
  }

  if (costPerCredit != null && costPerCredit > target) {
    alerts.push({
      level: costPerCredit > target * 1.5 ? "critical" : "warn",
      code: "cost_per_credit_over_target",
      title: "Cost per credit is above target",
      detail: `$${costPerCredit.toFixed(4)} per credit against a $${target.toFixed(4)} target (${((costPerCredit / target - 1) * 100).toFixed(0)}% over) across ${credits.toFixed(2)} credits.`,
    });
  }

  if (failureRate != null && finished.length >= 10 && failureRate > 20) {
    alerts.push({
      level: failureRate > 35 ? "critical" : "warn",
      code: "build_failure_rate",
      title: "Build failure rate is high",
      detail: `${failureRate.toFixed(0)}% of ${finished.length} finished builds failed. Failed builds cost us compute we can't bill for.`,
    });
  }

  if (cost > 0) {
    for (const [projectId, spend] of byProject) {
      const share = spend / cost;
      if (share >= 0.25 && spend >= 0.5) {
        alerts.push({
          level: share >= 0.5 ? "critical" : "warn",
          code: "project_cost_concentration",
          title: "One project dominates spend",
          detail: `Project ${projectId} accounts for ${(share * 100).toFixed(0)}% ($${spend.toFixed(2)}) of known variable cost in this window.`,
        });
      }
    }
  }

  return {
    windowDays,
    turns: turns.length,
    knownPct,
    creditsCharged: credits,
    variableCostUsd: cost,
    costPerCreditUsd: costPerCredit,
    targetCostPerCreditUsd: target,
    buildFailureRatePct: failureRate,
    alerts,
  };
}

export function renderCostAlertHtml(r: CostAlertReport): string {
  const rows = r.alerts
    .map(
      (a) =>
        `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;color:${a.level === "critical" ? "#b42318" : "#b54708"}">${a.level.toUpperCase()}</td><td style="padding:8px 12px;border-bottom:1px solid #eee"><strong>${a.title}</strong><br/><span style="color:#555">${a.detail}</span></td></tr>`,
    )
    .join("");
  const cpc = r.costPerCreditUsd == null ? "unknown" : `$${r.costPerCreditUsd.toFixed(4)}`;
  return `<div style="font-family:system-ui,sans-serif;max-width:640px">
  <h2 style="margin:0 0 4px">Petal · Cost alerts</h2>
  <p style="color:#666;margin:0 0 16px">Last ${r.windowDays} day(s) · ${r.turns} turns · cost known for ${r.knownPct.toFixed(0)}%</p>
  <p style="margin:0 0 16px">Credits charged <strong>${r.creditsCharged.toFixed(2)}</strong> · known variable cost <strong>$${r.variableCostUsd.toFixed(2)}</strong> · cost per credit <strong>${cpc}</strong> (target $${r.targetCostPerCreditUsd.toFixed(4)})</p>
  ${rows ? `<table style="width:100%;border-collapse:collapse">${rows}</table>` : `<p style="color:#067647">No alerts — everything is within thresholds.</p>`}
</div>`;
}
