/**
 * Pure mirrors of the database rules for economic operations. The database is
 * the authority (operation_credit_purpose, operation_transition_allowed); these
 * exist so the server can label operations and tests can pin the rules.
 */
export type OperationType =
  | "FIRST_BUILD" | "ITERATION" | "DESIGN_SYSTEM_CHANGE" | "DEBUG_FIX"
  | "RETRY" | "RECOVERY" | "RESTORE" | "UNDO" | "OTHER";

export type SettlementState =
  | "CREATED" | "RESERVED" | "EXECUTING" | "COMMITTED" | "BUILDING" | "VERIFYING"
  | "READY" | "FAILED" | "SETTLED" | "REFUNDED" | "CANCELLED";

/** Map the ONE existing classifier's operation onto the economic type. */
export function toOperationType(classifierOp: string, opts: { isInitial: boolean }): OperationType {
  if (opts.isInitial || classifierOp === "first_build") return "FIRST_BUILD";
  if (classifierOp === "repair") return "DEBUG_FIX";
  return "ITERATION";
}

const BUILD_TYPES: ReadonlySet<OperationType> = new Set([
  "FIRST_BUILD", "ITERATION", "DEBUG_FIX", "DESIGN_SYSTEM_CHANGE", "RESTORE", "UNDO",
]);

/** Free BUILD credits: allow-listed type AND a new buildable revision. Unknown → NON_BUILD. */
export function creditPurposeFor(type: string, producedRevision: boolean): "BUILD" | "NON_BUILD" {
  return producedRevision && BUILD_TYPES.has(type as OperationType) ? "BUILD" : "NON_BUILD";
}

const NEXT: Record<SettlementState, SettlementState[]> = {
  CREATED: ["RESERVED", "EXECUTING", "COMMITTED", "FAILED", "CANCELLED", "SETTLED"],
  RESERVED: ["EXECUTING", "COMMITTED", "FAILED", "CANCELLED", "SETTLED"],
  EXECUTING: ["COMMITTED", "FAILED", "CANCELLED", "SETTLED"],
  COMMITTED: ["BUILDING", "FAILED", "CANCELLED", "SETTLED"],
  BUILDING: ["VERIFYING", "READY", "FAILED"],
  VERIFYING: ["READY", "FAILED"],
  READY: ["SETTLED"],
  FAILED: ["BUILDING", "REFUNDED", "SETTLED"],
  SETTLED: [],
  REFUNDED: [],
  CANCELLED: [],
};

export function transitionAllowed(from: SettlementState, to: SettlementState): boolean {
  return from === to || NEXT[from].includes(to);
}
