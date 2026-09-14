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
 * Context providers are intentionally not synthesized. Their value is an
 * application contract; guessing it can turn a missing-provider issue into a
 * production crash that still passes TypeScript and Vite.
 *
 * Pure ProjectFile[] → ProjectFile[]. Regex-based (no Babel) for the same
 * sub-5ms-per-file budget as the other passes.
 */

import { rewriteOpeningTags } from "./jsx-tag-scan.server";
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

function injectSelectNoop(file: ProjectFile): { file: ProjectFile; count: number } {
  if (!SCANNABLE.test(file.path)) return { file, count: 0 };
  // Must use the brace-aware scanner: `<Select value={x} onChange={(v) => f(v)}>`
  // contains a `>` inside an attribute, and a `[^>]*` regex would splice the
  // injected prop into the middle of the arrow function (TS1005/TS1382).
  const { content, fixes } = rewriteOpeningTags(
    file.content,
    (name) => name === "Select",
    (tag) => {
      if (tag.selfClosing) return null;
      if (!/\bvalue\s*=/.test(tag.attrs)) return null;
      if (/\bonValueChange\s*=/.test(tag.attrs)) return null;
      if (/\bdefaultValue\s*=/.test(tag.attrs)) return null; // uncontrolled, fine
      return `<Select${tag.attrs} onValueChange={() => {}}>`;
    },
  );
  if (fixes === 0) return { file, count: 0 };
  return { file: { path: file.path, content }, count: fixes };
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

  // Never inject an invented context value. Targeted generation/repair owns
  // provider construction because it knows the required state shape.
  const providersWrapped: string[] = [];

  const notes: string[] = [];
  if (windowGuards) notes.push(`runtime-contract: guarded ${windowGuards} module-scope DOM read(s)`);
  if (dialogTitlesInjected)
    notes.push(`runtime-contract: injected ${dialogTitlesInjected} missing Dialog/AlertDialog Title(s)`);
  if (selectNoopsInjected)
    notes.push(`runtime-contract: stubbed onValueChange on ${selectNoopsInjected} controlled <Select>`);
  return {
    files,
    notes,
    windowGuards,
    dialogTitlesInjected,
    selectNoopsInjected,
    providersWrapped,
  };
}
