/**
 * Authoritative source verification of a PROPOSED tree (the uncommitted
 * TurnTransaction.proposedTree()). esbuild runs on the proposed bytes; the
 * existing source gates (syntax, dependencies, routes) then decide.
 * Used by /api/generate's commitTurn() — never reads persisted files.
 */
import { verifyFilesEsbuild } from "@/server/esbuild-verifier.server";
import { isVerifierExempt } from "@/server/scaffold-ownership.server";
import { checkUndefinedIdentifiers, type IdentifierCheckStatus } from "./identifiers.server";
import { finalizeVerification, runSourceGates, type VerificationRecord } from "./gates";
import { responsiveWarnings, type ResponsiveWarning } from "./responsive";

export async function verifyProposedSource(args: {
  tree: Array<{ path: string; content: string }>;
  changedPaths: string[];
  requestedRoutes: string[];
  /** First builds: the shared app frame is a required deliverable. */
  requireShell?: boolean;
}): Promise<VerificationRecord & { semantic: { status: IdentifierCheckStatus | "not_run"; reason?: string }; responsive: ResponsiveWarning[] }> {
  const parseable = args.changedPaths.filter((p) => /\.(tsx?|jsx?|mts|cts)$/i.test(p) && !isVerifierExempt(p));
  const esbuild = await verifyFilesEsbuild(args.tree, parseable);
  // Semantic gate: esbuild proves the bytes PARSE; the real TypeScript
  // checker proves the changed files don't reference identifiers that were
  // never declared (`ReferenceError: mode is not defined` shipped to the
  // preview because nothing checked this). Runs only when the parse gate
  // passed — a file that doesn't parse is already a FAIL with a better
  // diagnostic, and the checker would just echo it.
  let merged = esbuild;
  let semantic: { status: IdentifierCheckStatus | "not_run"; reason?: string } = { status: "not_run" };
  if (esbuild && (esbuild.status === "passed" || esbuild.status === "not_checked")) {
    const check = checkUndefinedIdentifiers(args.tree, parseable);
    const identifierIssues = check.issues;
    semantic = { status: check.status, ...(check.reason ? { reason: check.reason } : {}) };
    // "unavailable" follows the existing syntax-gate policy for this path
    // (checker unavailable → code kept, esbuild stays the parse authority)
    // but is carried on the record so it is never reported as verified.
    if (check.status === "failed") {
      merged = {
        ...esbuild,
        status: "failed",
        ok: false,
        issues: [
          ...(esbuild.issues ?? []),
          ...identifierIssues.map((i) => ({
            path: i.path,
            line: i.line,
            column: 0,
            kind: "semantic" as const,
            message: `${i.message} — declared nowhere in this file; the preview would crash with a ReferenceError`,
          })),
        ],
      };
    }
  }
  const record = finalizeVerification(runSourceGates({ files: args.tree, requestedRoutes: args.requestedRoutes, esbuild: merged, requireShell: args.requireShell }));
  // Advisory only: never changes the verdict above.
  let responsive: ResponsiveWarning[] = [];
  try {
    responsive = responsiveWarnings(args.tree, args.changedPaths);
    if (responsive.length) console.log(`[verify] responsive_advisory ${JSON.stringify(responsive.slice(0, 10))}`);
  } catch { /* advisory must never break verification */ }
  return { ...record, semantic, responsive };
}
