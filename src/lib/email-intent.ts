/**
 * Lightweight email-intent detector. Mirrors domain-intent.ts. Runs client-side
 * over the latest user message + assistant reply so we can show an inline
 * "Enable Petal Email?" suggestion chip in the chat. False positives are fine
 * — the chip is dismissible.
 *
 * Excludes signals that are clearly about authentication emails (password
 * reset, verification, magic link) since those are handled by the backend.
 */

const STRONG_SIGNALS: RegExp[] = [
  /\bsend (an? |the )?email\b/i,
  /\bemail (the |a )?(user|customer|client|admin|recipient|me|them|user's)\b/i,
  /\b(contact|booking|order|signup|welcome|reservation|inquiry) (form )?(email|notification|confirm(ation)?)/i,
  /\bnotify (the )?(user|customer|admin|me) (by|via) email\b/i,
  /\b(mailgun|sendgrid|postmark|mandrill|aws ses|amazon ses|brevo|sendinblue)\b/i,
  /\bnewsletter\b/i,
  /\btransactional emails?\b/i,
  /\bemail receipts?\b/i,
  /\bemail (notification|confirmation|reminder|digest|report)s?\b/i,
  /\bsmtp\b/i,
  /\bemail (api|service|provider)\b/i,
  /\b(petal email|resend)\b/i,
  /\bcontact form (and )?email\b/i,
];

const MIN_LENGTH = 8;

export type EmailIntent = {
  detected: boolean;
  reason?: string;
};

export function detectEmailIntent(text: string | null | undefined): EmailIntent {
  if (!text) return { detected: false };
  const t = text.trim();
  if (t.length < MIN_LENGTH) return { detected: false };

  for (const re of STRONG_SIGNALS) {
    const m = t.match(re);
    if (m) return { detected: true, reason: m[0].toLowerCase() };
  }
  return { detected: false };
}

export function detectEmailIntentInTurn(
  userText: string | null | undefined,
  assistantText: string | null | undefined,
): EmailIntent {
  const a = detectEmailIntent(userText);
  if (a.detected) return a;
  return detectEmailIntent(assistantText);
}
