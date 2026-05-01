/**
 * Daily self-learning digest builder.
 *
 * Reads the last 24h of telemetry (`ai_call_log`, `ai_call_outcomes`,
 * `pipeline_failures`) and produces a structured snapshot of how Petal is
 * doing — where it's failing, which models are flaky, what user prompts
 * trigger reverts. The cron route persists this to
 * `petal_self_learning_digests` and emails it to admins.
 *
 * This is the loop that turns raw telemetry into prompt-tuning signal.
 * Read the digest, fix the top thing, watch tomorrow's digest improve.
 *
 * Best-effort: every aggregation has a try/catch so a single bad query
 * doesn't kill the whole digest.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const WINDOW_HOURS = 24;

export interface DigestPayload {
  /** ISO date the digest covers (UTC). */
  periodDate: string;
  /** Human-readable window, e.g. "2026-04-30 00:00 UTC → 2026-05-01 00:00 UTC". */
  windowLabel: string;

  totals: {
    turns: number;
    projects: number;
    users: number;
    verifierPassRate: number | null;
    buildSuccessRate: number | null;
    followupWasFixRate: number | null;
    avgAutofixCount: number | null;
    /**
     * Share of generate turns where the model never produced files — i.e.
     * upstream timed out, returned empty, or the worker aborted before any
     * write. Read from `pipeline_failures` (timeout-family signatures)
     * normalized against total turns. Separate from verifier failures so
     * "we ran out of time" doesn't get conflated with "we wrote bad code."
     */
    timeoutRate: number | null;
  };

  /** Top failure signatures from pipeline_failures (the "Petal got confused" branch). */
  topFailureSignatures: Array<{
    signature: string;
    count: number;
    sampleMessage: string;
    surface: string | null;
    model: string | null;
  }>;

  /** Outcomes where the user's NEXT turn looked like a fix request. */
  topRevertedPrompts: Array<{
    sampleErrorPath: string;
    sampleErrorKind: string;
    count: number;
    model: string | null;
  }>;

  /** Per-model verifier + build pass rates so we can spot flaky models. */
  modelBreakdown: Array<{
    model: string;
    turns: number;
    verifierPassRate: number;
    buildSuccessRate: number;
    avgAutofixCount: number;
  }>;

  /** Plain-English suggestions derived from the data above. */
  recommendations: string[];
}

interface OutcomeRow {
  model: string | null;
  local_verifier_pass: boolean | null;
  local_verifier_errors: unknown;
  autofix_count: number;
  build_status: string | null;
  user_followup_was_fix: boolean | null;
  project_id: string | null;
  ai_call_id: string;
  created_at: string;
  files_written: number | null;
}

interface FailureRow {
  signature: string;
  raw_message: string;
  surface: string | null;
  model: string | null;
  user_id: string | null;
}

/**
 * Build a digest covering the last 24h ending at `endingAt` (default: now).
 * Returns a fully-shaped payload even when there's zero data — empty arrays
 * are explicit, not undefined.
 */
export async function buildSelfLearningDigest(
  endingAt: Date = new Date(),
): Promise<DigestPayload> {
  const end = new Date(endingAt);
  const start = new Date(end.getTime() - WINDOW_HOURS * 3600_000);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const periodDate = end.toISOString().slice(0, 10);
  const windowLabel = `${startIso.replace("T", " ").slice(0, 16)} UTC → ${endIso.replace("T", " ").slice(0, 16)} UTC`;

  const outcomes = await fetchOutcomes(startIso, endIso);
  const failures = await fetchFailures(startIso, endIso);
  const userCount = await fetchUserCount(startIso, endIso);

  const timeoutCount = countTimeoutFailures(failures);
  const totals = computeTotals(outcomes, userCount, timeoutCount);
  const topFailureSignatures = computeTopSignatures(failures);
  const topRevertedPrompts = computeTopReverts(outcomes);
  const modelBreakdown = computeModelBreakdown(outcomes);
  const recommendations = computeRecommendations({
    totals,
    topFailureSignatures,
    topRevertedPrompts,
    modelBreakdown,
  });

  return {
    periodDate,
    windowLabel,
    totals,
    topFailureSignatures,
    topRevertedPrompts,
    modelBreakdown,
    recommendations,
  };
}

async function fetchOutcomes(startIso: string, endIso: string): Promise<OutcomeRow[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("ai_call_outcomes")
      .select(
        "model, local_verifier_pass, local_verifier_errors, autofix_count, build_status, user_followup_was_fix, project_id, ai_call_id, created_at, files_written",
      )
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .eq("feature", "generate")
      .limit(10_000);
    if (error) {
      console.warn("[digest] outcomes fetch failed", error.message);
      return [];
    }
    return (data ?? []) as OutcomeRow[];
  } catch (e) {
    console.warn("[digest] outcomes fetch threw", e);
    return [];
  }
}

async function fetchFailures(startIso: string, endIso: string): Promise<FailureRow[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("pipeline_failures")
      .select("signature, raw_message, surface, model, user_id")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .limit(5_000);
    if (error) {
      console.warn("[digest] failures fetch failed", error.message);
      return [];
    }
    return (data ?? []) as FailureRow[];
  } catch (e) {
    console.warn("[digest] failures fetch threw", e);
    return [];
  }
}

async function fetchUserCount(startIso: string, endIso: string): Promise<number> {
  try {
    // Active users = distinct owner of any project that received a turn.
    // Best-effort; if the join is too heavy we just report 0.
    const { data, error } = await supabaseAdmin
      .from("ai_call_outcomes")
      .select("project_id")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .not("project_id", "is", null)
      .limit(10_000);
    if (error || !data?.length) return 0;
    const projectIds = Array.from(
      new Set(data.map((r) => r.project_id).filter(Boolean) as string[]),
    );
    if (!projectIds.length) return 0;
    const { data: projects } = await supabaseAdmin
      .from("projects")
      .select("owner_id")
      .in("id", projectIds);
    return new Set((projects ?? []).map((p) => p.owner_id).filter(Boolean)).size;
  } catch {
    return 0;
  }
}

/**
 * Failures whose signature/raw_message points at "we never finished
 * generating" rather than "we generated wrong code." Matched against
 * the patterns we actually see in `pipeline_failures` today (see the
 * 72h investigation pull).
 */
const TIMEOUT_SIGNATURE_RE =
  /timeout|aborted|no result returned|ran out of time|couldn't finish|hit a snag|took (a bit )?longer than expected|wasn't able to finish/i;

function countTimeoutFailures(failures: FailureRow[]): number {
  let n = 0;
  for (const f of failures) {
    const sig = `${f.signature ?? ""} ${f.raw_message ?? ""}`;
    if (TIMEOUT_SIGNATURE_RE.test(sig)) n += 1;
  }
  return n;
}

function computeTotals(
  outcomes: OutcomeRow[],
  userCount: number,
  timeoutCount: number,
): DigestPayload["totals"] {
  const turns = outcomes.length;
  // Denominator for timeoutRate is "real attempts" — generate failures plus
  // outcomes we recorded. Without outcomes (e.g. brand-new project), fall
  // back to the failure count itself so the metric still has meaning.
  const attempts = turns + timeoutCount;
  const timeoutRate = attempts > 0 ? timeoutCount / attempts : null;

  if (turns === 0) {
    return {
      turns: 0,
      projects: 0,
      users: userCount,
      verifierPassRate: null,
      buildSuccessRate: null,
      followupWasFixRate: null,
      avgAutofixCount: null,
      timeoutRate,
    };
  }
  const projects = new Set(outcomes.map((o) => o.project_id).filter(Boolean)).size;
  // Verifier rate is only meaningful for outcomes where the model actually
  // produced files. Outcomes with files_written = 0 mean the upstream
  // bailed before writing — counting those as verifier failures conflates
  // "didn't finish" with "wrote bad code" and triggers wrong recommendations.
  const wroteFiles = outcomes.filter((o) => (o.files_written ?? 0) > 0);
  const verifierKnown = wroteFiles.filter((o) => o.local_verifier_pass !== null);
  const verifierPass = verifierKnown.filter((o) => o.local_verifier_pass).length;
  const buildKnown = outcomes.filter(
    (o) => o.build_status === "ready" || o.build_status === "failed",
  );
  const buildPass = buildKnown.filter((o) => o.build_status === "ready").length;
  const followupKnown = outcomes.filter((o) => o.user_followup_was_fix !== null);
  const followupFix = followupKnown.filter((o) => o.user_followup_was_fix).length;
  const totalAutofix = outcomes.reduce((s, o) => s + (o.autofix_count ?? 0), 0);

  return {
    turns,
    projects,
    users: userCount,
    verifierPassRate: verifierKnown.length ? verifierPass / verifierKnown.length : null,
    buildSuccessRate: buildKnown.length ? buildPass / buildKnown.length : null,
    followupWasFixRate: followupKnown.length ? followupFix / followupKnown.length : null,
    avgAutofixCount: turns ? totalAutofix / turns : null,
    timeoutRate,
  };
}

function computeTopSignatures(
  failures: FailureRow[],
): DigestPayload["topFailureSignatures"] {
  const byKey = new Map<
    string,
    { count: number; sample: string; surface: string | null; model: string | null }
  >();
  for (const f of failures) {
    const key = f.signature || "unknown";
    const cur = byKey.get(key);
    if (cur) {
      cur.count += 1;
    } else {
      byKey.set(key, {
        count: 1,
        sample: (f.raw_message ?? "").slice(0, 240),
        surface: f.surface,
        model: f.model,
      });
    }
  }
  return Array.from(byKey, ([signature, v]) => ({
    signature,
    count: v.count,
    sampleMessage: v.sample,
    surface: v.surface,
    model: v.model,
  }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

function computeTopReverts(outcomes: OutcomeRow[]): DigestPayload["topRevertedPrompts"] {
  // Group outcomes whose followup looked like a fix request, keyed by the
  // first verifier error path+kind (proxy for "what kind of work was the
  // user doing when Petal had to be told 'fix this'").
  const reverted = outcomes.filter((o) => o.user_followup_was_fix === true);
  const byKey = new Map<
    string,
    { count: number; path: string; kind: string; model: string | null }
  >();
  for (const o of reverted) {
    const errs = Array.isArray(o.local_verifier_errors) ? o.local_verifier_errors : [];
    const first = errs[0] as { path?: string; kind?: string } | undefined;
    const path = first?.path ?? "<no-verifier-error>";
    const kind = first?.kind ?? "unknown";
    const key = `${kind}::${path}`;
    const cur = byKey.get(key);
    if (cur) {
      cur.count += 1;
    } else {
      byKey.set(key, { count: 1, path, kind, model: o.model });
    }
  }
  return Array.from(byKey.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((v) => ({
      sampleErrorPath: v.path,
      sampleErrorKind: v.kind,
      count: v.count,
      model: v.model,
    }));
}

function computeModelBreakdown(outcomes: OutcomeRow[]): DigestPayload["modelBreakdown"] {
  const byModel = new Map<
    string,
    {
      turns: number;
      verifierKnown: number;
      verifierPass: number;
      buildKnown: number;
      buildPass: number;
      autofixSum: number;
    }
  >();
  for (const o of outcomes) {
    const key = o.model ?? "unknown";
    let cur = byModel.get(key);
    if (!cur) {
      cur = {
        turns: 0,
        verifierKnown: 0,
        verifierPass: 0,
        buildKnown: 0,
        buildPass: 0,
        autofixSum: 0,
      };
      byModel.set(key, cur);
    }
    cur.turns += 1;
    if (o.local_verifier_pass !== null) {
      cur.verifierKnown += 1;
      if (o.local_verifier_pass) cur.verifierPass += 1;
    }
    if (o.build_status === "ready" || o.build_status === "failed") {
      cur.buildKnown += 1;
      if (o.build_status === "ready") cur.buildPass += 1;
    }
    cur.autofixSum += o.autofix_count ?? 0;
  }
  return Array.from(byModel, ([model, v]) => ({
    model,
    turns: v.turns,
    verifierPassRate: v.verifierKnown ? v.verifierPass / v.verifierKnown : 0,
    buildSuccessRate: v.buildKnown ? v.buildPass / v.buildKnown : 0,
    avgAutofixCount: v.turns ? v.autofixSum / v.turns : 0,
  }))
    .sort((a, b) => b.turns - a.turns)
    .slice(0, 10);
}

/**
 * Plain-English next-actions derived from the data. The goal is to give
 * the operator one or two concrete things to do tomorrow, not a wall of
 * stats. Cap at 6 so the email is scannable.
 */
function computeRecommendations(args: {
  totals: DigestPayload["totals"];
  topFailureSignatures: DigestPayload["topFailureSignatures"];
  topRevertedPrompts: DigestPayload["topRevertedPrompts"];
  modelBreakdown: DigestPayload["modelBreakdown"];
}): string[] {
  const out: string[] = [];

  if (args.totals.turns === 0 && (args.totals.timeoutRate ?? 0) === 0) {
    out.push("No generate turns in the last 24h — nothing to learn from yet.");
    return out;
  }

  // Timeout-dominated days: surface this FIRST, before any prompt-snippet
  // advice. A 120s upstream abort is not a code-quality problem; telling
  // the operator to "add a dynamic-prompt snippet for the top failure" is
  // wrong when the top failure is "operation aborted due to timeout."
  const timeoutRate = args.totals.timeoutRate ?? 0;
  if (timeoutRate >= 0.2) {
    out.push(
      `Timeouts are the dominant failure today (${(timeoutRate * 100).toFixed(1)}% of attempts). Investigate model latency and first-build scaffold size before tuning prompts — first-build streams now run on the 240s ceiling, so any new timeouts mean the model genuinely hung.`,
    );
  }

  // Only suggest prompt-snippet work when the day is NOT timeout-dominated.
  // Otherwise the verifier number is mostly noise from incomplete outputs.
  const promptSnippetEligible = timeoutRate < 0.1;

  if (
    promptSnippetEligible &&
    args.totals.verifierPassRate !== null &&
    args.totals.verifierPassRate < 0.85
  ) {
    out.push(
      `Verifier pass rate is ${(args.totals.verifierPassRate * 100).toFixed(1)}% — below the 85% target. Look at the top failure signatures and add a dynamic-prompt snippet for the top one.`,
    );
  }
  if (args.totals.buildSuccessRate !== null && args.totals.buildSuccessRate < 0.9) {
    out.push(
      `Build success rate is ${(args.totals.buildSuccessRate * 100).toFixed(1)}% — investigate the top failing model in the breakdown.`,
    );
  }
  if (
    args.totals.followupWasFixRate !== null &&
    args.totals.followupWasFixRate > 0.25
  ) {
    out.push(
      `${(args.totals.followupWasFixRate * 100).toFixed(1)}% of turns were followed by a "fix this" prompt — users are catching real bugs we missed. Review the top reverted prompts.`,
    );
  }

  const top = args.topFailureSignatures[0];
  if (promptSnippetEligible && top && top.count >= 5) {
    out.push(
      `Top failure signature ("${top.signature}") hit ${top.count}× — codify a fix in dynamic-prompts or the verifier.`,
    );
  }

  const flakyModel = args.modelBreakdown
    .filter((m) => m.turns >= 20)
    .sort((a, b) => a.verifierPassRate - b.verifierPassRate)[0];
  if (flakyModel && flakyModel.verifierPassRate < 0.8) {
    out.push(
      `${flakyModel.model} verifier pass rate is ${(flakyModel.verifierPassRate * 100).toFixed(1)}% over ${flakyModel.turns} turns — consider downgrading its smart-router weight.`,
    );
  }

  if (out.length === 0) {
    out.push("Quality looks healthy — no urgent action items today. Keep shipping.");
  }
  return out.slice(0, 6);
}

/**
 * Render a compact HTML email body for the digest. Inline styles only —
 * Resend / Gmail / Outlook all strip <style> blocks aggressively.
 */
export function renderDigestHtml(d: DigestPayload): string {
  const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(1)}%`);
  const num = (n: number | null) => (n === null ? "—" : n.toFixed(2));

  const failuresRows = d.topFailureSignatures
    .map(
      (f) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px">${escapeHtml(f.signature)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${f.count}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#666;font-size:12px">${escapeHtml(f.surface ?? "")}</td>
      </tr>`,
    )
    .join("");

  const revertsRows = d.topRevertedPrompts
    .map(
      (r) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px">${escapeHtml(r.sampleErrorKind)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px">${escapeHtml(r.sampleErrorPath)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${r.count}</td>
      </tr>`,
    )
    .join("");

  const modelRows = d.modelBreakdown
    .map(
      (m) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee">${escapeHtml(m.model)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${m.turns}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${(m.verifierPassRate * 100).toFixed(1)}%</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${(m.buildSuccessRate * 100).toFixed(1)}%</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${m.avgAutofixCount.toFixed(2)}</td>
      </tr>`,
    )
    .join("");

  const recRows = d.recommendations
    .map(
      (r) =>
        `<li style="margin:6px 0;color:#222;line-height:1.45">${escapeHtml(r)}</li>`,
    )
    .join("");

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f6f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#222">
<div style="max-width:680px;margin:0 auto;padding:24px">
  <h1 style="margin:0 0 4px 0;font-size:20px">Petal · Daily self-learning digest</h1>
  <div style="color:#666;font-size:13px;margin-bottom:24px">${escapeHtml(d.windowLabel)}</div>

  <div style="background:white;border:1px solid #eee;border-radius:8px;padding:16px;margin-bottom:16px">
    <div style="font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#666;margin-bottom:8px">Volume</div>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr>
        <td style="padding:4px 0;color:#666">Generate turns</td><td style="text-align:right;font-weight:600">${d.totals.turns}</td>
        <td style="padding:4px 0;color:#666">Active projects</td><td style="text-align:right;font-weight:600">${d.totals.projects}</td>
        <td style="padding:4px 0;color:#666">Active users</td><td style="text-align:right;font-weight:600">${d.totals.users}</td>
      </tr>
    </table>
    <div style="font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#666;margin:14px 0 8px">Quality</div>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr>
        <td style="padding:4px 0;color:#666">Verifier pass</td><td style="text-align:right;font-weight:600">${pct(d.totals.verifierPassRate)}</td>
        <td style="padding:4px 0;color:#666">Build success</td><td style="text-align:right;font-weight:600">${pct(d.totals.buildSuccessRate)}</td>
        <td style="padding:4px 0;color:#666">Followup = fix</td><td style="text-align:right;font-weight:600">${pct(d.totals.followupWasFixRate)}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;color:#666">Avg autofix passes</td><td style="text-align:right;font-weight:600" colspan="5">${num(d.totals.avgAutofixCount)}</td>
      </tr>
    </table>
  </div>

  <div style="background:white;border:1px solid #eee;border-radius:8px;padding:16px;margin-bottom:16px">
    <div style="font-size:14px;font-weight:600;margin-bottom:10px">What to do tomorrow</div>
    <ol style="margin:0;padding-left:20px">${recRows}</ol>
  </div>

  ${
    failuresRows
      ? `<div style="background:white;border:1px solid #eee;border-radius:8px;padding:16px;margin-bottom:16px">
    <div style="font-size:14px;font-weight:600;margin-bottom:10px">Top failure signatures</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>
      <th style="text-align:left;padding:6px 10px;color:#666;border-bottom:1px solid #eee">Signature</th>
      <th style="text-align:right;padding:6px 10px;color:#666;border-bottom:1px solid #eee">Count</th>
      <th style="text-align:left;padding:6px 10px;color:#666;border-bottom:1px solid #eee">Surface</th>
    </tr></thead><tbody>${failuresRows}</tbody></table>
  </div>`
      : ""
  }

  ${
    revertsRows
      ? `<div style="background:white;border:1px solid #eee;border-radius:8px;padding:16px;margin-bottom:16px">
    <div style="font-size:14px;font-weight:600;margin-bottom:10px">Top reverted prompts</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>
      <th style="text-align:left;padding:6px 10px;color:#666;border-bottom:1px solid #eee">Error kind</th>
      <th style="text-align:left;padding:6px 10px;color:#666;border-bottom:1px solid #eee">Sample path</th>
      <th style="text-align:right;padding:6px 10px;color:#666;border-bottom:1px solid #eee">Count</th>
    </tr></thead><tbody>${revertsRows}</tbody></table>
  </div>`
      : ""
  }

  ${
    modelRows
      ? `<div style="background:white;border:1px solid #eee;border-radius:8px;padding:16px;margin-bottom:16px">
    <div style="font-size:14px;font-weight:600;margin-bottom:10px">Model breakdown</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>
      <th style="text-align:left;padding:6px 10px;color:#666;border-bottom:1px solid #eee">Model</th>
      <th style="text-align:right;padding:6px 10px;color:#666;border-bottom:1px solid #eee">Turns</th>
      <th style="text-align:right;padding:6px 10px;color:#666;border-bottom:1px solid #eee">Verifier</th>
      <th style="text-align:right;padding:6px 10px;color:#666;border-bottom:1px solid #eee">Build</th>
      <th style="text-align:right;padding:6px 10px;color:#666;border-bottom:1px solid #eee">Avg autofix</th>
    </tr></thead><tbody>${modelRows}</tbody></table>
  </div>`
      : ""
  }

  <div style="color:#888;font-size:12px;margin-top:24px;text-align:center">
    Read the full archive at <a href="https://buildwithpetal.com/admin/digest" style="color:#888">/admin/digest</a>
  </div>
</div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Resolve admin email recipients via service-role auth.admin.listUsers().
 * Filters by user_roles.role='admin'. Best-effort — returns [] on error.
 */
export async function resolveAdminRecipients(): Promise<string[]> {
  try {
    const { data: roles, error: rolesErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");
    if (rolesErr || !roles?.length) return [];

    const adminIds = new Set(roles.map((r) => r.user_id));
    const emails: string[] = [];
    let page = 1;
    // Cap the scan at 5 pages (5000 users) to bound runtime.
    while (page <= 5) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: 1000,
      });
      if (error || !data?.users?.length) break;
      for (const u of data.users) {
        if (u.id && adminIds.has(u.id) && u.email) emails.push(u.email);
      }
      if (data.users.length < 1000) break;
      page += 1;
    }
    return Array.from(new Set(emails));
  } catch (e) {
    console.warn("[digest] resolveAdminRecipients failed", e);
    return [];
  }
}
