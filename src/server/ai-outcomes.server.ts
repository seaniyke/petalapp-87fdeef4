/**
 * AI outcome telemetry.
 *
 * Phase B of the reliability plan. Links each `ai_call_log` row (an HTTP call
 * to the model) with what happened next in the pipeline:
 *   - did the local verifier pass?
 *   - how many auto-fix passes ran?
 *   - did the build succeed?
 *
 * This is what the smart router will read from `public.ai_model_quality` to
 * pick models that produce *working* code, not just models that respond fast.
 *
 * Pairing strategy: we don't plumb the call_id through the streaming pipeline
 * (would touch ~10 files). Instead we look up the most recent `ai_call_log`
 * for `(feature='generate', model, status<400)` within a 5 minute window and
 * pair the outcome with it. Best-effort — never throws, never blocks a build.
 */

interface RecordOutcomeArgs {
  feature: "generate" | "discuss";
  provider: string;
  model: string | null;
  projectId: string | null;
  messageId?: string | null;
  localVerifierPass: boolean;
  localVerifierErrors: Array<{ path: string; kind: string; detail: string }>;
  autofixCount: number;
  buildStatus: "ready" | "failed" | "pending" | "unknown";
  buildId?: string | null;
  filesWritten: number;
}

export async function recordAiOutcome(args: RecordOutcomeArgs): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Find the most recent matching ai_call_log row to anchor this outcome.
    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    const { data: callRows } = await supabaseAdmin
      .from("ai_call_log")
      .select("id")
      .eq("feature", args.feature)
      .eq("provider", args.provider)
      .lt("status", 400)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1);

    const aiCallId = callRows?.[0]?.id;
    if (!aiCallId) {
      // No recent successful call — nothing to anchor to. Drop silently;
      // this path is hit when the model errored or telemetry insert lagged.
      return;
    }

    await supabaseAdmin.from("ai_call_outcomes").insert({
      ai_call_id: aiCallId,
      project_id: args.projectId,
      message_id: args.messageId ?? null,
      feature: args.feature,
      provider: args.provider,
      model: args.model,
      local_verifier_pass: args.localVerifierPass,
      local_verifier_errors: args.localVerifierErrors,
      autofix_count: args.autofixCount,
      build_status: args.buildStatus,
      build_id: args.buildId ?? null,
      files_written: args.filesWritten,
    });
  } catch (err) {
    console.warn("[ai-outcomes] insert failed", err);
  }
}
