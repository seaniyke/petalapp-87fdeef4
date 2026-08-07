const TRANSIENT_EDGE_STATUSES = new Set([502, 503, 504, 520, 521, 522, 523, 524, 530]);

/** Hosting-edge responses that can occur briefly while a deployment propagates. */
export function isTransientEdgeStatus(status: number | null | undefined): boolean {
  return typeof status === "number" && TRANSIENT_EDGE_STATUSES.has(status);
}