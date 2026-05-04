/**
 * Tracks the in-flight Petal turn for each project in localStorage so the
 * UI can silently reattach after a tab close, refresh, or device switch.
 *
 * The server is the source of truth for whether a turn is still running
 * (`turns.status`), but storing the id locally lets the client reconnect
 * BEFORE making a single network call — instant rehydration on mount.
 *
 *   { turnId: string, lastSeq: number, startedAt: number }
 *
 * `lastSeq` is the highest event sequence number we've already rendered,
 * so the resume endpoint only sends events we missed.
 */

const KEY_PREFIX = "petal:turn:";
/** Anything older than this is treated as stale on mount and cleared.
 *  Build pipelines top out at ~5 minutes; anything older means the user
 *  came back hours later and the turn long-since ended. */
const MAX_AGE_MS = 15 * 60_000;

export type ResumableTurn = {
  turnId: string;
  lastSeq: number;
  startedAt: number;
};

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function persistTurnId(projectId: string, turnId: string): void {
  const ls = safeStorage();
  if (!ls) return;
  try {
    ls.setItem(
      KEY_PREFIX + projectId,
      JSON.stringify({ turnId, lastSeq: 0, startedAt: Date.now() }),
    );
  } catch {
    /* quota / private mode — silent */
  }
}

export function bumpTurnSeq(projectId: string, seq: number): void {
  const cur = readPersistedTurn(projectId);
  if (!cur) return;
  if (seq <= cur.lastSeq) return;
  const ls = safeStorage();
  if (!ls) return;
  try {
    ls.setItem(KEY_PREFIX + projectId, JSON.stringify({ ...cur, lastSeq: seq }));
  } catch {
    /* silent */
  }
}

export function readPersistedTurn(projectId: string): ResumableTurn | null {
  const ls = safeStorage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(KEY_PREFIX + projectId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResumableTurn;
    if (
      !parsed ||
      typeof parsed.turnId !== "string" ||
      typeof parsed.lastSeq !== "number" ||
      typeof parsed.startedAt !== "number"
    ) {
      ls.removeItem(KEY_PREFIX + projectId);
      return null;
    }
    if (Date.now() - parsed.startedAt > MAX_AGE_MS) {
      ls.removeItem(KEY_PREFIX + projectId);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPersistedTurnId(projectId: string): void {
  const ls = safeStorage();
  if (!ls) return;
  try {
    ls.removeItem(KEY_PREFIX + projectId);
  } catch {
    /* silent */
  }
}
