/**
 * esbuild for the live Cloudflare Worker. The Node entry of esbuild-wasm
 * spawns a child process and refuses to run when bundled, so on the Worker we
 * use its browser build with the precompiled WASM module (Workers cannot
 * compile WASM from bytes at runtime; `?module` gives a compiled module).
 */
export async function loadWorkerEsbuild() {
  const [esbuild, wasm] = await Promise.all([
    import("esbuild-wasm/esm/browser.js"),
    // @ts-expect-error — Cloudflare's Vite plugin resolves `.wasm?module`.
    import("esbuild-wasm/esbuild.wasm?module"),
  ]);
  return { esbuild, wasmModule: (wasm as { default: WebAssembly.Module }).default };
}
