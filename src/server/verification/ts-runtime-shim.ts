/**
 * Must be imported before `typescript`.
 *
 * On the live server (Cloudflare Worker with Node compatibility) TypeScript
 * sees a Node-like runtime and builds its Node system at import time, reading
 * the CommonJS-only `__filename`/`__dirname`. Bundled as ESM there, those do
 * not exist, so the import threw "__filename is not defined" and killed every
 * generation turn. The checker never touches the disk (it uses an in-memory
 * host), so placeholder paths are enough. Real CommonJS scopes keep their own.
 */
const g = globalThis as { __filename?: string; __dirname?: string };
if (typeof g.__filename === "undefined") g.__filename = "/node_modules/typescript/lib/typescript.js";
if (typeof g.__dirname === "undefined") g.__dirname = "/node_modules/typescript/lib";

export {};
