/**
 * Storage / file-upload intent detector. Split from the generic backend
 * detector because the answer is specifically "Cloud storage bucket" and the
 * UX wording differs.
 */

const STRONG_SIGNALS: RegExp[] = [
  /\b(?:upload|uploading) (?:an? |the )?(?:image|images?|photo|photos?|picture|pictures?|video|videos?|file|files?|pdf|document|documents?|attachment|attachments?|avatar|profile pic(?:ture)?)/i,
  /\b(?:user|profile) (?:avatar|photo|picture|image)\b/i,
  /\bdrag (?:and |&\s*)drop (?:upload|files?|images?)\b/i,
  /\battach(?: a)? file\b/i,
  /\b(?:image|file|media) (?:upload|hosting|storage|library|gallery)\b/i,
  /\bstore (?:images?|photos?|files?|pdfs?|videos?|user[- ]uploaded)/i,
  /\b(?:S3 bucket|cloud storage|object storage|CDN upload)\b/i,
  /\bsupabase storage\b/i,
];

const MIN_LENGTH = 8;

export type StorageIntent = { detected: boolean; reason?: string };

export function detectStorageIntent(text: string | null | undefined): StorageIntent {
  if (!text) return { detected: false };
  const t = text.trim();
  if (t.length < MIN_LENGTH) return { detected: false };
  for (const re of STRONG_SIGNALS) {
    const m = t.match(re);
    if (m) return { detected: true, reason: m[0].toLowerCase() };
  }
  return { detected: false };
}

export function detectStorageIntentInTurn(
  userText: string | null | undefined,
  assistantText: string | null | undefined,
): StorageIntent {
  const a = detectStorageIntent(userText);
  if (a.detected) return a;
  return detectStorageIntent(assistantText);
}
