/**
 * `petal-source-plugin.ts` — the Vite plugin source injected into every
 * generated project. It tags every host-level JSX opening tag with
 * `data-source-file` / `data-source-line` so the in-iframe element picker
 * (`__petal_picker.js`) can report the EXACT file + line back to the chat
 * composer. Without this, the picker payload's `sourceFile` is always null
 * and Petal has to guess which file owns the clicked node.
 *
 * Approach (robust to the WebContainer environment — no extra deps):
 *   - Match every JSX opening tag of a LOWERCASE host element (<div,
 *     <section, <button, etc.). React component tags (<Card,
 *     <MyHeader) are skipped because their attributes get dropped by the
 *     component before the DOM ever sees them.
 *   - Skip <Fragment> / <> and self-closing whitespace-only matches.
 *   - Skip tags that already carry `data-source-file` (idempotent).
 *   - Inject attributes referencing the relative `src/...` path and the
 *     1-indexed line number of the opening <.
 *   - Dev-only: the plugin no-ops in `vite build` so the production bundle
 *     stays clean.
 *
 * This file is exported as a STRING from scaffold-kit.ts and written into
 * every project under `src/petal-source-plugin.mjs`.
 */
export const PETAL_SOURCE_PLUGIN = `// Auto-injected by Petal — do not edit.
// Tags host JSX opening tags with data-source-file / data-source-line so the
// in-preview element picker can report the exact file + line for each click.
import path from "node:path";

/** @returns {import('vite').Plugin} */
export default function petalSourcePlugin() {
  let projectRoot = process.cwd();
  let isDev = true;
  return {
    name: "petal-source-tag",
    apply: "serve", // dev-only — never runs during production build
    configResolved(config) {
      projectRoot = config.root || process.cwd();
      isDev = config.command === "serve";
    },
    transform(code, id) {
      if (!isDev) return null;
      // Only touch project source — skip node_modules, virtual modules, etc.
      if (id.includes("/node_modules/")) return null;
      if (!/\\.(tsx|jsx)$/.test(id)) return null;
      // Skip the UI kit and examples — they're noisy and the user can't edit
      // them directly anyway. The picker would still find SOMETHING; we want
      // it to find the user's app code instead.
      const rel = path.relative(projectRoot, id).replace(/\\\\/g, "/");
      if (rel.startsWith("src/components/ui/")) return null;
      if (rel.startsWith("src/components/examples/")) return null;
      if (rel.startsWith("src/integrations/")) return null;

      // Build a 1-indexed line lookup so we can resolve any byte offset to
      // the line containing the opening "<".
      const lineStarts = [0];
      for (let i = 0; i < code.length; i++) {
        if (code.charCodeAt(i) === 10 /* \\n */) lineStarts.push(i + 1);
      }
      function lineOf(offset) {
        // Binary search.
        let lo = 0, hi = lineStarts.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >>> 1;
          if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
        }
        return lo + 1;
      }

      // Match the opening of a JSX element where the tag name starts with a
      // lowercase letter (host element). We capture up to the first ">" or
      // "/>" so we can splice attributes in just before that.
      // Skips "<>" fragments and HTML/JSX comments by requiring the first
      // char after "<" to be [a-z].
      // NOTE: this is a regex pass, not a real parser — it intentionally
      // errs on the side of skipping when in doubt.
      let out = "";
      let cursor = 0;
      const re = /<([a-z][a-zA-Z0-9-]*)\\b([^>]*?)(\\/?)>/g;
      let m;
      while ((m = re.exec(code)) !== null) {
        const start = m.index;
        const fullLen = m[0].length;
        const attrs = m[2];
        const selfClose = m[3] === "/";
        // Idempotent: don't re-tag.
        if (attrs.indexOf("data-source-file") !== -1) continue;
        // Skip elements inside a string or jsx attribute value — cheap
        // heuristic: if the chars immediately before "<" suggest we're inside
        // a string template, skip. Common false-positive sources: code in a
        // <pre> example, regex literals. Skipping is safe — picker just
        // won't find a source for those.
        const prevChar = start > 0 ? code[start - 1] : "";
        if (prevChar === "\\\\" || prevChar === "\\`" || prevChar === '"' || prevChar === "'") continue;

        const line = lineOf(start);
        const inject = \` data-source-file="\${rel}" data-source-line="\${line}"\`;
        // Splice: keep everything up to the end of attrs, insert our
        // attributes, then re-emit the closing "/>" or ">".
        out += code.slice(cursor, start);
        const head = m[0].slice(0, fullLen - (selfClose ? 2 : 1));
        const tail = selfClose ? "/>" : ">";
        out += head + inject + tail;
        cursor = start + fullLen;
      }
      if (cursor === 0) return null; // no host elements
      out += code.slice(cursor);
      return { code: out, map: null };
    },
  };
}
`;
