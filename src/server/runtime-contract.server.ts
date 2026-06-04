/**
 * Phase 9 — Runtime contract pass.
 *
 * Failure modes this fixes:
 *
 *   A. Module-scope DOM access — `const w = window.innerWidth` at the top
 *      of a file. SSR/build crashes with `window is not defined`. Wrap
 *      such reads in a `typeof window !== "undefined"` guard.
 *
 *   B. shadcn `<Dialog>` / `<AlertDialog>` without a `<DialogTitle>` /
 *      `<AlertDialogTitle>` descendant. Radix throws a runtime error and
 *      the whole page unmounts. Inject a visually-hidden default title.
 *
 *   C. Controlled `<Select value={…}>` without `onValueChange`. The component
 *      becomes locked and clicks do nothing. Inject a `noop` handler so it
 *      degrades to read-only rather than mysteriously dead.
 *
 *   D. Context providers — for every `createContext()` declared in the
 *      project, ensure at least one `<X.Provider>` exists somewhere in the
 *      tree. If not, wrap App.tsx with a default-value provider. (We
 *      intentionally don't try to deduce provider position — wrapping App
 *      is always safe.)
 *
 * Pure ProjectFile[] → ProjectFile[]. Regex-based (no Babel) for the same
 * sub-5ms-per-file budget as the other passes.
 */

import type { ProjectFile } from "./generate.server";

const SCANNABLE = /\.(tsx|jsx)$/;
const ANY_TS = /\.(tsx?|jsx?)$/;

export interface RuntimeContractResult {
  files: ProjectFile[];
  notes: string[];
  windowGuards: number;
  dialogTitlesInjected: number;
  selectNoopsInjected: number;
  providersWrapped: string[];
}

// ---------- A. Module-scope DOM access guard ----------

// Top-level `const|let|var X = window.…` / `document.…` / `localStorage.…` /
// `navigator.…` / `sessionStorage.…` — i.e. NOT inside a function body.
// We approximate "top-level" by requiring the line starts at column 0.
const DOM_GLOBALS = ["window", "document", "localStorage", "sessionStorage", "navigator"];
const DOM_TOP_RE = new RegExp(
  `^(const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(${DOM_GLOBALS.join("|")})\\b([^;\\n]*);`,
  "gm",
);

function guardModuleScopeDom(file: ProjectFile): { file: ProjectFile; count: number } {
  if (!ANY_TS.test(file.path)) return { file, count: 0 };
  if (file.path.endsWith(".server.ts") || file.path.endsWith(".server.tsx")) {
    return { file, count: 0 };
  }
  let count = 0;
  const next = file.content.replace(
    DOM_TOP_RE,
    (_match, kw, name, glob, tail) => {
      count++;
      return `${kw} ${name} = (typeof ${glob} !== "undefined") ? (${glob}${tail}) : undefined;`;
    },
  );
  if (count === 0) return { file, count: 0 };
  return { file: { path: file.path, content: next }, count };
}

// ---------- B. Dialog/AlertDialog missing Title ----------

const DIALOG_BLOCK_RE = /<(Dialog|AlertDialog)Content\b[^>]*>([\s\S]*?)<\/\1Content>/g;

function injectDialogTitles(file: ProjectFile): { file: ProjectFile; count: number } {
  if (!SCANNABLE.test(file.path)) return { file, count: 0 };
  let count = 0;
  const content = file.content.replace(DIALOG_BLOCK_RE, (full, kind, inner) => {
    if (new RegExp(`<${kind}Title\\b`).test(inner)) return full;
    count++;
    // Insert a visually-hidden title right at the top of content.
    const hidden = `\n<${kind}Title className="sr-only">Dialog</${kind}Title>`;
    return full.replace(`>${inner}`, `>${hidden}${inner}`);
  });
  if (count === 0) return { file, count: 0 };

  // Ensure the Title import exists. We only handle the conventional
  // `@/components/ui/{dialog,alert-dialog}` import path; if the file imports
  // those modules at all, we augment the named-import list. Otherwise skip
  // — the existing scaffold for these primitives already exports the title.
  let next = content;
  for (const kind of ["Dialog", "AlertDialog"] as const) {
    if (!new RegExp(`<${kind}Title\\b`).test(next)) continue;
    const mod = kind === "Dialog" ? "dialog" : "alert-dialog";
    const importRe = new RegExp(
      `import\\s*\\{([^}]*)\\}\\s*from\\s*["']@/components/ui/${mod}["']`,
    );
    next = next.replace(importRe, (full, inner) => {
      if (new RegExp(`\\b${kind}Title\\b`).test(inner)) return full;
      return `import { ${inner.trim().replace(/,$/, "")}, ${kind}Title } from "@/components/ui/${mod}"`;
    });
  }

  return { file: { path: file.path, content: next }, count };
}

// ---------- C. Controlled <Select> without onValueChange ----------

const SELECT_TAG_RE = /<Select\b([^>]*)>/g;

function injectSelectNoop(file: ProjectFile): { file: ProjectFile; count: number } {
  if (!SCANNABLE.test(file.path)) return { file, count: 0 };
  let count = 0;
  const next = file.content.replace(SELECT_TAG_RE, (full, attrs) => {
    if (!/\bvalue\s*=/.test(attrs)) return full;
    if (/\bonValueChange\s*=/.test(attrs)) return full;
    if (/\bdefaultValue\s*=/.test(attrs)) return full; // uncontrolled, fine
    count++;
    return `<Select${attrs} onValueChange={() => {}}>`;
  });
  if (count === 0) return { file, count: 0 };
  return { file: { path: file.path, content: next }, count };
}

// ---------- D. Context providers ----------

const CREATE_CONTEXT_RE =
  /(?:export\s+)?(?:const|let|var)\s+([A-Z][A-Za-z0-9_]*)\s*=\s*(?:React\.)?createContext\b/g;

function findUnwrappedContexts(files: ProjectFile[]): Array<{ name: string; from: string }> {
  const created = new Map<string, string>(); // name → defining file
  for (const f of files) {
    if (!ANY_TS.test(f.path)) continue;
    let m: RegExpExecArray | null;
    const re = new RegExp(CREATE_CONTEXT_RE.source, "g");
    while ((m = re.exec(f.content))) created.set(m[1], f.path);
  }
  if (created.size === 0) return [];
  // Check whether ANY file uses `<Name.Provider`. Cheap, but accurate
  // enough — covers wrapper components defined separately from App.tsx.
  const unwrapped: Array<{ name: string; from: string }> = [];
  for (const [name, from] of created) {
    const re = new RegExp(`<${name}\\.Provider\\b`);
    const used = files.some((f) => ANY_TS.test(f.path) && re.test(f.content));
    if (!used) unwrapped.push({ name, from });
  }
  return unwrapped;
}

function wrapAppWithProviders(
  files: ProjectFile[],
  unwrapped: Array<{ name: string; from: string }>,
): { files: ProjectFile[]; wrapped: string[] } {
  if (unwrapped.length === 0) return { files, wrapped: [] };
  const appIdx = files.findIndex((f) => f.path === "src/App.tsx" || f.path === "src/main.tsx");
  if (appIdx < 0) return { files, wrapped: [] };
  const app = files[appIdx];
  let content = app.content;
  const wrapped: string[] = [];

  // Ensure each context is imported into App.tsx.
  for (const { name, from } of unwrapped) {
    // Skip when already referenced.
    if (new RegExp(`\\b${name}\\b`).test(content)) continue;
    const alias = `@/${from.replace(/^src\//, "").replace(/\.(tsx?|jsx?)$/, "")}`;
    content = `import { ${name} } from "${alias}";\n${content}`;
  }

  // Find the JSX root inside App's return and wrap it.
  const returnIdx = content.indexOf("return (");
  if (returnIdx < 0) return { files, wrapped: [] };
  let depth = 0;
  let start = -1;
  let end = -1;
  for (let i = returnIdx + "return (".length - 1; i < content.length; i++) {
    const ch = content[i];
    if (ch === "(") {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (start < 0 || end < 0) return { files, wrapped: [] };
  const inner = content.slice(start, end).trim();
  let wrappedJsx = inner;
  for (const { name } of unwrapped) {
    wrappedJsx = `<${name}.Provider value={undefined as any}>\n${wrappedJsx}\n</${name}.Provider>`;
    wrapped.push(name);
  }
  content = content.slice(0, start) + "\n" + wrappedJsx + "\n" + content.slice(end);

  const out = files.slice();
  out[appIdx] = { path: app.path, content };
  return { files: out, wrapped };
}

// ---------- composition ----------

export function enforceRuntimeContracts(input: ProjectFile[]): RuntimeContractResult {
  let files = input;
  let windowGuards = 0;
  let dialogTitlesInjected = 0;
  let selectNoopsInjected = 0;

  files = files.map((f) => {
    const a = guardModuleScopeDom(f);
    windowGuards += a.count;
    const b = injectDialogTitles(a.file);
    dialogTitlesInjected += b.count;
    const c = injectSelectNoop(b.file);
    selectNoopsInjected += c.count;
    return c.file;
  });

  const unwrapped = findUnwrappedContexts(files);
  const wrap = wrapAppWithProviders(files, unwrapped);
  files = wrap.files;

  const notes: string[] = [];
  if (windowGuards) notes.push(`runtime-contract: guarded ${windowGuards} module-scope DOM read(s)`);
  if (dialogTitlesInjected)
    notes.push(`runtime-contract: injected ${dialogTitlesInjected} missing Dialog/AlertDialog Title(s)`);
  if (selectNoopsInjected)
    notes.push(`runtime-contract: stubbed onValueChange on ${selectNoopsInjected} controlled <Select>`);
  if (wrap.wrapped.length)
    notes.push(`runtime-contract: wrapped App with ${wrap.wrapped.length} unwrapped Provider(s) (${wrap.wrapped.join(", ")})`);

  return {
    files,
    notes,
    windowGuards,
    dialogTitlesInjected,
    selectNoopsInjected,
    providersWrapped: wrap.wrapped,
  };
}
