import type { WebContainer, FileSystemTree } from "@webcontainer/api";
import type { ProjectFile } from "@/server/generate.server";

type LogLine = { stream: "stdout" | "stderr" | "system"; text: string };
type Listener = (line: LogLine) => void;
type ServerListener = (url: string | null) => void;

let bootPromise: Promise<WebContainer> | null = null;
let instance: WebContainer | null = null;
const logListeners = new Set<Listener>();
const serverListeners = new Set<ServerListener>();
let currentServerUrl: string | null = null;

function emitLog(line: LogLine) {
  for (const l of logListeners) l(line);
}

function emitServer(url: string | null) {
  currentServerUrl = url;
  for (const l of serverListeners) l(url);
}

/** Subscribe to streaming logs from npm install / npm run dev. */
export function subscribeLogs(fn: Listener): () => void {
  logListeners.add(fn);
  return () => logListeners.delete(fn);
}

/** Subscribe to dev-server URL changes. */
export function subscribeServer(fn: ServerListener): () => void {
  serverListeners.add(fn);
  // Immediately notify with the current value.
  fn(currentServerUrl);
  return () => serverListeners.delete(fn);
}

/** Boot the WebContainer once per page load. Safe to call concurrently. */
export async function getContainer(): Promise<WebContainer> {
  if (instance) return instance;
  if (bootPromise) return bootPromise;
  emitLog({ stream: "system", text: "Booting WebContainer…" });
  // Lazy-import keeps ~150KB out of the initial /builder bundle.
  const { WebContainer } = await import("@webcontainer/api");
  bootPromise = WebContainer.boot().then((wc) => {
    instance = wc;
    wc.on("server-ready", (_port, url) => {
      emitLog({ stream: "system", text: `Dev server ready at ${url}` });
      emitServer(url);
    });
    wc.on("error", ({ message }) => {
      emitLog({ stream: "stderr", text: `WebContainer error: ${message}` });
    });
    return wc;
  });
  return bootPromise;
}

/** Convert our flat ProjectFile[] to the nested FileSystemTree the API wants. */
function filesToTree(files: ProjectFile[]): FileSystemTree {
  const root: FileSystemTree = {};
  for (const f of files) {
    const parts = f.path.split("/").filter(Boolean);
    let node: FileSystemTree = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      if (isLast) {
        node[name] = { file: { contents: f.content } };
      } else {
        const existing = node[name];
        if (!existing || !("directory" in existing)) {
          node[name] = { directory: {} };
        }
        node = (node[name] as { directory: FileSystemTree }).directory;
      }
    }
  }
  return root;
}

/** Mount the given files into the container, replacing whatever was there. */
export async function mountProject(files: ProjectFile[]): Promise<void> {
  const wc = await getContainer();
  const tree = filesToTree(files);
  await wc.mount(tree);
}

/**
 * Picker script injected into running projects so the parent can pick an
 * element by clicking inside the iframe. Cross-origin iframes can't be
 * inspected from the parent, so the script lives inside the running app and
 * communicates back via window.postMessage. It is dormant until the parent
 * sends `{ type: "petal:pick:enable" }`.
 *
 * Idempotency / SPA-navigation safety:
 *   - The script tag carries `data-petal-picker-version="N"`. Bump
 *     PICKER_VERSION any time we ship a behaviour change so old cached
 *     copies don't win.
 *   - On each load the script checks `window.__petalPickerVersion`. If a
 *     newer version is present it tears down the previous handlers (stored
 *     on `window.__petalPickerCleanup`) before re-installing. This keeps the
 *     picker working after Vite full reloads or SPA navigations inside the
 *     iframe — the document changes, but the picker just reattaches.
 *   - The script always re-emits `petal:pick:ready` to the parent so the
 *     parent can immediately re-push the current `pickActive` state.
 */
const PICKER_VERSION = 2;
const PICKER_SCRIPT = `(() => {
  var VERSION = ${PICKER_VERSION};
  // If a same-or-newer copy already attached its handlers in this document,
  // there's nothing to do.
  if (window.__petalPickerVersion && window.__petalPickerVersion >= VERSION && window.__petalPickerCleanup) {
    parent.postMessage({ type: 'petal:pick:ready' }, '*');
    return;
  }
  // Tear down any previous (older) picker installed on this document.
  try { if (window.__petalPickerCleanup) window.__petalPickerCleanup(); } catch (_) {}
  window.__petalPickerVersion = VERSION;
  let active = false;
  let outline = null;
  let label = null;
  let lastTarget = null;
  function ensureOverlay() {
    if (outline) return;
    outline = document.createElement('div');
    outline.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #ec4899;background:rgba(236,72,153,0.08);border-radius:4px;transition:all 60ms ease;display:none;';
    label = document.createElement('div');
    label.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;background:#ec4899;color:#fff;font:600 11px/1.2 system-ui,sans-serif;padding:3px 6px;border-radius:4px;display:none;white-space:nowrap;max-width:280px;overflow:hidden;text-overflow:ellipsis;';
    document.documentElement.appendChild(outline);
    document.documentElement.appendChild(label);
  }
  function paint(el) {
    if (!el || !outline) return;
    const r = el.getBoundingClientRect();
    outline.style.display = 'block';
    outline.style.left = r.left + 'px';
    outline.style.top = r.top + 'px';
    outline.style.width = r.width + 'px';
    outline.style.height = r.height + 'px';
    label.style.display = 'block';
    label.style.left = r.left + 'px';
    label.style.top = Math.max(0, r.top - 20) + 'px';
    const text = (el.textContent || '').trim().slice(0, 40);
    label.textContent = '<' + el.tagName.toLowerCase() + '>' + (text ? ' "' + text + '"' : '');
  }
  function clear() {
    if (outline) outline.style.display = 'none';
    if (label) label.style.display = 'none';
    lastTarget = null;
  }
  function describe(el) {
    const text = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120);
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: (el.className && typeof el.className === 'string') ? el.className.slice(0, 200) : null,
      text,
      role: el.getAttribute('role') || null,
      ariaLabel: el.getAttribute('aria-label') || null,
      sourceFile: el.getAttribute('data-source-file') || null,
      sourceLine: el.getAttribute('data-source-line') || null,
    };
  }
  function onMove(e) {
    if (!active) return;
    const t = e.target;
    if (!t || t === lastTarget) return;
    lastTarget = t;
    paint(t);
  }
  function onClick(e) {
    if (!active) return;
    e.preventDefault();
    e.stopPropagation();
    const t = e.target;
    if (!t) return;
    parent.postMessage({ type: 'petal:pick:selected', payload: describe(t) }, '*');
    setActive(false);
  }
  function onKey(e) {
    if (active && e.key === 'Escape') {
      parent.postMessage({ type: 'petal:pick:cancelled' }, '*');
      setActive(false);
    }
  }
  function onMessage(e) {
    const data = e.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'petal:pick:enable') setActive(true);
    if (data.type === 'petal:pick:disable') setActive(false);
  }
  function setActive(v) {
    active = v;
    if (v) {
      ensureOverlay();
      document.documentElement.style.cursor = 'crosshair';
    } else {
      document.documentElement.style.cursor = '';
      clear();
    }
  }
  window.addEventListener('message', onMessage);
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
  // Expose a teardown hook so a future, newer version of this script can
  // safely uninstall us before installing itself.
  window.__petalPickerCleanup = function () {
    try { window.removeEventListener('message', onMessage); } catch (_) {}
    try { document.removeEventListener('mousemove', onMove, true); } catch (_) {}
    try { document.removeEventListener('click', onClick, true); } catch (_) {}
    try { document.removeEventListener('keydown', onKey, true); } catch (_) {}
    if (outline && outline.parentNode) outline.parentNode.removeChild(outline);
    if (label && label.parentNode) label.parentNode.removeChild(label);
    document.documentElement.style.cursor = '';
  };
  parent.postMessage({ type: 'petal:pick:ready' }, '*');
})();`;

/**
 * Runtime error bridge — installed alongside the picker. Listens for
 * `window.onerror` and `unhandledrejection` inside the running app's iframe
 * and forwards a compact `{ message, stack, source, lineno, colno }` payload
 * to the parent via `postMessage` as `petal:runtime:error`. The builder
 * surfaces a non-blocking banner with a one-click "Fix this" button that
 * routes through the existing free-charge auto-fix path.
 *
 * Throttled to one message per 1.5s + dedupe on identical message+source so a
 * crashing render loop doesn't flood the parent.
 */
const RUNTIME_BRIDGE_VERSION = 3;
const RUNTIME_BRIDGE_SCRIPT = `(() => {
  var VERSION = ${RUNTIME_BRIDGE_VERSION};
  if (window.__petalRuntimeBridgeVersion && window.__petalRuntimeBridgeVersion >= VERSION) return;
  window.__petalRuntimeBridgeVersion = VERSION;
  var lastKey = '';
  var lastAt = 0;
  var lastError = null;
  var blankSent = false;
  function send(payload) {
    try {
      var key = (payload.message || '') + '|' + (payload.source || '') + ':' + (payload.lineno || '');
      var now = Date.now();
      if (key === lastKey && (now - lastAt) < 1500) return;
      lastKey = key; lastAt = now;
      parent.postMessage({ type: 'petal:runtime:error', payload: payload }, '*');
    } catch (_) {}
  }
  function textOf(value) {
    if (!value) return 'Unknown preview error';
    if (value.message) return String(value.message);
    return typeof value === 'string' ? value : String(value);
  }
  function stackOf(value) {
    return value && value.stack ? String(value.stack).slice(0, 4000) : null;
  }
  function normalizeMessage(msg) {
    msg = String(msg || 'Unknown preview error');
    if (msg.indexOf("undefined is not an object (evaluating '") >= 0) return msg;
    var safariMatch = /undefined is not an object \(evaluating '([^']+)'\)/.exec(msg);
    if (safariMatch) return msg;
    var chromeMatch = /Cannot read (?:properties|property) of undefined \(reading '([^']+)'\)/.exec(msg);
    if (chromeMatch) return "undefined is not an object (evaluating '" + chromeMatch[1] + "')";
    return msg;
  }
  function visibleRoot(root) {
    if (!root) return false;
    if ((root.textContent || '').trim()) return true;
    var nodes = root.querySelectorAll('canvas,svg,img,video,button,a,input,textarea,select,[role]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
      var rect = el.getBoundingClientRect();
      if (rect.width > 2 && rect.height > 2) return true;
    }
    return false;
  }
  function checkBlank() {
    if (blankSent) return;
    var root = document.getElementById('root');
    if (visibleRoot(root)) return;
    blankSent = true;
    try {
      parent.postMessage({ type: 'petal:preview:blank', payload: {
        message: lastError ? normalizeMessage(textOf(lastError)) : 'The app loaded, but nothing visible was rendered into #root.',
        stack: lastError ? stackOf(lastError) : null,
        source: null,
        lineno: null,
        colno: null,
        kind: 'blank'
      } }, '*');
    } catch (_) {}
  }
  window.addEventListener('error', function (e) {
    if (!e) return;
    // Ignore script-load CORS errors (no useful info) and ResizeObserver noise.
    var msg = normalizeMessage(e.message || '');
    if (!msg || msg === 'Script error.' || msg.indexOf('ResizeObserver loop') === 0) return;
    lastError = e.error || msg;
    send({
      message: msg,
      stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 4000) : null,
      source: e.filename || null,
      lineno: e.lineno || null,
      colno: e.colno || null,
      kind: 'error',
    });
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    if (!e) return;
    var reason = e.reason;
    lastError = reason;
    var msg = normalizeMessage(reason && reason.message ? reason.message : (typeof reason === 'string' ? reason : 'Unhandled promise rejection'));
    send({
      message: msg,
      stack: reason && reason.stack ? String(reason.stack).slice(0, 4000) : null,
      source: null,
      lineno: null,
      colno: null,
      kind: 'unhandledrejection',
    });
  });
  setTimeout(checkBlank, 2500);
  setTimeout(checkBlank, 6500);
})();`;

/**
 * Ensure the picker script and a script tag in index.html exist in the
 * running container. Vite's HMR will pick up the change without a full
 * reload of the dev server. Idempotent — safe to call on every file change
 * AND on every iframe `onLoad` event.
 *
 * The picker script in `public/__petal_picker.js` is rewritten unconditionally
 * (cheap), and `index.html` is patched only if either the script tag is
 * missing OR an older `data-petal-picker-version` is present.
 */
export async function ensurePickerInstalled(currentIndexHtml: string | undefined): Promise<void> {
  const wc = await getContainer();
  // Drop the picker + runtime-error bridge as public assets.
  try {
    await wc.fs.mkdir("public", { recursive: true });
  } catch {
    /* ignore */
  }
  await wc.fs.writeFile("public/__petal_picker.js", PICKER_SCRIPT);
  await wc.fs.writeFile("public/__petal_runtime.js", RUNTIME_BRIDGE_SCRIPT);
  if (!currentIndexHtml) return;

  const pickerVersionAttr = `data-petal-picker-version="${PICKER_VERSION}"`;
  const pickerTag = `<script src="/__petal_picker.js" ${pickerVersionAttr}></script>`;
  const runtimeVersionAttr = `data-petal-runtime-version="${RUNTIME_BRIDGE_VERSION}"`;
  const runtimeTag = `<script src="/__petal_runtime.js" ${runtimeVersionAttr}></script>`;

  const hasCurrentPicker = currentIndexHtml.includes(pickerVersionAttr);
  const hasCurrentRuntime = currentIndexHtml.includes(runtimeVersionAttr);
  if (hasCurrentPicker && hasCurrentRuntime) return;

  // Strip any older picker / runtime tags so we don't accumulate stale ones.
  let stripped = currentIndexHtml.replace(
    /\s*<script\s+src="\/__petal_picker\.js"[^>]*><\/script>/g,
    "",
  );
  stripped = stripped.replace(
    /\s*<script\s+src="\/__petal_runtime\.js"[^>]*><\/script>/g,
    "",
  );
  const insert = `  ${runtimeTag}\n  ${pickerTag}\n  `;
  const next = stripped.includes("</body>")
    ? stripped.replace("</body>", `${insert}</body>`)
    : `${stripped}\n${runtimeTag}\n${pickerTag}`;
  await wc.fs.writeFile("index.html", next);
}

/** Patch only changed files into a running container — no remount needed. */
export async function patchFiles(
  ops: { path: string; content?: string; deleted?: boolean }[]
): Promise<void> {
  const wc = await getContainer();
  for (const op of ops) {
    if (op.deleted) {
      try {
        await wc.fs.rm(op.path, { force: true, recursive: true });
      } catch {
        /* ignore */
      }
    } else if (op.content !== undefined) {
      // Ensure parent directories exist.
      const dir = op.path.split("/").slice(0, -1).join("/");
      if (dir) {
        try {
          await wc.fs.mkdir(dir, { recursive: true });
        } catch {
          /* ignore — exists */
        }
      }
      await wc.fs.writeFile(op.path, op.content);
    }
  }
}

/**
 * Phase 4 #12 — stream a single file into a running container WITHOUT
 * booting one if it isn't already up. Called from the SSE stream handler
 * on every `file_complete` event so HMR can pick up changes mid-turn
 * instead of waiting for the entire write_project/patch_files to land.
 *
 * No-ops (returns false) when:
 *  - the container hasn't booted yet (we don't want to race the initial
 *    mountProject + installDeps with a partial tree)
 *  - the path isn't a runtime file (skip lockfiles, .env, migrations)
 *  - content is empty / undefined
 *
 * Errors are swallowed — streaming preview is a perceived-latency
 * optimization, never the source of truth. The final patchFiles call
 * after the turn ends still runs and reconciles state.
 */
export async function streamWriteFile(path: string, content: string): Promise<boolean> {
  if (!instance) return false; // container not booted yet
  if (!content) return false;
  // Skip files that shouldn't trigger HMR or that the dev server doesn't
  // serve. Migrations + lockfiles are persisted server-side only.
  if (
    path.startsWith("supabase/") ||
    path.startsWith("supabase\\") ||
    path === "package-lock.json" ||
    path === "bun.lockb" ||
    path === "yarn.lock" ||
    path === ".env" ||
    path.endsWith(".sql")
  ) {
    return false;
  }
  try {
    const dir = path.split("/").slice(0, -1).join("/");
    if (dir) {
      try {
        await instance.fs.mkdir(dir, { recursive: true });
      } catch {
        /* exists */
      }
    }
    await instance.fs.writeFile(path, content);
    return true;
  } catch (e) {
    emitLog({ stream: "stderr", text: `streamWriteFile(${path}) failed: ${String(e)}` });
    return false;
  }
}


async function pipeProcess(label: string, process: { output: ReadableStream<string>; exit: Promise<number> }) {
  const reader = process.output.getReader();
  void (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) emitLog({ stream: "stdout", text: value });
    }
  })();
  const code = await process.exit;
  emitLog({ stream: "system", text: `${label} exited with code ${code}` });
  return code;
}

let installPromise: Promise<number> | null = null;
let devProcess: { kill: () => void } | null = null;

/** Run npm install. De-duplicated — concurrent calls share one promise. */
export async function installDeps(): Promise<number> {
  if (installPromise) return installPromise;
  const wc = await getContainer();
  emitLog({ stream: "system", text: "$ npm install" });
  const proc = await wc.spawn("npm", ["install"]);
  installPromise = pipeProcess("npm install", proc).finally(() => {
    installPromise = null;
  });
  return installPromise;
}

/** Start `npm run dev`. Kills any previous dev process first.
 *  P0-H: explicitly wait for any in-flight `installDeps()` to finish before
 *  spawning `npm run dev` — otherwise a fast re-mount can race the install
 *  and start the dev server against an incomplete `node_modules`, which
 *  manifests as "module not found" / blank preview with no clear cause. */
export async function startDevServer(): Promise<void> {
  if (installPromise) {
    emitLog({ stream: "system", text: "waiting for npm install to finish before starting dev server…" });
    try {
      await installPromise;
    } catch {
      // installDeps surfaces its own error in logs; nothing to add here.
    }
  }
  const wc = await getContainer();
  if (devProcess) {
    devProcess.kill();
    devProcess = null;
    emitServer(null);
  }
  emitLog({ stream: "system", text: "$ npm run dev" });
  const proc = await wc.spawn("npm", ["run", "dev"]);
  devProcess = proc;
  void pipeProcess("npm run dev", proc);
}


/** Stop the dev server (e.g. when leaving the builder). */
export function stopDevServer() {
  devProcess?.kill();
  devProcess = null;
  emitServer(null);
}

export function getCurrentServerUrl(): string | null {
  return currentServerUrl;
}
