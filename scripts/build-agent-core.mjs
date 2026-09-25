// Bundles the generation pipeline for the Railway build server.
// Output: builder/vendor/agent-core.mjs (committed — Railway only sees builder/)
// plus builder/vendor/agent-core.version.json (content hash, served on
// /agent/healthz so production can prove which bundle it runs).
// Run: bun scripts/build-agent-core.mjs
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const shim = path.join(root, "src/server/agent-runtime/client-server-shim.ts");
const outfile = path.join(root, "builder/vendor/agent-core.mjs");

async function listFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(p)));
    else out.push(p);
  }
  return out;
}

await build({
  entryPoints: [path.join(root, "src/server/agent-runtime/entry.ts")],
  outfile,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  legalComments: "none",
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  // The Node entry locates its adjacent WASM runner via CommonJS module paths
  // and deliberately rejects bundling. Let Railway load it from node_modules.
  external: ["esbuild-wasm"],
  plugins: [
    {
      name: "kimble-agent-aliases",
      setup(b) {
        // No admin key on Railway: the admin client becomes the gateway stand-in.
        b.onResolve({ filter: /^@\/integrations\/supabase\/client\.server$/ }, () => ({ path: shim }));
        b.onResolve({ filter: /^@\// }, async (args) => {
          const r = await b.resolve("./" + args.path.slice(2), { resolveDir: path.join(root, "src"), kind: args.kind });
          return r.errors.length ? undefined : { path: r.path };
        });
      },
    },
    {
      // Vite `?raw` imports (agent-knowledge Markdown) → file text, as Vite does.
      name: "kimble-vite-raw",
      setup(b) {
        b.onResolve({ filter: /\?raw$/ }, (args) => ({
          path: path.resolve(args.resolveDir, args.path.slice(0, -"?raw".length)),
          namespace: "vite-raw",
        }));
        b.onLoad({ filter: /.*/, namespace: "vite-raw" }, async (args) => ({
          contents: await readFile(args.path, "utf8"),
          loader: "text",
        }));
      },
    },
    {
      // The design-system registry's eager `import.meta.glob(..., ?raw)`,
      // expanded to the same `{ "./packages/<slug>/<file>": text }` map Vite builds.
      name: "kimble-vite-glob-design-systems",
      setup(b) {
        b.onLoad({ filter: /[\\/]design-systems[\\/]registry\.ts$/ }, async (args) => {
          const src = await readFile(args.path, "utf8");
          const dir = path.dirname(args.path);
          const files = await listFiles(path.join(dir, "packages"));
          const map = {};
          for (const f of files.sort()) {
            map["./" + path.relative(dir, f).split(path.sep).join("/")] = await readFile(f, "utf8");
          }
          const re = /import\.meta\.glob\(\s*"\.\/packages\/\*\*\/\*"[^)]*\)/;
          if (!re.test(src)) throw new Error("design-systems registry glob not found — update build-agent-core.mjs");
          return { contents: src.replace(re, JSON.stringify(map)), loader: "ts" };
        });
      },
    },
  ],
  // Vite-only flags: the Node bundle has no import.meta.env.
  define: { "import.meta.env": JSON.stringify({ DEV: false, PROD: true, MODE: "production", SSR: true }) },
  logLevel: "warning",
});

const bundle = await readFile(outfile);
const hash = createHash("sha256").update(bundle).digest("hex");
await writeFile(
  path.join(root, "builder/vendor/agent-core.version.json"),
  JSON.stringify({ hash, bytes: bundle.length }, null, 2) + "\n",
);
console.log(`agent core bundled → builder/vendor/agent-core.mjs (sha256 ${hash.slice(0, 16)})`);
