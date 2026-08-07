import { injectPreviewGuard } from "./src/server/preview-guard.server";
const html = `<!doctype html><html><head></head><body><div id="root"></div>
    <script src="/__petal_guard.js?v=4" data-petal-preview-guard-version="4"></script>
    <script type="module" src="/src/main.tsx"></script></body></html>`;
let r = injectPreviewGuard([{path:"index.html",content:html},{path:"public/__petal_guard.js",content:"old"}],{projectId:"abc"});
let out = r.files.find(f=>f.path==="index.html")!.content;
console.log("guard file kept:", r.files.some(f=>f.path.includes("__petal_guard.js")));
console.log("external ref:", /src=["'][^"']*__petal_guard/.test(out));
console.log("inline tags:", (out.match(/data-petal-preview-guard-version/g)||[]).length);
console.log("before main:", out.indexOf("__petalPreviewGuardVersion") < out.indexOf("/src/main.tsx"));
const r2 = injectPreviewGuard(r.files,{projectId:"abc"});
const out2 = r2.files.find(f=>f.path==="index.html")!.content;
console.log("idempotent:", out2===out, "tags2:", (out2.match(/data-petal-preview-guard-version/g)||[]).length);
