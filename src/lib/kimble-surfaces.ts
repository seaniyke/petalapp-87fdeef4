/**
 * Kimble's map of itself.
 *
 * Kimble already reads a message for *app-building* intent ("needs a
 * database", "mentions uploads") in `intent-registry.ts`. This is the second,
 * separate read: *product* intent — the user asking for something Kimble the
 * product offers ("I want a domain", "who signed up?", "how many credits do I
 * have left?").
 *
 * One table lists every area Kimble can open, what it is for in plain words,
 * and the phrases that mean it. The same table is used three ways:
 *   1. the detector below decides which area a message is asking for,
 *   2. the prompt block lets Kimble answer as the owner of that area,
 *   3. the builder opens it.
 *
 * Design rules:
 *  - Pure and deterministic. No AI call, no network, no imports beyond types.
 *  - Fires only on a first-person request about THIS project. A build
 *    instruction ("a marketplace where people buy domains") must never open
 *    Kimble's own domain screen.
 *  - At most one surface per message. Ambiguity means silence, not a guess.
 */

export type SurfaceId =
  | "domains"
  | "publish"
  | "credits"
  | "cloud"
  | "cloud.database"
  | "cloud.users"
  | "cloud.storage"
  | "cloud.secrets"
  | "cloud.logs"
  | "cloud.ai"
  | "payments"
  | "integrations"
  | "analytics"
  | "website-info"
  | "mobile"
  | "history"
  | "code"
  | "share"
  | "security"
  | "settings";

export type Surface = {
  id: SurfaceId;
  /** What the user calls it. */
  label: string;
  /** One plain sentence: what this area is for. */
  purpose: string;
  /** Phrases that mean this area. */
  triggers: RegExp[];
  /**
   * True when finishing the job needs the user's own money or an outside
   * account. Kimble opens the screen and names the one manual step; it never
   * completes the purchase or the connection.
   */
  needsUser?: boolean;
};

/**
 * Ordered most specific first: "app users" must win over the generic Cloud
 * entry, and "AI usage" over "credits".
 */
export const SURFACES: Surface[] = [
  {
    id: "cloud.users",
    label: "your app's users",
    purpose: "everyone who has signed up inside the app you built",
    triggers: [
      /\b(?:who|how many|which)\b[^.?!]{0,40}\b(?:signed[- ]?up|registered|users?|members?|accounts?)\b/i,
      /\b(?:my|the|our|app'?s?)\s+(?:app'?s?\s+)?(?:users?|members?|signups?|sign[- ]?ups?)\b/i,
      /\buser\s+list\b/i,
    ],
  },
  {
    id: "cloud.database",
    label: "your database",
    purpose: "the tables and rows your app has saved",
    triggers: [
      /\b(?:see|show|open|view|check|browse|inspect)\b[^.?!]{0,30}\b(?:database|tables?|rows?|records?|the data)\b/i,
      /\b(?:my|our|the)\s+(?:database|tables?)\b/i,
    ],
  },
  {
    id: "cloud.storage",
    label: "your files",
    purpose: "files your app's users have uploaded",
    triggers: [
      /\b(?:uploaded|stored)\s+files?\b/i,
      /\b(?:file|image)\s+storage\b/i,
      /\bstorage\s+(?:bucket|usage)\b/i,
    ],
  },
  {
    id: "cloud.secrets",
    label: "your secrets",
    purpose: "API keys and private values your app needs",
    triggers: [
      /\b(?:add|set|store|update|change|where).{0,24}\b(?:api key|secret key|secrets?|env(?:ironment)? variables?)\b/i,
      /\bsecrets?\s+(?:panel|screen|manager)\b/i,
    ],
  },
  {
    id: "cloud.logs",
    label: "your logs",
    purpose: "what your app's backend has been doing, including errors",
    triggers: [
      /\b(?:server|backend|error|function)\s+logs?\b/i,
      /\b(?:see|show|check|open|view)\b[^.?!]{0,20}\blogs?\b/i,
    ],
  },
  {
    id: "cloud.ai",
    label: "AI usage",
    purpose: "how much AI your app has used",
    triggers: [/\bai\s+(?:usage|spend|calls?|tokens?)\b/i, /\bhow much ai\b/i],
  },
  {
    id: "domains",
    label: "domains",
    purpose: "buy a web address or connect one you already own",
    needsUser: true,
    triggers: [
      /\b(?:custom\s+)?domains?\b/i,
      /\bweb\s+address\b/i,
      /\b(?:connect|point|hook up|attach|use)\b[^.?!]{0,30}\b(?:\.com|\.co|\.io|\.app|\.dev|\.cloud|\.net|\.org|\.ng)\b/i,
      /\bdns\b/i,
    ],
  },
  {
    id: "credits",
    label: "credits and plan",
    purpose: "your balance, top-ups, your plan, and where credits went",
    needsUser: true,
    triggers: [
      /\bcredits?\b/i,
      /\btop[- ]?up\b/i,
      /\b(?:my|our)\s+(?:plan|balance|subscription)\b/i,
      /\b(?:upgrade|downgrade|cancel)\b[^.?!]{0,20}\b(?:plan|subscription)\b/i,
      /\bhow much (?:do|will) (?:i|this|it) (?:pay|cost|owe)\b/i,
      /\b(?:billing|invoices?|receipts?)\b/i,
    ],
  },
  {
    id: "mobile",
    label: "mobile builds",
    purpose: "build and download the iOS or Android app",
    triggers: [
      /\b(?:app ?store|play ?store|test ?flight)\b/i,
      /\b(?:ios|android|apk|ipa)\s+(?:build|app|version|file|download)\b/i,
      /\b(?:build|download|ship|publish)\b[^.?!]{0,24}\b(?:ios|android|apk|ipa)\b/i,
    ],
  },
  {
    id: "publish",
    label: "publish",
    purpose: "put the app live and see its link",
    triggers: [
      /\b(?:publish|go live|deploy|ship it|make it live|put it live)\b/i,
      /\b(?:live|public)\s+(?:link|url|site)\b/i,
    ],
  },
  {
    id: "payments",
    label: "payments",
    purpose: "let the app you built take money",
    needsUser: true,
    triggers: [
      /\b(?:stripe|paystack|paddle)\b/i,
      /\b(?:take|accept|collect|receive)\b[^.?!]{0,20}\b(?:payments?|money|cards?)\b/i,
      /\b(?:payment|checkout)\s+(?:provider|account|setup|settings?)\b/i,
    ],
  },
  {
    id: "integrations",
    label: "integrations",
    purpose: "connect outside services like email, analytics and storage",
    triggers: [
      /\b(?:resend|plausible|posthog|sendgrid|twilio|mailgun|cloudinary)\b/i,
      /\b(?:integrations?|connectors?)\b/i,
      /\bconnect\b[^.?!]{0,20}\b(?:service|tool|account|api)\b/i,
    ],
  },
  {
    id: "analytics",
    label: "analytics",
    purpose: "visitors and traffic for your published app",
    triggers: [
      /\b(?:analytics|traffic|visitors?|page ?views?)\b/i,
      /\bhow many people (?:have )?(?:visited|viewed)\b/i,
    ],
  },
  {
    id: "website-info",
    label: "website info",
    purpose: "the title, description and social preview people see when you share a link",
    triggers: [
      /\b(?:seo|meta ?tags?|open ?graph|og ?image)\b/i,
      /\b(?:social|link)\s+preview\b/i,
      /\b(?:site|page|website)\s+(?:title|description)\b/i,
    ],
  },
  {
    id: "history",
    label: "history",
    purpose: "every checkpoint of this project, and going back to one",
    triggers: [
      /\b(?:version\s+)?history\b/i,
      /\b(?:revert|roll ?back|restore|undo)\b[^.?!]{0,24}\b(?:version|checkpoint|change|build|yesterday|earlier)\b/i,
      /\bprevious\s+version\b/i,
    ],
  },
  {
    id: "share",
    label: "sharing",
    purpose: "a preview link others can open and comment on",
    triggers: [
      /\bshare\b[^.?!]{0,24}\b(?:link|preview|project|app|with)\b/i,
      /\b(?:preview|feedback)\s+link\b/i,
    ],
  },
  {
    id: "security",
    label: "security review",
    purpose: "Kimble Shield's review of this project",
    triggers: [
      /\b(?:security|shield)\s+(?:review|audit|check|scan|report)\b/i,
      /\bis (?:my|this) app secure\b/i,
    ],
  },
  {
    id: "code",
    label: "code and files",
    purpose: "the actual source files of your app",
    triggers: [
      /\b(?:show|see|open|view|download|export)\b[^.?!]{0,20}\b(?:the\s+)?(?:code|source|files?|repo)\b/i,
    ],
  },
  {
    id: "cloud",
    label: "Kimble Cloud",
    purpose: "your app's database, sign-ins, files, secrets and logs",
    triggers: [
      /\b(?:kimble\s+)?cloud\s+(?:panel|screen|settings?|hub)\b/i,
      /\bopen\b[^.?!]{0,16}\bcloud\b/i,
      /\bmy\s+backend\b/i,
    ],
  },
  {
    id: "settings",
    label: "project settings",
    purpose: "the project's name, visibility, instructions and memory",
    triggers: [
      /\bproject\s+settings?\b/i,
      /\b(?:rename|make it private|make this private|make it public)\b/i,
      /\bwhat (?:do )?you remember\b/i,
    ],
  },
];

const BY_ID = new Map<SurfaceId, Surface>(SURFACES.map((s) => [s.id, s]));

export function getSurface(id: SurfaceId): Surface | undefined {
  return BY_ID.get(id);
}

/**
 * The user is asking Kimble for something, not describing an app to build.
 * One of these has to be present before anything opens.
 */
const REQUEST_CUES = [
  /\bi\s+(?:want|need|would like|wanna)\b/i,
  /\b(?:can|could|will|would)\s+(?:you|i|we)\b/i,
  /\b(?:how|where)\s+(?:do|can|would|should)\s+i\b/i,
  /\bwhere('?s| is| are)\b/i,
  /\b(?:show|give|take|get|let)\s+me\b/i,
  /\bopen\b/i,
  /\bhow (?:many|much)\b/i,
  /\bwho\s+(?:has\s+)?(?:signed|registered)\b/i,
  /\bmy\b/i,
  /^\s*(?:check|see|view|manage|set ?up|add|connect|buy)\b/i,
];

/**
 * Phrasing that means "build this into my app", which must never open one of
 * Kimble's own screens. Checked before everything else.
 */
const BUILD_CUES = [
  /\b(?:build|make|create|add|generate|design|code)\s+(?:me\s+)?(?:a|an|the)\s+(?:app|site|website|page|landing|dashboard|tool|platform|marketplace|store|shop|clone)\b/i,
  /\b(?:app|site|website|platform|marketplace|page)\s+(?:that|where|which|to)\b/i,
  /\b(?:users?|people|customers?|visitors?)\s+(?:can|should|will|could)\b/i,
  /\blike\s+(?:airbnb|uber|shopify|notion|stripe)\b/i,
];

export type SurfaceSignal = {
  surface: Surface;
  /** The phrase that matched, for logging and prompt context. */
  matched: string;
};

/**
 * Decide which part of Kimble a message is asking for. Returns null far more
 * often than not — that is the point.
 */
export function detectSurfaceIntent(
  text: string | null | undefined,
): SurfaceSignal | null {
  const raw = (text ?? "").trim();
  if (raw.length < 4 || raw.length > 2000) return null;

  for (const cue of BUILD_CUES) if (cue.test(raw)) return null;
  if (!REQUEST_CUES.some((cue) => cue.test(raw))) return null;

  for (const surface of SURFACES) {
    for (const trigger of surface.triggers) {
      const hit = raw.match(trigger);
      if (hit) return { surface, matched: hit[0] };
    }
  }
  return null;
}

/**
 * The block that makes Kimble answer as the owner of the area rather than as
 * a guide describing a product. Empty string when nothing was detected.
 */
export function renderSurfaceBlock(signal: SurfaceSignal | null): string {
  if (!signal) return "";
  const { surface } = signal;
  const lines = [
    "",
    "## THE USER IS ASKING FOR PART OF KIMBLE ITSELF",
    `They are asking about **${surface.label}** — ${surface.purpose}.`,
    "It is opening on their screen right now. Answer as the owner of it, in one or two short sentences:",
    "- Say it is open and what they will see. Never tell them where to click, never say \"you can find it under…\", never describe Kimble in the third person.",
    "- Do not ask them a question about it.",
  ];
  if (surface.needsUser) {
    lines.push(
      "- This one needs their own money or their own account. Name that single step plainly in one sentence, and make clear nothing has been bought, charged or connected.",
    );
  }
  lines.push("");
  return lines.join("\n");
}

/** The whole map, for Kimble's self-knowledge. */
export function renderSurfaceMap(): string {
  const rows = SURFACES.filter((s) => !s.id.startsWith("cloud."))
    .map((s) => `- **${s.label}** — ${s.purpose}.`)
    .join("\n");
  return `\n\nWHAT KIMBLE CAN OPEN FOR THE USER (you own all of these — when one is asked for, it opens automatically; never send the user hunting for it):\n${rows}\n- Inside Kimble Cloud: the database, the app's signed-up users, uploaded files, secrets and logs.\nNever say Kimble "supports" or "offers" these as if describing someone else's product, and never invent a screen that is not on this list.\n`;
}
