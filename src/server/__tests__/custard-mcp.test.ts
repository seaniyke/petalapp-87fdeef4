import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { TOOLS, handleMcpPayload, readTurnId, type ApiCall } from "@/server/mcp/custard-mcp";

const P = "11111111-1111-4111-8111-111111111111";
const T = "22222222-2222-4222-8222-222222222222";

const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const sseRes = (...events: unknown[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });

function fakeApi(routes: Record<string, (body: unknown) => Response>) {
  const seen: Array<{ method: string; path: string; body: unknown }> = [];
  const call: ApiCall = async (method, path, body) => {
    seen.push({ method, path, body });
    const h = routes[`${method} ${path}`];
    return h ? h(body) : jsonRes({ error: "not_found" }, 404);
  };
  return { call, seen };
}

const rpc = (method: string, params?: unknown) => ({ jsonrpc: "2.0", id: 1, method, params });
async function callTool(call: ApiCall, name: string, args: unknown) {
  const out = (await handleMcpPayload(rpc("tools/call", { name, arguments: args }), call)) as { result: { isError: boolean; structuredContent?: Record<string, unknown>; content: Array<{ text: string }> } };
  return out.result;
}

describe("Custard AI MCP protocol", () => {
  it("negotiates a supported protocol version and falls back to the newest", async () => {
    const { call } = fakeApi({});
    const a = (await handleMcpPayload(rpc("initialize", { protocolVersion: "2025-03-26" }), call)) as { result: { protocolVersion: string; serverInfo: { name: string } } };
    expect(a.result.protocolVersion).toBe("2025-03-26");
    expect(a.result.serverInfo.name).toBe("custard-ai");
    const b = (await handleMcpPayload(rpc("initialize", { protocolVersion: "1999-01-01" }), call)) as { result: { protocolVersion: string } };
    expect(b.result.protocolVersion).toBe("2025-06-18");
  });

  it("sends no reply to notifications", async () => {
    const { call } = fakeApi({});
    expect(await handleMcpPayload({ jsonrpc: "2.0", method: "notifications/initialized" }, call)).toBeNull();
  });

  it("lists exactly the seven Custard tools with closed input schemas", async () => {
    const { call } = fakeApi({});
    const out = (await handleMcpPayload(rpc("tools/list"), call)) as { result: { tools: Array<{ name: string; inputSchema: { additionalProperties: boolean } }> } };
    expect(out.result.tools.map((t) => t.name)).toEqual([
      "custard_create_web_app",
      "custard_edit_web_app",
      "custard_get_build_status",
      "custard_list_web_apps",
      "custard_get_preview",
      "custard_publish_web_app",
      "custard_cancel_build",
    ]);
    for (const t of out.result.tools) expect(t.inputSchema.additionalProperties).toBe(false);
  });

  it("marks publishing and cancelling as destructive and status reads as read-only", () => {
    const by = Object.fromEntries(TOOLS.map((t) => [t.name, t.annotations]));
    expect(by.custard_publish_web_app.destructiveHint).toBe(true);
    expect(by.custard_cancel_build.destructiveHint).toBe(true);
    expect(by.custard_get_build_status.readOnlyHint).toBe(true);
    expect(by.custard_list_web_apps.readOnlyHint).toBe(true);
  });

  it("returns unknown methods and unknown tools as JSON-RPC errors", async () => {
    const { call } = fakeApi({});
    const m = (await handleMcpPayload(rpc("resources/list"), call)) as { error: { code: number } };
    expect(m.error.code).toBe(-32601);
    const t = (await handleMcpPayload(rpc("tools/call", { name: "nope", arguments: {} }), call)) as { error: { code: number } };
    expect(t.error.code).toBe(-32602);
  });
});

describe("Custard AI MCP tools", () => {
  it("create makes a project, starts its build without a webhook, and returns both ids", async () => {
    const { call, seen } = fakeApi({
      "POST /projects": () => jsonRes({ project: { id: P } }, 201),
      "POST /generate": () => sseRes({ type: "turn_id", turnId: T }, { type: "phase", phase: "thinking" }),
    });
    const r = await callTool(call, "custard_create_web_app", { prompt: "A bakery site", externalUserId: "cust-9" });
    expect(r.isError).toBe(false);
    expect(r.structuredContent).toMatchObject({ projectId: P, turnId: T, status: "building" });
    expect(seen[0].body).toEqual({ externalUserId: "cust-9" });
    expect(seen[1].body).toEqual({ projectId: P, prompt: "A bakery site", webhookUrl: null });
  });

  it("create reports the project id when the build fails to start", async () => {
    const { call } = fakeApi({
      "POST /projects": () => jsonRes({ project: { id: P } }, 201),
      "POST /generate": () => jsonRes({ error: "insufficient_credits" }, 402),
    });
    const r = await callTool(call, "custard_create_web_app", { prompt: "A bakery site" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain(P);
    expect(r.content[0].text).toContain("credits");
  });

  it("edit on a busy project explains that another build is running", async () => {
    const { call } = fakeApi({ "POST /generate": () => jsonRes({ error: "turn_running" }, 409) });
    const r = await callTool(call, "custard_edit_web_app", { projectId: P, prompt: "Make it blue" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("already running");
  });

  it("rejects undeclared and invalid arguments", async () => {
    const { call, seen } = fakeApi({});
    const a = await callTool(call, "custard_edit_web_app", { projectId: "not-a-uuid", prompt: "x" });
    expect(a.isError).toBe(true);
    const b = await callTool(call, "custard_get_build_status", { turnId: T, extra: 1 });
    expect(b.isError).toBe(true);
    expect(seen).toHaveLength(0);
  });

  it("status: running turn is not done; succeeded turn with a live address is ready", async () => {
    const running = fakeApi({ [`GET /turns/${T}`]: () => jsonRes({ turn: { project_id: P, status: "running", progress_label: "Writing pages" }, creditsUsed: 0 }) });
    const a = await callTool(running.call, "custard_get_build_status", { turnId: T });
    expect(a.structuredContent).toMatchObject({ stage: "building", done: false, progress: "Writing pages" });

    const ready = fakeApi({ [`GET /turns/${T}`]: () => jsonRes({ turn: { project_id: P, status: "succeeded" }, creditsUsed: 12.5, previewUrl: "https://x.pages.dev" }) });
    const b = await callTool(ready.call, "custard_get_build_status", { turnId: T });
    expect(b.structuredContent).toMatchObject({ stage: "ready", done: true, previewUrl: "https://x.pages.dev", creditsUsed: 12.5 });
  });

  it("status: succeeded turn whose deploy is still running reports deploying, a failed deploy reports failed", async () => {
    const turn = () => jsonRes({ turn: { project_id: P, status: "succeeded" }, previewUrl: null });
    const deploying = fakeApi({
      [`GET /turns/${T}`]: turn,
      [`GET /projects/${P}/builds?limit=10`]: () => jsonRes({ builds: [{ turnId: T, status: "building" }] }),
    });
    expect((await callTool(deploying.call, "custard_get_build_status", { turnId: T })).structuredContent).toMatchObject({ stage: "deploying", done: false });
    const failed = fakeApi({
      [`GET /turns/${T}`]: turn,
      [`GET /projects/${P}/builds?limit=10`]: () => jsonRes({ builds: [{ turnId: T, status: "failed", error: "tests failed" }] }),
    });
    expect((await callTool(failed.call, "custard_get_build_status", { turnId: T })).structuredContent).toMatchObject({ stage: "failed", done: true, error: "tests failed" });
  });

  it("status: a deploy started by the build server (no turn link) is matched by revision", async () => {
    const f = fakeApi({
      [`GET /turns/${T}`]: () => jsonRes({ turn: { project_id: P, status: "succeeded", committed_revision: 4 }, previewUrl: null }),
      [`GET /projects/${P}/builds?limit=10`]: () =>
        jsonRes({
          latest: { turnId: null, revision: 5, status: "building" },
          builds: [
            { turnId: null, revision: 5, status: "building" },
            { turnId: null, revision: 4, status: "ready", deploymentUrl: "https://rev4" },
          ],
        }),
    });
    expect((await callTool(f.call, "custard_get_build_status", { turnId: T })).structuredContent).toMatchObject({ stage: "ready", previewUrl: "https://rev4" });
  });

  it("status: aborted and awaiting_credits turns are done with clear stages", async () => {
    for (const [status, stage] of [["aborted", "cancelled"], ["awaiting_credits", "needs_credits"], ["failed", "failed"]]) {
      const f = fakeApi({ [`GET /turns/${T}`]: () => jsonRes({ turn: { project_id: P, status } }) });
      expect((await callTool(f.call, "custard_get_build_status", { turnId: T })).structuredContent).toMatchObject({ stage, done: true });
    }
  });

  it("preview with an origin asks for an embed address; without one returns the live build", async () => {
    const { call, seen } = fakeApi({
      [`POST /projects/${P}/embed-preview`]: () => jsonRes({ embedUrl: "https://e", expiresAt: "t", allowedOrigin: "https://a.com", certificateReady: true }, 201),
      [`GET /projects/${P}/builds?limit=10`]: () => jsonRes({ live: { buildId: "b1", deploymentUrl: "https://live" } }),
    });
    expect((await callTool(call, "custard_get_preview", { projectId: P, allowedOrigin: "https://a.com" })).structuredContent).toMatchObject({ embedUrl: "https://e" });
    expect(seen[0].body).toEqual({ allowedOrigin: "https://a.com" });
    expect((await callTool(call, "custard_get_preview", { projectId: P })).structuredContent).toMatchObject({ previewUrl: "https://live" });
  });

  it("a read-only key gets a clear message instead of a raw error", async () => {
    const { call } = fakeApi({ [`POST /projects/${P}/publish`]: () => jsonRes({ error: "insufficient_scope", needed: "projects:write" }, 403) });
    const r = await callTool(call, "custard_publish_web_app", { projectId: P });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("projects:write");
  });

  it("list maps projects and passes the end-customer filter", async () => {
    const { call, seen } = fakeApi({
      "GET /projects?externalUserId=c%201": () => jsonRes({ projects: [{ id: P, title: "Bakery", revision: 3, external_user_id: "c 1", updated_at: "u" }] }),
    });
    const r = await callTool(call, "custard_list_web_apps", { externalUserId: "c 1" });
    expect(seen[0].path).toBe("/projects?externalUserId=c%201");
    expect(r.structuredContent).toEqual({ projects: [{ projectId: P, title: "Bakery", revision: 3, externalUserId: "c 1", updatedAt: "u" }] });
  });
});

describe("readTurnId", () => {
  it("stops at turn_id and surfaces stream errors", async () => {
    expect(await readTurnId(sseRes({ type: "status" }, { type: "turn_id", turnId: T }))).toBe(T);
    await expect(readTurnId(sseRes({ type: "error", message: "boom" }))).rejects.toThrow("boom");
    await expect(readTurnId(sseRes({ type: "done", status: "failed" }))).rejects.toThrow();
  });

  it("times out when the build never starts", async () => {
    const stalled = new Response(new ReadableStream({ start() {} }), { headers: { "Content-Type": "text/event-stream" } });
    await expect(readTurnId(stalled, 50)).rejects.toThrow("in time");
  });
});

describe("@custardai/mcp stdio bridge", () => {
  it("forwards each line with the API key and writes the reply; stays quiet on 202", async () => {
    const auths: string[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        auths.push(String(req.headers.authorization));
        const msg = JSON.parse(body);
        if (msg.id === undefined) {
          res.writeHead(202).end();
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { ok: true } }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      const child = spawn(process.execPath, ["packages/custard-mcp/bin/custard-mcp.js"], {
        env: { ...process.env, CUSTARD_API_KEY: "sk_custard_test", CUSTARD_MCP_URL: `http://127.0.0.1:${port}/mcp` },
      });
      let out = "";
      child.stdout.on("data", (c) => (out += c));
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping" }) + "\n");
      child.stdin.end();
      await new Promise((r) => child.on("exit", r));
      expect(out.trim().split("\n").map((l) => JSON.parse(l))).toEqual([{ jsonrpc: "2.0", id: 7, result: { ok: true } }]);
      expect(auths).toEqual(["Bearer sk_custard_test", "Bearer sk_custard_test"]);
    } finally {
      server.close();
    }
  });

  it("refuses to start without an API key", async () => {
    const env = { ...process.env };
    delete env.CUSTARD_API_KEY;
    const child = spawn(process.execPath, ["packages/custard-mcp/bin/custard-mcp.js"], { env });
    const code = await new Promise((r) => child.on("exit", r));
    expect(code).toBe(1);
  });
});
