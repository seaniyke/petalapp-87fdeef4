import { EXAMPLES_PACK } from "/dev-server/src/server/examples-pack.ts";
import { KIT_CONTENT_FILES } from "/dev-server/src/server/scaffold-kit-content.ts";
const all=[...EXAMPLES_PACK,...KIT_CONTENT_FILES];
const pick={"src/components/examples/widget-filter-bar.tsx":[30,40],"src/components/examples/kit-multi-page-app.tsx":[152,162],"src/components/content/markdown-view.tsx":[42,54]};
for(const f of all){ if(pick[f.path]){const [a,b]=pick[f.path]; const L=f.content.split("\n"); console.log("=== "+f.path); L.slice(a-1,b).forEach((l,i)=>console.log((a+i)+": "+l)); }}
