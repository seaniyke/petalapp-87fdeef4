/**
 * Generated flows sometimes join a CSS selector and a Playwright text selector
 * with a comma ("button:has-text('X'), text=X"), which Playwright cannot parse.
 * Split top-level commas and OR the parts so a malformed check step never
 * fails a working app.
 */
export function splitSelector(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0, quote = "", cur = "";
  for (const ch of selector) {
    if (quote) { if (ch === quote) quote = ""; cur += ch; continue; }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.filter(Boolean);
}


/**
 * "header text=Book" (a CSS scope followed by a Playwright engine selector)
 * is not valid; Playwright needs "header >> text=Book". Rewrite that form.
 */
export function normalizeSelectorPart(part: string): string {
  const m = /^(.*?\S)\s+((?:text|role|data-testid|id)=.*)$/s.exec(part);
  if (!m || m[1].includes(">>") || /^(text|role|xpath|id|data-testid)=/.test(part)) return part;
  return `${m[1]} >> ${m[2]}`;
}
