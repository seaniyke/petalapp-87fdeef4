/**
 * Realtime intent detector. Triggers on phrases that imply WebSockets /
 * postgres-changes — Petal's Cloud has this but never proactively offers it.
 */

const STRONG_SIGNALS: RegExp[] = [
  /\breal[- ]?time\b/i,
  /\blive (?:chat|messaging|messages|updates?|feed|comments?|cursor|typing|reactions?|notifications?)\b/i,
  /\b(?:online|active) (?:users?|members?|presence)\b/i,
  /\bpresence (?:indicator|state|tracking)?\b/i,
  /\bcollabora(?:tive|tion)\b/i,
  /\b(?:multiplayer|co[- ]?editing|shared cursor)/i,
  /\btyping indicator\b/i,
  /\b(?:websocket|ws|server[- ]sent events|SSE)\b/i,
  /\b(?:pusher|ably|socket\.io|liveblocks)\b/i,
  /\bsupabase realtime\b/i,
  /\bauto[- ]?refresh (?:the )?(?:list|feed|messages?|data)\b/i,
  /\bpush updates? (?:to|when)/i,
];

const MIN_LENGTH = 6;

export type RealtimeIntent = { detected: boolean; reason?: string };

export function detectRealtimeIntent(text: string | null | undefined): RealtimeIntent {
  if (!text) return { detected: false };
  const t = text.trim();
  if (t.length < MIN_LENGTH) return { detected: false };
  for (const re of STRONG_SIGNALS) {
    const m = t.match(re);
    if (m) return { detected: true, reason: m[0].toLowerCase() };
  }
  return { detected: false };
}

export function detectRealtimeIntentInTurn(
  userText: string | null | undefined,
  assistantText: string | null | undefined,
): RealtimeIntent {
  const a = detectRealtimeIntent(userText);
  if (a.detected) return a;
  return detectRealtimeIntent(assistantText);
}
