/**
 * In-process dispatch for the hosted MCP endpoint: each tool's REST call is
 * handed to the very route handler a developer would reach over HTTP, with the
 * caller's own Authorization header. No second copy of auth, scoping or build
 * logic exists for MCP.
 */
import type { ApiCall } from "@/server/mcp/custard-mcp";

type Handler = (ctx: { request: Request; params: Record<string, string> }) => Promise<Response>;
type RouteModule = { Route: unknown };

const ID = "([0-9a-fA-F-]{36})";
const TABLE: Array<{ pattern: RegExp; keys: string[]; load: () => Promise<RouteModule> }> = [
  { pattern: /^\/projects$/, keys: [], load: () => import("@/routes/api/public/v1/projects") },
  { pattern: /^\/generate$/, keys: [], load: () => import("@/routes/api/public/v1/generate") },
  { pattern: new RegExp(`^/turns/${ID}$`), keys: ["id"], load: () => import("@/routes/api/public/v1/turns/$id") },
  { pattern: new RegExp(`^/turns/${ID}/cancel$`), keys: ["id"], load: () => import("@/routes/api/public/v1/turns/$id.cancel") },
  { pattern: new RegExp(`^/projects/${ID}/builds$`), keys: ["id"], load: () => import("@/routes/api/public/v1/projects/$id.builds") },
  { pattern: new RegExp(`^/projects/${ID}/embed-preview$`), keys: ["id"], load: () => import("@/routes/api/public/v1/projects/$id.embed-preview") },
  { pattern: new RegExp(`^/projects/${ID}/publish$`), keys: ["id"], load: () => import("@/routes/api/public/v1/projects/$id.publish") },
];

function handlerOf(mod: RouteModule, method: string): Handler | null {
  const options = (mod.Route as { options?: { server?: { handlers?: unknown } } } | undefined)?.options;
  const handlers = options?.server?.handlers;
  if (!handlers || typeof handlers !== "object") return null;
  const h = (handlers as Record<string, unknown>)[method];
  return typeof h === "function" ? (h as Handler) : null;
}

function notFound(): Response {
  return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } });
}

export function inProcessApiCall(original: Request): ApiCall {
  const authorization = original.headers.get("authorization") ?? "";
  return async (method, path, body) => {
    const url = new URL(`/api/public/v1${path}`, original.url);
    const entry = TABLE.find((r) => r.pattern.test(url.pathname.slice("/api/public/v1".length)));
    if (!entry) return notFound();
    const match = url.pathname.slice("/api/public/v1".length).match(entry.pattern)!;
    const params = Object.fromEntries(entry.keys.map((k, i) => [k, match[i + 1]]));
    const handler = handlerOf(await entry.load(), method);
    if (!handler) return notFound();
    const request = new Request(url, {
      method,
      headers: { authorization, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return handler({ request, params });
  };
}
