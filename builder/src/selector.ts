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

