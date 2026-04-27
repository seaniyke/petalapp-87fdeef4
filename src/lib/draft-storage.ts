/**
 * Tab-scoped, project-scoped session storage for unsaved UI drafts.
 *
 * Used to keep these things alive across a browser refresh:
 *   - the builder composer text and queued messages
 *   - composer image attachments
 *   - in-progress edits to the Project Knowledge sheet
 *
 * Design choices:
 *   - sessionStorage (not localStorage) so drafts stay scoped to the current
 *     browser tab and never leak between users on a shared machine.
 *   - keys are namespaced by project id so switching between projects in the
 *     same tab never resurrects another project's draft.
 *   - all helpers are SSR-safe (silently no-op when window is undefined).
 *   - writes are wrapped in try/catch — a quota error must never break a UI
 *     interaction. If we can't save, we just lose the draft, not the page.
 */

const NS = "petal:draft:";

function isAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

export function readDraft<T>(key: string): T | null {
  if (!isAvailable()) return null;
  try {
    const raw = window.sessionStorage.getItem(NS + key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeDraft<T>(key: string, value: T): void {
  if (!isAvailable()) return;
  try {
    const serialized = JSON.stringify(value);
    // Cap individual entries at 200KB so a runaway attachment payload can't
    // blow past the per-origin sessionStorage quota.
    if (serialized.length > 200_000) return;
    window.sessionStorage.setItem(NS + key, serialized);
  } catch {
    // QuotaExceededError or JSON failure — silently drop the write.
  }
}

export function clearDraft(key: string): void {
  if (!isAvailable()) return;
  try {
    window.sessionStorage.removeItem(NS + key);
  } catch {
    // No-op.
  }
}

/** Convenience helpers that build the per-project key prefix for you. */
export const builderDraftKeys = {
  composer: (projectId: string) => `builder:${projectId}:composer`,
  queue: (projectId: string) => `builder:${projectId}:queue`,
  attachments: (projectId: string) => `builder:${projectId}:attachments`,
  knowledge: (projectId: string) => `builder:${projectId}:knowledge`,
};

/** Auth form: remember the last email used so a refresh doesn't wipe it. */
export const authDraftKey = "auth:last-email";

export function readLastAuthEmail(): string {
  if (!isAvailable()) return "";
  try {
    return window.localStorage.getItem("petal:" + authDraftKey) ?? "";
  } catch {
    return "";
  }
}

export function writeLastAuthEmail(email: string): void {
  if (!isAvailable()) return;
  try {
    if (email.trim()) {
      window.localStorage.setItem("petal:" + authDraftKey, email.trim());
    } else {
      window.localStorage.removeItem("petal:" + authDraftKey);
    }
  } catch {
    // No-op.
  }
}

export function clearLastAuthEmail(): void {
  if (!isAvailable()) return;
  try {
    window.localStorage.removeItem("petal:" + authDraftKey);
  } catch {
    // No-op.
  }
}
