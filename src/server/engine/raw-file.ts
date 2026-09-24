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
