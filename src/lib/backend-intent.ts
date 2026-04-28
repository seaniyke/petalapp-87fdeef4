/**
 * Lightweight, regex-based backend-intent detector. Runs client-side over the
 * latest user message + the assistant's reply so we can show a "Need a backend?"
 * suggestion chip inline in the chat.
 *
 * Keep it cheap: no AI round-trip, no new dependency. False positives are fine
 * because the chip is dismissible and only appears when the project doesn't
 * already have a backend connected.
 */

/** Phrases that nearly always imply persistence / users / server data. */
const STRONG_SIGNALS = [
  /\bsign[- ]?(?:up|in|on)\b/i,
  /\b(?:log[- ]?in|logout|sign[- ]?out)\b/i,
  /\bauth(?:entication)?\b/i,
  /\b(?:user|customer|member)s?\s+(?:account|profile|login|signup)/i,
  /\bdatabase\b/i,
  /\bsupabase\b/i,
  /\bbackend\b/i,
  /\bserver[- ]?side\b/i,
  /\bpersist(?:ent|ence|ed|ing)?\b/i,
  /\bsave (?:to|the|in) (?:cloud|database|server|backend)/i,
  /\bstore (?:data|records|users|posts|comments|messages|orders)/i,
  /\bsync (?:across|between) devices?/i,
  /\b(?:upload|store) (?:files?|images?|photos?|documents?)\b/i,
  /\b(?:CRUD|REST API|edge function|webhook)\b/i,
  /\bRow Level Security\b/i,
  /\bpayments?\b.*\b(?:stripe|paddle|paystack)\b/i,
  /\bemail (?:notifications?|magic link)/i,
];

/** Domain words that imply persistence when paired with create/save verbs. */
const ENTITY_WORDS =
  /\b(post|posts|comment|comments|order|orders|booking|bookings|invoice|invoices|task|tasks|todo|todos|note|notes|message|messages|product|products|listing|listings|review|reviews|appointment|appointments|reservation|reservations|customer|customers|client|clients|profile|profiles|account|accounts)\b/i;
const PERSIST_VERBS =
  /\b(save|store|create|add|persist|track|manage|fetch|load|sync|update|delete)\b/i;

/** Treat the chat strictly: ignore short throwaways. */
const MIN_LENGTH = 12;

export type BackendIntent = {
  detected: boolean;
  /** Short reason we can show in the chip tooltip ("save user accounts", etc.) */
  reason?: string;
};

export function detectBackendIntent(text: string | null | undefined): BackendIntent {
  if (!text) return { detected: false };
  const t = text.trim();
  if (t.length < MIN_LENGTH) return { detected: false };

  for (const re of STRONG_SIGNALS) {
    const m = t.match(re);
    if (m) return { detected: true, reason: m[0].toLowerCase() };
  }

  // Verb + entity within a short window.
  if (PERSIST_VERBS.test(t) && ENTITY_WORDS.test(t)) {
    const entity = t.match(ENTITY_WORDS)?.[0]?.toLowerCase();
    return { detected: true, reason: entity ? `manage ${entity}` : undefined };
  }
  return { detected: false };
}

/** Convenience: test the user turn AND the assistant reply together. */
export function detectBackendIntentInTurn(
  userText: string | null | undefined,
  assistantText: string | null | undefined,
): BackendIntent {
  const a = detectBackendIntent(userText);
  if (a.detected) return a;
  return detectBackendIntent(assistantText);
}
