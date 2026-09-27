/**
 * Flatten the assembled prompt's system messages into the single system
 * string the tool loop takes.
 *
 * The prompt is built as several system messages, and the first one's content
 * is a cache_control part array rather than a string. Stringifying it alone
 * produced "[object Object]", so first builds ran with no agent manual, no
 * selected skills and no design contract — the model invented its own
 * styling setup. Every system message, string or part array, is kept here.
 */
export function systemTextOf(messages: Array<{ role: string; content: unknown }>): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role !== "system") continue;
    if (typeof m.content === "string") parts.push(m.content);
    else if (Array.isArray(m.content)) {
      for (const p of m.content as Array<{ text?: unknown }>) {
        if (typeof p?.text === "string") parts.push(p.text);
      }
    }
  }
  return parts.filter((t) => t.trim()).join("\n\n");
}
