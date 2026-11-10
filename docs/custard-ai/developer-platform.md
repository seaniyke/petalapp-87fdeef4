# Custard AI developer platform guide

Build, change, preview and publish complete web apps from a plain-language description, through a REST API or any MCP-capable AI assistant.

`<API_BASE>` below is the API address Custard AI gives you with your key (planned: `https://api.custardai.dev`). All paths are under `<API_BASE>/api/public/v1` until the branded address is connected.

## 1. Keys

Every request sends `Authorization: Bearer sk_custard_…`.

| Scope | Allows |
| --- | --- |
| `projects:read` | List projects, read builds and status, follow progress |
| `projects:write` | Everything above, plus create, change, embed, publish and cancel |

A key sees only the projects it created. A revoked key stops working immediately.

## 2. REST quickstart

```bash
# 1. Create a project
curl -X POST "$API/projects" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"title":"Juniper Tea","externalUserId":"customer-42"}'

# 2. Build it (Server-Sent Events stream; the first event carries turnId)
curl -N -X POST "$API/generate" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"projectId":"<id>","prompt":"A one-page site for a loose-leaf tea shop","webhookUrl":null}'

# 3. Check progress any time (safe to disconnect from step 2)
curl "$API/turns/<turnId>" -H "Authorization: Bearer $KEY"

# 4. Get an address your app may show in an iframe for one hour
curl -X POST "$API/projects/<id>/embed-preview" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"allowedOrigin":"https://dashboard.example.com"}'

# 5. Put the latest build live
curl -X POST "$API/projects/<id>/publish" -H "Authorization: Bearer $KEY"
```

The full reference is the OpenAPI description at `GET /openapi.json` (no key needed).

### Finish notifications

Pass `webhookUrl` to receive a signed `POST` when a build finishes. Verify `X-Petal-Signature` (`sha256=` HMAC of the raw body) and ignore repeats with the same `X-Petal-Delivery` id. If your receiver is down, delivery is retried after 1 min, 5 min, 15 min, 1 h, 3 h and 6 h. Pass `null` to receive none and poll instead.

## 3. MCP for AI assistants

### Remote (recommended)

```
URL:     <API_BASE>/api/public/v1/mcp
Header:  Authorization: Bearer sk_custard_…
```

Claude Code:

```bash
claude mcp add --transport http custard "<API_BASE>/api/public/v1/mcp" --header "Authorization: Bearer $CUSTARD_API_KEY"
```

Cursor / VS Code `mcp.json`:

```json
{ "mcpServers": { "custard": { "url": "<API_BASE>/api/public/v1/mcp", "headers": { "Authorization": "Bearer sk_custard_…" } } } }
```

### Local bridge (Claude Desktop and other stdio-only clients)

```json
{ "mcpServers": { "custard": { "command": "npx", "args": ["-y", "@custardai/mcp"], "env": { "CUSTARD_API_KEY": "sk_custard_…" } } } }
```

### Tools

| Tool | Input | Returns |
| --- | --- | --- |
| `custard_create_web_app` | `prompt`, `title?`, `externalUserId?` | `projectId`, `turnId`, `status: building` |
| `custard_edit_web_app` | `projectId`, `prompt` | `turnId` |
| `custard_get_build_status` | `turnId` | `stage`, `done`, `previewUrl`, `creditsUsed`, `error` |
| `custard_list_web_apps` | `externalUserId?` | `projects[]` |
| `custard_get_preview` | `projectId`, `allowedOrigin?` | `previewUrl`, or `embedUrl` + `expiresAt` |
| `custard_publish_web_app` | `projectId` | `published`, `buildId`, `publishedAt` |
| `custard_cancel_build` | `turnId` | `cancelled`, `status` |

`stage` is one of `building`, `deploying`, `ready`, `failed`, `cancelled`, `needs_credits`. Builds take a few minutes; assistants poll `custard_get_build_status` about every 20 seconds until `done` is true.

Publishing and cancelling are marked as destructive, so assistants ask before running them.

## 4. Errors

| HTTP | `error` | Meaning |
| --- | --- | --- |
| 401 | `unauthorized` | Missing, wrong or revoked key |
| 403 | `insufficient_scope` | Read-only key used for a change |
| 404 | `not_found` | No such project, or not one this key created |
| 409 | — | Another build is already running for this project |
| 409 | `no_ready_build` | Nothing finished to preview or publish yet |

MCP tools return the same conditions as readable messages with `isError: true`.
