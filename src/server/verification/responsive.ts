/**
 * Responsive advisories — NON-BLOCKING. Pure; no I/O.
 *
 * Flags only very high-confidence mobile hazards in changed source files.
 * Never affects verification status: the result is attached to the record
 * and logged as telemetry. The build server's Playwright overflow check
 * (375px) stays the real evidence.
 */
export interface ResponsiveWarning {
  path: string;
  line: number;
  rule: "table-no-scroll" | "fixed-width-over-mobile";
  message: string;
}

/** Widths this large (px) cannot fit a 375px phone. */
const MOBILE_LIMIT_PX = 480;
const SCROLL_WRAPPER = /overflow-(x-)?(auto|scroll)/;

const lineOf = (src: string, idx: number) => src.slice(0, idx).split("\n").length;

export function responsiveWarnings(files: Array<{ path: string; content: string }>, changedPaths: string[]): ResponsiveWarning[] {
  const changed = new Set(changedPaths);
  const out: ResponsiveWarning[] = [];
  for (const f of files) {
    if (!changed.has(f.path) || !/\.(tsx|jsx)$/.test(f.path)) continue;
    const src = f.content;
    // Scroll wrappers may live in a kit Table component (shadcn wraps it).
    const usesKitTable = /from\s+["'][^"']*components\/ui\/table["']/.test(src);

    // 1. Raw <table> with no horizontal-scroll wrapper anywhere before it in the same file.
    if (!usesKitTable) {
      const re = /<table\b/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const before = src.slice(Math.max(0, m.index - 800), m.index);
        if (!SCROLL_WRAPPER.test(before)) {
          out.push({ path: f.path, line: lineOf(src, m.index), rule: "table-no-scroll", message: "table has no overflow-x-auto wrapper; it can overflow a phone screen" });
        }
      }
    }

    // 2. Fixed pixel widths larger than any phone, with no responsive or max-width escape in the same class list.
    const cls = /className\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g;
    let c: RegExpExecArray | null;
    while ((c = cls.exec(src))) {
      const list = c[1] ?? c[2] ?? c[3] ?? "";
      const tokens = list.split(/\s+/);
      for (const t of tokens) {
        const w = /^(min-)?w-\[(\d+)px\]$/.exec(t);
        if (!w || Number(w[2]) <= MOBILE_LIMIT_PX) continue;
        const escaped = tokens.some((x) => /^max-w-/.test(x) || /^(sm|md|lg|xl|2xl):(min-)?w-/.test(x)) || /^(sm|md|lg|xl|2xl):/.test(t);
        if (!escaped) {
          out.push({ path: f.path, line: lineOf(src, c.index), rule: "fixed-width-over-mobile", message: `${t} is wider than a phone with no max-width or breakpoint alternative` });
        }
      }
    }
  }
  return out;
}
