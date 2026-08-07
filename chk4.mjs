import { EXAMPLES_PACK } from "/dev-server/src/server/examples-pack.ts";
import { KIT_CONTENT_FILES } from "/dev-server/src/server/scaffold-kit-content.ts";
import { runAllRepairs } from "/dev-server/src/server/repair-all.server.ts";
const all=[...EXAMPLES_PACK,...KIT_CONTENT_FILES].map(f=>({path:f.path,content:f.content}));
const res=runAllRepairs(all);
for(const f of res.files){ const o=all.find(x=>x.path===f.path); if(o.content!==f.content){ console.log("CHANGED",f.path);
  const a=o.content.split("\n"),b=f.content.split("\n");
  for(let i=0;i<Math.max(a.length,b.length);i++) if(a[i]!==b[i]){console.log("  -",JSON.stringify(a[i]));console.log("  +",JSON.stringify(b[i]));}
}}
console.log(res.notes);
