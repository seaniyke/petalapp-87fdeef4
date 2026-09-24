/**
 * Railway runtime entry. Bundled into `builder/vendor/agent-core.mjs` by
 * `scripts/build-agent-core.mjs` and loaded by the build server when
 * AGENT_IN_PROCESS=1. Runs the exact same generation pipeline as the app,
 * in-process, with saved-data access served by the signed gateway.
 */
import { handleGenerateRequest } from "@/routes/api/generate";
import { runWithTurnContext } from "@/server/turn-context.server";
import { createGatewayAgentIO, createGatewayDb, createOpsSender } from "@/server/agent-runtime/gateway";

export type InProcessOptions = { appOrigin: string; secret: string; turnId: string };

export async function handleInProcess(request: Request, opts: InProcessOptions): Promise<Response> {
  const send = createOpsSender(opts);
  return runWithTurnContext(
    { turnId: opts.turnId, agentIO: createGatewayAgentIO(send), agentDb: createGatewayDb(send) },
    () => handleGenerateRequest(request),
  );
}

/** Stop from the build server: abort this turn's work controller. */
export { abortLocalTurn } from "@/server/turn-cancel.server";
