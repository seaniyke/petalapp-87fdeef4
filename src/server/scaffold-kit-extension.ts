/**
 * Chrome extension kit — Manifest V3 primitives injected when the project's
 * build target is `extension`.
 *
 * These files are overwrite-protected scaffolding so the model never has to
 * reproduce MV3 boilerplate (which it gets subtly wrong: MV2 manifests,
 * `localStorage` inside a service worker, missing async `onMessage` returns).
 * The model builds the popup UI and feature logic on top of them.
 */
import type { ProjectFile } from "@/server/generate.server";

const MANIFEST = `{
  "manifest_version": 3,
  "name": "Petal Extension",
  "version": "1.0.0",
  "description": "Built with Petal.",
  "permissions": ["storage", "activeTab"],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png"
    }
  },
  "background": { "service_worker": "background.js" },
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
`;

const BACKGROUND = `// MV3 service worker. No DOM, no localStorage — use chrome.storage.
import { storage } from "./lib/storage.js";

chrome.runtime.onInstalled.addListener(async () => {
  const seen = await storage.get("installedAt");
  if (!seen) await storage.set("installedAt", new Date().toISOString());
});

// Always \`return true\` when replying asynchronously, or the port closes.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "PING":
        sendResponse({ ok: true });
        break;
      default:
        sendResponse({ ok: false, error: "Unknown message: " + message?.type });
    }
  })();
  return true;
});
`;

const STORAGE_JS = `// Promise wrapper over chrome.storage.local. chrome.storage is async in MV3.
export const storage = {
  async get(key) {
    const out = await chrome.storage.local.get(key);
    return out[key];
  },
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
    return value;
  },
  async remove(key) {
    await chrome.storage.local.remove(key);
  },
  async all() {
    return chrome.storage.local.get(null);
  },
};

/** Current tab — the one thing almost every popup needs. */
export async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}
`;

const POPUP_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Petal Extension</title>
    <link rel="stylesheet" href="popup.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="popup.js"></script>
  </body>
</html>
`;

const POPUP_CSS = `:root {
  color-scheme: light dark;
  --bg: #0b0b0f;
  --fg: #f6f6f7;
  --muted: #9b9ba4;
  --accent: #e2447a;
  --border: rgba(255, 255, 255, 0.08);
}
* { box-sizing: border-box; }
body {
  width: 360px;
  min-height: 440px;
  margin: 0;
  padding: 16px;
  background: var(--bg);
  color: var(--fg);
  font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
h1 { margin: 0 0 4px; font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
.sub { margin: 0 0 14px; color: var(--muted); font-size: 12px; }
.card {
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 12px;
  margin-bottom: 10px;
  background: rgba(255, 255, 255, 0.03);
}
button {
  width: 100%;
  min-height: 40px;
  border: 0;
  border-radius: 12px;
  background: var(--accent);
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}
button:disabled { opacity: 0.5; cursor: default; }
.empty { color: var(--muted); text-align: center; padding: 28px 8px; font-size: 13px; }
.skeleton { height: 52px; border-radius: 12px; background: rgba(255,255,255,0.06); animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.5; } }
`;

const POPUP_JS = `import { storage, activeTab } from "./lib/storage.js";

const root = document.getElementById("root");

function render(html) {
  root.innerHTML = html;
}

async function main() {
  render('<div class="skeleton"></div>');
  const tab = await activeTab();
  const saved = (await storage.get("items")) ?? [];

  render(\`
    <h1>Petal Extension</h1>
    <p class="sub">\${tab?.title ? tab.title.slice(0, 60) : "No active tab"}</p>
    \${
      saved.length
        ? saved.map((i) => \`<div class="card">\${i.title}</div>\`).join("")
        : '<div class="empty">Nothing saved yet.<br />Save this page to get started.</div>'
    }
    <button id="save">Save this page</button>
  \`);

  document.getElementById("save").addEventListener("click", async () => {
    if (!tab) return;
    const next = [{ title: tab.title, url: tab.url, at: Date.now() }, ...saved].slice(0, 50);
    await storage.set("items", next);
    main();
  });
}

main();
`;

const README = `# Chrome extension (Manifest V3)

Source lives in \`extension/\`. Build the popup UI and features on top of these files.

- \`manifest.json\` — MV3. Add permissions only when you actually use them.
- \`background.js\` — service worker. No DOM, no \`localStorage\`; use \`lib/storage.js\`.
- \`popup.html\` / \`popup.js\` / \`popup.css\` — 360px popup shell with loading, empty, and list states.
- \`lib/storage.js\` — promise wrapper over \`chrome.storage.local\` plus \`activeTab()\`.
- \`content.js\` — only create it if the extension mutates page DOM; declare narrow \`matches\`.

## Install locally

1. Download / unzip the extension folder
2. Open \`chrome://extensions\`
3. Enable **Developer mode**
4. **Load unpacked** → select the \`extension\` folder

Works in Chrome, Edge, Brave, Arc and Opera.
`;

export function extensionKit(): ProjectFile[] {
  return [
    { path: "extension/manifest.json", content: MANIFEST },
    { path: "extension/background.js", content: BACKGROUND },
    { path: "extension/lib/storage.js", content: STORAGE_JS },
    { path: "extension/popup.html", content: POPUP_HTML },
    { path: "extension/popup.css", content: POPUP_CSS },
    { path: "extension/popup.js", content: POPUP_JS },
    { path: "extension/README.md", content: README },
  ];
}
