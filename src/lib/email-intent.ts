/**
 * Detect when a chat turn implies the user wants email functionality
 * (transactional or notification emails — NOT auth emails which are handled
 * by the backend integration).
 *
 * Mirrors the pattern used by domain-intent.ts and the backend chip.
 */

const STRONG_SIGNALS = [
  /\bsend (an? )?email/i,
  /\bemail (the )?(user|customer|client|me|admin|recipient)/i,
  /\b(contact|booking|order|signup|welcome) (form )?(email|notification|confirm)/i,
  /\bnotify (by|via) email/i,
  /\b(mailgun|sendgrid|postmark|mandrill|ses)\b/i,
  /\bnewsletter\b/i,
  /\btransactional emails?\b/i,
  /\bmagic link\b/i,
  /\bemail receipt\b/i,
  /\bsmtp\b/i,
  /\bresend\b/i,
];

const WEAK_SIGNALS = [/\bemails?\b/i, /\binbox\b/i, /\bnotification\b/i];

interface ChatTurn {
  user?: string;
  assistant?: string;
}

export function detectEmailIntentInTurn(turn: ChatTurn): boolean {
  const text = `${turn.user ?? ""}\n${turn.assistant ?? ""}`;
  if (!text.trim()) return false;
  if (STRONG_SIGNALS.some((re) => re.test(text))) return true;
  // Require two weak signals to avoid false positives on the word "email".
  const weakHits = WEAK_SIGNALS.filter((re) => re.test(text)).length;
  return weakHits >= 2;
}
