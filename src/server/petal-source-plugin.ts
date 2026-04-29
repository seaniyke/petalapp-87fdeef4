/**
 * `petal-source-plugin.ts` — the Vite plugin source injected into every
 * generated project. It tags every host-level JSX opening tag with
 * `data-source-file` / `data-source-line` so the in-iframe element picker
 * (`__petal_picker.js`) can report the EXACT file + line back to the chat
 * composer. Without this, the picker payload's `sourceFile` is always null
 * and Petal has to guess which file owns the clicked node.
 */

// We build the plugin source by concatenating raw string fragments so we
// never have to nest template-literal interpolations (which TypeScript
// rejects when the outer string is itself a template literal).
const PLUGIN_HEADER = `// Auto-injected by Petal — do not edit.
// Tags host JSX opening tags with data-source-file / data-source-line so the
// in-preview element picker can report the exact file + line for each click.
import path from "node:path";

/** @returns {import('vite').Plugin} */
export default function petalSourcePlugin() {
  let projectRoot = process.cwd();
  let isDev = true;
  return {
    name: "petal-source-tag",
    apply: "serve",
    configResolved(config) {
      projectRoot = config.root || process.cwd();
      isDev = config.command === "serve";
    },
    transform(code, id) {
      if (!isDev) return null;
      if (id.includes("/node_modules/")) return null;
      if (!/\\.(tsx|jsx)$/.test(id)) return null;
      const rel = path.relative(projectRoot, id).replace(/\\\\/g, "/");
      if (rel.startsWith("src/components/ui/")) return null;
      if (rel.startsWith("src/components/examples/")) return null;
      if (rel.startsWith("src/integrations/")) return null;

      const lineStarts = [0];
      for (let i = 0; i < code.length; i++) {
        if (code.charCodeAt(i) === 10) lineStarts.push(i + 1);
      }
      function lineOf(offset) {
        let lo = 0, hi = lineStarts.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >>> 1;
          if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
        }
        return lo + 1;
      }

      let out = "";
      let cursor = 0;
      const re = /<([a-z][a-zA-Z0-9-]*)\\b([^>]*?)(\\/?)>/g;
      let m;
      while ((m = re.exec(code)) !== null) {
        const start = m.index;
        const fullLen = m[0].length;
        const attrs = m[2];
        const selfClose = m[3] === "/";
        if (attrs.indexOf("data-source-file") !== -1) continue;
        const prevChar = start > 0 ? code[start - 1] : "";
`;

// The character class below contains a backtick — easier to write as a
// plain literal than to escape inside a template literal.
const PLUGIN_SKIP_CHECK =
  '        if (prevChar === "\\\\" || prevChar === "`" || prevChar === \'"\' || prevChar === "\'") continue;\n';

const PLUGIN_FOOTER = `
        const line = lineOf(start);
        const inject = ' data-source-file="' + rel + '" data-source-line="' + line + '"';
        out += code.slice(cursor, start);
        const head = m[0].slice(0, fullLen - (selfClose ? 2 : 1));
        const tail = selfClose ? "/>" : ">";
        out += head + inject + tail;
        cursor = start + fullLen;
      }
      if (cursor === 0) return null;
      out += code.slice(cursor);
      return { code: out, map: null };
    },
  };
}
`;

export const PETAL_SOURCE_PLUGIN =
  PLUGIN_HEADER + PLUGIN_SKIP_CHECK + PLUGIN_FOOTER;
