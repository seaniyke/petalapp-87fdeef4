import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // Some older regression harnesses are standalone Bun scripts. Let
    // Vitest run only files that use an actual test-runner API instead of
    // importing scripts that call process.exit at module scope.
    include: [
      "src/lib/preview-state.test.ts",
      "src/lib/intent-registry.test.ts",
      "src/server/__tests__/{agents-orchestrator,agents-qa-board,copy-slop,app-ui-library,backend-quality,billing-fairness,builder-deployment-readiness,chunked-generation,css-escape-fixer,document-head,file-budget,frontend-quality,html-injectors-integration,kit-dep-closure,prd-engine,prd-golden-corpus,preemit-gate,preview-guard-markup,product-principles,renderable-shell,repair-safety,design-variety,composition-contract,palette-integrity,design-floor,pic-engine,engine3-phase345,import-resolver-page-compose,scope-jsx-prose,scope-repair,sibling-resolver,tier-local-verify,tool-args-salvage,visual-qa,write-gate}.test.ts",
    ],
  },
});