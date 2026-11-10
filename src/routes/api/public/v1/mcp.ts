/**
 * POST /api/public/v1/mcp — Custard AI's hosted MCP server (Streamable HTTP,
 * stateless, JSON responses). Authenticate with `Authorization: Bearer <key>`
 * (a developer `sk_custard_…` key or the master key). Each tool re-checks the
 * key's scope and project access through the regular REST handlers.
 */
import { createFileRoute } from "@tanstack/react-router";
import { verifyApiCaller } from "@/server/service-api.server";
import { RPC, handleMcpPayload, rpcError } from "@/server/mcp/custard-mcp";
import { inProcessApiCall } from "@/server/mcp/dispatch.server";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "Mcp-Protocol-Version, WWW-Authenticate",
};

function reply(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...(body === null ? {} : { "Content-Type": "application/json" }), ...CORS, ...extra },
  });
}

const noStream = () => reply({ error: "This server does not open a stream. Send JSON-RPC messages with POST." }, 405, { Allow: "POST, OPTIONS" });

export const Route = createFileRoute("/api/public/v1/mcp")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () => noStream(),
      DELETE: async () => noStream(),
      POST: async ({ request }) => {
        // Identify the caller with the lowest scope (read); write tools are
        // checked again by the handlers they reach.
        const probe = new Request(request.url, { method: "GET", headers: { authorization: request.headers.get("authorization") ?? "" } });
        const denied = await verifyApiCaller(probe);
        if (denied) {
          return reply(rpcError(null, RPC.invalid, "Unauthorized: send Authorization: Bearer <your Custard AI API key>."), denied.status, {
            "WWW-Authenticate": 'Bearer realm="custard-ai"',
          });
        }
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return reply(rpcError(null, RPC.parse, "Parse error"), 400);
        }
        const out = await handleMcpPayload(payload, inProcessApiCall(request));
        return out === null ? reply(null, 202) : reply(out);
      },
    },
  },
});
