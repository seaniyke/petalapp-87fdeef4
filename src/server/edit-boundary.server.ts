/**
 * Edit boundary — the hard version of the scope contract.
 *
 * `renderScopeContractBlock` tells the model to stay on the files the request
 * named. That is advice, and advice is exactly what produced the worst edit
 * failure Kimble has: "add a back button to the sign-in page" came back having
 * rewritten the landing page.
 *
 * This module turns the resolved target list into a boundary the write path
 * actually enforces. Deliberately conservative:
 *   - It only engages when the request read as small (micro/targeted) AND we
 *     resolved at least one real target file. Structural asks, initial builds
 *     and cross-cutting redesigns are never constrained here.
 *   - Follow-on files are allowed: the direct import neighbours the pipeline
 *     already pinned (a parent that must keep compiling), and brand-new files
 *     (a small edit may legitimately add one component).
 *   - It never throws and never looks at the network.
 *
 * Everything it rejects flows into the existing one-round op-repair path, so a
 * rejected edit gets re-aimed at the right file instead of being lost.
 */

export interface EditBoundary {
  /** False when nothing is constrained — callers can skip the check entirely. */
  enforced: boolean;
  /** Files the request resolved to. */
  targets: string[];
  /** True when a write to this path is inside the boundary. */
  allows: (path: string) => boolean;
  /** One short line for the logs. */
  describe: () => string;
}

const OPEN: EditBoundary = {
  enforced: false,
  targets: [],
  allows: () => true,
  describe: () => "open",
};

export function buildEditBoundary(args: {
  /** How big the request read. Only micro/targeted are constrained. */
  scope: "micro" | "targeted" | "structural" | null | undefined;
  /** Files the resolver concluded the request is about. */
  targetPaths: string[];
  /** Import neighbours already pinned for this turn. */
  neighbourPaths?: string[];
  /** Every path that exists in the project right now. */
  existingPaths: string[];
  /** Cross-cutting redesigns and first builds are never constrained. */
  disabled?: boolean;
  /** The request asked for a new page/route. Otherwise new page files are out of scope. */
  allowNewPages?: boolean;
}): EditBoundary {
  if (args.disabled) return OPEN;
  if (args.scope !== "micro" && args.scope !== "targeted") return OPEN;

  const targets = Array.from(new Set(args.targetPaths.filter(Boolean)));
  if (targets.length === 0) return OPEN;
  // A "targeted" ask that resolved to half the app is not really targeted.
  if (targets.length > 8) return OPEN;

  // Read scope is not write scope: import neighbours are context the model
  // may READ, never files it may rewrite. Only the resolved targets (plus the
  // router entry when the request adds a page) are writable.
  const allowed = new Set<string>(targets);
  if (args.allowNewPages) {
    for (const p of args.existingPaths) if (/^src\/(App|main|router)\.(t|j)sx?$/.test(p)) allowed.add(p);
  }
  const existing = new Set(args.existingPaths);
  const isPageFile = (p: string) => /^src\/(pages|routes)\//.test(p);

  return {
    enforced: true,
    targets,
    // A path that does not exist yet is a new file — allowed, because a small
    // edit can legitimately introduce one component. Rewriting a file that
    // already exists and was never part of the ask is what we stop.
    allows: (path: string) =>
      allowed.has(path) || (!existing.has(path) && (args.allowNewPages || !isPageFile(path))),
    describe: () =>
      `${args.scope} edit may write ${targets.join(", ")}${
        (args.neighbourPaths?.length ?? 0) > 0
          ? ` (reads ${args.neighbourPaths!.length} neighbour(s), writes none)`
          : ""
      }`,
  };
}
