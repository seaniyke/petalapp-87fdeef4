import { strict as assert } from "node:assert";
import { repairBuildConfigImports } from "../build-config-repair.server";

const broken = [
  {
    path: "vite.config.ts",
    content: 'import { defineConfig } from "vite";\nexport default defineConfig({ resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } } });\n',
  },
];

const repaired = repairBuildConfigImports(broken);
assert.equal(repaired.notes.length, 1);
assert.match(repaired.files[0]?.content ?? "", /import \* as path from "node:path";/);

const secondPass = repairBuildConfigImports(repaired.files);
assert.equal(secondPass.notes.length, 0, "repair must be idempotent");
assert.equal(secondPass.files[0]?.content, repaired.files[0]?.content);

const appFile = repairBuildConfigImports([
  { path: "src/App.tsx", content: "const value = path.resolve('x');" },
]);
assert.equal(appFile.notes.length, 0, "app files must not be rewritten as build config");

console.log("build-config-repair: all assertions passed");