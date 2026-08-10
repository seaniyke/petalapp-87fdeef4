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

export default defineConfig({
  vite: {
    test: {
      // Some older regression harnesses are standalone Bun scripts. Let
      // Vitest run only files that use an actual test-runner API instead of
      // importing scripts that call process.exit at module scope.
      include: [
        "src/lib/preview-state.test.ts",
        "src/server/__tests__/{app-ui-library,backend-quality,billing-fairness,builder-deployment-readiness,chunked-generation,document-head,file-budget,frontend-quality,html-injectors-integration,kit-dep-closure,prd-engine,prd-golden-corpus,preemit-gate,preview-guard-markup,product-principles,renderable-shell,repair-safety,scope-jsx-prose,scope-repair,sibling-resolver,tier-local-verify,tool-args-salvage,verify-plan,visual-qa,write-gate}.test.ts",
      ],
    },
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
        entities: path.resolve(import.meta.dirname, "node_modules/entities"),
      },
    },
  },
});
