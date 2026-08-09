/**
 * Pending-plan persistence.
 *
 * Plan Mode stops a turn and waits for the user to approve a file list. That
 * state used to live only in React state, so a reload, a phone lock screen, or
 * an accidental tab close silently destroyed it: the user's prompt was already
 * in the thread, no build was running, and nothing would ever answer it. From
 * the user's side the builder simply ate the turn.
 *
 * We persist the proposal per project so returning to the builder restores the
 * exact card — including which files were ticked.
 */

export interface PersistedPlan {
  planId: string;
  summary: string;
  risk: "low" | "medium" | "high";
  files: Array<{ path: string; intent: "edit" | "create" | "delete"; reason: string }>;
  allowedPaths: string[];
  sourcePrompt: string;
  auto: boolean;
  /** ms epoch — proposals older than the TTL are dropped as stale. */
  savedAt: number;
}

const KEY = (projectId: string) => `petal:pending-plan:${projectId}`;
/** A day-old plan describes a codebase that has since moved on. */
const TTL_MS = 6 * 60 * 60 * 1000;

export function persistPendingPlan(projectId: string, plan: Omit<PersistedPlan, "savedAt">): void {
  if (typeof window === "undefined" || !projectId) return;
  try {
    window.localStorage.setItem(KEY(projectId), JSON.stringify({ ...plan, savedAt: Date.now() }));
  } catch {
    // Private mode / quota. Losing persistence is survivable; throwing is not.
  }
}

export function clearPendingPlan(projectId: string): void {
  if (typeof window === "undefined" || !projectId) return;
  try {
    window.localStorage.removeItem(KEY(projectId));
  } catch {
    /* ignore */
  }
}

export function readPendingPlan(projectId: string): PersistedPlan | null {
  if (typeof window === "undefined" || !projectId) return null;
  try {
    const raw = window.localStorage.getItem(KEY(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedPlan;
    if (
      !parsed ||
      typeof parsed.planId !== "string" ||
      typeof parsed.sourcePrompt !== "string" ||
      !Array.isArray(parsed.files)
    ) {
      clearPendingPlan(projectId);
      return null;
    }
    if (!parsed.savedAt || Date.now() - parsed.savedAt > TTL_MS) {
      clearPendingPlan(projectId);
      return null;
    }
    return {
      ...parsed,
      allowedPaths: Array.isArray(parsed.allowedPaths)
        ? parsed.allowedPaths
        : parsed.files.map((f) => f.path),
    };
  } catch {
    clearPendingPlan(projectId);
    return null;
  }
}
