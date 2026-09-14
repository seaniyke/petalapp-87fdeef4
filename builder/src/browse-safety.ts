/**
 * Test Lab safety — what a test session is allowed to touch.
 *
 * A generated app under test is real code talking to real services. Driving it
 * with a browser can therefore charge a card, send an email, fire an SMS or
 * push a message into someone's inbox — side effects a test must never cause.
 *
 * Two rules, both enforced at the network layer so no amount of app code can
 * route around them:
 *
 *  1. Requests to known payment / email / SMS / messaging providers are
 *     refused outright, whatever the method.
 *  2. Anything that writes (POST/PUT/PATCH/DELETE) to a third-party origin is
 *     refused. The app's own origin and its backend still work normally, so
 *     sign-up, sign-in and database writes behave exactly as for a real user.
 *
 * A refused request is recorded, not hidden: the report says what was stopped,
 * so a failing test is never silently blamed on Petal's own guard.
 */

/** Hosts that cost money or reach a human. Never contacted during a test. */
const SIDE_EFFECT_HOSTS = [
  // payments
  "stripe.com",
  "api.stripe.com",
  "checkout.stripe.com",
  "paystack.co",
  "api.paystack.co",
  "flutterwave.com",
  "paypal.com",
  "paddle.com",
  "razorpay.com",
  "squareup.com",
  "lemonsqueezy.com",
  // email
  "resend.com",
  "sendgrid.net",
  "api.sendgrid.com",
  "mailgun.net",
  "postmarkapp.com",
  "mailchimp.com",
  "sparkpostapis.com",
  "brevo.com",
  "sendinblue.com",
  // sms / voice / push
  "twilio.com",
  "api.twilio.com",
  "vonage.com",
  "nexmo.com",
  "messagebird.com",
  "termii.com",
  "africastalking.com",
  "onesignal.com",
  "expo.dev/--/api/v2/push",
  // chat / webhooks that reach people
  "hooks.slack.com",
  "discord.com/api/webhooks",
  "api.telegram.org",
];

/** Third-party origins that are safe to write to (analytics-free, no humans). */
const WRITE_ALLOWED_SUFFIXES = [".supabase.co", ".supabase.in", ".lovable.app"];

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface GuardDecision {
  allow: boolean;
  /** Plain-language note recorded on the report when a request is refused. */
  note?: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "";
  }
}

function sameSite(host: string, baseHost: string): boolean {
  if (!host || !baseHost) return false;
  if (host === baseHost) return true;
  // A preview host and its API subdomain count as the app itself.
  const root = baseHost.split(".").slice(-2).join(".");
  return Boolean(root) && (host === root || host.endsWith(`.${root}`));
}

export function guardRequest(args: {
  url: string;
  method: string;
  baseUrl: string;
}): GuardDecision {
  const host = hostOf(args.url);
  if (!host) return { allow: true };

  const matchedSideEffect = SIDE_EFFECT_HOSTS.find(
    (h) => host === h || host.endsWith(`.${h}`) || `${host}${pathOf(args.url)}`.startsWith(h),
  );
  if (matchedSideEffect) {
    return {
      allow: false,
      note: `Blocked during testing so nothing real is charged or sent: ${matchedSideEffect}`,
    };
  }

  const method = args.method.toUpperCase();
  if (!WRITE_METHODS.has(method)) return { allow: true };

  const baseHost = hostOf(args.baseUrl);
  if (sameSite(host, baseHost)) return { allow: true };
  if (host === "localhost" || host.startsWith("127.") || host.startsWith("localhost:")) {
    return { allow: true };
  }
  if (WRITE_ALLOWED_SUFFIXES.some((s) => host.endsWith(s))) return { allow: true };

  return {
    allow: false,
    note: `Blocked during testing: ${method} to an outside service (${host})`,
  };
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

export const __testables = { SIDE_EFFECT_HOSTS, WRITE_ALLOWED_SUFFIXES };
