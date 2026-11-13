/**
 * OpenAPI 3.1 description of the Custard AI App Generation API (engine: Petal).
 * Documents only endpoints that exist under /api/public/v1. The server URL is
 * filled from the request origin so the spec always points at the host that served it.
 */

import { LAYOUT_ARCHETYPE_IDS, PUBLIC_LOOK_SLUGS } from "@/server/design/style-catalog";

const err = { $ref: "#/components/responses/Error" };
const projectId = { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } };
const turnId = { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } };

export function openApiSpec(origin: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Custard AI App Generation API",
      version: "1.0.0",
      description:
        "Create projects, ask the AI to build or change a web app, follow progress, embed a live preview and publish. Engine: Petal by Custard AI.",
    },
    servers: [{ url: `${origin}/api/public/v1` }],
    security: [{ bearer: [] }],
    tags: [
      { name: "Projects" },
      { name: "Generation" },
      { name: "Builds & publishing" },
      { name: "Embedding" },
      { name: "MCP", description: "For AI assistants (Claude, Cursor, VS Code, ChatGPT…)." },
      { name: "Keys", description: "Master key only." },
    ],
    paths: {
      "/projects": {
        get: {
          tags: ["Projects"],
          summary: "List projects",
          description: "Developer keys see only projects they created.",
          parameters: [{ name: "externalUserId", in: "query", schema: { type: "string", maxLength: 128 } }],
          responses: {
            "200": {
              description: "Projects",
              content: { "application/json": { schema: { type: "object", properties: { projects: { type: "array", items: { $ref: "#/components/schemas/Project" } } } } } },
            },
            "401": err,
          },
        },
        post: {
          tags: ["Projects"],
          summary: "Create a project",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    title: { type: "string", maxLength: 120 },
                    externalUserId: { type: "string", maxLength: 128, description: "Your own user id, for filtering." },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Created", content: { "application/json": { schema: { type: "object", properties: { project: { $ref: "#/components/schemas/Project" } } } } } },
            "400": err,
            "401": err,
          },
        },
      },
      "/mcp": {
        post: {
          tags: ["MCP"],
          summary: "Model Context Protocol endpoint for AI assistants",
          description:
            "Streamable HTTP MCP server (stateless, JSON responses). Same bearer key as the REST API; each tool keeps the key's scope and project access. Tools: custard_create_web_app, custard_edit_web_app, custard_get_build_status, custard_list_web_apps, custard_get_preview, custard_publish_web_app, custard_cancel_build. Local stdio clients can use the @custardai/mcp package.",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", description: "A JSON-RPC 2.0 message or batch." } } } },
          responses: {
            "200": { description: "JSON-RPC response", content: { "application/json": { schema: { type: "object" } } } },
            "202": { description: "Notification accepted (no body)." },
            "401": err,
          },
        },
      },
      "/generate": {
        post: {
          tags: ["Generation"],
          summary: "Build or change a project from a prompt",
          description:
            "Starts one AI turn. Responds with a Server-Sent Events stream of progress events ending in a `done` event. If you disconnect, follow the turn with GET /turns/{id}/events. A signed webhook is also sent when the turn finishes.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["projectId", "prompt"],
                  properties: {
                    projectId: { type: "string", format: "uuid" },
                    prompt: { type: "string", maxLength: 60000 },
                    history: {
                      type: "array",
                      maxItems: 100,
                      items: { type: "object", properties: { role: { enum: ["user", "assistant"] }, content: { type: "string" } } },
                    },
                    webhookUrl: {
                      type: ["string", "null"],
                      format: "uri",
                      description: "Where to send the signed finish notification. null sends none (poll GET /turns/{id} instead).",
                    },
                    planFirst: { type: "boolean" },
                    style: {
                      type: "object",
                      additionalProperties: false,
                      description:
                        "Optional look and page layout for the project's first build. Omit to let Custard AI choose (similar briefs on different projects get different styles). Ignored once the project's design is set, so later changes keep the same style.",
                      properties: {
                        layout: { enum: [...LAYOUT_ARCHETYPE_IDS], description: "How public pages are composed." },
                        look: { enum: [...PUBLIC_LOOK_SLUGS], description: "Colours, fonts and shapes." },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Progress stream", content: { "text/event-stream": { schema: { type: "string" } } } },
            "400": err,
            "401": err,
            "404": err,
            "409": { description: "Another turn is already running for this project." },
          },
        },
      },
      "/turns/{id}": {
        get: {
          tags: ["Generation"],
          summary: "Get a turn's status, cost and preview address",
          parameters: [turnId],
          responses: {
            "200": { description: "Turn", content: { "application/json": { schema: { $ref: "#/components/schemas/TurnResponse" } } } },
            "404": err,
          },
        },
      },
      "/turns/{id}/events": {
        get: {
          tags: ["Generation"],
          summary: "Replay and follow a turn's events",
          parameters: [turnId, { name: "after", in: "query", schema: { type: "integer", minimum: 0 }, description: "Last seq you received." }],
          responses: { "200": { description: "Event stream", content: { "text/event-stream": { schema: { type: "string" } } } }, "404": err },
        },
      },
      "/turns/{id}/cancel": {
        post: {
          tags: ["Generation"],
          summary: "Stop a running turn",
          parameters: [turnId],
          responses: { "200": { description: "Cancelled", content: { "application/json": { schema: { type: "object", properties: { cancelled: { type: "boolean" }, status: { type: "string" } } } } } }, "404": err },
        },
      },
      "/projects/{id}/files": {
        get: {
          tags: ["Projects"],
          summary: "Download the project's source files",
          parameters: [projectId],
          responses: { "200": { description: "Files at the current revision" }, "404": err },
        },
      },
      "/projects/{id}/build": {
        post: {
          tags: ["Builds & publishing"],
          summary: "Compile, test and deploy the current code",
          description: "Idempotent per code revision.",
          parameters: [projectId],
          responses: {
            "202": { description: "Accepted", content: { "application/json": { schema: { type: "object", properties: { buildId: { type: "string" }, status: { type: "string" }, reused: { type: "boolean" }, revision: { type: "integer" } } } } } },
            "404": err,
          },
        },
      },
      "/projects/{id}/builds": {
        get: {
          tags: ["Builds & publishing"],
          summary: "Recent builds (or one with ?buildId=)",
          parameters: [projectId, { name: "buildId", in: "query", schema: { type: "string", format: "uuid" } }],
          responses: { "200": { description: "Builds", content: { "application/json": { schema: { type: "object", properties: { revision: { type: "integer" }, latest: { $ref: "#/components/schemas/Build" }, builds: { type: "array", items: { $ref: "#/components/schemas/Build" } } } } } } }, "404": err },
        },
      },
      "/projects/{id}/publish": {
        post: {
          tags: ["Builds & publishing"],
          summary: "Put the latest ready build live",
          parameters: [projectId],
          responses: { "200": { description: "Published", content: { "application/json": { schema: { type: "object", properties: { published: { type: "boolean" }, buildId: { type: "string" }, revision: { type: "integer" }, publishedAt: { type: "string", format: "date-time" } } } } } }, "404": err, "409": err },
        },
      },
      "/projects/{id}/embed-preview": {
        post: {
          tags: ["Embedding"],
          summary: "Get a one-hour preview address you can show in an iframe",
          description:
            "Only `allowedOrigin` may frame the page. The first call for a project requests its address certificate; until `certificateReady` is true the address can take about a minute to start working.",
          parameters: [projectId],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["allowedOrigin"], properties: { allowedOrigin: { type: "string", examples: ["https://dashboard.example.com"] } } } } },
          },
          responses: {
            "201": {
              description: "Embed address",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      embedUrl: { type: "string", format: "uri" },
                      expiresAt: { type: "string", format: "date-time" },
                      allowedOrigin: { type: "string" },
                      previewHost: { type: "string" },
                      certificateReady: { type: "boolean" },
                    },
                  },
                },
              },
            },
            "400": err,
            "404": err,
            "409": { description: "The project has no ready build yet." },
          },
        },
      },
      "/keys": {
        get: { tags: ["Keys"], summary: "List developer keys", responses: { "200": { description: "Keys (never the secret)" }, "403": err } },
        post: {
          tags: ["Keys"],
          summary: "Create a developer key",
          description: "The secret is returned once.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: {
                    name: { type: "string", maxLength: 120 },
                    ownerLabel: { type: "string", maxLength: 200 },
                    scopes: { type: "array", items: { enum: ["projects:read", "projects:write"] } },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "Created; includes `secret`" }, "400": err, "403": err },
        },
      },
      "/keys/{id}": {
        delete: { tags: ["Keys"], summary: "Revoke a developer key", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }], responses: { "200": { description: "Revoked" }, "403": err, "404": err } },
      },
    },
    components: {
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer", description: "A developer key (sk_custard_…) or the master key." },
      },
      responses: {
        Error: { description: "Error", content: { "application/json": { schema: { type: "object", properties: { error: { type: "string" } } } } } },
      },
      schemas: {
        Project: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
            title: { type: "string" },
            revision: { type: "integer" },
            external_user_id: { type: ["string", "null"] },
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" },
          },
        },
        Build: {
          type: ["object", "null"],
          properties: {
            buildId: { type: "string" },
            status: { enum: ["pending", "building", "ready", "failed"] },
            revision: { type: ["integer", "null"] },
            turnId: { type: ["string", "null"] },
            deploymentUrl: { type: ["string", "null"] },
            progress: { type: ["string", "null"] },
            error: { type: ["string", "null"] },
            createdAt: { type: "string", format: "date-time" },
            readyAt: { type: ["string", "null"] },
          },
        },
        TurnResponse: {
          type: "object",
          properties: {
            turn: {
              type: "object",
              properties: {
                id: { type: "string" },
                project_id: { type: "string" },
                status: { type: "string", examples: ["running", "succeeded", "failed", "cancelled"] },
                progress_label: { type: ["string", "null"] },
                error_message: { type: ["string", "null"] },
                previewUrl: { type: ["string", "null"] },
              },
            },
            creditsUsed: { type: "number" },
            previewUrl: { type: ["string", "null"] },
          },
        },
      },
    },
  };
}
