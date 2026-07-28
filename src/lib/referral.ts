/**
 * Shared waitlist-referral constants + tiny browser helpers.
 *
 * The rules are deliberately public and identical for everyone — hidden
 * queue-jumping is what makes referral waitlists feel unfair.
 */

/** Spots you move up the queue for each friend who joins. */
export const REFERRAL_JUMP = 15;
/** Friends needed to skip the queue entirely and get auto-invited. */
export const AUTO_APPROVE_AT = 3;
/** Credits the referrer gets per friend who actually signs in. */
export const REFERRER_CREDITS = 5;
/** Welcome credits the referred friend gets on first sign-in. */
export const REFERRED_CREDITS = 5;
/** Referrals that earn credits (queue jumps stay uncapped). */
export const REWARDED_REFERRALS_CAP = 10;
/** Referral counts that trigger a milestone email. */
export const MILESTONES = [1, AUTO_APPROVE_AT, 10];

const REF_KEY = "petal.waitlist.ref";
const TOKEN_KEY = "petal.waitlist.token";

export function rememberReferral(code: string) {
  try {
    localStorage.setItem(REF_KEY, code.slice(0, 32));
  } catch {
    /* private mode */
  }
}

export function readReferral(): string | null {
  try {
    return localStorage.getItem(REF_KEY);
  } catch {
    return null;
  }
}

export function clearReferral() {
  try {
    localStorage.removeItem(REF_KEY);
  } catch {
    /* noop */
  }
}

export function rememberStatusToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* noop */
  }
}

export function readStatusToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export const SITE_ORIGIN = "https://buildwithpetal.com";

export function shareUrl(code: string) {
  return `${SITE_ORIGIN}/r/${code}`;
}

export function shareText(code: string) {
  return `I'm in line for Petal — you describe an app in a sentence and it builds it. Grab a spot: ${shareUrl(code)}`;
}
