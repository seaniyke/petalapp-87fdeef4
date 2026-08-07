import * as esbuild from "esbuild-wasm";
try { await esbuild.transform("const a = <div>;", {loader:"tsx"}); console.log("NO ERROR - bad"); } catch(e){ console.log("caught ok"); }
