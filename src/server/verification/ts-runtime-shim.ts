/**
 * Must be imported before `typescript`, and its export must be referenced
 * (the package is `sideEffects: false`, so a bare import is dropped).
 *
 * On the live server (Cloudflare Worker with Node compatibility) TypeScript
 * sees a Node-like runtime and builds its Node system at import time, reading
 * the CommonJS-only `__filename`/`__dirname`. Bundled as ESM there, those do
 * not exist, so the import threw "__filename is not defined" and killed every
 * generation turn. The checker never touches the disk (it uses an in-memory
 * host), so placeholder paths are enough. Real CommonJS scopes keep their own.
 *
 * In the production Worker bundle TypeScript is its own chunk, which is
 * evaluated BEFORE this module's body runs, so the import-order trick alone
 * is too late there. `installTsRuntimeGlobals()` is therefore also called by
 * the server request middleware in src/start.ts, which runs before any
 * handler lazily loads the checker.
 */
export function installTsRuntimeGlobals(): true {
  return install();
}

function install(): true {
  const g = globalThis as { __filename?: string; __dirname?: string };
  if (typeof g.__filename === "undefined") g.__filename = "/node_modules/typescript/lib/typescript.js";
  if (typeof g.__dirname === "undefined") g.__dirname = "/node_modules/typescript/lib";
  return true;
}

export const TS_RUNTIME_READY: true = install();
