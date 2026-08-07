import { EXAMPLES_PACK } from "/dev-server/src/server/examples-pack.ts";
import { KIT_CONTENT_FILES } from "/dev-server/src/server/scaffold-kit-content.ts";
import * as esbuild from "esbuild-wasm";
const all = [...EXAMPLES_PACK, ...KIT_CONTENT_FILES];
for (const f of all) {
  if (!/\.(tsx?|jsx)$/.test(f.path)) continue;
  try { await esbuild.transform(f.content, { loader: f.path.endsWith("tsx")?"tsx":"ts", sourcefile: f.path }); }
  catch(e){ console.log("FAIL", f.path, JSON.stringify(e.errors?.[0])); }
}
console.log("done", all.length);
