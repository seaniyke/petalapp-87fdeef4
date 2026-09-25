/**
 * Structured project memory + source-of-truth precedence.
 *
 * Stored rows stay the existing key/value `project_memory` table. Each row is
 * CLASSIFIED deterministically into a kind; a model-written note is never a
 * FACT — only the current source can establish facts. Before rendering, each
 * entry is checked against the manifest: memory that contradicts the current
 * source is marked stale and dropped; memory that contradicts the current
 * request is overridden.
 */
import type { MemoryEntry } from "@/server/project-memory.server";
import type { ProjectManifest } from "./manifest";

export type MemoryKind =
  | "FACT"
  | "CURRENT_STATE"
  | "DECISION"
  | "USER_PREFERENCE"
  | "HISTORY"
  | "INFERENCE"
  | "UNKNOWN";

/** Precedence, highest first. */
export const PRECEDENCE = [
  "USER_REQUEST",
  "SOURCE",
  "BUILD_STATE",
  "MANIFEST",
  "RECENT_MEMORY",
  "HISTORY",
  "INFERENCE",
] as const;
export type Authority = (typeof PRECEDENCE)[number];

export function outranks(a: Authority, b: Authority): boolean {
  return PRECEDENCE.indexOf(a) < PRECEDENCE.indexOf(b);
}

export interface ClassifiedMemory extends MemoryEntry {
  kind: MemoryKind;
  authority: Authority;
  status: "active" | "stale" | "overridden";
  reason?: string;
}

const DECISION_KEYS = new Set(["must_have", "dont_do", "locked", "always", "key_features"]);
const PREFERENCE_KEYS = new Set(["tone", "palette_intent", "typography_intent", "language", "audience"]);
const FACT_KEYS = new Set(["name"]);
const HISTORY_KEYS = new Set(["notes", "history", "last_change"]);

/**
 * Classify by key. A value that sounds uncertain is INFERENCE regardless of
 * key; a value naming something missing/unconfigured is UNKNOWN.
 */
export function classifyMemory(e: MemoryEntry): MemoryKind {
  const v = e.value.toLowerCase();
  if (/\b(not (yet )?(configured|set up|connected|decided)|unknown|tbd)\b/.test(v)) return "UNKNOWN";
  if (/\b(maybe|probably|likely|seems|might|guess)\b/.test(v)) return "INFERENCE";
  if (DECISION_KEYS.has(e.key)) return "DECISION";
  if (PREFERENCE_KEYS.has(e.key)) return "USER_PREFERENCE";
  if (FACT_KEYS.has(e.key)) return "FACT";
  if (HISTORY_KEYS.has(e.key)) return "HISTORY";
  if (e.key.startsWith("state_") || e.key === "app_kind") return "CURRENT_STATE";
  return "INFERENCE";
}

function authorityOf(kind: MemoryKind): Authority {
  switch (kind) {
    case "DECISION":
    case "USER_PREFERENCE":
    case "FACT":
    case "CURRENT_STATE":
      return "RECENT_MEMORY";
    case "HISTORY":
      return "HISTORY";
    default:
      return "INFERENCE";
  }
}

/** File/component names mentioned in a memory value (PascalCase or paths). */
function mentionedArtifacts(v: string): string[] {
  const out = new Set<string>();
  for (const m of v.matchAll(/\bsrc\/[\w/.-]+\.(?:t|j)sx?\b/g)) out.add(m[0]);
  for (const m of v.matchAll(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g)) out.add(m[1]!);
  return [...out];
}

/** Terms the current request explicitly reverses ("remove X", "no longer X", "change X to"). */
function reversedTerms(request: string): string[] {
  const out: string[] = [];
  for (const m of request.toLowerCase().matchAll(/\b(?:remove|delete|drop|replace|no longer|stop using|change|switch|get rid of)\s+(?:the\s+)?([a-z][\w-]*(?:\s[a-z][\w-]*)?)/g)) {
    out.push(m[1]!.trim());
  }
  return out;
}

/**
 * Apply precedence. SOURCE beats memory: a CURRENT_STATE/FACT naming a file or
 * component that no longer exists is stale. USER_REQUEST beats memory: an
 * entry whose value mentions something the request reverses is overridden.
 */
export function resolveMemory(
  entries: MemoryEntry[],
  manifest: ProjectManifest | null,
  request: string,
): ClassifiedMemory[] {
  const known = new Set<string>();
  if (manifest) {
    for (const p of [...manifest.components, ...manifest.pages.map((x) => x.path), ...manifest.layouts]) {
      known.add(p);
      known.add((p.split("/").pop() ?? "").replace(/\.(t|j)sx?$/, ""));
    }
  }
  const reversed = reversedTerms(request);
  return entries
    .filter((e) => e.key && e.value)
    .map((e) => {
      const kind = classifyMemory(e);
      const base: ClassifiedMemory = { ...e, kind, authority: authorityOf(kind), status: "active" };
      if (manifest && (kind === "CURRENT_STATE" || kind === "FACT" || kind === "HISTORY" || kind === "INFERENCE")) {
        const missing = mentionedArtifacts(e.value).filter((a) => /[/.]/.test(a) || /[A-Z]/.test(a)).filter((a) => !known.has(a));
        if (missing.length > 0 && kind !== "HISTORY") {
          return { ...base, status: "stale", reason: `source no longer has ${missing.join(", ")}` };
        }
      }
      const lv = e.value.toLowerCase();
      const hit = reversed.find((t) => t.length >= 3 && lv.includes(t));
      if (hit) return { ...base, status: "overridden", reason: `current request changes "${hit}"` };
      return base;
    });
}

const KIND_ORDER: MemoryKind[] = ["DECISION", "USER_PREFERENCE", "FACT", "CURRENT_STATE", "UNKNOWN", "HISTORY", "INFERENCE"];

export function renderResolvedMemory(items: ClassifiedMemory[], opts: { includeHistory?: boolean } = {}): string {
  const active = items
    .filter((i) => i.status === "active")
    .filter((i) => opts.includeHistory !== false || (i.kind !== "HISTORY" && i.kind !== "INFERENCE"))
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  if (active.length === 0) return "";
  const lines = active.map((i) => `- [${i.kind}] ${i.key}: ${i.value}`);
  return (
    "\n\nProject Memory (precedence: the user's current request > current source files > build state > this memory; INFERENCE and HISTORY are hints, never facts — if memory disagrees with the files shown, the files win):\n" +
    lines.join("\n") +
    "\n"
  );
}

/**
 * Post-commit guard. Authoritative memory is only written for a change that
 * passed the atomic commit/validation path. Anything else is not truth.
 */
export function shouldRecordMemory(outcome: {
  committed: boolean;
  rolledBack?: boolean;
  cancelled?: boolean;
  missingScope?: number;
}): boolean {
  return outcome.committed && !outcome.rolledBack && !outcome.cancelled && (outcome.missingScope ?? 0) === 0;
}
