# @custardai/mcp

Let any AI assistant build, preview and publish complete web apps with **Custard AI**.

Custard AI runs a hosted [Model Context Protocol](https://modelcontextprotocol.io) server. Clients that support remote MCP servers connect to it directly. This package is a small local bridge for clients that only start local (stdio) servers. It has no dependencies, and tools are defined on the server, so you never need to update the package when tools change.

## What you need

- A Custard AI API key (`sk_custard_…`). Keys with `projects:read` can list and check builds; creating, changing and publishing needs `projects:write`.
- Node.js 18 or newer (local bridge only).

## Connect

### Remote (recommended)

Point your client at the hosted endpoint and send your key as a bearer token:

```
URL:     <API_BASE>/mcp
Header:  Authorization: Bearer sk_custard_…
```

Claude Code:

```bash
claude mcp add --transport http custard <API_BASE>/mcp --header "Authorization: Bearer $CUSTARD_API_KEY"
```

Cursor / VS Code (`mcp.json`):

```json
{
  "mcpServers": {
    "custard": {
      "url": "<API_BASE>/mcp",
      "headers": { "Authorization": "Bearer sk_custard_…" }
    }
  }
}
```

### Local bridge (stdio)

Claude Desktop (`claude_desktop_config.json`) and other stdio-only clients:

```json
{
  "mcpServers": {
    "custard": {
      "command": "npx",
      "args": ["-y", "@custardai/mcp"],
      "env": { "CUSTARD_API_KEY": "sk_custard_…" }
    }
  }
}
```

| Variable | Required | Meaning |
| --- | --- | --- |
| `CUSTARD_API_KEY` | yes | Your API key. |
| `CUSTARD_MCP_URL` | no | Endpoint override (defaults to Custard AI's hosted endpoint). |

## Tools

| Tool | What it does |
| --- | --- |
| `custard_create_web_app` | Creates a project and starts building it from a description. Returns `projectId` and `turnId`. |
| `custard_edit_web_app` | Starts a change to an existing project. Returns `turnId`. |
| `custard_get_build_status` | Reports `stage` (`building`, `deploying`, `ready`, `failed`, `cancelled`, `needs_credits`), `done`, `previewUrl` and `creditsUsed`. |
| `custard_list_web_apps` | Lists the projects your key can see, optionally for one `externalUserId`. |
| `custard_get_preview` | Latest finished preview. With `allowedOrigin`, a one-hour address only that website may show in an iframe. |
| `custard_publish_web_app` | Puts the latest finished build live. Replaces what is live now. |
| `custard_cancel_build` | Stops a running build. |

Builds take a few minutes. Starting tools return immediately; assistants poll `custard_get_build_status` about every 20 seconds until `done` is true.

## Security

- Each key sees only the projects it created.
- The bridge sends your key only to the configured endpoint and never logs it.
- Revoke a key at any time; calls with a revoked key fail immediately.

## Licence

MIT
