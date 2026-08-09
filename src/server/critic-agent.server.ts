/**
 * Critic subagent — the last gate before bytes hit the project.
 *
 * Petal's other agents *produce*: the inspector finds ground truth, the agent
 * loop codemods, the emit call writes ops. Nothing until now looked at the
 * proposed diff and asked the only question that matters: "is this obviously
 * wrong?"
 *
 * Two layers, cheapest first:
 *
 * 1. Deterministic rules. Elision markers ("... rest of the file unchanged"),
 *    no-op replaces, blanked-out files, deletes of the entry trio, catastrophic
 *    shrink. These are unambiguous — no model needed, no latency, no cost.
 * 2. A budget-tier model review of the remaining diff, given the user's actual
 *    request. It only rejects a change it can name a concrete defect in.
 *
 * A rejected op is dropped, not silently mutated, and the reason is reported so
 * the caller can tell the user. The critic never rewrites an op, and it never
 * throws: any failure means "approve everything", because a broken critic must
 * not be able to block a good build.
 */
import type { FileOp, ProjectFile } from "@/server/generate.server";
import { aiChatCompletions } from "@/server/ai-provider.server";
import type { Prd } from "@/server/prd/prd-types";
import { excludedSurfaceForPath } from "@/server/prd/prd-reconcile";

export interface CriticRejection {
  path: string;
  op: string;
  reason: string;
  /** true when a deterministic rule caught it (no model involved). */
  deterministic: boolean;
  /**
   * Dropped for hygiene, not because anything the user wanted was lost.
   * A no-op edit changes nothing whether it lands or not — telling the user
   * "a change was blocked" makes a clean turn look partially failed.
   */
  silent?: boolean;
}

export interface CriticVerdict {
  /** Ops that survived review, in original order. */
  ops: FileOp[];
  rejections: CriticRejection[];
  /** True when every proposed op was rejected. */
  blockedEverything: boolean;
  /** Whether the model layer actually ran. */
  modelReviewed: boolean;
}

const MODEL = "google/gemini-2.5-flash-lite";

/** Files whose deletion is almost never what the user meant. */
const ENTRY_FILES = new Set([
  "index.html",
  "src/main.tsx",
  "src/App.tsx",
  "src/styles.css",
  "src/index.css",
  "package.json",
  "vite.config.ts",
]);

/**
 * Placeholder/elision markers. These mean the model wrote a *description* of
 * the file instead of the file, and applying it destroys real code.
 */
const ELISION = [
  /\/\/\s*\.\.\.\s*(rest|remaining|other|existing|unchanged|keep)/i,
  /\{\s*\/\*\s*\.\.\.\s*(rest|remaining|existing|unchanged|keep)/i,
  /#\s*\.\.\.\s*(rest|remaining|existing|unchanged)/i,
  /\/\/\s*(keep existing code|unchanged|no changes here)/i,
  /<!--\s*\.\.\.\s*(rest|existing|unchanged)/i,
];

function nextContent(op: FileOp): string | null {
  if (op.op === "create" || op.op === "update") return op.content;
  if (op.op === "replace") return op.replace;
  return null;
}

function isBlank(s: string): boolean {
  return s.replace(/\s/g, "").length === 0;
}

/** Layer 1. Pure, instant, no network. */
export function findDeterministicDefects(
  ops: FileOp[],
  files: ProjectFile[],
  userPrompt: string,
  prd?: Prd | null,
): CriticRejection[] {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  const prompt = (userPrompt || "").toLowerCase();
  const out: CriticRejection[] = [];

  for (const op of ops) {
    const prev = byPath.get(op.path);

    if (op.op === "delete") {
      const asked = /\b(delete|remove|drop|get rid of)\b/.test(prompt);
      if (ENTRY_FILES.has(op.path) && !asked) {
        out.push({
          path: op.path,
          op: op.op,
          deterministic: true,
          reason: `refuses to delete ${op.path} — the app cannot render without it and the request never asked for a deletion`,
        });
      }
      continue;
    }

    if (op.op === "replace") {
      if (op.search === op.replace) {
        out.push({
          path: op.path,
          op: op.op,
          deterministic: true,
          silent: true,
          reason: "replacement text is byte-identical to the search text — the edit would do nothing",
        });
        continue;
      }
      if (isBlank(op.search)) {
        out.push({
          path: op.path,
          op: op.op,
          deterministic: true,
          reason: "search snippet is empty, so the match point is undefined",
        });
        continue;
      }
    }

    // PRD contract: the product's own requirements document says this surface
    // is out of scope. A template habit must not bolt auth onto a calculator.
    if (prd && (op.op === "create" || op.op === "update")) {
      const surface = excludedSurfaceForPath(prd, op.path);
      if (surface && !new RegExp(`\\b${surface}\\b`, "i").test(prompt)) {
        out.push({
          path: op.path,
          op: op.op,
          deterministic: true,
          reason: `adds a \`${surface}\` surface that the product contract for ${prd.productName} explicitly excludes, and the request never asked for it`,
        });
        continue;
      }
    }

    const content = nextContent(op);
    if (content === null) continue;

    if (op.op !== "replace" && isBlank(content)) {
      out.push({
        path: op.path,
        op: op.op,
        deterministic: true,
        reason: "writes an empty file, which would blank out the module",
      });
      continue;
    }

    const marker = ELISION.find((re) => re.test(content));
    if (marker) {
      out.push({
        path: op.path,
        op: op.op,
        deterministic: true,
        reason:
          "contains an elision placeholder (\"…rest of the file unchanged\") instead of real code — applying it would delete the omitted region",
      });
      continue;
    }

    // Catastrophic shrink on a whole-file write: a 2k-line file replaced by
    // 20 lines is a truncated generation far more often than an intentional
    // rewrite. Only fires on substantial files, and never when the user asked
    // for a rewrite/simplification.
    if ((op.op === "update" || op.op === "create") && prev) {
      const prevLines = prev.split("\n").length;
      const nextLines = content.split("\n").length;
      const rewriteAsked = /\b(rewrite|simplif\w*|shorten|strip|reduce|clean up|trim|minimal)\b/.test(prompt);
      if (prevLines >= 80 && nextLines < prevLines * 0.25 && !rewriteAsked) {
        out.push({
          path: op.path,
          op: op.op,
          deterministic: true,
          reason: `shrinks the file from ${prevLines} to ${nextLines} lines with no request to rewrite it — this is almost always a truncated generation`,
        });
      }
    }
  }

  return out;
}

function diffDigest(ops: FileOp[], files: ProjectFile[]): string {
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  return ops
    .map((op, i) => {
      const prev = byPath.get(op.path);
      const head = `### ${i}. ${op.op} ${op.path}${prev === undefined ? " (new file)" : ` (${prev.split("\n").length} lines today)`}`;
      if (op.op === "delete") return head;
      if (op.op === "ast-patch") {
        return `${head}\n${JSON.stringify(op.patches).slice(0, 1200)}`;
      }
      if (op.op === "replace") {
        return [
          head,
          "SEARCH:",
          "```",
          op.search.slice(0, 1200),
          "```",
          "REPLACE:",
          "```",
          op.replace.slice(0, 1600),
          "```",
        ].join("\n");
      }
      return [head, "```", op.content.slice(0, 2400), "```"].join("\n");
    })
    .join("\n\n")
    .slice(0, 24_000);
}

const SYSTEM_PROMPT = `You are Petal's Critic: the last review before a proposed code change is written to a user's live app.

You are shown the user's request and the exact ops about to be applied. Your only job is to catch changes that are CLEARLY WRONG — the ones a careful engineer would refuse at review.

Reject an op ONLY when you can name a concrete, specific defect:
- it writes a placeholder, a stub, a comment-only body, or elided code where real code must be
- it deletes or blanks out working functionality the user never asked to remove
- it is obviously syntactically broken or truncated mid-expression
- it edits a completely unrelated file that has nothing to do with the request
- it contradicts the request outright (user asked to add X, the op removes X)

Do NOT reject for taste, style, naming, missing tests, incompleteness of a larger plan, or "could be better". Partial progress is fine. When in doubt, APPROVE.

Reply with JSON only, no prose, no code fence:
{"rejections":[{"index":<op index>,"reason":"<one concrete sentence>"}]}

Return {"rejections":[]} when everything should be applied.`;

interface ModelRejection {
  index: number;
  reason: string;
}

function parseRejections(text: string, opCount: number): ModelRejection[] {
  const raw = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  const list = (parsed as { rejections?: unknown })?.rejections;
  if (!Array.isArray(list)) return [];
  const seen = new Set<number>();
  const out: ModelRejection[] = [];
  for (const item of list) {
    const idx = Number((item as { index?: unknown })?.index);
    const reason = String((item as { reason?: unknown })?.reason ?? "").trim();
    if (!Number.isInteger(idx) || idx < 0 || idx >= opCount) continue;
    if (!reason) continue;
    if (seen.has(idx)) continue;
    seen.add(idx);
    out.push({ index: idx, reason: reason.slice(0, 240) });
  }
  return out;
}

/**
 * Review a proposed diff. Never throws; on any failure the ops pass through
 * untouched apart from deterministic rejections already found.
 */
export async function runCritic(args: {
  ops: FileOp[];
  files: ProjectFile[];
  userPrompt: string;
  projectId: string;
  userId?: string | null;
  signal?: AbortSignal;
  /** Skip the model layer (deterministic rules still run). */
  deterministicOnly?: boolean;
  /** The product contract for this turn, when one exists. */
  prd?: Prd | null;
}): Promise<CriticVerdict> {
  const rejections: CriticRejection[] = [];

  if (args.ops.length === 0) {
    return { ops: args.ops, rejections, blockedEverything: false, modelReviewed: false };
  }

  for (const r of findDeterministicDefects(args.ops, args.files, args.userPrompt, args.prd)) {
    rejections.push(r);
  }

  let surviving = args.ops.filter(
    (op) => !rejections.some((r) => r.path === op.path && r.op === op.op),
  );

  let modelReviewed = false;

  if (!args.deterministicOnly && surviving.length > 0) {
    try {
      const res = await aiChatCompletions({
        feature: "generate",
        timeoutTier: "default",
        signal: args.signal,
        meta: { projectId: args.projectId, userId: args.userId ?? null, phase: "critic" },
        body: {
          model: MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                ...(args.prd
                  ? [
                      "## Product contract (authoritative)",
                      `${args.prd.productName} — ${args.prd.purpose}`,
                      `Product type: ${args.prd.productType}`,
                      `Required surfaces: ${args.prd.requiredSurfaces.join(", ")}`,
                      args.prd.excludedSurfaces.length
                        ? `Surfaces that must NOT exist: ${args.prd.excludedSurfaces.join(", ")}`
                        : "",
                      "Reject any op that contradicts this contract.",
                      "",
                    ]
                  : []),
                "## The user asked for",
                args.userPrompt.slice(0, 4000) || "(no message)",
                "",
                "## Proposed ops",
                diffDigest(surviving, args.files),
              ].join("\n"),
            },
          ],
          max_tokens: 700,
          stream: false,
        },
      });

      if (res.ok) {
        const json = (await res.json()) as {
          choices?: Array<{ message?: { content?: string | null } }>;
        };
        const text = json.choices?.[0]?.message?.content ?? "";
        const modelRejections = parseRejections(text, surviving.length);
        modelReviewed = true;

        // Safety valve: a model that rejects everything is far more likely to
        // be malfunctioning than to be right. Ignore a full sweep.
        if (modelRejections.length > 0 && modelRejections.length < surviving.length) {
          const rejectedIdx = new Set(modelRejections.map((r) => r.index));
          for (const r of modelRejections) {
            const op = surviving[r.index];
            rejections.push({
              path: op.path,
              op: op.op,
              reason: r.reason,
              deterministic: false,
            });
          }
          surviving = surviving.filter((_, i) => !rejectedIdx.has(i));
        }
      }
    } catch (err) {
      console.warn("[critic] review failed:", err instanceof Error ? err.message : err);
    }
  }

  return {
    ops: surviving,
    rejections,
    blockedEverything: surviving.length === 0 && args.ops.length > 0,
    modelReviewed,
  };
}

/**
 * One-line-per-rejection note for the turn summary.
 *
 * `silent` rejections (no-op edits) are omitted: nothing the user asked for was
 * lost, so reporting them makes a fully successful turn read as partly blocked.
 */
export function criticDisclosure(rejections: CriticRejection[]): string {
  const visible = rejections.filter((r) => !r.silent);
  if (visible.length === 0) return "";
  const lines = visible.map((r) => `- \`${r.path}\` — ${r.reason}`);
  return [
    "",
    visible.length === 1
      ? "**One proposed change was blocked before it was applied:**"
      : `**${visible.length} proposed changes were blocked before they were applied:**`,
    ...lines,
    "",
    "Everything else went through. Tell me if you want me to retry the blocked part differently.",
  ].join("\n");
}
