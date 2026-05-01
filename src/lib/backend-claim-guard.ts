/**
 * Backend-claim guardrail.
 *
 * Petal's generation pipeline doesn't yet run migrations against managed
 * backends, but the model regularly writes recap/summary text claiming it
 * "created the users table" or "wired up sign-up". That's a lie by
 * construction — the user then opens the Cloud panel and sees nothing,
 * which is the bug the user reported.
 *
 * Until the migration runner ships (a much bigger change in
 * `installer.server.ts` + the deploy flow), we strip those claims from any
 * assistant text whenever the underlying file set didn't actually include a
 * `supabase/migrations/*.sql` file AND a real route consuming it.
 *
 * Scope: text-only sanitization. We never edit code; we just keep the chat
 * honest. Pair with the "no tables yet" empty state in the Cloud panel.
 */

export type GuardFile = { path: string };

export function emittedRealBackend(files: ReadonlyArray<GuardFile>): boolean {
  if (!files || files.length === 0) return false;
  const hasMigration = files.some((f) =>
    /^supabase\/migrations\/.+\.sql$/i.test(f.path),
  );
  const hasRoute = files.some(
    (f) => /^src\/routes\/.+\.(t|j)sx?$/i.test(f.path),
  );
  return hasMigration && hasRoute;
}

// Sentences that imply the backend / auth / database is now live. If a
// sentence matches any of these AND no migration was emitted, we drop it.
const BACKEND_CLAIM_PATTERNS: RegExp[] = [
  /\b(created?|added?|set\s*up|setup|built|wired(?:\s*up)?|configured|enabled|provisioned)\b[^.\n!?]*\b(table|tables|database|schema|profiles?|users?\s*table|auth\s*table|rls|row[-\s]?level\s*security|policies|policy|migration|migrations|backend|supabase)\b/i,
  /\b(sign[-\s]?up|sign[-\s]?in|log[-\s]?in|login|signup|signin|registration|password\s*reset|magic\s*link|otp|google\s*sign[-\s]?in|social\s*login)\b[^.\n!?]*\b(works?|working|ready|live|enabled|wired|set\s*up|now)\b/i,
  /\busers?\s+can\s+(now\s+)?(sign\s*up|sign\s*in|log\s*in|register|create\s*an?\s*account)\b/i,
  /\b(your|the)\s+(database|backend|auth|authentication)\s+(is|will\s+be)\s+(ready|live|set\s*up|configured|enabled)\b/i,
  /\bauthentication\s+(is|has\s+been)\s+(added|enabled|wired|set\s*up)\b/i,
];

function dropFalseClaimSentences(text: string): string {
  // Split on sentence boundaries / list markers but preserve them.
  const parts = text.split(/(\n+|(?<=[.!?])\s+)/);
  const kept: string[] = [];
  for (const part of parts) {
    if (!part) continue;
    if (/^\s*$/.test(part)) {
      kept.push(part);
      continue;
    }
    const isClaim = BACKEND_CLAIM_PATTERNS.some((re) => re.test(part));
    if (isClaim) continue;
    kept.push(part);
  }
  let out = kept.join("").replace(/\n{3,}/g, "\n\n").trim();
  // If we stripped a markdown bullet line, leave the line empty rather than
  // an orphan "- " marker.
  out = out.replace(/^[-*]\s*$/gm, "").replace(/\n{3,}/g, "\n\n");
  return out;
}

/**
 * If the file set didn't include a real migration, strip false "I built your
 * backend" claims from `text`. Returns the (possibly trimmed) string. When
 * everything was a claim, returns a short honest fallback so the bubble
 * isn't empty.
 */
export function guardBackendClaims(
  text: string | null | undefined,
  files: ReadonlyArray<GuardFile>,
  fallback = "",
): string {
  if (!text) return text ?? "";
  if (emittedRealBackend(files)) return text;
  const cleaned = dropFalseClaimSentences(text);
  if (cleaned.trim().length === 0) return fallback;
  return cleaned;
}
