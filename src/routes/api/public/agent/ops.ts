/**
 * Signed data gateway for generation running on the Railway builder.
 * The builder has no database key; it sends HMAC-signed op batches here.
 * See src/server/agent-ops.server.ts for the security model.
 */
import { createFileRoute } from "@tanstack/react-router";
import { verifySignature } from "@/server/builder.server";
import { AgentOpError, AgentOpsRequestSchema, runAgentOps } from "@/server/agent-ops.server";

export const Route = createFileRoute("/api/public/agent/ops")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.BUILDER_SHARED_SECRET;
        if (!secret) return new Response("Server misconfigured", { status: 500 });
        const raw = await request.text();
        if (raw.length > 4_000_000) return new Response("Too large", { status: 413 });
        const ok = verifySignature(
          secret,
          raw,
          request.headers.get("x-petal-timestamp"),
          request.headers.get("x-petal-signature"),
        );
        if (!ok) return new Response("Invalid signature", { status: 401 });
        let parsed;
        try {
          parsed = AgentOpsRequestSchema.safeParse(JSON.parse(raw));
        } catch {
          return new Response("Bad JSON", { status: 400 });
        }
        if (!parsed.success) return Response.json({ error: "invalid_ops" }, { status: 400 });
        try {
          const { createAgentOpsStore } = await import("@/server/agent-ops-store.server");
          const results = await runAgentOps(createAgentOpsStore(), parsed.data.turnId, parsed.data.ops);
          return Response.json({ results });
        } catch (e) {
          if (e instanceof AgentOpError) return Response.json({ error: e.message }, { status: e.status });
          console.error("[agent-ops] failed", (e as Error).message);
          return Response.json({ error: "internal_error" }, { status: 500 });
        }
      },
    },
  },
});
