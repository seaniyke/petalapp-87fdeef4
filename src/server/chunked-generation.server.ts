import { RECOVERY_LIMITS } from "@/server/engine/recovery-policy";
/**
 * Chunked generation + staged application for large multi-page edits.
 *
 * A single model turn has a hard output ceiling. A big multi-part request
 * ("rebuild the nav, add 4 pages, wire the footer links") regularly hits it:
 * the provider stops with finish_reason=`length`, the tail of the tool JSON is
 * truncated, and — even after per-op salvage — the turn ships only the prefix
 * the model happened to finish. The user sees a partial edit, or none at all.
 *
 * This module turns that one-shot into a bounded sequence of CHUNKS:
 *
 *   round 1 (the normal stream)  → ops for steps 1..k, truncated at the ceiling
 *   round 2 (chunk continuation) → "you already shipped X; emit ONLY the rest"
 *   round 3 …                    → until the plan is covered or the budget ends
 *
 * Each chunk's output is merged into the accumulating op/file list in order, so
 * the existing applier applies them sequentially — staged application, without
 * a second write path. Everything here is pure except `runChunkedGeneration`,
 * which delegates the actual model call to a caller-supplied function so the
 * decision logic stays testable and free of transport concerns.
 */

import type { FileOp, ProjectFile } from "@/server/generate.server";

export interface ChunkAssessment {
  needed: boolean;
  /** Machine-readable trigger, for logs/telemetry. */
  reason:
    | "none"
    | "truncated_output"
    | "unclosed_payload"
    | "steps_incomplete"
    | "coverage_incomplete";
  /** Steps declared by the model that no emitted op/file claimed yet. */
  remainingSteps: string[];
  /** Paths the model already emitted this turn. */
  deliveredPaths: string[];
}

export interface ChunkRequest {
  /** 1-based continuation round (round 1 is the original stream). */
  round: number;
  /** Message appended as the new user turn for this chunk. */
  instruction: string;
  /** Output ceiling for this chunk. */
  maxTokens: number;
}

export interface ChunkOutput {
  ops?: FileOp[];
  files?: ProjectFile[];
  summary?: string;
  /** Provider stop reason for this chunk, when known. */
  finishReason?: string | null;
  /** Steps the chunk declared (used to recompute what is still missing). */
  steps?: string[];
}

export interface ChunkedResult {
  ops: FileOp[];
  files: ProjectFile[];
  /** How many continuation rounds actually ran. */
  rounds: number;
  /** Ops/files contributed by continuation rounds only. */
  added: number;
  notes: string[];
}

/** Hard ceiling on continuation rounds — cost and latency safety. */
/** Owned by the recovery table (truncated_output). */
export const MAX_CHUNK_ROUNDS = RECOVERY_LIMITS.truncated_output;

/**
 * Pull the COMPLETE elements of a top-level `"steps": [...]` array out of a
 * raw (possibly truncated) tool-args string. Mirrors the streaming parser so
 * a cut-off tail never yields a half-quoted step label.
 */
export function parseStepsFromArgs(rawArgs: string): string[] {
  if (!rawArgs) return [];
  const at = rawArgs.indexOf('"steps"');
  if (at === -1) return [];
  const open = rawArgs.indexOf("[", at);
  if (open === -1) return [];

  const out: string[] = [];
  let i = open + 1;
  while (i < rawArgs.length) {
    while (i < rawArgs.length && /[\s,]/.test(rawArgs[i]!)) i++;
    if (i >= rawArgs.length || rawArgs[i] === "]") break;
    if (rawArgs[i] !== '"') break;
    const start = i;
    i++;
    let escaped = false;
    let closed = false;
    for (; i < rawArgs.length; i++) {
      const ch = rawArgs[i]!;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") escaped = true;
      else if (ch === '"') {
        i++;
        closed = true;
        break;
      }
    }
    if (!closed) break;
    try {
      const value = JSON.parse(rawArgs.slice(start, i)) as string;
      if (value.trim()) out.push(value.trim());
    } catch {
      break;
    }
  }
  return out;
}

function pathsOf(args: { ops?: FileOp[]; files?: ProjectFile[] }): string[] {
  const out: string[] = [];
  for (const f of args.files ?? []) if (f?.path) out.push(f.path);
  for (const o of args.ops ?? []) if (o && "path" in o && o.path) out.push(o.path);
  return Array.from(new Set(out));
}

/**
 * Decide whether the turn stopped short of the work it announced.
 *
 * Conservative on purpose: a chunk round costs a model call, so we only ask
 * for one when there is hard evidence of an incomplete emit — a truncating
 * finish reason, an unclosed payload, or a published plan whose later steps
 * produced no ops at all.
 */
export function assessChunking(args: {
  rawArgs: string;
  finishReason: string | null | undefined;
  ops?: FileOp[];
  files?: ProjectFile[];
  /** Steps parsed from the payload, when the caller already has them. */
  steps?: string[];
}): ChunkAssessment {
  const steps = args.steps ?? parseStepsFromArgs(args.rawArgs);
  const deliveredPaths = pathsOf(args);
  const emitted = (args.ops?.length ?? 0) + (args.files?.length ?? 0);

  const truncated = /^(length|max_tokens)$/i.test(args.finishReason ?? "");
  const unclosed =
    args.rawArgs.trim().length > 0 && !args.rawArgs.trimEnd().endsWith("}");

  // With a published plan, each step should have produced at least one file
  // op. Fewer ops than steps after a truncating stop means the tail is missing.
  const stepsIncomplete = steps.length > 1 && emitted > 0 && emitted < steps.length;

  // Steps we can't tie to any emitted path — the model names files in its
  // step labels often enough that this is a useful signal, and when it isn't
  // we simply pass the whole tail of the plan back to the model.
  const covered = Math.min(emitted, steps.length);
  const remainingSteps = steps.slice(covered);

  let reason: ChunkAssessment["reason"] = "none";
  if (truncated) reason = "truncated_output";
  else if (unclosed) reason = "unclosed_payload";
  else if (stepsIncomplete) reason = "steps_incomplete";

  return {
    needed: reason !== "none" && emitted > 0,
    reason,
    remainingSteps,
    deliveredPaths,
  };
}

/**
 * Route-coverage assessment for INITIAL builds.
 *
 * A clean `stop` is not proof the app is complete: the model routinely ships a
 * gorgeous landing page and defers "browse / detail / journal / stats" to a
 * follow-up turn the user never asked for. When the turn planned or promised
 * routes that no emitted file provides, continue in the same turn instead of
 * shipping a one-page app.
 */
export function assessRouteCoverage(args: {
  expectedRoutes: string[];
  files?: ProjectFile[];
  ops?: FileOp[];
  /**
   * Paths that already exist in the project. On an EDIT turn a nav link to
   * an existing page is not a missing page, so those routes count as covered.
   */
  existingPaths?: string[];
  /**
   * Router source (entry + App + emitted files). A page file that no
   * <Route path="..."> registers is unreachable, which reads to the user as
   * a missing screen — so an unregistered route counts as not delivered.
   */
  routerSource?: string;
  /**
   * First builds: the unit is only complete when the app shell (src/App.tsx)
   * with its home screen exists. A normal provider finish that wrote only
   * theme/brand files is INCOMPLETE work, not success.
   */
  requireAppShell?: boolean;
}): ChunkAssessment {
  const deliveredPaths = pathsOf(args);
  const emitted = deliveredPaths.length;
  const shellMissing =
    args.requireAppShell === true &&
    ![...deliveredPaths, ...(args.existingPaths ?? [])].some((p) => /^src\/App\.(t|j)sx$/i.test(p));

  const routeFiles = [
    ...deliveredPaths,
    ...(args.existingPaths ?? []),
  ].filter((p) => /^src\/(routes|pages)\//i.test(p));
  const haystack = routeFiles.map((p) => p.toLowerCase()).join("\n");


  const missing: string[] = [];
  for (const raw of args.expectedRoutes) {
    const route = String(raw ?? "").trim();
    if (!route) continue;
    // "/" is covered by any index/home route file; other routes match on slug.
    const slug = route.replace(/^\/+|\/+$/g, "").split("/")[0]?.toLowerCase() ?? "";
    if (!slug) {
      if (!/\/(index|home|landing)\.(t|j)sx?$/im.test(haystack) && !/index/.test(haystack)) {
        missing.push("/");
      }
      continue;
    }
    if (/[:$*]/.test(slug)) continue; // dynamic params — covered by their parent
    // Multi-word routes ("/terms-and-privacy") are written as PascalCase files
    // ("TermsAndPrivacy.tsx"), so also match the slug with separators removed.
    const compact = slug.replace(/[-_]/g, "");
    if (!haystack.includes(slug) && !haystack.includes(compact)) {
      missing.push(route);
      continue;
    }
    if (args.routerSource) {
      const registered = new RegExp(
        `path\\s*[=:]\\s*["'\`][^"'\`]*${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
        "i",
      ).test(args.routerSource);
      if (!registered) missing.push(route);
    }
  }

  const unique = Array.from(new Set(missing)).slice(0, 8);
  const steps = unique.map(
    (r) => `Build the "${r}" page as its own route file and link it from the nav and footer.`,
  );
  if (shellMissing) {
    steps.unshift(
      "Write src/App.tsx: the router with every requested page registered, the shared nav/footer, and the complete Home page.",
    );
  }
  const incomplete = steps.length > 0;
  return {
    needed: incomplete && emitted > 0,
    reason: incomplete ? "coverage_incomplete" : "none",
    remainingSteps: steps,
    deliveredPaths,
  };
}

/** Build the follow-up user turn for one continuation chunk. */
export function buildChunkInstruction(args: {
  round: number;
  isInitial: boolean;
  deliveredPaths: string[];
  remainingSteps: string[];
  reason?: ChunkAssessment["reason"];
}): string {
  const tool = args.isInitial ? "write_project" : "patch_files";
  const done = args.deliveredPaths.slice(0, 40);
  const todo = args.remainingSteps.slice(0, 12);
  const coverage = args.reason === "coverage_incomplete";

  return [
    coverage
      ? `Your previous ${tool} call shipped only part of the app: pages you planned are still missing. Finish them NOW, in this turn — never defer a planned page to a later turn.`
      : `Your previous ${tool} call was cut off by the output limit, so the work is only partly done.`,
    done.length
      ? `Already applied (do NOT resend these unless a remaining step must change them): ${done.join(", ")}.`
      : "No files were applied yet.",
    todo.length
      ? `Remaining work from your own plan:\n${todo.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
      : "Finish the remaining work from your plan that you had not emitted yet.",
    `Emit ONE ${tool} call containing ONLY the remaining work. Keep this chunk small — at most 3 files. Do not repeat completed files, do not re-explain, do not restate the plan.`,
    `If nothing is left to do, return an empty ops list and say so in \`summary\`.`,
  ].join("\n\n");
}

/**
 * Merge a continuation chunk into the accumulated payload.
 *
 * Later whole-file writes (`create`/`update`) for a path supersede earlier
 * ones — the newest content is the model's latest intent. `replace` ops are
 * positional and are always appended so they apply in emission order.
 */
const COMPLETED_PAGE = /(^|\/)src\/(pages|routes)\//;

export function mergeChunk(
  base: { ops: FileOp[]; files: ProjectFile[] },
  chunk: ChunkOutput,
): { ops: FileOp[]; files: ProjectFile[]; added: number } {
  const ops = [...base.ops];
  const files = [...base.files];
  let added = 0;

  for (const file of chunk.files ?? []) {
    if (!file?.path || typeof file.content !== "string") continue;
    const at = files.findIndex((f) => f.path === file.path);
    // A completed page is never regenerated by a later unit. Shared shell
    // files (router, layout, styles) may still be updated to wire new pages.
    if (at >= 0 && COMPLETED_PAGE.test(file.path)) continue;
    if (at >= 0) files[at] = file;
    else files.push(file);
    added++;
  }

  for (const op of chunk.ops ?? []) {
    if (!op || !("op" in op) || !("path" in op) || !op.path) continue;
    if (op.op === "create" || op.op === "update") {
      const at = ops.findIndex(
        (o) => o.path === op.path && (o.op === "create" || o.op === "update"),
      );
      if (at >= 0) {
        ops[at] = op;
        added++;
        continue;
      }
    }
    ops.push(op);
    added++;
  }

  return { ops, files, added };
}

/**
 * Run bounded continuation rounds until the plan is covered, the model stops
 * producing new work, or the round budget is spent.
 *
 * `request` performs the actual model call. Returning `null` (transport error,
 * unparseable output) ends the loop cleanly — chunking is always best-effort
 * and must never fail a turn that already carries usable work.
 */
export async function runChunkedGeneration(args: {
  isInitial: boolean;
  assessment: ChunkAssessment;
  ops: FileOp[];
  files: ProjectFile[];
  maxRounds?: number;
  chunkMaxTokens?: number;
  request: (req: ChunkRequest) => Promise<ChunkOutput | null>;
  onRound?: (round: number, added: number) => void;
}): Promise<ChunkedResult> {
  const notes: string[] = [];
  let ops = [...args.ops];
  let files = [...args.files];
  let remainingSteps = [...args.assessment.remainingSteps];
  let deliveredPaths = [...args.assessment.deliveredPaths];
  let added = 0;
  let rounds = 0;

  const maxRounds = Math.max(1, Math.min(args.maxRounds ?? MAX_CHUNK_ROUNDS, MAX_CHUNK_ROUNDS));

  for (let round = 1; round <= maxRounds; round++) {
    let chunk: ChunkOutput | null = null;
    try {
      chunk = await args.request({
        round,
        instruction: buildChunkInstruction({
          round,
          isInitial: args.isInitial,
          deliveredPaths,
          remainingSteps,
          reason: args.assessment.reason,
        }),
        maxTokens: args.chunkMaxTokens ?? 8_000,
      });
    } catch (e) {
      notes.push(`chunk ${round} errored: ${e instanceof Error ? e.message : String(e)}`);
      break;
    }

    rounds = round;
    if (!chunk) {
      notes.push(`chunk ${round} returned nothing — stopping`);
      break;
    }

    const merged = mergeChunk({ ops, files }, chunk);
    if (merged.added === 0) {
      notes.push(`chunk ${round} added no new work — plan looks covered`);
      break;
    }

    ops = merged.ops;
    files = merged.files;
    added += merged.added;
    deliveredPaths = pathsOf({ ops, files });
    remainingSteps = remainingSteps.slice(
      Math.min((chunk.ops?.length ?? 0) + (chunk.files?.length ?? 0), remainingSteps.length),
    );
    notes.push(`chunk ${round}: +${merged.added} change(s)`);
    args.onRound?.(round, merged.added);

    const stillTruncated = /^(length|max_tokens)$/i.test(chunk.finishReason ?? "");
    if (!stillTruncated && remainingSteps.length === 0) break;
  }

  return { ops, files, rounds, added, notes };
}
