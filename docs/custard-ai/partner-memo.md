# Petal joins Custard AI: developer platform standardisation

**To:** Custard AI
**From:** Petal (app generation engine)
**Date:** 10 November 2026

## Summary

Custard AI is now the parent brand of Petal's app generation engine. From today, everything developers see (API, documentation, keys, SDKs and the MCP server) carries the Custard AI name. **Nothing in the infrastructure moves.** Databases, servers, build workers, the sites router and every address Custard already calls stay exactly as they are.

The goal is for Custard AI's documentation to be the single place developers learn about and connect to app generation.

## What does not change

- The API addresses Custard calls today and every existing endpoint, field and webhook.
- Webhook signatures and headers (`X-Petal-Signature`, `X-Petal-Event`, `X-Petal-Delivery`). These are wire identifiers; renaming them would break your receiver.
- Published sites on `*.sites.custardai.dev`, connected domains, and the build server.
- Billing: all API usage, including developer keys, draws from Custard AI's credit balance.

## What is ready now

| Capability | Status |
| --- | --- |
| Developer API keys (`sk_custard_…`), read or read-write, each key sees only its own projects | Built |
| REST API v1 and its OpenAPI description at `/api/public/v1/openapi.json` | Built |
| Embeddable previews: one-hour address that only your chosen website may show in an iframe | Built |
| Hosted MCP server at `/api/public/v1/mcp` (7 tools, same keys) | Built |
| `@custardai/mcp` local bridge for stdio-only assistants | Built, not yet on npm |
| Finish notifications retried for up to ~10 hours if your receiver is down | Built |
| Server-side search, sort and paging for site data | Built |
| Password reset and Google sign-in for sites | Built; email sending and Google sign-in await setup |

All of it goes live when Petal is next published.

## Naming standard

| Surface | Name |
| --- | --- |
| Product | Custard AI App Generation API |
| Engine credit (optional, docs footer only) | Engine: Petal by Custard AI |
| API keys | `sk_custard_…` |
| npm scope | `@custardai/*` (first package: `@custardai/mcp`) |
| MCP server name / title | `custard-ai` / Custard AI |
| MCP tool prefix | `custard_` |
| Developer-facing errors and docs | Custard AI only |
| Internal identifiers (headers, query parameters, database names) | Unchanged |

New SDKs, packages and examples follow this table. Existing internal names stay where renaming would change structure.

## What we need from Custard AI

1. **A branded API address.** Point `api.custardai.dev` at the API so documentation and the MCP package never show the engine's own address. Until then, the API keeps answering on the address you use today.
2. **npm publishing.** Create the `@custardai` organisation on npm and either add us as a publisher or publish `@custardai/mcp` yourselves from the files we supply.
3. **Key issuance.** Decide where developers get keys (for example, your dashboard calling `POST /keys` with the master key). Each key's secret is shown once.
4. **Developer billing.** Developer usage is charged to your balance. Confirm how you want to bill your developers, and whether you need per-key usage reports.
5. **Developer webhooks.** Today a developer key's finish notifications can only go to your approved receiver. Tell us if developers should register their own receivers.
6. **Documentation.** Add the API reference (from the OpenAPI file), the quickstart and the MCP setup guide to your docs. We supply all three.

## Next steps

1. Petal publishes; we confirm the API, embeds and MCP server answer from outside.
2. Custard connects `api.custardai.dev` and sets up npm; we switch the package default and publish `@custardai/mcp`.
3. Custard's docs team adds the three guides; we review them for accuracy.

Attached: *Custard AI developer platform guide* (quickstart, MCP setup, tool reference).
