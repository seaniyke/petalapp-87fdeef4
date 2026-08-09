/**
 * Ephemeral static server for a freshly built `dist/` folder.
 *
 * W1 — "close the loop". Browser verification used to run against the deployed
 * Cloudflare URL, which meant (a) a broken app was already uploaded before
 * anyone looked at it, and (b) every finding had to be filtered for CDN
 * propagation noise (52x) that had nothing to do with the generated code.
 *
 * Serving `dist/` locally removes both problems: the check runs before the
 * deploy exists, and localhost has no edge to be flaky.
 *
 * SPA semantics: any request that does not map to a real file falls back to
 * `index.html`, which is what Cloudflare Pages does for client-routed apps.
 * Without the fallback every non-root route would 404 and the verifier would
 * report the whole app as broken.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

export type PreviewServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

/**
 * Resolve a URL path to a file inside `root`, or null when it escapes the
 * root (path traversal) or does not exist.
 */
async function resolveFile(root: string, urlPath: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0]!.split("#")[0]!);
  } catch {
    return null;
  }
  const candidate = resolve(join(root, normalize(decoded)));
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  try {
    const info = await stat(candidate);
    if (info.isDirectory()) return resolveFile(root, join(decoded, "index.html"));
    return info.isFile() ? candidate : null;
  } catch {
    return null;
  }
}

export async function startPreviewServer(distDir: string): Promise<PreviewServer> {
  const root = resolve(distDir);
  const indexHtml = join(root, "index.html");

  const server: Server = createServer((req, res) => {
    void (async () => {
      const urlPath = req.url ?? "/";
      let file = await resolveFile(root, urlPath);
      // SPA fallback — only for navigations, never for asset extensions. A
      // missing .js served as HTML would produce a misleading MIME console
      // error that the verifier would then report as an app defect.
      if (!file && !extname(urlPath.split("?")[0] ?? "")) file = indexHtml;
      if (!file) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Not found");
        return;
      }
      const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      createReadStream(file)
        .on("error", () => {
          res.destroy();
        })
        .pipe(res);
    })();
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    // Port 0 = let the OS pick a free port. Concurrent builds share this
    // process, so a fixed port would collide.
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((done) => server.close(() => done()));
    throw new Error("Preview server did not bind to a TCP port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections?.();
        server.close(() => done());
      }),
  };
}
