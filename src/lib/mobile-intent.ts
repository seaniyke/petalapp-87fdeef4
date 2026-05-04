/**
 * Mobile intent detector. Mirrors email-intent / payment-intent / add-page-intent.
 *
 * Fires when the user (or Petal's reply) talks about turning the project
 * into a real mobile app — App Store / Play Store presence, push
 * notifications, native feel, app icon, install on phone, etc.
 *
 * Petal's mobile path = Capacitor under the hood (hidden from users), driven
 * by a remote build pipeline (Codemagic) so users never need a Mac, Xcode,
 * or fastlane on their machine. This intent powers the EnableMobileSuggestionChip
 * — same pattern as backend/email/payments: paid-plan gated, never a
 * top-up modal for free users.
 */

const STRONG_SIGNALS: RegExp[] = [
  /\b(?:mobile|native) app\b/i,
  /\b(?:ios|iphone|ipad) app\b/i,
  /\bandroid app\b/i,
  /\bplay store\b/i,
  /\bapp store\b/i,
  /\btestflight\b/i,
  /\bpush notifications?\b/i,
  /\bapp icon\b/i,
  /\bsplash screen\b/i,
  /\binstall (?:it|this|the app) on (?:my )?phone\b/i,
  /\bship (?:to|on) (?:the )?app store\b/i,
  /\bpublish (?:to|on) (?:the )?(?:app|play) store\b/i,
  /\bapk\b/i,
  /\bipa\b/i,
  /\baab\b/i,
  /\bsigned build\b/i,
  /\bbundle id\b/i,
  /\bcapacitor\b/i,
  /\breact native\b/i,
  /\bwrap (?:as|in)(?: a)? (?:mobile|native) app\b/i,
  /\bturn (?:this|it) into (?:a )?(?:mobile|native|phone) app\b/i,
];

const MIN_LENGTH = 6;

export type MobileIntent = { detected: boolean; reason?: string };

export function detectMobileIntent(text: string | null | undefined): MobileIntent {
  if (!text) return { detected: false };
  const t = text.trim();
  if (t.length < MIN_LENGTH) return { detected: false };
  for (const re of STRONG_SIGNALS) {
    const m = t.match(re);
    if (m) return { detected: true, reason: m[0].toLowerCase() };
  }
  return { detected: false };
}

export function detectMobileIntentInTurn(
  userText: string | null | undefined,
  assistantText: string | null | undefined,
): MobileIntent {
  const a = detectMobileIntent(userText);
  if (a.detected) return a;
  return detectMobileIntent(assistantText);
}
