/**
 * Authoritative source verification of a PROPOSED tree (the uncommitted
 * TurnTransaction.proposedTree()). esbuild runs on the proposed bytes; the
 * existing source gates (syntax, dependencies, routes) then decide.
 * Used by /api/generate's commitTurn() — never reads persisted files.
 */
import { verifyFilesEsbuild } from "@/server/esbuild-verifier.server";
import { isVerifierExempt } from "@/server/scaffold-ownership.server";
import { finalizeVerification, runSourceGates, type VerificationRecord } from "./gates";

export async function verifyProposedSource(args: {
  tree: Array<{ path: string; content: string }>;
  changedPaths: string[];
  requestedRoutes: string[];
}): Promise<VerificationRecord> {
  const parseable = args.changedPaths.filter((p) => /\.(tsx?|jsx?|mts|cts)$/i.test(p) && !isVerifierExempt(p));
  const esbuild = await verifyFilesEsbuild(args.tree, parseable);
  return finalizeVerification(runSourceGates({ files: args.tree, requestedRoutes: args.requestedRoutes, esbuild }));
}
