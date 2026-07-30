/**
 * Pure helpers that turn everything Petal streams during a build into ONE
 * chronological trace — the thing the Details sheet renders.
 *
 * Before this, the sheet stacked four separate lists (phases, thoughts,
 * files, checks) which read out of order and made every row feel the same
 * weight. Here we merge them by timestamp and roll consecutive reasoning
 * ticks into a single "Thought for Ns" row that expands to the full text.
 *
 * No React, no side effects — just data in, data out.
 */

import type { Phase } from "@/lib/build-phases";

export type ThoughtTick = { id: number; text: string; ts: number };

export type TraceEntry =
  | {
      kind: "thought";
      key: string;
      ts: number;
      /** Seconds spent in this reasoning burst (>= 1). */
      seconds: number;
      lines: string[];
    }
  | {
      kind: "phase";
      key: string;
      ts: number;
      label: string;
      detail?: string;
      status: Phase["status"];
    }
  | {
      kind: "file";
      key: string;
      ts: number;
      path: string;
      verb: "Created" | "Edited" | "Removed";
      done: boolean;
      addedLines?: number;
      removedLines?: number;
    }
  | {
      kind: "check";
      key: string;
      ts: number;
      message: string;
      detail: string;
      outcome: "ok" | "fixed" | "skipped" | "failed";
    };

export type TimelineLike = {
  step: string;
  outcome: "ok" | "fixed" | "skipped" | "failed";
  message: string;
  count?: number;
  ts: number;
};

export type FileChangeLike = {
  kind: "added" | "modified" | "unchanged" | "deleted";
  addedLines: number;
  removedLines: number;
};

export interface BuildTraceInput {
  phases: Phase[];
  thoughts: ThoughtTick[];
  writtenPaths?: string[];
  /** First time we saw each path stream in. Falls back to write order. */
  fileTimestamps?: Record<string, number>;
  completedPaths?: Set<string>;
  fileChanges?: Record<string, FileChangeLike>;
  timelineEvents?: TimelineLike[];
}

/** Merge every signal into one time-ordered trace, thoughts already grouped. */
export function buildTrace(input: BuildTraceInput): TraceEntry[] {
  const raw: TraceEntry[] = [];

  for (const p of input.phases) {
    if (p.id === "live" || p.status === "pending" || !p.startedAt) continue;
    raw.push({
      kind: "phase",
      key: `p-${p.id}`,
      ts: p.startedAt,
      label: p.status === "done" ? p.doneLabel : p.label,
      detail: p.reassurance,
      status: p.status,
    });
  }

  for (const t of input.thoughts) {
    raw.push({ kind: "thought", key: `t-${t.id}`, ts: t.ts, seconds: 0, lines: [t.text] });
  }

  const paths = input.writtenPaths ?? [];
  paths.forEach((path, i) => {
    const change = input.fileChanges?.[path];
    raw.push({
      kind: "file",
      key: `f-${path}`,
      // Synthetic fallback keeps write order stable when we have no clock.
      ts: input.fileTimestamps?.[path] ?? i,
      path,
      verb: change?.kind === "added" ? "Created" : change?.kind === "deleted" ? "Removed" : "Edited",
      done: input.completedPaths?.has(path) ?? change != null,
      addedLines: change?.addedLines,
      removedLines: change?.removedLines,
    });
  });

  (input.timelineEvents ?? []).forEach((ev, i) => {
    raw.push({
      kind: "check",
      key: `c-${ev.step}-${ev.ts}-${i}`,
      ts: ev.ts,
      message: ev.message,
      detail: ev.step.replace(/_/g, " "),
      outcome: ev.outcome,
    });
  });

  raw.sort((a, b) => a.ts - b.ts);
  return groupThoughts(raw);
}

/** Collapse runs of consecutive thought entries into one "Thought for Ns" row. */
export function groupThoughts(entries: TraceEntry[]): TraceEntry[] {
  const out: TraceEntry[] = [];
  for (const entry of entries) {
    const prev = out[out.length - 1];
    if (entry.kind === "thought" && prev?.kind === "thought") {
      if (!prev.lines.includes(entry.lines[0])) prev.lines.push(entry.lines[0]);
      prev.seconds = Math.max(1, Math.round((entry.ts - prev.ts) / 1000));
      continue;
    }
    out.push(entry.kind === "thought" ? { ...entry, lines: [...entry.lines], seconds: 1 } : entry);
  }
  return out;
}

/** "1m 12s" / "8s" */
export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/** Headline counts for the Summary tab. */
export function traceStats(entries: TraceEntry[]) {
  let thoughts = 0;
  let filesTouched = 0;
  let checksPassed = 0;
  let checksFixed = 0;
  let checksFailed = 0;
  for (const e of entries) {
    if (e.kind === "thought") thoughts += 1;
    else if (e.kind === "file") filesTouched += 1;
    else if (e.kind === "check") {
      if (e.outcome === "ok") checksPassed += 1;
      else if (e.outcome === "fixed") checksFixed += 1;
      else if (e.outcome === "failed") checksFailed += 1;
    }
  }
  return { thoughts, filesTouched, checksPassed, checksFixed, checksFailed };
}
