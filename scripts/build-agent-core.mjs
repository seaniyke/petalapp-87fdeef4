// Bundles the generation pipeline for the Railway build server.
// Output: builder/vendor/agent-core.mjs (committed — Railway only sees builder/).
// Run: bun scripts/build-agent-core.mjs
import { build } from "esbuild";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const shim = path.join(root, "src/server/agent-runtime/client-server-shim.ts");

await build({
  entryPoints: [path.join(root, "src/server/agent-runtime/entry.ts")],
  outfile: path.join(root, "builder/vendor/agent-core.mjs"),
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
  ],
  // Vite-only flags: the Node bundle has no import.meta.env.
  define: { "import.meta.env": JSON.stringify({ DEV: false, PROD: true, MODE: "production", SSR: true }) },
  logLevel: "warning",
});
console.log("agent core bundled → builder/vendor/agent-core.mjs");
