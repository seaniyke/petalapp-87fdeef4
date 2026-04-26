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

/** Start `npm run dev`. Kills any previous dev process first. */
export async function startDevServer(): Promise<void> {
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
