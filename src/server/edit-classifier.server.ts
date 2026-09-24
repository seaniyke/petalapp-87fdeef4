/**
 * Semantic edit classifier (Engine 3.0, phase 4).
 *
 * The pipeline used to decide "is this a small edit or a structural one?" from
 * regexes alone. Regexes miss the ask that matters most: "make it feel like a
 * real product", "this page is a mess, sort it out", "nothing works on my
 * phone" — all structural, none matching a keyword list. That misclassification
 * is the root of the worst failure mode Kimble has: a redesign request answered
 * with a two-line tweak.
 *
 * This module keeps the deterministic verdict as the PRIOR and lets a cheap
 * model widen it. Rules:
 *  - The model may only ESCALATE scope (micro -> targeted -> structural), never
 *    shrink it. A wrong escalation costs prompt tokens; a wrong de-escalation
 *    costs the user their edit.
 *  - Never throws, never blocks: on any failure the deterministic prior stands.
 *  - Off switch: PETAL_EDIT_CLASSIFIER=0.
 */
import { aiChatCompletions } from "@/server/ai-provider.server";

export type EditScope = "micro" | "targeted" | "structural";

export interface EditClassification {
  scope: EditScope;
  /** What the user is actually changing. Drives which contracts get pinned. */
  dimensions: Array<"visual" | "content" | "behaviour" | "data" | "navigation" | "responsive">;
  /** Surface/section words worth matching against real file names. */
  hints: string[];
  reason: string;
  source: "deterministic" | "model";
}

const STRUCTURAL_RE =
  /\b(redesign|re-?design|rebuild|revamp|overhaul|from scratch|start over|entire (site|app|website|thing)|whole (site|app|website|thing)|every (page|screen)|all (the )?pages|site-?wide|new (page|screen|feature|section)|add (a |an )?(page|dashboard|auth|login|signup|payments?|checkout|blog)|make it (a )?real|looks? (bad|terrible|awful|plain|generic|unfinished)|doesn'?t look|nothing works)\b/i;

const RESPONSIVE_RE = /\b(mobile|phone|tablet|responsive|small screens?|breakpoints?)\b/i;
const VISUAL_RE =
  /\b(design|theme|colou?rs?|palette|font|typography|spacing|layout|styling|style|look|hero|animation)\b/i;
const BEHAVIOUR_RE =
  /\b(click|button|form|submit|validate|route|link|navigate|filter|sort|search|state|toggle|modal|drawer)\b/i;
const DATA_RE = /\b(database|table|schema|auth|login|sign ?up|store|save|persist|api|backend)\b/i;
const NAV_RE = /\b(nav|navbar|navigation|menu|header|footer|sidebar|breadcrumb)\b/i;
const CONTENT_RE = /\b(copy|text|headline|wording|title|label|rename|typo|content)\b/i;
const IMPERATIVE_RE =
  /^\s*(please\s+)?(on|in|for)?\b[^.!?]{0,60}?\b(add|change|make|set|move|remove|delete|rename|replace|swap|update|fix|put|insert|show|hide|use|turn|increase|decrease|align|center|centre|shorten|lengthen|translate|rewrite|reword)\b/i;

const MICRO_RE =
  /^\s*(change|rename|fix|update|set|make)\b[^.!?]{0,80}$/i;

function dimensionsFor(text: string): EditClassification["dimensions"] {
  const dims: EditClassification["dimensions"] = [];
  if (VISUAL_RE.test(text)) dims.push("visual");
  if (CONTENT_RE.test(text)) dims.push("content");
  if (BEHAVIOUR_RE.test(text)) dims.push("behaviour");
  if (DATA_RE.test(text)) dims.push("data");
  if (NAV_RE.test(text)) dims.push("navigation");
  if (RESPONSIVE_RE.test(text)) dims.push("responsive");
  return dims.length ? dims : ["visual"];
}

/** Regex prior — always available, always the floor. */
export function classifyEditDeterministic(prompt: string): EditClassification {
  const text = (prompt ?? "").trim();
  const dimensions = dimensionsFor(text);
  if (STRUCTURAL_RE.test(text)) {
    return {
      scope: "structural",
      dimensions,
      hints: [],
      reason: "matched a cross-cutting phrase",
      source: "deterministic",
    };
  }
  if (MICRO_RE.test(text) && text.length <= 90) {
    return {
      scope: "micro",
      dimensions,
      hints: [],
      reason: "short single-verb request",
      source: "deterministic",
    };
  }
  return { scope: "targeted", dimensions, hints: [], reason: "default", source: "deterministic" };
}

const ORDER: EditScope[] = ["micro", "targeted", "structural"];
const widest = (a: EditScope, b: EditScope): EditScope =>
  ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;

function classifierEnabled(): boolean {
  const raw = process.env["PETAL_EDIT_CLASSIFIER"];
  if (raw == null || raw === "") return true;
  return !/^(0|false|off|no)$/i.test(raw.trim());
}

const SYSTEM = `You classify edit requests for an AI app builder. You never write code.

scope:
- "micro": one visible value changes (a word, a colour, one button).
- "targeted": one page, section or component changes materially.
- "structural": the request spans multiple pages/components, changes the product's shape, adds a page or feature, or asks for a redesign/overhaul — including vague dissatisfaction like "this looks generic" or "make it feel real".

When unsure between two scopes, choose the WIDER one.

dimensions: any of visual, content, behaviour, data, navigation, responsive.
hints: up to 6 lowercase nouns naming the surfaces or sections involved (e.g. "hero", "pricing", "checkout"). No verbs.

Respond with JSON only:
{"scope":"micro|targeted|structural","dimensions":["..."],"hints":["..."],"reason":"one short clause"}`;

/**
 * Classify an edit turn. `prior` is the deterministic verdict; the model can
 * only widen it.
 */
export async function classifyEdit(args: {
  prompt: string;
  projectPurpose?: string | null;
  fileCount?: number;
  projectId?: string | null;
  userId?: string | null;
  signal?: AbortSignal;
}): Promise<EditClassification> {
  const prior = classifyEditDeterministic(args.prompt);
  // A regex-certain structural ask needs no second opinion, and a blank
  // prompt has nothing to reason about.
  if (!classifierEnabled() || prior.scope === "structural") return prior;
  // A clear instruction needs no model to tell us it is an edit. The model is
  // kept for genuinely vague asks ("this looks generic", "feels off") where
  // no imperative verb names the change.
  if (IMPERATIVE_RE.test((args.prompt ?? "").trim())) return prior;
  if ((args.prompt ?? "").trim().length < 4) return prior;

  try {
    const res = await aiChatCompletions({
      feature: "triage",
      budgetAware: true,
      body: {
        model: "google/gemini-2.5-flash-lite",
        temperature: 0,
        max_tokens: 220,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              args.projectPurpose ? `PROJECT: ${args.projectPurpose.slice(0, 300)}` : "",
              typeof args.fileCount === "number" ? `FILES: ${args.fileCount}` : "",
              `REQUEST: ${args.prompt.slice(0, 1200)}`,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      },
      signal: args.signal,
      meta: {
        projectId: args.projectId ?? null,
        userId: args.userId ?? null,
        phase: "edit-classifier",
      },
    });
    if (!res.ok) return prior;
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const parsed = parseClassification(json.choices?.[0]?.message?.content ?? "");
    if (!parsed) return prior;
    return {
      scope: widest(prior.scope, parsed.scope),
      dimensions: parsed.dimensions.length ? parsed.dimensions : prior.dimensions,
      hints: parsed.hints,
      reason: parsed.reason || "model classification",
      source: "model",
    };
  } catch {
    return prior;
  }
}

export function parseClassification(content: string): EditClassification | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }
  const root = parsed as { scope?: unknown; dimensions?: unknown; hints?: unknown; reason?: unknown };
  const scope = typeof root.scope === "string" ? root.scope.toLowerCase() : "";
  if (!ORDER.includes(scope as EditScope)) return null;
  const allowed = new Set(["visual", "content", "behaviour", "data", "navigation", "responsive"]);
  const dimensions = Array.isArray(root.dimensions)
    ? (root.dimensions
        .map((d) => (typeof d === "string" ? d.toLowerCase().trim() : ""))
        .filter((d) => allowed.has(d)) as EditClassification["dimensions"])
    : [];
  const hints = Array.isArray(root.hints)
    ? root.hints
        .map((h) => (typeof h === "string" ? h.toLowerCase().trim().slice(0, 30) : ""))
        .filter(Boolean)
        .slice(0, 6)
    : [];
  return {
    scope: scope as EditScope,
    dimensions,
    hints,
    reason: typeof root.reason === "string" ? root.reason.slice(0, 140) : "",
    source: "model",
  };
}
