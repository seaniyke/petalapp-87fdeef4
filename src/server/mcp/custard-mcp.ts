/**
 * Custard AI MCP server — protocol + tools, with no I/O of its own.
 *
 * Every tool is a thin client over the public REST API (/api/public/v1). The
 * caller injects `call(method, path, body)`; the hosted endpoint dispatches it
 * in-process to the same route handlers developers call over HTTP, so keys,
 * scopes, project ownership, billing and every build gate apply unchanged.
 *
 * Wire format: MCP Streamable HTTP, stateless, JSON responses (no sessions,
 * no server-initiated stream). Builds take minutes, so starting tools return
 * a turn id at once and agents poll `custard_get_build_status`.
 */
import { z } from "zod";
import { LAYOUT_ARCHETYPE_IDS, PUBLIC_LOOK_SLUGS } from "@/server/design/style-catalog";

export type ApiCall = (method: "GET" | "POST", path: string, body?: unknown) => Promise<Response>;

export const MCP_SERVER_INFO = { name: "custard-ai", title: "Custard AI", version: "1.0.0" } as const;
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const MCP_INSTRUCTIONS =
  "Custard AI builds and hosts complete web apps from a plain-language description. " +
  "Start with custard_create_web_app (or custard_edit_web_app for an existing project). Builds take a few minutes: " +
  "poll custard_get_build_status with the returned turnId about every 20 seconds until `done` is true, then share `previewUrl`. " +
  "Use custard_get_preview for an embeddable preview address and custard_publish_web_app to put the latest build live.";

/** How long a starting tool waits for the build to be accepted. */
export const START_TIMEOUT_MS = 25_000;

export class ToolError extends Error {}

const FRIENDLY: Record<string, string> = {
  unauthorized: "The API key was not accepted. Check that it is a current Custard AI key.",
  insufficient_scope: "This API key can only read. Use a key with the projects:write scope to make changes.",
  not_found: "Not found, or this API key cannot see that project or build.",
  project_not_found: "Not found, or this API key cannot see that project.",
  turn_in_progress: "Another build is already running for this project. Wait for it to finish, then try again.",
  no_ready_build: "This project has no finished build yet. Wait for the build to finish first.",
  no_build: "This project has no finished build yet. Wait for the build to finish first.",
  build_not_ready: "The latest build is not finished yet. Try again when custard_get_build_status reports done.",
  latest_changes_still_building: "The latest changes are still building. Try again when they finish.",
  invalid_origin: "allowedOrigin must look like https://host or https://host:port (http only for localhost).",
  insufficient_credits: "The account has run out of credits. Top up, then try again.",
};

async function readBody(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { value: parsed };
  } catch {
    return text ? { error: text.slice(0, 300) } : {};
  }
}

function failure(status: number, body: Record<string, unknown>): ToolError {
  const code = typeof body.error === "string" ? body.error : "";
  if (status === 409 && !FRIENDLY[code]) return new ToolError(FRIENDLY.turn_in_progress);
  if (status === 402) return new ToolError(FRIENDLY.insufficient_credits);
  const friendly = FRIENDLY[code];
  if (friendly) return new ToolError(friendly);
  if (status === 404) return new ToolError(FRIENDLY.not_found);
  if (status >= 500) return new ToolError(`Custard AI could not finish that request (HTTP ${status}). Try again shortly.`);
  return new ToolError(`Request rejected (HTTP ${status})${code ? `: ${code}` : ""}.`);
}

async function api(call: ApiCall, method: "GET" | "POST", path: string, body?: unknown) {
  const res = await call(method, path, body);
  const data = await readBody(res);
  if (!res.ok) throw failure(res.status, data);
  return data;
}

/**
 * Reads a build stream only until the build is accepted (`turn_id`), then
 * lets go. The build itself runs on the build server and does not depend on
 * this connection.
 */
export async function readTurnId(res: Response, timeoutMs = START_TIMEOUT_MS): Promise<string> {
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !res.body || !type.includes("text/event-stream")) {
    throw failure(res.ok ? 502 : res.status, await readBody(res));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ToolError("The build did not start in time. Try again.")), timeoutMs);
  });
  const scan = async (): Promise<string> => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new ToolError("The build did not start. Try again.");
      buf += decoder.decode(value, { stream: true });
      const blocks = buf.split("\n\n");
      buf = blocks.pop() ?? "";
      for (const block of blocks) {
        const line = block.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        let evt: Record<string, unknown>;
        try {
          evt = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }
        if (evt.type === "turn_id" && typeof evt.turnId === "string") return evt.turnId;
        if (evt.type === "error") throw new ToolError(`The build could not start: ${String(evt.message ?? "unknown error")}`);
        if (evt.type === "done") throw new ToolError("The build ended before it started. Try again.");
      }
    }
  };
  try {
    return await Promise.race([scan(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
}

type StyleChoice = { layout?: (typeof LAYOUT_ARCHETYPE_IDS)[number]; look?: (typeof PUBLIC_LOOK_SLUGS)[number] };

async function startBuild(call: ApiCall, projectId: string, prompt: string, style?: StyleChoice): Promise<string> {
  // MCP callers poll for status; no finish notification is sent anywhere.
  const hasStyle = !!style && (!!style.layout || !!style.look);
  const res = await call("POST", "/generate", { projectId, prompt, webhookUrl: null, ...(hasStyle ? { style } : {}) });
  return readTurnId(res);
}

const NEXT_STEP = "Call custard_get_build_status with this turnId about every 20 seconds until done is true.";

type JsonSchema = Record<string, unknown>;
type ToolDef = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint: boolean };
  parse: z.ZodTypeAny;
  run: (input: never, call: ApiCall) => Promise<Record<string, unknown>>;
};

const uuid = z.string().uuid();
const prompt = z.string().trim().min(1).max(60_000);
const externalUserId = z.string().trim().min(1).max(128);
const styleChoice = z
  .object({ layout: z.enum(LAYOUT_ARCHETYPE_IDS).optional(), look: z.enum(PUBLIC_LOOK_SLUGS).optional() })
  .strict();

const S = {
  uuid: (description: string) => ({ type: "string", format: "uuid", description }),
  prompt: { type: "string", minLength: 1, maxLength: 60000, description: "What to build or change, in plain language." },
  externalUserId: {
    type: "string",
    maxLength: 128,
    description: "Your own id for the end customer this app belongs to (optional).",
  },
};

function obj(properties: Record<string, JsonSchema>, required: string[]): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

function stageOf(status: string): "building" | "failed" | "cancelled" | "needs_credits" | "succeeded" {
  if (status === "succeeded") return "succeeded";
  if (status === "failed") return "failed";
  if (status === "aborted" || status === "cancelled") return "cancelled";
  if (status === "awaiting_credits") return "needs_credits";
  return "building";
}

type BuildRow = {
  buildId?: string;
  status?: string;
  turnId?: string | null;
  revision?: number | null;
  deploymentUrl?: string | null;
  error?: string | null;
};

export const TOOLS: ToolDef[] = [
  {
    name: "custard_create_web_app",
    title: "Create web app",
    description: "Create a new project and start building a web app from a plain-language description. Returns projectId and turnId.",
    inputSchema: obj(
      {
        prompt: S.prompt,
        title: { type: "string", maxLength: 120, description: "Project name (optional)." },
        externalUserId: S.externalUserId,
        style: {
          type: "object",
          additionalProperties: false,
          description:
            "Optional look and page layout. Omit to let Custard AI choose a fitting, varied style for this brief.",
          properties: {
            layout: { type: "string", enum: [...LAYOUT_ARCHETYPE_IDS], description: "How the public pages are composed." },
            look: { type: "string", enum: [...PUBLIC_LOOK_SLUGS], description: "Colours, fonts and shapes." },
          },
        },
      },
      ["prompt"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    parse: z
      .object({
        prompt,
        title: z.string().trim().min(1).max(120).optional(),
        externalUserId: externalUserId.optional(),
        style: styleChoice.optional(),
      })
      .strict(),
    run: async (input: { prompt: string; title?: string; externalUserId?: string; style?: StyleChoice }, call) => {
      const created = await api(call, "POST", "/projects", {
        ...(input.title ? { title: input.title } : {}),
        ...(input.externalUserId ? { externalUserId: input.externalUserId } : {}),
      });
      const projectId = String((created.project as { id?: string } | undefined)?.id ?? "");
      if (!projectId) throw new ToolError("The project could not be created. Try again.");
      try {
        const turnId = await startBuild(call, projectId, input.prompt, input.style);
        return { projectId, turnId, status: "building", next: NEXT_STEP };
      } catch (e) {
        const why = e instanceof Error ? e.message : "unknown error";
        throw new ToolError(`Project ${projectId} was created, but the build did not start: ${why} Retry with custard_edit_web_app and this projectId.`);
      }
    },
  },
  {
    name: "custard_edit_web_app",
    title: "Change web app",
    description: "Ask for changes to an existing project. Starts a new build and returns its turnId.",
    inputSchema: obj({ projectId: S.uuid("The project to change."), prompt: S.prompt }, ["projectId", "prompt"]),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    parse: z.object({ projectId: uuid, prompt }).strict(),
    run: async (input: { projectId: string; prompt: string }, call) => {
      const turnId = await startBuild(call, input.projectId, input.prompt);
      return { projectId: input.projectId, turnId, status: "building", next: NEXT_STEP };
    },
  },
  {
    name: "custard_get_build_status",
    title: "Get build status",
    description: "Check a build started by create or edit. When done is true and stage is ready, previewUrl is the live preview.",
    inputSchema: obj({ turnId: S.uuid("The turnId returned when the build started.") }, ["turnId"]),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    parse: z.object({ turnId: uuid }).strict(),
    run: async (input: { turnId: string }, call) => {
      const data = await api(call, "GET", `/turns/${input.turnId}`);
      const turn = (data.turn ?? {}) as Record<string, unknown>;
      const projectId = String(turn.project_id ?? "");
      const base = {
        turnId: input.turnId,
        projectId,
        progress: ((data.progress ?? turn.progress_label) as string | null) ?? null,
        creditsUsed: (data.creditsUsed as number | null) ?? null,
      };
      const stage = stageOf(String(turn.status ?? ""));
      if (stage !== "succeeded") {
        const done = stage !== "building";
        return { ...base, stage, done, previewUrl: null, error: (turn.error_message as string | null) ?? null };
      }
      const previewUrl = (data.previewUrl as string | null) ?? null;
      if (previewUrl) return { ...base, stage: "ready", done: true, previewUrl, error: null };
      // The AI finished; the app is being compiled, tested and deployed.
      const builds = await api(call, "GET", `/projects/${projectId}/builds?limit=10`);
      const list = (builds.builds ?? []) as BuildRow[];
      // The build server often starts the deploy itself (no turn link); match by revision then.
      const revision = typeof turn.committed_revision === "number" ? turn.committed_revision : null;
      const mine =
        list.find((b) => b.turnId === input.turnId) ??
        (revision !== null ? list.find((b) => b.revision === revision) : undefined) ??
        (builds.latest as BuildRow | null) ??
        null;
      if (mine?.status === "ready" && mine.deploymentUrl) {
        return { ...base, stage: "ready", done: true, previewUrl: mine.deploymentUrl, error: null };
      }
      if (mine?.status === "failed") {
        return { ...base, stage: "failed", done: true, previewUrl: null, error: mine.error ?? "The deploy failed." };
      }
      return { ...base, stage: "deploying", done: false, progress: base.progress ?? "Compiling, testing and deploying", previewUrl: null, error: null };
    },
  },
  {
    name: "custard_list_web_apps",
    title: "List web apps",
    description: "List projects this API key can see, newest first. Optionally only one end customer's projects.",
    inputSchema: obj({ externalUserId: S.externalUserId }, []),
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    parse: z.object({ externalUserId: externalUserId.optional() }).strict(),
    run: async (input: { externalUserId?: string }, call) => {
      const q = input.externalUserId ? `?externalUserId=${encodeURIComponent(input.externalUserId)}` : "";
      const data = await api(call, "GET", `/projects${q}`);
      const rows = (data.projects ?? []) as Array<Record<string, unknown>>;
      return {
        projects: rows.map((p) => ({
          projectId: String(p.id ?? ""),
          title: (p.title as string | null) ?? null,
          revision: (p.revision as number | null) ?? null,
          externalUserId: (p.external_user_id as string | null) ?? null,
          updatedAt: (p.updated_at as string | null) ?? null,
        })),
      };
    },
  },
  {
    name: "custard_get_preview",
    title: "Get preview address",
    description:
      "Get the latest finished preview of a project. Pass allowedOrigin to get a one-hour address that only that website may show in an iframe.",
    inputSchema: obj(
      {
        projectId: S.uuid("The project to preview."),
        allowedOrigin: {
          type: "string",
          maxLength: 300,
          description: "Origin allowed to embed the preview, e.g. https://dashboard.example.com (optional).",
        },
      },
      ["projectId"],
    ),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    parse: z.object({ projectId: uuid, allowedOrigin: z.string().trim().min(1).max(300).optional() }).strict(),
    run: async (input: { projectId: string; allowedOrigin?: string }, call) => {
      if (input.allowedOrigin) {
        const e = await api(call, "POST", `/projects/${input.projectId}/embed-preview`, { allowedOrigin: input.allowedOrigin });
        return {
          projectId: input.projectId,
          embedUrl: (e.embedUrl as string) ?? null,
          expiresAt: (e.expiresAt as string) ?? null,
          allowedOrigin: (e.allowedOrigin as string) ?? input.allowedOrigin,
          certificateReady: Boolean(e.certificateReady),
          note: e.certificateReady ? null : "First embed for this project: the address can take about a minute to start working.",
        };
      }
      const data = await api(call, "GET", `/projects/${input.projectId}/builds?limit=10`);
      const live = (data.live ?? null) as BuildRow | null;
      if (!live?.deploymentUrl) throw new ToolError(FRIENDLY.no_ready_build);
      return { projectId: input.projectId, previewUrl: live.deploymentUrl, buildId: live.buildId ?? null };
    },
  },
  {
    name: "custard_publish_web_app",
    title: "Publish web app",
    description: "Put the project's latest finished build live on its public addresses, replacing what is live now.",
    inputSchema: obj({ projectId: S.uuid("The project to publish.") }, ["projectId"]),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    parse: z.object({ projectId: uuid }).strict(),
    run: async (input: { projectId: string }, call) => {
      const r = await api(call, "POST", `/projects/${input.projectId}/publish`, {});
      return {
        projectId: input.projectId,
        published: Boolean(r.published),
        buildId: (r.buildId as string) ?? null,
        revision: (r.revision as number) ?? null,
        publishedAt: (r.publishedAt as string) ?? null,
      };
    },
  },
  {
    name: "custard_cancel_build",
    title: "Cancel build",
    description: "Stop a build that is still running. Work already saved stays saved.",
    inputSchema: obj({ turnId: S.uuid("The turnId of the build to stop.") }, ["turnId"]),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    parse: z.object({ turnId: uuid }).strict(),
    run: async (input: { turnId: string }, call) => {
      const r = await api(call, "POST", `/turns/${input.turnId}/cancel`, {});
      return { turnId: input.turnId, cancelled: Boolean(r.cancelled), status: (r.status as string) ?? null };
    },
  },
];

// ---------------------------------------------------------------- JSON-RPC

type Id = string | number | null;
type RpcResponse = { jsonrpc: "2.0"; id: Id; result?: unknown; error?: { code: number; message: string } };

export const RPC = { parse: -32700, invalid: -32600, method: -32601, params: -32602, internal: -32603 } as const;

export function rpcError(id: Id, code: number, message: string): RpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolResult(out: Record<string, unknown>) {
  return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], structuredContent: out, isError: false };
}

function toolFailure(message: string) {
  return { content: [{ type: "text", text: message }], isError: true };
}

export async function callTool(name: string, args: unknown, call: ApiCall) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return null;
  const parsed = tool.parse.safeParse(args ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    return toolFailure(`Invalid arguments — ${issues}`);
  }
  try {
    return toolResult(await tool.run(parsed.data as never, call));
  } catch (e) {
    if (e instanceof ToolError) return toolFailure(e.message);
    console.error("[custard-mcp] tool failed", name, e);
    return toolFailure("Something went wrong on Custard AI's side. Try again shortly.");
  }
}

async function handleOne(msg: unknown, call: ApiCall): Promise<RpcResponse | null> {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return rpcError(null, RPC.invalid, "Invalid request");
  const m = msg as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
  const hasId = "id" in m && (typeof m.id === "string" || typeof m.id === "number");
  const id: Id = hasId ? (m.id as string | number) : null;
  if (m.jsonrpc !== "2.0" || typeof m.method !== "string") {
    // A response or malformed message; responses from the client need no reply.
    return "result" in m || "error" in m ? null : rpcError(id, RPC.invalid, "Invalid request");
  }
  if (!hasId) return null; // notification (e.g. notifications/initialized)
  const params = (m.params ?? {}) as Record<string, unknown>;
  switch (m.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(asked)
        ? asked
        : SUPPORTED_PROTOCOL_VERSIONS[0];
      return {
        jsonrpc: "2.0",
        id,
        result: { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: MCP_SERVER_INFO, instructions: MCP_INSTRUCTIONS },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })),
        },
      };
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const result = await callTool(name, params.arguments, call);
      if (!result) return rpcError(id, RPC.params, `Unknown tool: ${name || "(none)"}`);
      return { jsonrpc: "2.0", id, result };
    }
    default:
      return rpcError(id, RPC.method, `Method not found: ${m.method}`);
  }
}

/** Handles one JSON-RPC message or a batch. Returns null when nothing needs a reply. */
export async function handleMcpPayload(payload: unknown, call: ApiCall): Promise<RpcResponse | RpcResponse[] | null> {
  if (Array.isArray(payload)) {
    if (payload.length === 0) return rpcError(null, RPC.invalid, "Empty batch");
    const out = (await Promise.all(payload.map((p) => handleOne(p, call)))).filter((r): r is RpcResponse => r !== null);
    return out.length ? out : null;
  }
  return handleOne(payload, call);
}
