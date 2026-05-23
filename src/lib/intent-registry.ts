/**
 * Intent registry — single source of truth for the regex-based intent
 * detectors that drive Petal's inline suggestion chips.
 *
 * Background: we used to have one file per chip (backend-intent.ts,
 * payment-intent.ts, email-intent.ts, …). Each file held its own
 * STRONG_SIGNALS list, MIN_LENGTH constant, and detectXIntent /
 * detectXIntentInTurn helpers — 12 copies of the same shape. Adding a new
 * chip meant writing a new file + wiring a new import + rendering a new
 * branch. The duplication is also what bit us in the question-asking
 * layers: many places independently deciding the same thing can disagree.
 *
 * This module collapses all of that into ONE table. Each per-chip file
 * (`src/lib/<id>-intent.ts`) is now a thin shim that re-exports from here,
 * keeping every existing call site working unchanged.
 *
 * Out of scope (not unified, because their return shapes differ):
 *   - game-intent.ts          — returns genre + multiplayer/3d/physics flags
 *   - high-stakes-intent.ts   — returns a HighStakesDomain enum
 *   - integration-request-intent.ts — returns N service names per turn
 */

export type SimpleIntentId =
  | "backend"
  | "payment"
  | "email"
  | "domain"
  | "seo"
  | "addPage"
  | "mobile"
  | "analytics"
  | "aiFeature"
  | "storage"
  | "realtime"
  | "cron";

export type IntentResult = {
  detected: boolean;
  /** Short reason snippet for the chip tooltip. */
  reason?: string;
};

type Rule = {
  id: SimpleIntentId;
  signals: RegExp[];
  minLength: number;
  /**
   * Optional secondary detector that runs only if no STRONG_SIGNALS matched.
   * Used for the backend "verb + entity" pair and the AI-feature
   * "provider + action" pair.
   */
  augment?: (text: string) => IntentResult | null;
};

// ---------------------------------------------------------------------------
// backend — entity + persist-verb pairing as an augment
// ---------------------------------------------------------------------------
const BACKEND_ENTITY_WORDS =
  /\b(post|posts|comment|comments|order|orders|booking|bookings|invoice|invoices|task|tasks|todo|todos|note|notes|message|messages|product|products|listing|listings|review|reviews|appointment|appointments|reservation|reservations|customer|customers|client|clients|profile|profiles|account|accounts)\b/i;
const BACKEND_PERSIST_VERBS =
  /\b(save|store|create|add|persist|track|manage|fetch|load|sync|update|delete)\b/i;

// ---------------------------------------------------------------------------
// ai-feature — provider names + action verbs as an augment
// ---------------------------------------------------------------------------
const AI_PROVIDER_NAMES =
  /\b(?:OpenAI|GPT-?[345]|ChatGPT|Claude|Anthropic|Gemini|Google AI|Mistral|Llama|DeepSeek|Perplexity)\b/i;
const AI_ACTION_VERBS =
  /\b(?:add|build|integrate|use|wire|set ?up|connect|call|hook (?:up|into)|via|with|using)\b/i;

const RULES: Record<SimpleIntentId, Rule> = {
  backend: {
    id: "backend",
    minLength: 12,
    signals: [
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
    ],
    augment: (t) => {
      if (BACKEND_PERSIST_VERBS.test(t) && BACKEND_ENTITY_WORDS.test(t)) {
        const entity = t.match(BACKEND_ENTITY_WORDS)?.[0]?.toLowerCase();
        return { detected: true, reason: entity ? `manage ${entity}` : undefined };
      }
      return null;
    },
  },

  payment: {
    id: "payment",
    minLength: 8,
    signals: [
      /\b(stripe|paddle|paystack|flutterwave|lemon ?squeezy|shopify pay|paypal)\b/i,
      /\baccept(?:ing)? payments?\b/i,
      /\btake (?:credit )?cards?\b/i,
      /\bcollect(?:ing)? payments?\b/i,
      /\bcharge (?:my |the )?(?:user|customer|client|visitor)s?\b/i,
      /\b(?:add|enable|set up|setup) (?:a )?(?:checkout|paywall|payment|payments|billing)\b/i,
      /\bcheckout (?:flow|page|button|session)\b/i,
      /\bpay(?:ment)?(?:s)? (?:flow|page|gateway|provider|integration|button|link)\b/i,
      /\bsubscriptions?\b/i,
      /\brecurring (?:billing|payments?|charges?)\b/i,
      /\b(?:monthly|yearly|annual) (?:plan|subscription|billing)\b/i,
      /\bpricing (?:tier|plan|page)s?\b/i,
      /\bpaywall\b/i,
      /\bupgrade (?:to )?(?:pro|premium|paid)\b/i,
      /\bfree trial\b/i,
      /\bsell (?:my |a |an |this )?(?:product|service|course|ebook|template|subscription|access|membership)\b/i,
      /\b(?:online )?(?:store|storefront|shop)\b/i,
      /\bdigital downloads?\b/i,
      /\b(?:e-?commerce|ecommerce)\b/i,
      /\b(?:add|build) (?:a )?(?:cart|shopping cart)\b/i,
      /\b(?:invoice|invoicing|receipt|refund|payout|donation|tip jar)s?\b/i,
    ],
  },

  email: {
    id: "email",
    minLength: 8,
    signals: [
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
    ],
  },

  domain: {
    id: "domain",
    minLength: 8,
    signals: [
      /\bcustom domain\b/i,
      /\bown domain\b/i,
      /\bmy (?:own )?domain\b/i,
      /\b(?:buy|purchase|register) (?:a |an |my )?(?:custom |new )?domain\b/i,
      /\b(?:connect|hook up|point|link) (?:a |my |the )?(?:custom )?domain\b/i,
      /\b(?:use|set up|setup) (?:a |my )?(?:custom )?domain\b/i,
      /\bDNS (?:records?|setup|config(?:uration)?)\b/i,
      /\bnameservers?\b/i,
      /\bpoint (?:my )?domain (?:to|at)\b/i,
    ],
  },

  seo: {
    id: "seo",
    minLength: 6,
    signals: [
      /\bSEO\b/i,
      /\bsearch engine\b/i,
      /\b(?:rank|ranking) (?:on |in )?Google\b/i,
      /\bgoogle (?:indexing|index|search|results)\b/i,
      /\bget(?:ting)? indexed\b/i,
      /\bmeta (?:tags?|description|title)\b/i,
      /\bopen ?graph\b/i,
      /\bog (?:image|tags?|title)\b/i,
      /\bshare (?:preview|card|image)\b/i,
      /\bsocial (?:preview|card|sharing)\b/i,
      /\btwitter card\b/i,
      /\bsitemap(?:\.xml)?\b/i,
      /\brobots\.txt\b/i,
      /\bcanonical (?:url|tag)\b/i,
      /\bstructured data\b/i,
      /\bJSON-?LD\b/i,
      /\bschema\.org\b/i,
      /\bdiscoverab(?:le|ility)\b/i,
    ],
  },

  addPage: {
    id: "addPage",
    minLength: 6,
    signals: [
      /\babout (?:us|page|section)\b/i,
      /\bpricing page\b/i,
      /\bcontact (?:us|page|form page)\b/i,
      /\bblog (?:page|index|section)?\b/i,
      /\bfaq page\b/i,
      /\bservices page\b/i,
      /\bportfolio page\b/i,
      /\bcareers? page\b/i,
      /\bteam page\b/i,
      /\bcase stud(?:y|ies)\b/i,
      /\bmulti[- ]?page\b/i,
      /\bseparate pages?\b/i,
      /\bits own page\b/i,
      /\bnew page\b/i,
      /\badd (?:an?|another) page\b/i,
      /\/(?:about|pricing|contact|blog|faq|services|portfolio|team|careers)\b/i,
    ],
  },

  mobile: {
    id: "mobile",
    minLength: 6,
    signals: [
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
    ],
  },

  analytics: {
    id: "analytics",
    minLength: 6,
    signals: [
      /\b(?:track|tracking) (?:visitors?|users?|page ?views?|clicks?|events?|conversions?)\b/i,
      /\b(?:visitor|page ?view|click|event|conversion) (?:tracking|analytics)\b/i,
      /\banalytics (?:dashboard|integration|tool|service|provider)?\b/i,
      /\b(?:plausible|posthog|mixpanel|amplitude|fathom|umami|simple ?analytics)\b/i,
      /\bgoogle analytics\b/i,
      /\bGA4?\b/,
      /\bheatmaps?\b/i,
      /\bfunnel(?:s| analysis)\b/i,
      /\bA\/?B test(?:ing|s)?\b/i,
      /\bsee (?:how many|who) (?:visit|visited|viewed|using)\b/i,
      /\bmeasure (?:traffic|engagement|usage)\b/i,
    ],
  },

  aiFeature: {
    id: "aiFeature",
    minLength: 8,
    signals: [
      /\b(?:add|build|integrate|wire (?:up|in)|set up|setup|implement) (?:an? )?(?:AI|chatbot|assistant|copilot|agent)/i,
      /\b(?:add|build|integrate|wire (?:up|in)|set up|setup|implement) (?:an? )?(?:chat|chatbot|assistant)\b/i,
      /\b(?:summari[sz]e|translate|paraphrase|rewrite|classify|extract|transcribe|moderate|generate|caption) (?:the |a |this |these )?(?:text|content|article|email|image|images?|audio|file|comment|review|message)/i,
      /\bAI[- ]powered\b/i,
      /\bask (?:an? )?AI\b/i,
      /\b(?:LLM|large language model)\b/i,
      /\b(?:image|text|content|copy) generation\b/i,
      /\b(?:auto|automatically) (?:summari[sz]e|translate|tag|caption|reply|respond)/i,
      /\bsemantic search\b/i,
      /\bembeddings?\b/i,
    ],
    augment: (t) => {
      if (AI_PROVIDER_NAMES.test(t) && AI_ACTION_VERBS.test(t)) {
        const provider = t.match(AI_PROVIDER_NAMES)?.[0]?.toLowerCase();
        return { detected: true, reason: provider ? `use ${provider}` : "use AI" };
      }
      return null;
    },
  },

  storage: {
    id: "storage",
    minLength: 8,
    signals: [
      /\b(?:upload|uploading) (?:an? |the )?(?:image|images?|photo|photos?|picture|pictures?|video|videos?|file|files?|pdf|document|documents?|attachment|attachments?|avatar|profile pic(?:ture)?)/i,
      /\b(?:user|profile) (?:avatar|photo|picture|image)\b/i,
      /\bdrag (?:and |&\s*)drop (?:upload|files?|images?)\b/i,
      /\battach(?: a)? file\b/i,
      /\b(?:image|file|media) (?:upload|hosting|storage|library|gallery)\b/i,
      /\bstore (?:images?|photos?|files?|pdfs?|videos?|user[- ]uploaded)/i,
      /\b(?:S3 bucket|cloud storage|object storage|CDN upload)\b/i,
      /\bsupabase storage\b/i,
    ],
  },

  realtime: {
    id: "realtime",
    minLength: 6,
    signals: [
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
    ],
  },

  cron: {
    id: "cron",
    minLength: 8,
    signals: [
      /\b(?:every|each) (?:minute|hour|day|night|morning|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
      /\b(?:daily|nightly|weekly|monthly|hourly) (?:digest|email|report|summary|reminder|sync|backup|cleanup|job|cron|task)\b/i,
      /\b(?:scheduled|schedule a|recurring) (?:email|job|task|reminder|report|notification|digest)\b/i,
      /\b(?:cron|cronjob|cron job|pg_?cron)\b/i,
      /\bbackground (?:job|task|worker|process)\b/i,
      /\b(?:auto|automatically) (?:send|email|notify|reset|clean ?up|expire|archive|sync|run)/i,
      /\b(?:reminder|digest) (?:email|notification)s?\b/i,
      /\brun (?:this |the |a )?(?:job|task|script) (?:every|once|on a schedule|periodically)/i,
      /\bperiodic(?:ally)?\b/i,
    ],
  },
};

/** Run a single intent rule against one piece of text. */
export function detectIntent(id: SimpleIntentId, text: string | null | undefined): IntentResult {
  if (!text) return { detected: false };
  const t = text.trim();
  const rule = RULES[id];
  if (t.length < rule.minLength) return { detected: false };

  for (const re of rule.signals) {
    const m = t.match(re);
    if (m) return { detected: true, reason: m[0].toLowerCase() };
  }
  if (rule.augment) {
    const aug = rule.augment(t);
    if (aug && aug.detected) return aug;
  }
  return { detected: false };
}

/** Convenience: run a rule across both the user turn and the assistant reply. */
export function detectIntentInTurn(
  id: SimpleIntentId,
  userText: string | null | undefined,
  assistantText: string | null | undefined,
): IntentResult {
  const a = detectIntent(id, userText);
  if (a.detected) return a;
  return detectIntent(id, assistantText);
}

/**
 * Run every registered rule against a turn and return the ids that fired.
 * Order matches RULES insertion order (backend first), which is the same
 * priority builder.tsx already uses when deciding which chip to render.
 *
 * Currently a convenience; the per-chip render branches in builder.tsx
 * still call detectIntentInTurn(id, …) individually so each branch can
 * apply its own UI-side gating (paid plan, dismissal set, etc.). Future
 * passes can collapse those branches further.
 */
export function detectIntents(
  userText: string | null | undefined,
  assistantText: string | null | undefined,
): SimpleIntentId[] {
  const out: SimpleIntentId[] = [];
  for (const id of Object.keys(RULES) as SimpleIntentId[]) {
    if (detectIntentInTurn(id, userText, assistantText).detected) out.push(id);
  }
  return out;
}
