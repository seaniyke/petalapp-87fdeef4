/**
 * Staged Pipeline — orchestrator entrypoint.
 *
 * Runs Plan → Scaffold (parallel) → Wire-up and streams the result as
 * a server-sent event (SSE) Response in the same shape the existing
 * monolithic /api/generate path emits. The client reads either path
 * identically — no UI work needed.
 *
 * Behavior contract:
 *   - Returns `null` when the pipeline could not finish; the caller
 *     MUST fall back to the monolithic path. Never throws.
 *   - Returns a Response when the pipeline succeeded end-to-end.
 *   - Each SSE event is appended in the order the user expects:
 *     phase("thinking") → status → phase("writing") → file_complete*
 *     → phase("polishing") → status → result.
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
  // Run plan first. If plan fails we fall back to monolithic — no
  // partial results to stream.
  const plan = await runStagePlan({ brief: args.brief, hasBackend: args.hasBackend });
  if (!plan.ok) {
    console.warn("[staged] plan failed:", plan.reason);
    return null;
  }

  // From here on we own the response stream. Stage failures inside the
  // stream emit a friendly `error` event and close cleanly — the client
  // shows the same retry card it always does.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(sse({ type: "phase", phase: "thinking" })));
        controller.enqueue(
          encoder.encode(
            sse({ type: "status", message: `Planning ${plan.files.length} files…` }),
          ),
        );

        controller.enqueue(encoder.encode(sse({ type: "phase", phase: "writing" })));
        controller.enqueue(
          encoder.encode(sse({ type: "status", message: "Writing files in parallel…" })),
        );

        const scaffold = await runStageScaffold({
          plan: plan.files,
          brief: args.brief,
          manifestSummary: plan.summary,
        });

        if (!scaffold.ok) {
          controller.enqueue(
            encoder.encode(
              sse({
                type: "error",
                message:
                  "Petal couldn't finish writing the files this turn. Try again — usually a one-time hiccup.",
                kind: "generation_incomplete",
                raw: `staged_pipeline:scaffold_failed:${scaffold.reason}`,
              }),
            ),
          );
          controller.close();
          return;
        }

        // Emit a file_complete event per file so the activity card shows
        // realtime progress instead of one big blob at the end.
        scaffold.files.forEach((f, i) => {
          controller.enqueue(
            encoder.encode(
              sse({
                type: "file_complete",
                path: f.path,
                bytes: f.content.length,
                index: i,
              }),
            ),
          );
        });

        controller.enqueue(encoder.encode(sse({ type: "phase", phase: "polishing" })));
        controller.enqueue(
          encoder.encode(sse({ type: "status", message: "Verifying the build…" })),
        );

        const wireup = await runStageWireup({
          files: scaffold.files,
          brief: args.brief,
        });

        if (!wireup.ok) {
          controller.enqueue(
            encoder.encode(
              sse({
                type: "error",
                message:
                  "Petal built the files but they didn't pass the safety check. Try again with a slightly clearer prompt.",
                kind: "generation_incomplete",
                raw: `staged_pipeline:wireup_failed:${wireup.reason}`,
              }),
            ),
          );
          controller.close();
          return;
        }

        controller.enqueue(
          encoder.encode(
            sse({
              type: "result",
              files: wireup.files as ProjectFile[],
              summary: wireup.summary,
            }),
          ),
        );
        controller.close();
      } catch (e) {
        controller.enqueue(
          encoder.encode(
            sse({
              type: "error",
              message: "Petal ran into an unexpected hiccup. Try again.",
              kind: "unknown",
              raw: e instanceof Error ? e.message : String(e),
            }),
          ),
        );
        controller.close();
      }
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
