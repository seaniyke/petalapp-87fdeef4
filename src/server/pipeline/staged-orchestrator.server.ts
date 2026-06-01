/**
 * Staged Pipeline — orchestrator entrypoint.
 *
 * Runs Plan → Scaffold (parallel) → Wire-up to completion BEFORE opening
 * the SSE response. This lets us return `null` (caller falls back to the
 * monolithic path) for any condition that should not surface to the user
 * — most importantly `missing_root_view`, which means the model produced
 * no real src/App.tsx and the monolithic path's retry/continuation
 * budget is the user's best chance at a real app this turn.
 *
 * Behavior contract:
 *   - Returns `null` when the pipeline could not finish OR when the
 *     monolithic path would do better; the caller MUST fall back.
 *   - Returns a Response when the pipeline succeeded end-to-end with a
 *     real, renderable result. Never throws.
 *
 * The SSE events are emitted in the order the existing client expects
 * (phase → status → file_complete* → phase → status → result) so the
 * activity card renders identically to the monolithic path.
 */

import { runStagePlan } from "./stage-plan.server";
import { runStageScaffold } from "./stage-scaffold.server";
import { runStageWireup } from "./stage-wireup.server";
import type { ProjectFile, StreamEvent } from "@/server/generate.server";

function sse(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function runStagedPipelineStream(args: {
  brief: string;
  hasBackend: boolean;
}): Promise<Response | null> {
  // STAGE 1 — plan.
  const plan = await runStagePlan({ brief: args.brief, hasBackend: args.hasBackend });
  if (!plan.ok) {
    console.warn("[staged] plan failed:", plan.reason);
    return null;
  }

  // STAGE 2 — parallel scaffold.
  const scaffold = await runStageScaffold({
    plan: plan.files,
    brief: args.brief,
    manifestSummary: plan.summary,
  });
  if (!scaffold.ok) {
    console.warn("[staged] scaffold failed:", scaffold.reason);
    return null;
  }

  // STAGE 3 — wireup + renderable-shell guard.
  const wireup = await runStageWireup({ files: scaffold.files, brief: args.brief });
  if (!wireup.ok) {
    // missing_root_view / verifier failures all warrant a silent fallback
    // — the monolithic path has retries and continuation we don't have
    // here, and giving the user a real app beats surfacing the failure.
    console.warn(
      `[staged] wireup failed (${wireup.reason}) — falling back to monolithic:`,
      wireup.blockingIssues.join(" | "),
    );
    return null;
  }

  // All three stages succeeded. Replay the events as an SSE stream so the
  // client renders the same progress UI it always does.
  const encoder = new TextEncoder();
  const events: StreamEvent[] = [
    { type: "phase", phase: "thinking" },
    { type: "status", message: `Planning ${plan.files.length} files…` },
    { type: "phase", phase: "writing" },
    { type: "status", message: "Writing files in parallel…" },
    ...scaffold.files.map((f, i) => ({
      type: "file_complete" as const,
      path: f.path,
      bytes: f.content.length,
      index: i,
    })),
    { type: "phase", phase: "polishing" },
    { type: "status", message: "Verifying the build…" },
    {
      type: "result",
      files: wireup.files as ProjectFile[],
      summary: wireup.summary,
    },
  ];

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const ev of events) {
        controller.enqueue(encoder.encode(sse(ev)));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
