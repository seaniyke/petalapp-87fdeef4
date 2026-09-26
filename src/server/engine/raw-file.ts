/**
 * Page writes return code as PLAIN TEXT in one fenced block, not inside a
 * JSON tool string. Root cause of cut-off pages: code carried in a JSON
 * string needs every quote escaped; one raw `"` (e.g. `className="`) closed
 * the string early and the provider ended the call there, leaving a file cut
 * off mid-tag. Plain text has nothing to escape.
 */
export const RAW_FILE_FORMAT =
  "OUTPUT FORMAT (strict): reply with ONLY the complete file inside ONE fenced code block — a line ```tsx, then the full file, then a line ```. " +
  "No tool call, no JSON, no prose before or after. Write the code exactly as it should be saved (no escaping).";

/** The file inside the single fenced block, or null when the block never
 *  closed (cut off) or is empty. Never repairs or invents content. */
export function parseRawFile(text: string): string | null {
  const open = /^[ \t]*```[^\n]*\n/m.exec(text);
  if (!open) return null;
  const start = open.index + open[0].length;
  const rest = text.slice(start);
  const close = /^[ \t]*```[ \t]*$/m.exec(rest);
  if (!close) return null;
  const body = rest.slice(0, close.index).replace(/\s+$/, "") + "\n";
  return body.trim() ? body : null;
}

/** Multi-file format for a DECOMPOSED page: one fenced block per file, the
 *  first line of each block names its path. */
export const RAW_FILES_FORMAT =
  "OUTPUT FORMAT (strict): one fenced code block per file. Each block starts with a line ```tsx, then a first line `// file: <path>`, then the full file, then a line ```. " +
  "Write the page file FIRST, then each section file it imports. No tool call, no JSON, no prose between blocks.";

/**
 * Every CLOSED block that names its path. A block cut off by the output limit
 * is dropped (never patched); the blocks before it are kept, so a truncated
 * decomposed page loses one section, not the whole page.
 */
export function parseRawFiles(text: string): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = [];
  const re = /^[ \t]*```[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const body = m[1]!;
    const head = /^\s*\/\/\s*file:\s*(\S+)\s*\n/.exec(body);
    if (!head) continue;
    const content = body.slice(head[0].length).replace(/\s+$/, "") + "\n";
    if (content.trim()) out.push({ path: head[1]!.replace(/^\.\//, ""), content });
  }
  return out;
}
