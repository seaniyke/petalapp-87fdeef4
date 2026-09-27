/**
 * Webby parity: pre-loaded template metadata.
 *
 * Webby's runner injects the template's machine-readable contract straight
 * into the first user message so the agent never has to spend a round trip on
 * `readFile("template.json")` before it can write code. The file itself still
 * exists in the workspace (the executor reads it back for route/orphan
 * checks, and later turns may read it), it is simply pre-loaded.
 *
 * Kimble does the same. `template.json` is shipped by the scaffold kit and is
 * scaffold-owned (read allowed, write refused); this module renders the same
 * contract as a prompt section so the first build starts writing immediately
 * with an accurate picture of what already exists.
 *
 * Derived, never hand-maintained: the content comes from the kit itself.
 */
import { KIT_FILES } from "@/server/scaffold-kit";

export const TEMPLATE_CONTRACT_PATH = "template.json";

/** Kit directories the metadata may advertise, kept only when shipped. */
export const REFERENCE_DIRS = ["@/components/blocks", "@/components/examples", "@/components/motion", "@/components/fx"] as const;

/**
 * THE template grounding rule — exactly one of these reaches the model.
 * Preloaded: the section below is the authoritative contract; reading the
 * file is optional. Not preloaded: read it before implementing.
 */
export const TEMPLATE_PRELOADED_RULE =
  "This is the complete, authoritative contract; you do not need to read template.json.";
export const TEMPLATE_READ_RULE =
  "Read template.json before writing code: it is the authoritative project contract.";

/** The grounding rule for a context that does or does not already carry the contract. */
export function templateGroundingRule(context: string): string {
  return context.includes(TEMPLATE_PRELOADED_RULE) ? "" : TEMPLATE_READ_RULE;
}

/** The contract file's content, as shipped by the scaffold kit. */
export function templateContractContent(): string {
  return KIT_FILES.find((f) => f.path === TEMPLATE_CONTRACT_PATH)?.content ?? "";
}

/** Parsed contract, or null when the kit somehow did not ship it. */
export function templateContract(): Record<string, unknown> | null {
  const raw = templateContractContent();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * The prompt section. Mirrors Webby's `buildTemplateMetadataSection`: layout,
 * available primitives, icon set, routing pattern, usage examples — stated as
 * fact so the model does not read or guess them.
 */
export function renderTemplateMetadataSection(): string {
  const c = templateContract();
  if (!c) return "";
  const fs = (c["file_structure"] ?? {}) as Record<string, string>;
  const styling = (c["styling"] ?? {}) as Record<string, string>;
  const shadcn = Array.isArray(c["shadcn_components"]) ? (c["shadcn_components"] as string[]) : [];
  const examples = (c["usage_examples"] ?? {}) as Record<string, string>;
  const protectedFiles = Array.isArray(c["protected_files"]) ? (c["protected_files"] as string[]) : [];

  // Only directories the kit actually ships — the section describes reality.
  const refDirs = REFERENCE_DIRS.filter((d) => KIT_FILES.some((f) => f.path.startsWith(`src/${d.slice(2)}/`)));
  return (
    `\n### Project contract (template.json)\n${TEMPLATE_PRELOADED_RULE}\n` +
    `Pages: ${fs["pages_dir"]}/  ·  Components: ${fs["components_dir"]}/  ·  ` +
    `Router: ${fs["routes_file"]}  ·  Entry: ${fs["entry_file"]}  ·  Stylesheet: ${fs["stylesheet"]}\n` +
    `Routing: ${c["routing_pattern"]}  ·  Styling: ${styling["framework"]} v${styling["tailwind_version"]} ` +
    `(${styling["tokens"]})  ·  Icons: ${styling["icon_set"]}\n` +
    `Pre-installed UI kit at @/components/ui — import these, never write them: ${shadcn.join(", ")}.\n` +
    (refDirs.length ? `Also installed (import or copy from): ${refDirs.join(", ")}.\n` : "") +
    `Read-only (writes are refused): ${protectedFiles.join(", ")}.\n` +
    Object.values(examples)
      .map((e) => `- ${e}`)
      .join("\n") +
    `\n` +
    renderStarterKitMap()
  );
}

/* ------------------------------------------------------------------ */
/* Compact starter-kit map (what exists, where, what for)              */
/* ------------------------------------------------------------------ */

/**
 * Kit areas worth mapping for web builds, in the order a page is assembled.
 * `api: true` areas carry the full public API (every export, its prop types,
 * variant keys) — exactly what a writer needs to use the component, so no
 * read_file is required to rediscover it. Examples are full compositions,
 * not an importable API, and are listed by name only.
 */
const MAP_AREAS: Array<{ dir: string; label: string; api: boolean }> = [
  { dir: "src/components/ui/", label: "UI kit", api: true },
  { dir: "src/components/blocks/", label: "Page sections (blocks)", api: true },
  { dir: "src/components/motion/", label: "Motion", api: true },
  { dir: "src/components/fx/", label: "Visual effects", api: false },
  { dir: "src/components/content/", label: "Content", api: false },
  { dir: "src/components/image/", label: "Images", api: false },
  { dir: "src/components/scroll/", label: "Scroll", api: false },
  { dir: "src/components/examples/", label: "Full example compositions (optional; not needed to build — compose from the blocks above)", api: false },
];

function firstDocSentence(src: string): string {
  const m = src.match(/\/\*\*([\s\S]*?)\*\//);
  if (!m) return "";
  const text = m[1]!.split("\n").map((l) => l.replace(/^\s*\*\s?/, "").trim()).filter((l) => l && !l.startsWith("@")).join(" ");
  const s = text.split(/(?<=\.)\s/)[0] ?? text;
  return s.length > 90 ? `${s.slice(0, 87)}…` : s;
}

const squash = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").replace(/\s+/g, " ").trim();

/** Every exported value name (components, hooks, helpers, re-exports), in source order. */
export function exportedNames(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class|let)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]!);
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1]!.split(",")) {
      const raw = part.trim();
      if (!raw || raw.startsWith("type ")) continue;
      const n = raw.split(/\s+as\s+/).pop()!.trim();
      if (n && n !== "default") out.add(n);
    }
  }
  return [...out];
}

/** Text from `start` (an opening bracket) to its matching close, inclusive. */
function balanced(src: string, start: number): string {
  const open = src[start]!;
  const close = open === "{" ? "}" : open === "(" ? ")" : open === "<" ? ">" : "";
  if (!close) return "";
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) return src.slice(start, i + 1);
  }
  return "";
}

/** Top-level interface / type declarations (the component contracts), whitespace-collapsed. */
export function typeDeclarations(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/^(?:export\s+)?(interface|type)\s+([A-Z][\w$]*)([^\n{=]*)(=?)/gm)) {
    const at = m.index! + m[0].length;
    if (m[1] === "interface") {
      const brace = src.indexOf("{", at - 1);
      const body = brace >= 0 ? balanced(src, brace) : "";
      out.push(squash(`interface ${m[2]}${m[3]} ${body}`));
    } else {
      // type X = ... ; (may span lines until a top-level ';' or blank line)
      let i = at, depth = 0;
      for (; i < src.length; i++) {
        const ch = src[i];
        if ("{(<[".includes(ch!)) depth++;
        else if ("})>]".includes(ch!)) depth--;
        else if (depth <= 0 && (ch === ";" || (ch === "\n" && src[i + 1] === "\n"))) break;
      }
      out.push(squash(`type ${m[2]}${m[3]}= ${src.slice(at, i)}`));
    }
  }
  return out;
}

/** cva variant keys, e.g. `variant=default|outline; size=sm|lg`. */
export function variantKeys(src: string): string {
  const at = src.search(/\bvariants:\s*\{/);
  if (at < 0) return "";
  const body = balanced(src, src.indexOf("{", at));
  const out: string[] = [];
  for (const g of body.slice(1, -1).matchAll(/(\w+):\s*\{([^{}]*)\}/g)) {
    const keys = [...g[2]!.matchAll(/^\s*["']?([\w-]+)["']?\s*:/gm)].map((x) => x[1]);
    if (keys.length) out.push(`${g[1]}=${keys.join("|")}`);
  }
  return out.join("; ");
}

/** Inline parameter type of an exported component without a named Props type. */
function inlineParams(src: string, name: string): string {
  const m = new RegExp(`export\\s+(?:default\\s+)?function\\s+${name}\\s*(?:<[^>]*>)?\\(`).exec(src);
  if (!m) return "";
  const params = balanced(src, m.index + m[0].length - 1);
  const colon = params.indexOf(":");
  if (colon < 0 || /:\s*[A-Z][\w$]*Props\b/.test(params)) return "";
  const s = squash(params.slice(colon + 1, -1));
  return s.length > 260 ? "" : `${name}: ${s}`;
}

/** Own prop names of `XProps` (interface or type literal), from the kit source. */
export function propNames(src: string, component: string): string[] {
  const decl = typeDeclarations(src).find((d) => new RegExp(`^(?:interface|type)\\s+${component}Props\\b`).test(d));
  if (!decl) return [];
  const body = decl.slice(decl.indexOf("{"));
  return [...body.matchAll(/[{;]\s*([A-Za-z_$][\w$]*)(\??)\s*:/g)].map((k) => `${k[1]}${k[2]}`);
}

/** The public API of one kit file: exports, their types, variant keys. */
export function kitFileApi(src: string): { exports: string[]; types: string[] } {
  const exports = exportedNames(src);
  const types = typeDeclarations(src);
  for (const n of exports) {
    const p = /^[A-Z]/.test(n) ? inlineParams(src, n) : "";
    if (p) types.push(p);
  }
  const v = variantKeys(src);
  if (v) types.push(`variants: ${v}`);
  return { exports, types };
}

/**
 * Deterministic API reference for the starter kit, derived from the files
 * actually shipped: path, every export, its prop/item types and variant keys.
 * It is the same information reading the file would give a writer, so the
 * model starts writing immediately instead of rediscovering the kit with
 * read_file. Component bodies are never included.
 */
export function renderStarterKitMap(): string {
  const lines: string[] = [];
  for (const area of MAP_AREAS) {
    const files = KIT_FILES.filter((f) => f.path.startsWith(area.dir) && /\.tsx?$/.test(f.path)).sort((a, b) => a.path.localeCompare(b.path));
    if (!files.length) continue;
    lines.push(`${area.label} — ${area.dir.replace(/^src\//, "@/").replace(/\/$/, "")}:`);
    if (area.api) {
      for (const f of files) {
        const name = f.path.slice(area.dir.length).replace(/\.tsx?$/, "");
        const api = kitFileApi(f.content);
        const doc = area.dir.endsWith("/ui/") ? "" : firstDocSentence(f.content);
        lines.push(`- ${name}${api.exports.length ? ` {${api.exports.join(", ")}}` : ""}${doc ? ` — ${doc}` : ""}`);
        if (api.types.length) lines.push(`    ${api.types.join("; ")}`);
      }
    } else {
      lines.push(files.map((f) => f.path.slice(area.dir.length).replace(/\.tsx?$/, "")).join(", "));
    }
  }
  if (!lines.length) return "";
  return (
    `\n### Starter-kit API (authoritative — derived from the shipped files; do not list directories to discover it)\n` +
    `Everything below already exists. Import each export from its own path exactly as listed ` +
    `(e.g. {SlideUp} from @/components/motion/slide-up). The exports, prop types and variants below are the ` +
    `complete public API — the same thing reading the file would tell you — so use them directly without read_file. ` +
    `Wrong-path kit imports are corrected automatically.\n${lines.join("\n")}\n`
  );
}
