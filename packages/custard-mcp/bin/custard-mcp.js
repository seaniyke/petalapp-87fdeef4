#!/usr/bin/env node
/**
 * @custardai/mcp — local (stdio) bridge to Custard AI's hosted MCP server.
 *
 * For MCP clients that only start local servers. Each JSON-RPC line from
 * stdin is sent to the hosted endpoint with your API key; each reply is
 * written to stdout. The tools themselves live on the server, so this
 * package never needs an update when tools change. No dependencies.
 *
 *   CUSTARD_API_KEY   required — your sk_custard_… key
 *   CUSTARD_MCP_URL   optional — endpoint override
 */
import readline from "node:readline";

export const DEFAULT_MCP_URL = "https://petalapp.lovable.app/api/public/v1/mcp";
const endpoint = process.env.CUSTARD_MCP_URL || DEFAULT_MCP_URL;
const apiKey = (process.env.CUSTARD_API_KEY || "").trim();
const VERSION = "1.0.0";

if (!apiKey) {
  process.stderr.write("custard-mcp: set CUSTARD_API_KEY to your Custard AI API key (sk_custard_…).\n");
  process.exit(1);
}

const write = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");

/** Ids that expect a reply in this message (single or batch). */
function idsOf(msg) {
  const list = Array.isArray(msg) ? msg : [msg];
  return list
    .filter((m) => m && typeof m === "object" && typeof m.method === "string" && (typeof m.id === "string" || typeof m.id === "number"))
    .map((m) => m.id);
}

function failAll(msg, message) {
  for (const id of idsOf(msg)) write({ jsonrpc: "2.0", id, error: { code: -32603, message } });
}

let pending = 0;
let closed = false;
const maybeExit = () => {
  if (closed && pending === 0) process.exit(0);
};

async function forward(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "User-Agent": `custard-mcp/${VERSION}`,
      },
      body: line,
    });
  } catch (e) {
    failAll(msg, `Could not reach Custard AI (${e && e.message ? e.message : "network error"}).`);
    return;
  }
  if (res.status === 202) return;
  const text = await res.text().catch(() => "");
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  if (body && (Array.isArray(body) || body.jsonrpc === "2.0") && res.ok) {
    process.stdout.write(JSON.stringify(body) + "\n");
    return;
  }
  if (res.status === 401 || res.status === 403) {
    failAll(msg, "Custard AI did not accept CUSTARD_API_KEY. Check that the key is current and not revoked.");
    return;
  }
  failAll(msg, `Custard AI answered HTTP ${res.status}.`);
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", (line) => {
  if (!line.trim()) return;
  pending++;
  forward(line).finally(() => {
    pending--;
    maybeExit();
  });
});
rl.on("close", () => {
  closed = true;
  maybeExit();
});
