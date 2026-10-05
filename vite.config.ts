// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import path from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Load all env vars (no prefix) into process.env so server routes can access
// non-VITE_ secrets like SUPABASE_SERVICE_ROLE_KEY and LOVABLE_API_KEY.
// Do NOT add these to envDefine — that would leak secrets into the client bundle.
const serverEnv = loadEnv(process.env.NODE_ENV ?? "development", process.cwd(), "");
Object.assign(process.env, serverEnv);

// Some build environments inject `process.env.X` defines whose values are
// expressions like `(globalThis.process.env.X ?? ("..."))`. esbuild only
// accepts identifiers or literals as define values, so those crash the SSR
// build. Drop non-literal define values; server code reads process.env at
// runtime anyway.
const isValidDefine = (v: unknown) =>
  typeof v !== "string" || /^(?:[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*|"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null|undefined|\{\}|\{.*\}|\[.*\])$/s.test(v.trim());
function sanitize(define?: Record<string, unknown>) {
  if (!define) return;
  for (const k of Object.keys(define)) if (!isValidDefine(define[k])) delete define[k];
}
const sanitizeDefinePlugin = {
  name: "kimble:sanitize-define",
  enforce: "post" as const,
  configResolved(cfg: { define?: Record<string, unknown>; environments?: Record<string, { define?: Record<string, unknown> }> }) {
    sanitize(cfg.define);
    for (const env of Object.values(cfg.environments ?? {})) sanitize(env.define);
  },
};

export default defineConfig({
  vite: {
    plugins: [sanitizeDefinePlugin],
    resolve: {
      alias: {
        // Force every `entities` import to the hoisted v4.5.0 copy. Some
        // packages pull a nested v7, which removed ./lib/decode.js and
        // breaks SSR rendering (used by @react-email/components).
        "entities/lib/decode.js": path.resolve(
          import.meta.dirname,
          "node_modules/entities/lib/decode.js",
        ),
        "entities/lib/encode.js": path.resolve(
          import.meta.dirname,
          "node_modules/entities/lib/encode.js",
        ),
        // parse5 needs the newer `entities/decode` / `entities/escape` subpaths,
        // which v4 lacks — point them at parse5's own nested copy.
        "entities/decode": path.resolve(
          import.meta.dirname,
          "node_modules/parse5/node_modules/entities/decode.js",
        ),
        "entities/escape": path.resolve(
          import.meta.dirname,
          "node_modules/parse5/node_modules/entities/escape.js",
        ),
        entities: path.resolve(import.meta.dirname, "node_modules/entities"),
      },
    },
  },
});
