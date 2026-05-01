/**
 * Lightweight sanity check for AI-generated `src/styles.css`.
 *
 * Tailwind v4 aborts the entire build when it encounters an invalid CSS
 * declaration (e.g. a stray `1` line, an unbalanced brace, or a missing
 * `@import "tailwindcss";`). Instead of letting that bring down the whole
 * deploy, we run this validator at two points:
 *
 *  1. After the AI returns files but before we persist them.
 *  2. Immediately before we ship files to the Railway builder.
 *
 * If validation fails, the caller swaps the AI's CSS for the canonical
 * scaffold default. The user keeps full theme customization in the happy
 * path — we only step in when something is genuinely broken.
 *
 * This is intentionally conservative: we don't try to be a full CSS parser
 * (and we definitely don't want to ship Tailwind into our SSR worker). We
 * just catch the failure modes that have actually broken builds in
 * production.
 */

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

const TAILWIND_IMPORT = /^\s*@import\s+["']tailwindcss["']\s*;?/i;

/**
 * Strip block comments (/* ... *\/). We don't need full lexing — comments
 * in CSS can't span declarations in a way that would change our line-by-line
 * top-level checks for the bugs we care about.
 */
function stripBlockComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

export function validateStylesCss(raw: string): ValidationResult {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, reason: "empty file" };
  }

  // 1) Must begin with the Tailwind v4 import. Without it, every utility
  //    class in the app fails to resolve. Allow leading whitespace/comments.
  const headerStripped = stripBlockComments(raw).trimStart();
  if (!TAILWIND_IMPORT.test(headerStripped)) {
    return { ok: false, reason: 'missing `@import "tailwindcss";` at top of file' };
  }

  // 2) Brace balance. If `{` and `}` don't match, Tailwind's parser explodes
  //    at a confusing offset. Catch it here with a clean message.
  const noComments = stripBlockComments(raw);
  // Strip strings so braces inside content: "..." don't throw off the count.
  const noStrings = noComments.replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""');
  const open = (noStrings.match(/\{/g) ?? []).length;
  const close = (noStrings.match(/\}/g) ?? []).length;
  if (open !== close) {
    return { ok: false, reason: `unbalanced braces (${open} open vs ${close} close)` };
  }

  // 2.5) Tailwind v4 `@theme { ... }` may contain ONLY token declarations
  //      (`--name: value;`). Nested selectors like `.dark { ... }`,
  //      `:root { ... }`, `&:is(...)`, or `@media (...)` inside `@theme`
  //      abort the build with a confusing parser error. This is the most
  //      common AI mistake on Tailwind v4 — flag it deterministically so the
  //      autofix model gets a precise MUST-FIX entry instead of guessing.
  {
    const themeBlockRx = /@theme\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = themeBlockRx.exec(noStrings)) !== null) {
      const start = m.index + m[0].length;
      // Find matching closing brace, tracking nested depth.
      let d = 1;
      let end = -1;
      for (let i = start; i < noStrings.length; i++) {
        const ch = noStrings[i];
        if (ch === "{") d++;
        else if (ch === "}") {
          d--;
          if (d === 0) { end = i; break; }
        }
      }
      if (end === -1) break; // brace-balance check above already covers this
      const inner = noStrings.slice(start, end);
      // Any `{` inside means a nested block exists — illegal in @theme.
      if (inner.includes("{")) {
        // Find the offending line for a clearer message.
        const before = noStrings.slice(0, start + inner.indexOf("{"));
        const lineNo = before.split("\n").length;
        return {
          ok: false,
          reason: `nested block inside @theme { ... } on line ${lineNo} — Tailwind v4 only allows token declarations (\`--name: value;\`) inside @theme. Move .dark / :root / @media blocks OUTSIDE @theme.`,
        };
      }
    }
  }

  // 3) Top-level junk. Walk the file line by line, tracking nesting depth.
  //    When depth === 0, the only legal lines are: blank, line comments
  //    (handled by stripping), at-rules, selector lines (ending in `{` or
  //    a comma), or stray `}` that closes a previous block. Anything else
  //    — like a bare `1` — is what triggers Tailwind's "Invalid declaration".
  let depth = 0;
  const lines = noComments.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;

    // Update depth from this line's braces (rough but sufficient — we
    // already handled strings above for the totals; for per-line nesting
    // a small over/undercount is fine because we only flag clear top-level
    // garbage, never borderline cases).
    const opensHere = (line.match(/\{/g) ?? []).length;
    const closesHere = (line.match(/\}/g) ?? []).length;

    if (depth === 0) {
      // Line that starts a block, an at-rule, or closes a previous one.
      const startsAtRule = line.startsWith("@");
      const opensBlock = opensHere > 0;
      const closesBlock = closesHere > 0 && opensHere === 0;
      const isSelectorContinuation = line.endsWith(",");
      const isLikelySelector = opensBlock || isSelectorContinuation;

      if (!startsAtRule && !isLikelySelector && !closesBlock) {
        // Could be a continued selector that already opened on a previous
        // line ending in `,`. Look back one non-blank line.
        let prev = "";
        for (let j = i - 1; j >= 0; j--) {
          const t = lines[j].trim();
          if (t.length === 0) continue;
          prev = t;
          break;
        }
        if (!prev.endsWith(",")) {
          return {
            ok: false,
            reason: `unexpected top-level content on line ${i + 1}: ${truncate(line, 80)}`,
          };
        }
      }
    }

    depth += opensHere - closesHere;
    if (depth < 0) {
      return { ok: false, reason: `extra closing brace on line ${i + 1}` };
    }
  }

  // 4) `@apply` referencing a class that is never defined.
  //    Tailwind v4 aborts the entire build with "Cannot apply unknown utility
  //    class `foo`" when an `@apply` references a custom class (e.g.
  //    `neo-border`, `neo-card`, `glass-panel`) that wasn't registered via
  //    `@utility` / `@layer utilities { .foo { … } }`. The model frequently
  //    invents these for "neo-brutalist" / "glassmorphic" themes without
  //    defining them. Catch it deterministically — the fallback then swaps
  //    the broken stylesheet for the canonical scaffold.
  {
    const unknown = findUnknownAppliedClasses(noStrings);
    if (unknown.length > 0) {
      const sample = unknown.slice(0, 3).join("`, `");
      const more = unknown.length > 3 ? ` (+${unknown.length - 3} more)` : "";
      return {
        ok: false,
        reason: `\`@apply\` references undefined custom class(es): \`${sample}\`${more}. Define them with \`@utility ${unknown[0]} { … }\` (Tailwind v4) or use a built-in utility instead.`,
      };
    }
  }

  return { ok: true };
}

/**
 * Return the list of custom class names referenced by `@apply` that are NOT
 * defined anywhere in the same stylesheet. We only flag identifiers that
 * cannot possibly be a built-in Tailwind utility — i.e. multi-segment names
 * with no recognized prefix. This keeps false positives near zero.
 */
function findUnknownAppliedClasses(src: string): string[] {
  // Collect names defined locally, so user themes that DO declare their custom
  // utilities don't trip the check.
  const defined = new Set<string>();
  // `.foo { … }` — selectors
  for (const m of src.matchAll(/\.([a-zA-Z_][\w-]*)\s*[{,:]/g)) defined.add(m[1]);
  // `@utility foo { … }` — Tailwind v4 custom utility
  for (const m of src.matchAll(/@utility\s+([a-zA-Z_][\w-]*)/g)) defined.add(m[1]);

  const unknown = new Set<string>();
  // Capture the entire class list inside each `@apply …;`
  for (const m of src.matchAll(/@apply\s+([^;}{]+)[;}]/g)) {
    const tokens = m[1].trim().split(/\s+/);
    for (const tokRaw of tokens) {
      // Strip variant prefixes (`hover:`, `md:`, `dark:`, `group-hover:`, …)
      // and leading `!` (important). The actual utility is the LAST segment.
      const tok = tokRaw.replace(/^!/, "");
      const segments = tok.split(":");
      const util = segments[segments.length - 1];
      if (!util) continue;
      // If it's defined locally, it's fine.
      if (defined.has(util)) continue;
      // Heuristic: a custom (non-Tailwind) class typically uses two or more
      // hyphenated segments AND does NOT start with a known utility prefix.
      // Built-ins like `bg-red-500`, `text-foreground`, `rounded-lg`, `p-4`,
      // `flex`, `grid-cols-3`, `border` all match a known prefix or are
      // single-segment — so we leave them alone.
      if (looksLikeBuiltInUtility(util)) continue;
      unknown.add(util);
    }
  }
  return Array.from(unknown);
}

/** Conservative allowlist — if uncertain, treat as built-in (no false positive). */
function looksLikeBuiltInUtility(name: string): boolean {
  // Single-token utilities (flex, grid, hidden, block, container, …) — assume built-in.
  if (!name.includes("-")) return true;
  // Known Tailwind prefixes. Anything starting with one of these is treated as
  // a built-in utility — we don't try to validate the suffix.
  const prefixes = [
    "bg", "text", "border", "rounded", "shadow", "ring", "outline",
    "p", "px", "py", "pt", "pb", "pl", "pr", "ps", "pe",
    "m", "mx", "my", "mt", "mb", "ml", "mr", "ms", "me",
    "w", "h", "min", "max", "size",
    "flex", "grid", "col", "row", "gap", "space", "place", "items", "justify", "self", "content",
    "font", "leading", "tracking", "decoration", "underline", "uppercase", "lowercase",
    "opacity", "z", "top", "bottom", "left", "right", "inset", "translate", "rotate", "scale", "skew", "transform", "origin",
    "transition", "duration", "delay", "ease", "animate",
    "cursor", "select", "pointer", "overflow", "scroll", "snap", "touch", "resize",
    "object", "fill", "stroke", "list",
    "from", "via", "to",
    "divide", "order", "basis", "shrink", "grow",
    "backdrop", "blur", "brightness", "contrast", "grayscale", "invert", "saturate", "sepia", "drop",
    "aspect", "table", "caret", "accent", "appearance",
    "antialiased", "subpixel", "italic", "not", "sr",
    "absolute", "relative", "fixed", "sticky", "static",
  ];
  const head = name.split("-")[0];
  return prefixes.includes(head);
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
