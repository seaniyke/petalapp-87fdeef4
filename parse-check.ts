import { EXAMPLES_PACK } from "/dev-server/src/server/examples-pack";
import { KIT_CONTENT_FILES } from "/dev-server/src/server/scaffold-kit-content";
import { runAllRepairs } from "/dev-server/src/server/repair-all.server";
import { transformSync } from "esbuild-wasm";
await (await import("esbuild-wasm")).initialize({worker:false});
const all:any[]=[...EXAMPLES_PACK,...KIT_CONTENT_FILES].map(f=>({path:f.path,content:f.content}));
for (const stage of [{n:"RAW",fs:all},{n:"REPAIRED",fs:runAllRepairs(all).files}]) {
  let bad=0;
  for (const f of stage.fs) { if(!/\.(tsx?|jsx?)$/.test(f.path)) continue;
    try { transformSync(f.content,{loader:f.path.endsWith(".tsx")?"tsx":"ts",sourcefile:f.path}); }
    catch(e:any){ bad++; console.log(stage.n+" FAIL "+f.path+": "+(e.errors?.[0]?.text)+" @"+JSON.stringify(e.errors?.[0]?.location?.line)); }
  }
  console.log(stage.n+" bad="+bad+" of "+stage.fs.length);
}
