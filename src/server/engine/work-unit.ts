/**
 * WORK UNIT — the one execution primitive of the WRITE stage.
 *
 * A work unit is one bounded, observable piece of work: a foundation module,
 * a page, a section, the router. Each unit is executed, IMMEDIATELY validated
 * against the staged tree (truncation, imports, real export signatures), and
 * its result is recorded before dependent units run. A failing unit gets its
 * exact diagnostic back once (same-writer feedback); only after that does it
 * fall to the existing recovery table / final gates.
 *
 * Pure and deterministic. It does not write to the project: results are
 * staged into the existing TurnTransaction by the single writer, and the
 * final authoritative verification + CAS commit are unchanged.
 */
import type { ProjectFile } from "@/server/generate.server";
import { resolveSpecifier } from "@/server/engine/structural-deps";

export type UnitKind = "foundation" | "page" | "section" | "router" | "edit";

export interface WorkUnit {
  id: string;
  kind: UnitKind;
  /** File the unit may write (sections: its folder is in `mayWrite`). */
  target: string;
  reason: string;
  /** Unit ids that must be complete (with real signatures) before this runs. */
  dependsOn: string[];
  mayWrite: string[];
  /** On immediate-validation failure: correct in the same writer, then recovery. */
  onFailure: "same_writer_then_recovery";
}

export interface UnitRecord {
  id: string;
  kind: UnitKind;
  target: string;
  layer: number;
  calls: number;
  feedbackRounds: number;
  continued: boolean;
  diagnostics: string[];
  ms: number;
  outcome: "ok" | "corrected" | "failed" | "skipped_done";
}

// ---------------------------------------------------------------------------
// Real export signatures (derived from staged source; never guessed)
// ---------------------------------------------------------------------------

export interface ExportSignature {
  path: string;
  hasDefault: boolean;
  named: string[];
  components: string[];
  functions: string[];
  types: string[];
}

const DECL = /export\s+(?:declare\s+)?(?:async\s+)?(function\*?|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g;

export function exportSignature(path: string, content: string): ExportSignature {
  const named = new Set<string>();
  const types = new Set<string>();
  const functions = new Set<string>();
  for (const m of content.matchAll(DECL)) {
    const kind = m[1]!;
    const name = m[2]!;
    if (kind === "type" || kind === "interface") types.add(name);
    else {
      named.add(name);
      if (kind.startsWith("function")) functions.add(name);
    }
  }
  for (const m of content.matchAll(/export\s+(type\s+)?\{([^}]*)\}(?!\s*from)/g)) {
    for (const part of m[2]!.split(",")) {
      const raw = part.trim();
      if (!raw) continue;
      const isType = Boolean(m[1]) || raw.startsWith("type ");
      const exported = raw.replace(/^type\s+/, "").split(/\s+as\s+/).pop()!.trim();
      if (exported === "default") continue;
      (isType ? types : named).add(exported);
    }
  }
  for (const m of content.matchAll(/export\s+(type\s+)?\{([^}]*)\}\s*from/g)) {
    for (const part of m[2]!.split(",")) {
      const exported = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop()!.trim();
      if (exported && exported !== "default") (m[1] ? types : named).add(exported);
    }
  }
  const hasDefault =
    /export\s+default\b/.test(content) || /export\s*\{[^}]*\bas\s+default\b[^}]*\}/.test(content);
  const components = [...named].filter((n) => /^[A-Z][a-z0-9]/.test(n) && !/^[A-Z0-9_]+$/.test(n));
  return {
    path,
    hasDefault,
    named: [...named].sort(),
    components: components.sort(),
    functions: [...functions].sort(),
    types: [...types].sort(),
  };
}

const isSource = (p: string) => /\.(tsx?|jsx?)$/.test(p);
const isPage = (p: string) => p.startsWith("src/pages/");

/** "import like this" line for one module, written for a model. */
export function describeSignature(sig: ExportSignature): string {
  const alias = "@/" + sig.path.replace(/^src\//, "").replace(/\.(tsx?|jsx?)$/, "");
  const parts: string[] = [];
  if (sig.named.length) parts.push(`named { ${sig.named.slice(0, 30).join(", ")} }`);
  if (sig.types.length) parts.push(`types { ${sig.types.slice(0, 15).join(", ")} }`);
  parts.push(sig.hasDefault ? "HAS a default export" : "NO default export");
  return `- ${alias}: ${parts.join("; ")}`;
}

/** Signatures of every non-page app module a page may import (UI kit excluded — listed by name elsewhere). */
export function sharedSignatures(files: ProjectFile[]): ExportSignature[] {
  return files
    .filter(
      (f) =>
        isSource(f.path) &&
        f.path.startsWith("src/") &&
        !isPage(f.path) &&
        !f.path.startsWith("src/components/ui/") &&
        !f.path.startsWith("src/integrations/supabase/") &&
        !/^src\/(main|App)\.tsx$/.test(f.path) &&
        !/\.d\.ts$/.test(f.path),
    )
    .map((f) => exportSignature(f.path, f.content))
    .filter((s) => s.named.length || s.hasDefault || s.types.length)
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function signatureContext(files: ProjectFile[]): string {
  const sigs = sharedSignatures(files);
  if (!sigs.length) return "";
  return [
    "REAL EXPORT SIGNATURES of the modules that already exist (import them exactly like this — a module with NO default export must be imported with braces):",
    ...sigs.slice(0, 80).map(describeSignature),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Immediate unit validation (deterministic, against the staged tree)
// ---------------------------------------------------------------------------

export interface UnitDiagnostic {
  path: string;
  spec: string;
  message: string;
}

const IMPORT = /import\s+(type\s+)?([\w$]+)?\s*,?\s*(\{[^}]*\})?\s*(?:\*\s+as\s+[\w$]+\s*)?from\s*["']([^"']+)["']/g;

function resolveStaged(from: string, spec: string, byPath: Map<string, string>): string | null {
  const hit = resolveSpecifier(from, spec, new Set(byPath.keys()));
  if (!hit) return null;
  return typeof hit === "string" ? hit : null;
}

/**
 * Validate one produced file's imports against the staged tree:
 *  - every local import resolves to a staged file;
 *  - a default import targets a module that HAS a default export;
 *  - every named import exists in the target's real signature.
 * Type-only imports are checked for existence only (they are erased).
 */
export function validateUnitImports(file: ProjectFile, staged: ProjectFile[]): UnitDiagnostic[] {
  if (!isSource(file.path)) return [];
  const byPath = new Map(staged.map((f) => [f.path, f.content]));
  byPath.set(file.path, file.content);
  const out: UnitDiagnostic[] = [];
  IMPORT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMPORT.exec(file.content))) {
    const typeOnly = Boolean(m[1]);
    const def = m[2];
    const spec = m[4]!;
    if (!spec.startsWith("@/") && !spec.startsWith(".")) continue;
    if (/\.(css|svg|png|jpe?g|webp|gif|json)$/.test(spec)) continue;
    const target = resolveStaged(file.path, spec, byPath);
    if (!target) {
      out.push({
        path: file.path,
        spec,
        message: `"${spec}" does not exist. Import only from the existing modules listed in the signatures, or define it inside ${file.path}.`,
      });
      continue;
    }
    if (typeOnly || !isSource(target)) continue;
    const sig = exportSignature(target, byPath.get(target) ?? "");
    const avail = sig.named.length ? `Available named exports: { ${sig.named.slice(0, 20).join(", ")} }.` : "";
    if (def && !sig.hasDefault) {
      out.push({
        path: file.path,
        spec,
        message: `"${spec}" has NO default export, so \`import ${def} from "${spec}"\` is invalid. ${avail}${sig.named.includes(def) ? ` Use \`import { ${def} } from "${spec}"\`.` : ""}`,
      });
    }
    const names = (m[3] ?? "")
      .replace(/[{}]/g, "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("type "))
      .map((s) => s.split(/\s+as\s+/)[0]!.trim());
    const all = new Set([...sig.named, ...sig.types]);
    const missing = names.filter((n) => n !== "default" && !all.has(n));
    if (missing.length) {
      out.push({
        path: file.path,
        spec,
        message: `"${spec}" does not export ${missing.map((n) => `\`${n}\``).join(", ")}. ${avail}${sig.hasDefault ? " It has a default export." : ""}`,
      });
    }
  }
  return out;
}

export function feedbackInstruction(original: string, file: ProjectFile, diags: UnitDiagnostic[]): string {
  return [
    original,
    "",
    "IMMEDIATE VALIDATION FEEDBACK — your previous answer for this file failed these exact checks against the real project:",
    ...diags.map((d) => `- ${d.message}`),
    "Rewrite the SAME file, complete, fixing only these problems. Keep everything else as it was.",
    `Your previous version of ${file.path}:`,
    "```tsx",
    file.content,
    "```",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Truncation continuation (never regenerate a whole file blindly)
// ---------------------------------------------------------------------------

/** The produced part up to its last complete line. */
export function completedPortion(partial: string): string {
  const cut = partial.lastIndexOf("\n");
  return cut === -1 ? "" : partial.slice(0, cut + 1);
}

export function continuationInstruction(target: string, partial: string): string {
  const done = completedPortion(partial);
  return [
    `CONTINUATION: your answer for ${target} was cut off. The completed portion is below.`,
    `WRITE SCOPE: exactly one file — write it as ${target}, but its content must be ONLY the remaining source that comes AFTER the last line shown, so that (completed portion + your answer) is the whole file.`,
    "Do not repeat any line already written. Do not add imports that are already present. Finish every open JSX element, function and the default export.",
    "Completed portion:",
    "```tsx",
    done,
    "```",
  ].join("\n");
}

export function stitchContinuation(partial: string, continuation: string): string {
  const done = completedPortion(partial);
  let rest = continuation.replace(/^\s*\n/, "");
  // Models sometimes echo the last line they were shown; drop one exact echo.
  const lastLine = done.trimEnd().split("\n").pop()?.trim();
  if (lastLine && rest.trimStart().startsWith(lastLine) && lastLine.length > 8) {
    rest = rest.trimStart().slice(lastLine.length).replace(/^\s*\n/, "");
  }
  return done + rest;
}

// ---------------------------------------------------------------------------
// Dependency layers
// ---------------------------------------------------------------------------

/**
 * Build the unit graph for a first build's WRITE stage.
 * Layer 0: missing foundation modules (independent → parallel).
 * Layer 1: pages (each depends on every foundation unit — they consume real signatures).
 * Layer 2: router/frame (depends on pages).
 */
export function planWorkUnits(pages: Array<{ route: string; file: string }>, foundationTargets: string[]): WorkUnit[][] {
  const foundation: WorkUnit[] = foundationTargets.map((t) => ({
    id: `foundation:${t}`,
    kind: "foundation",
    target: t,
    reason: "shared module imported by the frame but not yet created",
    dependsOn: [],
    mayWrite: [t],
    onFailure: "same_writer_then_recovery",
  }));
  const pageUnits: WorkUnit[] = pages.map((p) => ({
    id: `page:${p.file}`,
    kind: "page",
    target: p.file,
    reason: `planned route ${p.route}`,
    dependsOn: foundation.map((f) => f.id),
    mayWrite: [p.file],
    onFailure: "same_writer_then_recovery",
  }));
  const router: WorkUnit = {
    id: "router:src/App.tsx",
    kind: "router",
    target: "src/App.tsx",
    reason: "register every written page (only if the frame is incomplete)",
    dependsOn: pageUnits.map((p) => p.id),
    mayWrite: ["src/App.tsx"],
    onFailure: "same_writer_then_recovery",
  };
  return [foundation, pageUnits, [router]].filter((l) => l.length);
}
