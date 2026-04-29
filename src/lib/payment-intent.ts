/**
 * Lightweight payment-intent detector. Mirrors email-intent.ts and
 * domain-intent.ts. Runs client-side over the latest user message + the
 * assistant's reply so we can surface an inline "Enable payments?" chip
 * BEFORE Petal scaffolds checkout code that needs Cloud + a payment provider.
 *
 * False positives are fine — the chip is dismissible.
 */

const STRONG_SIGNALS: RegExp[] = [
  // Provider-name mentions in a building context.
  /\b(stripe|paddle|paystack|flutterwave|lemon ?squeezy|shopify pay|paypal)\b/i,

  // Generic payment / monetization phrases.
  /\baccept(?:ing)? payments?\b/i,
  /\btake (?:credit )?cards?\b/i,
  /\bcollect(?:ing)? payments?\b/i,
  /\bcharge (?:my |the )?(?:user|customer|client|visitor)s?\b/i,
  /\b(?:add|enable|set up|setup) (?:a )?(?:checkout|paywall|payment|payments|billing)\b/i,
  /\bcheckout (?:flow|page|button|session)\b/i,
  /\bpay(?:ment)?(?:s)? (?:flow|page|gateway|provider|integration|button|link)\b/i,

  // Subscriptions & pricing.
  /\bsubscriptions?\b/i,
  /\brecurring (?:billing|payments?|charges?)\b/i,
  /\b(?:monthly|yearly|annual) (?:plan|subscription|billing)\b/i,
  /\bpricing (?:tier|plan|page)s?\b/i,
  /\bpaywall\b/i,
  /\bupgrade (?:to )?(?:pro|premium|paid)\b/i,
  /\bfree trial\b/i,

  // Selling / commerce intent.
  /\bsell (?:my |a |an |this )?(?:product|service|course|ebook|template|subscription|access|membership)\b/i,
  /\b(?:online )?(?:store|storefront|shop)\b/i,
  /\bdigital downloads?\b/i,
  /\b(?:e-?commerce|ecommerce)\b/i,
  /\b(?:add|build) (?:a )?(?:cart|shopping cart)\b/i,

  // Money handling / payouts.
  /\b(?:invoice|invoicing|receipt|refund|payout|donation|tip jar)s?\b/i,
];

const MIN_LENGTH = 8;

export type PaymentIntent = {
  detected: boolean;
  reason?: string;
};

export function detectPaymentIntent(text: string | null | undefined): PaymentIntent {
  if (!text) return { detected: false };
  const t = text.trim();
  if (t.length < MIN_LENGTH) return { detected: false };

  for (const re of STRONG_SIGNALS) {
    const m = t.match(re);
    if (m) return { detected: true, reason: m[0].toLowerCase() };
  }
  return { detected: false };
}

export function detectPaymentIntentInTurn(
  userText: string | null | undefined,
  assistantText: string | null | undefined,
): PaymentIntent {
  const a = detectPaymentIntent(userText);
  if (a.detected) return a;
  return detectPaymentIntent(assistantText);
}
