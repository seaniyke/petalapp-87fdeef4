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

/** Kit areas worth mapping for web builds, in the order a page is assembled. */
const MAP_AREAS: Array<{ dir: string; label: string; purpose: boolean }> = [
  { dir: "src/components/blocks/", label: "Page sections (blocks)", purpose: true },
  { dir: "src/components/motion/", label: "Motion", purpose: true },
  { dir: "src/components/fx/", label: "Visual effects", purpose: false },
  { dir: "src/components/content/", label: "Content", purpose: false },
  { dir: "src/components/image/", label: "Images", purpose: false },
  { dir: "src/components/scroll/", label: "Scroll", purpose: false },
  { dir: "src/components/examples/", label: "Full reference examples (copy patterns from, do not import)", purpose: false },
];

function firstDocSentence(src: string): string {
  const m = src.match(/\/\*\*([\s\S]*?)\*\//);
  if (!m) return "";
  const text = m[1]!.split("\n").map((l) => l.replace(/^\s*\*\s?/, "").trim()).filter((l) => l && !l.startsWith("@")).join(" ");
  const s = text.split(/(?<=\.)\s/)[0] ?? text;
  return s.length > 90 ? `${s.slice(0, 87)}…` : s;
}

function exportedNames(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/export\s+(?:default\s+)?(?:function|const|class)\s+([A-Z][A-Za-z0-9]*)/g)) out.add(m[1]!);
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1]!.split(",")) {
      const n = part.trim().split(/\s+as\s+/).pop()!.trim();
      if (/^[A-Z]/.test(n)) out.add(n);
    }
  }
  return [...out].slice(0, 4);
}

/** Own prop names of `XProps` (interface or type literal), from the kit source. */
export function propNames(src: string, component: string): string[] {
  const m = new RegExp(`(?:interface\\s+${component}Props[^{]*|type\\s+${component}Props\\s*=[^{]*)\\{([\\s\\S]*?)\\n\\}`).exec(src);
  if (!m) return [];
  const out: string[] = [];
  for (const line of m[1]!.split("\n")) {
    const k = /^\s{2}([A-Za-z_$][\w$]*)(\??):/.exec(line);
    if (k) out.push(`${k[1]}${k[2]}`);
  }
  return out.slice(0, 8);
}

/**
 * Deterministic map of the starter kit, derived from the files actually
 * shipped: path, exported components, one-line purpose. Lets the model pick a
 * primitive and read exactly that file — instead of discovering the kit with
 * repeated listings. No file contents are included.
 */
export function renderStarterKitMap(): string {
  const lines: string[] = [];
  for (const area of MAP_AREAS) {
    const files = KIT_FILES.filter((f) => f.path.startsWith(area.dir) && /\.tsx?$/.test(f.path)).sort((a, b) => a.path.localeCompare(b.path));
    if (!files.length) continue;
    lines.push(`${area.label} — ${area.dir.replace(/^src\//, "@/").replace(/\/$/, "")}:`);
    if (area.purpose) {
      for (const f of files) {
        const name = f.path.slice(area.dir.length).replace(/\.tsx?$/, "");
        const ex = exportedNames(f.content).map((n) => {
          const props = propNames(f.content, n);
          return props.length ? `${n}(${props.join(", ")})` : n;
        });
        const doc = firstDocSentence(f.content);
        lines.push(`- ${name}${ex.length ? ` {${ex.join(", ")}}` : ""}${doc ? ` — ${doc}` : ""}`);
      }
    } else {
      lines.push(files.map((f) => f.path.slice(area.dir.length).replace(/\.tsx?$/, "")).join(", "));
    }
  }
  if (!lines.length) return "";
  return (
    `\n### Starter-kit map (authoritative — do not list directories to discover it)\n` +
    `Everything below already exists. Import each component from its own path, exactly as listed ` +
    `(e.g. {SlideUp} from @/components/motion/slide-up). Exports and their own props are listed — use them ` +
    `directly; read a kit file only when you need implementation details the map does not give.\n${lines.join("\n")}\n`
  );
}
