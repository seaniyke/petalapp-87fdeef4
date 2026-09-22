/**
 * Persisted automatic-recovery state.
 *
 * Kimble's self-healing paths (build auto-fix, no-edit escalation, transient
 * retry, post-deploy browser verification) all shared one in-memory budget.
 * That budget lived in refs, so leaving the tab and coming back — or iOS
 * discarding a backgrounded tab and reloading it — reset the counters AND the
 * "already handled this build id" sets. Kimble then happily started the whole
 * repair chain again on a build it had already reacted to, which is what makes
 * a single user request look like an endless loop of fix attempts.
 *
 * Storing the state per project in localStorage makes the budget survive
 * reloads, so "3 silent repairs per user turn" actually means 3 — ever, for
 * that turn — no matter how many times the page remounts.
 */

export type RecoveryState = {
  /** Identifies the user turn the budget belongs to. */
  turnKey: string | null;
  /** Silent repair turns already spent for `turnKey`. */
  used: number;
  /** Build-failure auto-fix attempts. */
  autoFixAttempts: number;
  /** Build ids whose failure Kimble already reacted to. */
  handledBuildIds: string[];
  /** Build ids whose browser-verification defects were already fed back. */
  verifyHandledBuildIds: string[];
  /** Build ids this browser session actually kicked off. */
  startedBuildIds: string[];
  noEditAttempts: number;
  transientAttempts: number;
  updatedAt: number;
};

export const emptyRecoveryState = (): RecoveryState => ({
  turnKey: null,
  used: 0,
  autoFixAttempts: 0,
  handledBuildIds: [],
  verifyHandledBuildIds: [],
  startedBuildIds: [],
  noEditAttempts: 0,
  transientAttempts: 0,
  updatedAt: Date.now(),
});

const KEY = (projectId: string) => `petal:recovery:${projectId}`;
/** Older than this and the state is meaningless — treat as a fresh turn. */
const TTL_MS = 6 * 60 * 60 * 1000;
/** Keep the persisted id lists bounded. */
const MAX_IDS = 40;

const trim = (ids: unknown): string[] =>
  Array.isArray(ids)
    ? ids.filter((v): v is string => typeof v === "string").slice(-MAX_IDS)
    : [];

export function loadRecoveryState(projectId: string | null | undefined): RecoveryState {
  if (!projectId || typeof window === "undefined") return emptyRecoveryState();
  try {
    const raw = window.localStorage.getItem(KEY(projectId));
    if (!raw) return emptyRecoveryState();
    const parsed = JSON.parse(raw) as Partial<RecoveryState>;
    const updatedAt = typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0;
    if (!updatedAt || Date.now() - updatedAt > TTL_MS) return emptyRecoveryState();
    return {
      turnKey: typeof parsed.turnKey === "string" ? parsed.turnKey : null,
      used: Number.isFinite(parsed.used) ? Number(parsed.used) : 0,
      autoFixAttempts: Number.isFinite(parsed.autoFixAttempts)
        ? Number(parsed.autoFixAttempts)
        : 0,
      handledBuildIds: trim(parsed.handledBuildIds),
      verifyHandledBuildIds: trim(parsed.verifyHandledBuildIds),
      startedBuildIds: trim(parsed.startedBuildIds),
      noEditAttempts: Number.isFinite(parsed.noEditAttempts) ? Number(parsed.noEditAttempts) : 0,
      transientAttempts: Number.isFinite(parsed.transientAttempts)
        ? Number(parsed.transientAttempts)
        : 0,
      updatedAt,
    };
  } catch {
    return emptyRecoveryState();
  }
}

export function saveRecoveryState(
  projectId: string | null | undefined,
  state: RecoveryState,
): void {
  if (!projectId || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      KEY(projectId),
      JSON.stringify({
        ...state,
        handledBuildIds: trim(state.handledBuildIds),
        verifyHandledBuildIds: trim(state.verifyHandledBuildIds),
        startedBuildIds: trim(state.startedBuildIds),
        updatedAt: Date.now(),
      }),
    );
  } catch {
    /* storage full or blocked — budget degrades to in-memory only */
  }
}

export function clearRecoveryState(projectId: string | null | undefined): void {
  if (!projectId || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY(projectId));
  } catch {
    /* ignore */
  }
}
