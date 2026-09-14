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
      "src/lib/friendly-errors.test.ts",
      "src/server/__tests__/runtime-credit-fallback.test.ts",
      "src/server/__tests__/build-breaker-regressions.test.ts",
      "src/server/__tests__/browse-client.test.ts",
      "src/server/__tests__/test-plan.test.ts",
      "src/server/__tests__/test-repair.test.ts",
      "src/server/__tests__/readiness.test.ts",
      "src/server/__tests__/test-safety.test.ts",
      "src/server/__tests__/test-lab-view.test.ts",
      "src/server/__tests__/test-lab-scope.test.ts",
      "src/server/__tests__/ask-policy.test.ts",
      "src/server/__tests__/test-cost.test.ts",
      "src/server/__tests__/test-the-tester.test.ts",
      "src/server/__tests__/test-results.test.ts",
      "src/server/__tests__/change-set.test.ts",
      "src/server/__tests__/view-context.test.ts",
      "src/server/__tests__/edit-focus.test.ts",
      "src/server/__tests__/{agents-orchestrator,agents-qa-board,copy-slop,app-ui-library,backend-quality,billing-fairness,builder-deployment-readiness,chunked-generation,css-escape-fixer,document-head,file-budget,frontend-quality,html-injectors-integration,kit-customization,kit-dep-closure,prd-engine,prd-golden-corpus,preemit-gate,preview-guard-markup,product-principles,renderable-shell,repair-safety,design-variety,composition-contract,palette-integrity,design-floor,pic-engine,engine3-phase345,import-resolver-page-compose,scope-jsx-prose,scope-repair,sibling-resolver,tier-local-verify,tool-args-salvage,visual-qa,write-gate}.test.ts",
    ],
  },
});