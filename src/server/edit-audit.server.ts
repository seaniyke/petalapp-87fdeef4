/**
 * Edit completeness audit (Edit Intelligence, phase 1 + 2).
 *
 * The change set says what the user asked for. This module checks, against the
 * real byte diff, whether each requested change actually landed — and whether
 * anything the user said to preserve was touched anyway.
 *
 * Deterministic first: evidence is the set of changed paths and the lines that
 * were ADDED to those files. A change is "met" when its target or one of its
 * distinctive keywords shows up in that evidence. Anything we cannot find
 * evidence for is reported as unmet, never silently passed.
 *
 * When something is unmet and the caller has budget, `runCompletenessPass`
 * makes ONE focused model call carrying only the unmet items and the files
 * most likely to own them. Everything here fails open: an audit that errors
 * must never fail a turn that otherwise succeeded.
 */

import { aiChatCompletions } from "@/server/ai-provider.server";
import {
  PATCH_FILES_TOOL,
  applyOpsPartial,
  type FileOp,
  type ProjectFile,
} from "@/server/generate.server";
import type { ChangeItem, ChangeSet, PreserveItem } from "@/server/change-set.server";

export interface AuditResult {
  met: ChangeItem[];
  unmet: ChangeItem[];
  /** Preservation rules that look violated by this diff. */
  violations: Array<{ preserve: PreserveItem; paths: string[] }>;
  changedPaths: string[];
}

function addedText(before: ProjectFile[], after: ProjectFile[]): { text: string; paths: string[] } {
  const prev = new Map(before.map((f) => [f.path, f.content]));
  const paths: string[] = [];
  const chunks: string[] = [];
  for (const f of after) {
    const old = prev.get(f.path);
    if (old === f.content) continue;
    paths.push(f.path);
    if (old === undefined) {
      chunks.push(f.content);
      continue;
    }
    const oldLines = new Set(old.split("\n").map((l) => l.trim()));
    const newLines = f.content.split("\n");
    newLines.forEach((line, i) => {
      const t = line.trim();
      if (!t || oldLines.has(t)) return;
      // Two lines of context: an edit like `className="py-0"` only names the
      // component it belongs to on the line above (`<NavBar`), and without
      // that the audit would call a landed change unmet.
      for (let j = Math.max(0, i - 2); j <= i; j++) {
        const c = newLines[j]!.trim();
        if (c) chunks.push(c);
      }
    });
  }
  for (const f of before) {
    if (!after.some((a) => a.path === f.path)) paths.push(f.path);
  }
  return { text: chunks.join("\n").toLowerCase(), paths };
}

function evidenceFor(item: ChangeItem, text: string, paths: string[]): boolean {
  const pathBlob = paths.join(" ").toLowerCase();
  const tokens = [
    ...(item.target ? [item.target.toLowerCase()] : []),
    ...item.keywords.filter((k) => k.length >= 4),
  ];
  if (tokens.length === 0) return paths.length > 0;
  for (const t of tokens) {
    const compact = t.replace(/\s+/g, "");
    if (!compact) continue;
    if (pathBlob.includes(compact) || pathBlob.includes(t)) return true;
    if (text.includes(t)) return true;
    if (compact.length >= 4 && text.includes(compact)) return true;
  }
  return false;
}

/** Compare the requested change set against what actually changed on disk. */
export function auditChangeSet(args: {
  changeSet: ChangeSet;
  before: ProjectFile[];
  after: ProjectFile[];
}): AuditResult {
  const { text, paths } = addedText(args.before, args.after);
  const met: ChangeItem[] = [];
  const unmet: ChangeItem[] = [];

  for (const item of args.changeSet.items) {
    if (paths.length === 0) {
      unmet.push(item);
      continue;
    }
    (evidenceFor(item, text, paths) ? met : unmet).push(item);
  }

  const violations: AuditResult["violations"] = [];
  for (const p of args.changeSet.preserve) {
    if (!p.target) continue;
    const token = p.target.toLowerCase().replace(/\s+/g, "");
    if (token.length < 4) continue;
    const hit = paths.filter((path) => path.toLowerCase().replace(/[-_]/g, "").includes(token));
    if (hit.length > 0) violations.push({ preserve: p, paths: hit });
  }

  return { met, unmet, violations, changedPaths: paths };
}

/** Plain-language note appended to the turn summary when items did not land. */
export function unmetDisclosure(
  unmet: ChangeItem[],
  violations: AuditResult["violations"] = [],
): string {
  let out = "";
  if (unmet.length > 0) {
    const list = unmet.map((i) => `- ${i.text}`).join("\n");
    out +=
      `\n\n${unmet.length === 1 ? "One part" : `${unmet.length} parts`} of your message didn't land yet:\n${list}\n` +
      `Say the word and I'll do just that part next.`;
  }
  if (violations.length > 0) {
    const list = violations
      .map((v) => `- ${v.preserve.text} (${v.paths.slice(0, 3).join(", ")})`)
      .join("\n");
    out += `\n\nHeads up — I touched something you asked me to leave alone:\n${list}`;
  }
  return out;
}

export interface CompletenessPassResult {
  ran: boolean;
  files: ProjectFile[];
  appliedPaths: string[];
  note: string | null;
}

const SYSTEM = `You are Petal finishing an edit that was only partly completed.

You receive the user's original request, the parts that are still MISSING, and the current contents of the files most likely to own them.

Rules:
- Do ONLY the missing parts. Everything else in the app is already correct and must come back byte-identical.
- Prefer \`replace\` ops quoting the exact existing bytes. Use \`update\` only when you must rewrite a whole small file.
- Never emit an op for a file you were not given.
- Never add placeholders, TODOs, or "rest of file unchanged" markers.
- If a missing part genuinely cannot be done in these files, emit no op for it rather than guessing.`;

/**
 * One focused model call to land the change-set items the first pass missed.
 * Bounded, cheap-model, and fail-open: on any error the caller keeps the files
 * it already had.
 */
export async function runCompletenessPass(args: {
  userRequest: string;
  unmet: ChangeItem[];
  files: ProjectFile[];
  candidatePaths: string[];
  model: string;
  projectId?: string | null;
  userId?: string | null;
  signal?: AbortSignal;
}): Promise<CompletenessPassResult> {
  const idle: CompletenessPassResult = {
    ran: false,
    files: args.files,
    appliedPaths: [],
    note: null,
  };
  if (args.unmet.length === 0) return idle;

  const candidates = args.files
    .filter((f) => args.candidatePaths.includes(f.path))
    .slice(0, 8)
    .filter((f) => f.content.length < 60_000);
  if (candidates.length === 0) return idle;

  try {
    const res = await aiChatCompletions({
      feature: "generate",
      timeoutTier: "default",
      signal: args.signal,
      meta: {
        projectId: args.projectId ?? null,
        userId: args.userId ?? null,
        phase: "edit-completeness",
      },
      body: {
        model: args.model,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content:
              `Original request:\n${args.userRequest}\n\n` +
              `STILL MISSING:\n${args.unmet.map((u, i) => `${i + 1}. ${u.text}`).join("\n")}\n\n` +
              `Files:\n\n${candidates.map((f) => `--- ${f.path} ---\n${f.content}`).join("\n\n")}`,
          },
        ],
        tools: [PATCH_FILES_TOOL],
        tool_choice: { type: "function", function: { name: "patch_files" } },
        max_tokens: 8000,
        stream: false,
      },
    });
    if (!res.ok) return idle;
    const json = (await res.json()) as {
      choices?: Array<{
        message?: { tool_calls?: Array<{ function?: { arguments?: string } }> };
      }>;
    };
    const rawArgs = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!rawArgs) return idle;
    const parsed = JSON.parse(rawArgs) as { ops?: FileOp[] };
    const allowed = new Set(candidates.map((f) => f.path));
    const ops = (parsed.ops ?? []).filter((op) => op && allowed.has(op.path) && op.op !== "delete");
    if (ops.length === 0) return idle;

    const applied = applyOpsPartial(args.files, ops);
    const appliedPaths = Array.from(new Set(applied.applied.map((o) => o.path)));
    if (appliedPaths.length === 0) return idle;

    return {
      ran: true,
      files: applied.files,
      appliedPaths,
      note: `Completed ${args.unmet.length} remaining part${args.unmet.length === 1 ? "" : "s"} of your request.`,
    };
  } catch (e) {
    console.warn("[edit-audit] completeness pass failed:", e instanceof Error ? e.message : String(e));
    return idle;
  }
}
