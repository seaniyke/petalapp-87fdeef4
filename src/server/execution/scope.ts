/**
 * Execution scope: the explicit contract for one turn. The AI may change the
 * affected files; shared chrome (nav/header/footer/layout) and unrelated
 * pages are protected unless the request names them or a dependency needs
 * them. Scope never grows silently.
 */
import type { ProjectManifest } from "@/server/context/manifest";
import type { Classification } from "./classify";

export interface ExecutionScope {
  operation: Classification["operation"];
  outcome: string;
  affectedPages: string[];
  affectedComponents: string[];
  affectedFiles: string[];
  constraints: string[];
  protectedAreas: string[];
  acceptance: string[];
  /** True when this path may not be written this turn. */
  isProtected(path: string): boolean;
  /** Why a path is protected, or null. */
  protectionReason(path: string): string | null;
}

const CHROME_RE = /(Layout|Header|Footer|Nav(bar)?|SiteNav|Shell|Sidebar)\.(t|j)sx$/;
const CHROME_WORDS = /\b(nav|navbar|navigation|menu|header|footer|layout|sidebar|site-?wide|every page|all pages)\b/i;

function constraintsFrom(request: string): string[] {
  const out: string[] = [];
  for (const m of request.matchAll(/\b(?:don'?t|do not|never|keep|leave|without)\b[^.!?\n]{3,80}/gi)) out.push(m[0].trim());
  return out.slice(0, 6);
}

export function buildExecutionScope(args: {
  request: string;
  classification: Classification;
  manifest: ProjectManifest | null;
  targets: string[];
  neighbours?: string[];
}): ExecutionScope {
  const { request, classification, manifest } = args;
  const targets = Array.from(new Set(args.targets));
  const neighbours = (args.neighbours ?? []).filter((p) => !targets.includes(p));
  const pagesSet = new Set(manifest?.pages.map((p) => p.path) ?? []);
  const wide =
    classification.operation === "first_build" ||
    classification.operation === "architectural_change" ||
    classification.operation === "page_creation" ||
    targets.length === 0;
  const chromeNamed = CHROME_WORDS.test(request);

  const reason = (p: string): string | null => {
    if (wide || targets.includes(p)) return null;
    if (CHROME_RE.test(p) && !chromeNamed) return "shared navigation/layout was not part of this request";
    if (pagesSet.has(p) && !neighbours.includes(p)) return "a different page than the one requested";
    return null;
  };

  const protectedAreas = wide
    ? []
    : [
        ...(chromeNamed ? [] : (manifest?.layouts ?? []).filter((l) => !targets.includes(l))),
        ...[...pagesSet].filter((p) => !targets.includes(p) && !neighbours.includes(p)),
      ];

  return {
    operation: classification.operation,
    outcome: request.trim().slice(0, 300),
    affectedPages: targets.filter((t) => pagesSet.has(t)),
    affectedComponents: targets.filter((t) => !pagesSet.has(t)),
    affectedFiles: [...targets, ...neighbours],
    constraints: constraintsFrom(request),
    protectedAreas,
    acceptance: [
      "the requested outcome is visible in the changed files",
      "every changed file compiles",
      ...(protectedAreas.length ? ["protected areas are byte-identical"] : []),
    ],
    isProtected: (p) => reason(p) !== null,
    protectionReason: reason,
  };
}

export function renderScopeBlock(s: ExecutionScope): string {
  if (!s.protectedAreas.length && !s.constraints.length) return "";
  const lines = ["\n\nEXECUTION SCOPE (enforced — writes outside it are rejected):", `- Operation: ${s.operation}`];
  if (s.affectedFiles.length) lines.push(`- May change: ${s.affectedFiles.join(", ")}`);
  if (s.protectedAreas.length) lines.push(`- Protected (do not touch): ${s.protectedAreas.slice(0, 12).join(", ")}`);
  if (s.constraints.length) lines.push(`- User constraints: ${s.constraints.join(" | ")}`);
  lines.push("- A new file is allowed only when a changed file imports it.");
  return lines.join("\n");
}
