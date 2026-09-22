/**
 * Kimble Intelligence — Phase E: the QA board and defect router.
 *
 * The build pipeline already produces findings from several independent
 * checkers (browser verification, visual QA, deploy probe) and already
 * classifies them by severity via the defect judge. What was missing was
 * *ownership*: a finding was just a string, so every repair round re-derived
 * from scratch what kind of problem it was and who should fix it.
 *
 * This module is the missing half. It is pure and deterministic — no network,
 * no model, no database — so it costs nothing and can never fail a build:
 *
 *   judged defects  →  typed Defect[]  →  owning agent  →  scoped repair brief
 *
 * The owner is one of the registry agents, which means a repair round can be
 * pointed at the same specialist that made the original decision instead of
 * asking the emitter to "fix everything" with the whole prompt re-attached.
 */

import type { AgentName } from "./context";
import type { JudgedDefects } from "@/server/defect-judge.server";

export type DefectKind =
  | "runtime"
  | "navigation"
  | "data"
  | "auth"
  | "security"
  | "responsive"
  | "visual"
  | "content"
  | "performance"
  | "unknown";

export type DefectSeverity = "blocking" | "visual" | "advisory";

export interface Defect {
  id: string;
  kind: DefectKind;
  severity: DefectSeverity;
  /** The registry agent responsible for this class of problem. */
  owner: AgentName;
  /** Verbatim finding text from the checker. */
  evidence: string;
}

export interface DefectRouting {
  defects: Defect[];
  /** Owners with at least one blocking defect, highest priority first. */
  blockingOwners: AgentName[];
  /** Counts per owner, for telemetry. */
  byOwner: Record<string, number>;
  /** Prompt-ready brief for a repair round. Empty when nothing is actionable. */
  brief: string;
}

/**
 * Classification table. Order matters: the first pattern that matches wins,
 * so the most specific and most severe classes are listed first.
 */
const CLASSIFIERS: Array<{ kind: DefectKind; owner: AgentName; test: RegExp }> = [
  // Hard runtime failure — the page does not work at all.
  {
    kind: "runtime",
    owner: "frontend",
    test: /uncaught|reference ?error|type ?error|is not (?:a )?(?:defined|function)|white ?screen|blank (?:page|screen)|failed to (?:render|mount)|hydration|cannot read (?:property|properties)/i,
  },
  // Security and access control.
  {
    kind: "security",
    owner: "security",
    test: /\brls\b|row[- ]level|policy|service[- ]role|api key|secret|token leak|exposed|unauthori[sz]ed access|privilege/i,
  },
  {
    kind: "auth",
    owner: "backend",
    test: /\bsign[- ]?(?:in|up)\b|\blog ?(?:in|out)\b|\bauth(?:entication)?\b|session|redirect(?:ed)? to \/auth/i,
  },
  // Data plumbing.
  {
    kind: "data",
    owner: "database",
    test: /\b(?:select|insert|update|delete)\b .*(?:failed|error)|supabase|query failed|\b4\d\d\b.*\/rest\/|permission denied|relation .* does not exist|empty (?:list|table) where data was expected/i,
  },
  // Navigation and dead interactions.
  {
    kind: "navigation",
    owner: "architecture",
    test: /\b404\b|route .* (?:missing|not found)|link .* (?:dead|does nothing|no-?op)|button .* (?:does nothing|no-?op|not wired)|form .* (?:does nothing|not submit)|nav(?:igation)? .* (?:broken|missing)/i,
  },
  // Phone experience.
  {
    kind: "responsive",
    owner: "responsive",
    test: /horizontal (?:overflow|scroll)|overflow(?:s|ing)? (?:the )?viewport|mobile (?:nav|menu|drawer|layout)|\b390px\b|\b375px\b|tap target|cramped on (?:mobile|phone)|off[- ]screen/i,
  },
  // Craft.
  {
    kind: "visual",
    owner: "design",
    test: /overlap|clipp?(?:ed|ing)|contrast|unreadable|misalign|cut ?off|truncat|spacing|z-index|hero .* (?:empty|bare)|looks (?:generic|unstyled|default)/i,
  },
  {
    kind: "content",
    owner: "product",
    test: /lorem ipsum|placeholder (?:text|copy)|todo\b|coming soon|untitled|sample (?:data|content)/i,
  },
  {
    kind: "performance",
    owner: "frontend",
    test: /slow (?:request|response|load)|took \d+ ?m?s|bundle size|large (?:image|asset)/i,
  },
];

/** Priority used when several owners have blocking work. Mirrors the reconciler. */
const OWNER_PRIORITY: AgentName[] = [
  "security",
  "database",
  "backend",
  "architecture",
  "frontend",
  "responsive",
  "ux",
  "design",
  "product",
  "ai_logic",
  "qa",
];

function classify(evidence: string): { kind: DefectKind; owner: AgentName } {
  for (const c of CLASSIFIERS) {
    if (c.test.test(evidence)) return { kind: c.kind, owner: c.owner };
  }
  return { kind: "unknown", owner: "frontend" };
}

const LABEL: Record<AgentName, string> = {
  product: "Product / content",
  ux: "UX flows and states",
  design: "Visual craft",
  architecture: "Routing and file ownership",
  frontend: "Frontend implementation",
  backend: "Server contracts",
  database: "Data layer",
  security: "Security and access",
  ai_logic: "Business logic",
  responsive: "Mobile / responsive",
  qa: "Verification",
};

/** Turn judged findings into owned defects plus a scoped repair brief. */
export function routeDefects(judged: {
  blocking?: string[];
  visual?: string[];
  advisory?: string[];
}): DefectRouting {
  const defects: Defect[] = [];
  const push = (list: string[] | undefined, severity: DefectSeverity) => {
    for (const raw of list ?? []) {
      const evidence = String(raw ?? "").trim();
      if (!evidence) continue;
      const { kind, owner } = classify(evidence);
      defects.push({
        id: `d${defects.length + 1}`,
        kind,
        severity,
        owner,
        evidence: evidence.slice(0, 400),
      });
    }
  };
  push(judged.blocking, "blocking");
  push(judged.visual, "visual");
  push(judged.advisory, "advisory");

  const byOwner: Record<string, number> = {};
  for (const d of defects) byOwner[d.owner] = (byOwner[d.owner] ?? 0) + 1;

  const blockingOwners = OWNER_PRIORITY.filter((a) =>
    defects.some((d) => d.owner === a && d.severity === "blocking"),
  );

  return { defects, blockingOwners, byOwner, brief: renderRepairBrief(defects) };
}

/**
 * Group the defects by owner into a compact, imperative brief. This is what a
 * repair round attaches instead of a flat bullet list of strings.
 */
export function renderRepairBrief(defects: Defect[]): string {
  const actionable = defects.filter((d) => d.severity !== "advisory");
  if (actionable.length === 0) return "";

  const order = OWNER_PRIORITY.filter((a) => actionable.some((d) => d.owner === a));
  const lines: string[] = [
    "REPAIR BRIEF — each finding below is already assigned to the layer that owns it.",
    "Fix the blocking items first, in the order given. Do not refactor anything else.",
  ];
  for (const owner of order) {
    const own = actionable.filter((d) => d.owner === owner);
    const blocking = own.filter((d) => d.severity === "blocking");
    const visual = own.filter((d) => d.severity === "visual");
    lines.push("", `${LABEL[owner]} (${own.length}):`);
    for (const d of [...blocking, ...visual].slice(0, 8)) {
      lines.push(`- [${d.severity}/${d.kind}] ${d.evidence}`);
    }
  }
  return lines.join("\n");
}

/** Convenience wrapper over the defect judge's output shape. */
export function routeJudgedDefects(judged: JudgedDefects): DefectRouting {
  return routeDefects({
    blocking: judged.blocking,
    visual: judged.visual,
    advisory: judged.advisory,
  });
}

/** One-line summary for server logs. */
export function summarizeRouting(routing: DefectRouting): string {
  if (!routing.defects.length) return "[qa-board] no defects";
  const parts = Object.entries(routing.byOwner)
    .sort((a, b) => b[1] - a[1])
    .map(([owner, n]) => `${owner}:${n}`);
  return `[qa-board] ${routing.defects.length} defect(s) → ${parts.join(" ")}${
    routing.blockingOwners.length ? ` · blocking owners: ${routing.blockingOwners.join(",")}` : ""
  }`;
}
