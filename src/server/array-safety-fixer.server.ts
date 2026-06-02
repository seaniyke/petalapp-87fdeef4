/**
 * Array-safety autofixer.
 *
 * Root-causes the recurring runtime crash:
 *   `undefined is not an object (evaluating 'e.filter')`
 *
 * The bug: LLM-generated components call `.filter()` / `.map()` / `.length`
 * on a value that is undefined on first render. The two dominant sources
 * are async data (`const { data } = useQuery(...)` → undefined until
 * resolved) and `useState()` without an array initializer.
 *
 * The render-risk linter (R1) already catches optional props but only
 * SOFT-warns. By the time the model gets to autofix the file is already
 * shipped. This module is the deterministic safety net that runs on EVERY
 * generated file set: it locates identifiers that are provably-possibly-
 * undefined and rewrites array-method accesses on them to use `?? []`.
 *
 * Scope is intentionally narrow to avoid false positives:
 *   - useState(<no-arg>) / useState(undefined) / useState(null)
 *   - destructured `data` from useQuery/useSuspenseQuery/useInfiniteQuery
 *   - destructured `data` from supabase result objects (best-effort)
 *
 * Rewrite:
 *   ITEMS.filter(...)  →  (ITEMS ?? []).filter(...)
 *   ITEMS.length       →  (ITEMS ?? []).length
 *
 * NOT rewritten (already safe):
 *   ITEMS?.filter(...)
 *   (ITEMS ?? []).filter(...)
 *   foo.ITEMS.filter(...)   (member access, not the binding we tracked)
 */

import type { ProjectFile } from "@/server/generate.server";

const SCANNABLE = /\.(tsx?|jsx?)$/;

const ARRAY_METHODS = [
  "map",
  "filter",
  "forEach",
  "reduce",
  "reduceRight",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "some",
  "every",
  "includes",
  "indexOf",
  "lastIndexOf",
  "slice",
  "sort",
  "reverse",
  "flat",
  "flatMap",
  "join",
  "concat",
  "length",
];

export interface ArraySafetyFix {
  path: string;
  identifiers: string[];
  rewrites: number;
}

export interface ArraySafetyResult {
  files: ProjectFile[];
  fixes: ArraySafetyFix[];
}

function collectUnsafeIdents(src: string): Set<string> {
  const idents = new Set<string>();

  // 1. useState() / useState(undefined) / useState(null) / useState<T>()
  //    Form: const [X, setX] = useState(...)
  const useStateRe =
    /const\s*\[\s*([A-Za-z_$][\w$]*)\s*,\s*set[A-Z]\w*\s*\]\s*=\s*useState\s*(?:<[^>]*>)?\s*\(\s*(undefined|null)?\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = useStateRe.exec(src))) {
    idents.add(m[1]);
  }

  // 2. useQuery / useSuspenseQuery / useInfiniteQuery — destructured data.
  //    Form: const { data, ... } = useQuery(...)  OR  const { data: alias } = useQuery(...)
  //    Note: useSuspenseQuery's `data` is non-null at runtime, but only
  //    after suspense resolves; components rendered outside <Suspense>
  //    boundaries still crash. Treating it as possibly-undefined is safe.
  const queryRe =
    /const\s*\{\s*([^}]+?)\s*\}\s*=\s*(?:useQuery|useSuspenseQuery|useInfiniteQuery|useLoaderData)\b/g;
  while ((m = queryRe.exec(src))) {
    for (const part of m[1].split(",")) {
      const t = part.trim();
      if (!t) continue;
      const alias = /^data\s*:\s*([A-Za-z_$][\w$]*)/.exec(t);
      if (alias) {
        idents.add(alias[1]);
        continue;
      }
      if (/^data\b/.test(t)) idents.add("data");
    }
  }

  // 3. supabase client query: const { data } = await supabase... .select(...)
  //    Same shape — `data` may be null on error.
  const supabaseRe =
    /const\s*\{\s*([^}]+?)\s*\}\s*=\s*await\s+supabase\b/g;
  while ((m = supabaseRe.exec(src))) {
    for (const part of m[1].split(",")) {
      const t = part.trim();
      const alias = /^data\s*:\s*([A-Za-z_$][\w$]*)/.exec(t);
      if (alias) idents.add(alias[1]);
      else if (/^data\b/.test(t)) idents.add("data");
    }
  }

  // 4. Component prop destructuring WITHOUT a default value. The dominant
  //    landing-page crash source: `function Hero({ features }) { features.map(...) }`.
  //    The parent forgot to pass `features`, child crashes. We rewrite the
  //    body access defensively. Match `function Name({ a, b: c, d = [] }: ...)`
  //    and `const Name = ({ ... }: ...) => ...`. Only flag bindings with NO
  //    `= default` (those already have a default and are safe).
  const propsRe =
    /(?:function\s+[A-Z]\w*\s*\(|const\s+[A-Z]\w*\s*[:=][^=]*?=\s*\(|\(\s*)\{\s*([^}]+?)\s*\}\s*(?::\s*[^)=]+)?\s*\)\s*(?:=>|\{)/g;
  while ((m = propsRe.exec(src))) {
    for (const raw of m[1].split(",")) {
      const part = raw.trim();
      if (!part || part.startsWith("...")) continue;
      // Skip if it has a default value: `name = something`
      if (/=/.test(part)) continue;
      // Strip alias: `data: rows` → use `rows`
      const alias = /^[A-Za-z_$][\w$]*\s*:\s*([A-Za-z_$][\w$]*)/.exec(part);
      const name = alias ? alias[1] : (/^([A-Za-z_$][\w$]*)/.exec(part)?.[1] ?? "");
      if (!name) continue;
      // Don't touch obviously-non-array props
      if (/^(children|className|style|id|key|ref|onClick|on[A-Z])/.test(name)) continue;
      idents.add(name);
    }
  }

  return idents;
}


function rewriteFile(src: string, idents: Set<string>): { src: string; rewrites: number } {
  if (idents.size === 0) return { src, rewrites: 0 };
  let out = src;
  let rewrites = 0;
  const methodAlt = ARRAY_METHODS.join("|");

  for (const id of idents) {
    // Match `IDENT.method` where IDENT is NOT preceded by a word char,
    // `.`, or `?` (so we skip `obj.IDENT.method`, `IDENT?.method`, and
    // chained calls). Also skip if preceded by `(` directly followed by
    // ` ?? []).` (already wrapped).
    const re = new RegExp(
      `(^|[^\\w.?\\]])${id}\\.(${methodAlt})\\b`,
      "g",
    );
    out = out.replace(re, (_match, lead, method) => {
      rewrites++;
      return `${lead}(${id} ?? []).${method}`;
    });
  }

  return { src: out, rewrites };
}

export function fixArraySafety(files: ProjectFile[]): ArraySafetyResult {
  const fixes: ArraySafetyFix[] = [];
  const next = files.map((f) => {
    if (!SCANNABLE.test(f.path)) return f;
    if (
      f.path.startsWith("src/components/ui/") ||
      f.path.startsWith("src/integrations/") ||
      f.path === "src/routeTree.gen.ts"
    ) {
      return f;
    }
    const idents = collectUnsafeIdents(f.content);
    let src = f.content;
    let rewrites = 0;
    if (idents.size > 0) {
      const r = rewriteFile(src, idents);
      src = r.src;
      rewrites += r.rewrites;
    }

    // Final safety net: wrap ANY `{IDENT.map(` / `{IDENT.filter(` inside JSX
    // expression containers. Catches props/derived values we didn't track.
    // Only matches when preceded by `{` (JSX expression start) and the ident
    // is bare (not `obj.IDENT`, not `IDENT?.`, not already wrapped).
    const jsxRe = /(\{|\{\s)([A-Za-z_$][\w$]*)\.(map|filter|forEach|reduce|some|every|find|flatMap|slice|sort)\(/g;
    src = src.replace(jsxRe, (_m, lead: string, id: string, method: string) => {
      // Skip if identifier is a known global / safe name
      if (["Array", "Object", "JSON", "Math", "React", "console"].includes(id)) {
        return _m;
      }
      rewrites++;
      return `${lead}(${id} ?? []).${method}(`;
    });

    if (rewrites === 0) return f;
    fixes.push({ path: f.path, identifiers: [...idents], rewrites });
    return { ...f, content: src };
  });

  return { files: next, fixes };
}

