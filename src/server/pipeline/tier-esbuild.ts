/**
 * Tier 2.7 — esbuild parse pass.
 *
 * Same parser Vite uses to ship the bundle. If a file passes here, it WILL
 * parse in production. Catches semantic syntax errors the heuristic local
 * verifier can miss (mismatched generics, misplaced `await`, invalid JSX
 * expression children, etc.).
 *
 * Behavior preservation: identical SSE timeline event shape and message.
 */

import { verifyFilesEsbuild } from "@/server/esbuild-verifier.server";
import type { ProjectFile } from "@/server/generate.server";
import type { EsbuildTierOutput } from "./tier-types";

interface RunArgs {
  files: ProjectFile[];
  earlyChangedPaths: string[];
}

export async function runEsbuildTier(args: RunArgs): Promise<EsbuildTierOutput> {
  const { files, earlyChangedPaths } = args;

  const verdict = await verifyFilesEsbuild(files, earlyChangedPaths);
  if (verdict.status === "unavailable") {
    console.error("[esbuild-verifier] authoritative parser unavailable:", verdict.unavailableDetail);
  } else if (!verdict.ok) {
    console.warn(
      `[esbuild-verifier] ${verdict.issues.length} parse error(s):`,
      verdict.issues.map((i) => `${i.path}:${i.line}:${i.column} ${i.message}`).join("; "),
    );
  }

  const emit: EsbuildTierOutput["emit"] = [
    {
      type: "timeline",
      step: "esbuild_parse",
      outcome: verdict.status === "passed" || verdict.status === "not_checked" ? "ok" : "failed",
      message: verdict.status === "unavailable"
        ? "Code parser unavailable — validation stopped"
        : verdict.status === "not_checked"
          ? "No changed code files needed parsing"
          : verdict.ok
            ? `Parsed ${verdict.checkedPaths.length} file${verdict.checkedPaths.length === 1 ? "" : "s"} cleanly`
            : `Found ${verdict.issues.length} syntax issue${verdict.issues.length === 1 ? "" : "s"}`,
      count: verdict.ok ? verdict.checkedPaths.length : verdict.issues.length,
      ts: Date.now(),
    },
  ];

  return { verdict, emit };
}
