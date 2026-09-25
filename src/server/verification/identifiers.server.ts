/**
 * Deterministic undefined-identifier gate.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The write gate and the syntax gate run esbuild, which proves a file
 * PARSES. It cannot prove the code RUNS: `const x = mode ? 1 : 2` parses
 * cleanly even when `mode` was never declared, and the user finds out as a
 * `ReferenceError: mode is not defined` crash in the preview — after the
 * bytes were already committed.
 *
 * This gate closes that gap with the REAL TypeScript compiler (the
 * `typescript` package already ships with the project — no homemade
 * parser, no regex scope guessing). The proposed tree is loaded into an
 * in-memory program and we read the checker's semantic diagnostics,
 * keeping only TS2304 ("Cannot find name 'X'") on the files this turn
 * changed. Everything else (missing modules, implicit any, untyped JSX)
 * is owned by other gates and is filtered out here.
 *
 * Contract:
 *   - Never throws. Any compiler failure returns no issues (fail-open);
 *     esbuild remains the authoritative parse gate.
 *   - Only reports on files the turn actually changed.
 *   - No network, no filesystem, no AI.
 */
import ts from "typescript";

export interface IdentifierIssue {
  path: string;
  line: number;
  message: string;
}

/** TS2304 — "Cannot find name 'X'". The only diagnostic this gate owns. */
const CANNOT_FIND_NAME = 2304;

const PARSEABLE = /\.(tsx?|jsx?)$/i;

/**
 * Ambient declarations standing in for lib.dom / lib.esnext, which are not
 * loadable inside the Worker bundle. Value + type space are both declared
 * so real code (`new Map()`, `Promise<void>`, `console.log`) never looks
 * like an undefined identifier. Non-generic uses of generic names raise
 * TS2315, not TS2304, so they stay out of this gate's verdict.
 */
const AMBIENT_GLOBALS = `
declare var console: any;
declare var window: any;
declare var document: any;
declare var navigator: any;
declare var location: any;
declare var history: any;
declare var localStorage: any;
declare var sessionStorage: any;
declare var fetch: any;
declare var setTimeout: any;
declare var setInterval: any;
declare var clearTimeout: any;
declare var clearInterval: any;
declare var setImmediate: any;
declare var clearImmediate: any;
declare var requestAnimationFrame: any;
declare var cancelAnimationFrame: any;
declare var requestIdleCallback: any;
declare var queueMicrotask: any;
declare var structuredClone: any;
declare var alert: any;
declare var confirm: any;
declare var prompt: any;
declare var atob: any;
declare var btoa: any;
declare var crypto: any;
declare var performance: any;
declare var globalThis: any;
declare var process: any;
declare var Buffer: any;
declare var module: any;
declare var require: any;
declare var exports: any;
declare var __dirname: any;
declare var __filename: any;
declare var global: any;
declare var undefined: undefined;
declare var NaN: number;
declare var Infinity: number;
declare var parseInt: any;
declare var parseFloat: any;
declare var isNaN: any;
declare var isFinite: any;
declare var encodeURI: any;
declare var decodeURI: any;
declare var encodeURIComponent: any;
declare var decodeURIComponent: any;
declare type Console = any;
declare type Window = any;
declare type Document = any;
declare type Navigator = any;
declare type Storage = any;
declare type Response = any;
declare type Request = any;
declare type Headers = any;
declare type URL = any;
declare type URLSearchParams = any;
declare type FormData = any;
declare type Blob = any;
declare type File = any;
declare type FileReader = any;
declare type Event = any;
declare type EventTarget = any;
declare type CustomEvent = any;
declare type KeyboardEvent = any;
declare type MouseEvent = any;
declare type PointerEvent = any;
declare type TouchEvent = any;
declare type DragEvent = any;
declare type FocusEvent = any;
declare type InputEvent = any;
declare type SubmitEvent = any;
declare type AnimationEvent = any;
declare type TransitionEvent = any;
declare type WheelEvent = any;
declare type ClipboardEvent = any;
declare type MediaQueryList = any;
declare type HTMLElement = any;
declare type HTMLInputElement = any;
declare type HTMLTextAreaElement = any;
declare type HTMLSelectElement = any;
declare type HTMLFormElement = any;
declare type HTMLAnchorElement = any;
declare type HTMLButtonElement = any;
declare type HTMLImageElement = any;
declare type HTMLVideoElement = any;
declare type HTMLCanvasElement = any;
declare type HTMLDivElement = any;
declare type HTMLSpanElement = any;
declare type SVGElement = any;
declare type SVGSVGElement = any;
declare type Element = any;
declare type Node = any;
declare type NodeList = any;
declare type NodeListOf<T> = any;
declare type MutationObserver = any;
declare type ResizeObserver = any;
declare type ResizeObserverEntry = any;
declare type IntersectionObserver = any;
declare type IntersectionObserverEntry = any;
declare type AbortController = any;
declare type AbortSignal = any;
declare type TextEncoder = any;
declare type TextDecoder = any;
declare type WebSocket = any;
declare type Worker = any;
declare type Image = any;
declare type Audio = any;
declare type Geolocation = any;
declare type CanvasRenderingContext2D = any;
declare type WebGLRenderingContext = any;
declare type RequestInit = any;
declare type ResponseInit = any;
declare type HeadersInit = any;
declare type BodyInit = any;
declare type Timer = any;
declare type Timeout = any;
declare namespace NodeJS {
  type Timeout = any;
  type Timer = any;
  type ProcessEnv = any;
}
declare namespace JSX {
  interface IntrinsicElements { [elemName: string]: any }
  interface Element {}
  interface ElementChildrenAttribute { children: {} }
}
declare module "*";
`;

const AMBIENT_PATH = "/petal-ambient-globals.d.ts";

/**
 * Check the changed files of a proposed tree for identifiers the real
 * TypeScript checker cannot resolve to any declaration. Returns one issue
 * per unresolved name (deduped per name+file), or [] when clean / unable
 * to run.
 */
export function checkUndefinedIdentifiers(
  tree: Array<{ path: string; content: string }>,
  changedPaths: string[],
): IdentifierIssue[] {
  const targets = changedPaths.filter((p) => PARSEABLE.test(p));
  if (targets.length === 0) return [];
  try {
    const files = new Map(tree.map((f) => [`/${f.path}`, f.content]));
    const options: ts.CompilerOptions = {
      noEmit: true,
      noLib: true,
      allowJs: true,
      checkJs: false,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      types: [],
      // React 17+ JSX transform: tag names are not value identifiers, so
      // untyped JSX never produces a TS2304 false positive.
    };
    const host: ts.CompilerHost = {
      getSourceFile: (name, languageVersion) => {
        const content = name === AMBIENT_PATH ? AMBIENT_GLOBALS : files.get(name);
        if (content === undefined) return undefined;
        return ts.createSourceFile(name, content, languageVersion, true);
      },
      getDefaultLibFileName: () => AMBIENT_PATH,
      writeFile: () => {},
      getCurrentDirectory: () => "/",
      getDirectories: () => [],
      getCanonicalFileName: (f) => f,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => "\n",
      fileExists: (name) => name === AMBIENT_PATH || files.has(name),
      readFile: (name) => (name === AMBIENT_PATH ? AMBIENT_GLOBALS : files.get(name)),
    };
    const program = ts.createProgram([AMBIENT_PATH, ...files.keys()], options, host);
    const wanted = new Set(targets.map((p) => `/${p}`));
    const seen = new Set<string>();
    const issues: IdentifierIssue[] = [];
    for (const d of program.getSemanticDiagnostics()) {
      if (d.code !== CANNOT_FIND_NAME) continue;
      const file = d.file?.fileName;
      if (!file || !wanted.has(file)) continue;
      const message = ts.flattenDiagnosticMessageText(d.messageText, " ");
      const key = `${file}::${message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const { line } = d.file!.getLineAndCharacterOfPosition(d.start ?? 0);
      issues.push({ path: file.slice(1), line: line + 1, message });
    }
    return issues;
  } catch (e) {
    // Fail-open: the compiler itself failing must never block a commit.
    console.warn(
      "[identifier-gate] skipped:",
      e instanceof Error ? e.message : String(e),
    );
    return [];
  }
}
