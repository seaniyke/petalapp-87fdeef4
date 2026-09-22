/**
 * Change-set extraction (Edit Intelligence, phase 1).
 *
 * A single user message is rarely a single change:
 *
 *   "Make the hero darker, change the headline, replace the illustration,
 *    make the CTA larger and give the section a more premium feel — but
 *    don't touch the pricing."
 *
 * That is five requested changes plus one preservation constraint. Kimble used
 * to send the whole sentence to the model and hope every clause landed; when
 * three of five landed the turn still reported success, and the user had to
 * come back with "you forgot the navbar".
 *
 * This module turns the message into an explicit, checkable list:
 *   - `items`    — the individual requested changes, each with a target and a
 *                  kind (visual / content / behaviour / data / navigation /
 *                  responsive).
 *   - `preserve` — the things the user explicitly said must NOT change.
 *
 * Deterministic string work only: no model call, no I/O. It runs on every edit
 * turn, so it must be free and it must never throw. The audit pass
 * (`edit-audit.server.ts`) checks the resulting list against the real byte
 * diff after the edit lands.
 */

export type ChangeKind =
  | "visual"
  | "content"
  | "behaviour"
  | "data"
  | "navigation"
  | "responsive";

export interface ChangeItem {
  /** 1-based index, stable for the life of the turn. */
  id: number;
  /** The clause as the user wrote it, trimmed. */
  text: string;
  /** Best-effort surface/element the clause is about ("hero", "navbar", …). */
  target: string | null;
  kind: ChangeKind;
  /** Lowercased tokens used by the audit to look for evidence in the diff. */
  keywords: string[];
}

export interface PreserveItem {
  /** What must not change, as the user described it. */
  text: string;
  /** Best-effort surface/element token. */
  target: string | null;
}

export interface ChangeSet {
  items: ChangeItem[];
  preserve: PreserveItem[];
  /** True when the message asked for more than one distinct change. */
  multi: boolean;
}

/** Surface vocabulary users actually type. Order matters: longest first. */
const SURFACES = [
  "hero section",
  "hero banner",
  "landing page",
  "home page",
  "homepage",
  "sign up page",
  "signup page",
  "sign in page",
  "login page",
  "checkout page",
  "pricing section",
  "pricing cards",
  "pricing card",
  "testimonials",
  "testimonial",
  "navigation bar",
  "nav bar",
  "navbar",
  "navigation",
  "side bar",
  "sidebar",
  "top bar",
  "topbar",
  "header",
  "footer",
  "hero",
  "pricing",
  "dashboard",
  "checkout",
  "cart",
  "profile",
  "settings",
  "contact form",
  "contact",
  "gallery",
  "faq",
  "features",
  "feature cards",
  "cards",
  "card",
  "buttons",
  "button",
  "cta",
  "headline",
  "heading",
  "title",
  "subtitle",
  "logo",
  "menu",
  "modal",
  "table",
  "form",
  "search",
  "filters",
  "filter",
  "login",
  "logout",
  "signup",
  "onboarding",
  "blog",
  "about",
  "image",
  "illustration",
  "photo",
  "background",
  "colors",
  "colours",
  "palette",
  "font",
  "typography",
  "spacing",
];

const KIND_PATTERNS: Array<{ kind: ChangeKind; re: RegExp }> = [
  {
    kind: "responsive",
    // "phone number" / "phone call" is contact content, not a screen size.
    re: /\b(mobile|phones?(?!\s*(?:numbers?|calls?|lines?))|tablet|responsive|small screens?|breakpoints?)\b/i,
  },
  {
    kind: "data",
    re: /\b(database|table|schema|save[sd]?|saving|store[sd]?|storage|record|persist|supabase|backend|api|auth|sign\s?-?\s?(in|up)|login|logout|account|upload)\b/i,
  },
  {
    kind: "navigation",
    re: /\b(link|links|route|routes|navigate|navigation|menu|redirect|page flow|breadcrumb)\b/i,
  },
  {
    kind: "behaviour",
    re: /\b(work|works|working|fix|broken|clickable|submits?|submit|validate|validation|filter|filtering|sort|search|enable|disable|toggle|loading|error state)\b/i,
  },
  {
    kind: "content",
    re: /\b(headline|heading|title|subtitle|copy|text|wording|word|label|caption|says?|rename|rewrite|replace .*(text|copy|wording)|placeholder|price|pricing text)\b/i,
  },
  {
    kind: "visual",
    re: /\b(dark|darker|light|lighter|colou?r|bigger|larger|smaller|rounded|shadow|spacing|padding|margin|font|typography|style|styling|look|feel|premium|modern|clean|layout|image|illustration|photo|icon|background|gradient|animate|animation|design|theme)\b/i,
  },
];

/** Verbs that mean "please change something". */
const CHANGE_VERB =
  /\b(make|change|update|replace|swap|add|remove|delete|drop|move|rename|fix|improve|redesign|restyle|resize|increase|decrease|shrink|enlarge|darken|lighten|tighten|round|soften|hide|show|wire|connect|enable|disable|use|set|give|put|center|centre|align|reorder|rewrite|translate|clean)\b/i;

/** Clauses that describe something that must NOT change. */
const PRESERVE_RE =
  /\b(?:but\s+)?(?:don'?t|do not|never|without)\s+(?:change|changing|touch|touching|alter|altering|modify|modifying|break|breaking|remove|removing|move|moving)\b|\bkeep\s+(?:the\s+)?[^,.;]{2,60}?\s+(?:exactly\s+)?(?:as is|as-is|as (?:it|they) (?:is|are)|the same|unchanged|untouched|intact|where (?:it|they) (?:is|are))\b|\bleave\s+(?:the\s+)?[^,.;]{2,60}?\s+(?:alone|as (?:it|they) (?:is|are)|untouched)\b|\bpreserv(?:e|ing)\b|\bkeep\s+(?:the\s+)?(?:current|existing)\b/i;

function splitClauses(prompt: string): string[] {
  const normalised = prompt
    .replace(/\r/g, "")
    // Bullets and numbered lists become clause boundaries.
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "\n");

  const parts = normalised
    .split(/\n+|(?<=[.!?])\s+|\s*;\s*|\s*,\s*(?=(?:and|also|then|plus)\b)|\s*,\s*|\s+(?:and\s+also|and\s+then|and|also|plus|as well as|while)\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);

  return parts;
}

function findSurface(text: string): string | null {
  const lower = text.toLowerCase();
  for (const s of SURFACES) {
    if (new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lower)) return s;
  }
  // Explicit file or component name.
  const comp = text.match(/\b([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+)\b/);
  if (comp) return comp[1]!;
  const route = text.match(/\s(\/[a-z0-9\-/]{1,40})/i);
  if (route) return route[1]!;
  return null;
}

function classifyKind(text: string): ChangeKind {
  for (const { kind, re } of KIND_PATTERNS) {
    if (re.test(text)) return kind;
  }
  return "visual";
}

const STOP = new Set([
  "the","a","an","and","also","but","please","make","change","it","its","to","of","on","in","for","with","that","this","then","too","more","less","be","is","are","my","our","your","all","some","very","really","just","now","can","you","i","we","should","would","like","want","need","them","they",
]);

function keywordsFor(text: string, target: string | null): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9/\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
  const out = new Set<string>();
  if (target) {
    for (const t of target.toLowerCase().split(/\s+/)) if (t.length >= 3) out.add(t);
  }
  for (const w of words.slice(0, 10)) out.add(w);
  // Quoted copy is the strongest signal of all.
  for (const m of text.matchAll(/["'“”‘’]([^"'“”‘’]{2,60})["'“”‘’]/g)) {
    out.add(m[1]!.toLowerCase().trim());
  }
  return Array.from(out);
}

/**
 * Split a user message into the complete set of requested changes plus the
 * things they explicitly asked Kimble to leave alone.
 */
export function extractChangeSet(prompt: string): ChangeSet {
  const items: ChangeItem[] = [];
  const preserve: PreserveItem[] = [];
  const raw = (prompt ?? "").trim();
  if (!raw) return { items, preserve, multi: false };

  const clauses = splitClauses(raw);
  const seen = new Set<string>();

  for (const clause of clauses) {
    const text = clause.replace(/^(?:and|also|then|plus|but)\s+/i, "").trim();
    if (text.length < 3) continue;

    if (PRESERVE_RE.test(text)) {
      preserve.push({ text, target: findSurface(text) });
      continue;
    }

    const target = findSurface(text);
    const looksLikeChange = CHANGE_VERB.test(text) || target !== null;
    if (!looksLikeChange) continue;

    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    items.push({
      id: items.length + 1,
      text,
      target,
      kind: classifyKind(text),
      keywords: keywordsFor(text, target),
    });
    if (items.length >= 12) break;
  }

  // A message with no recognisable clause structure is still one change.
  if (items.length === 0 && CHANGE_VERB.test(raw)) {
    const target = findSurface(raw);
    items.push({
      id: 1,
      text: raw.slice(0, 300),
      target,
      kind: classifyKind(raw),
      keywords: keywordsFor(raw, target),
    });
  }

  return { items, preserve, multi: items.length > 1 };
}

/**
 * Prompt block naming every requested change and every preservation rule, so
 * the model is working from an explicit checklist instead of one long
 * sentence. Returns "" when there is nothing worth saying.
 */
export function renderChangeSetBlock(cs: ChangeSet): string {
  if (cs.items.length < 2 && cs.preserve.length === 0) return "";
  const lines: string[] = ["", "REQUESTED CHANGES — every one of these must land in this turn:"];
  cs.items.forEach((it) => {
    const target = it.target ? ` [target: ${it.target}]` : "";
    lines.push(`${it.id}. ${it.text}${target} (${it.kind})`);
  });
  if (cs.preserve.length > 0) {
    lines.push("", "MUST NOT CHANGE — the user explicitly asked you to leave these alone:");
    for (const p of cs.preserve) {
      lines.push(`- ${p.text}${p.target ? ` [${p.target}]` : ""}`);
    }
  }
  lines.push(
    "",
    "Answering only the first item is a failed turn. In your recap, account for every numbered item above.",
  );
  return lines.join("\n");
}

/** Kimble-owned files the model is never handed as an edit target. */
function isKitFile(path: string): boolean {
  return (
    path.startsWith("src/components/ui/") ||
    path.startsWith("src/components/blocks/") ||
    path.startsWith("src/components/examples/") ||
    path.startsWith("src/components/mobile/") ||
    path.startsWith("src/integrations/")
  );
}

/**
 * A requested surface sometimes only exists inside a Kimble-owned kit file — the
 * app's navbar is `src/components/blocks/nav-bar.tsx`, which the model may not
 * edit. Left alone, "shrink the navbar" simply cannot land: the model has no
 * file to change and the audit records an honest but avoidable miss.
 *
 * So we tell it where the component is used and that the change must be made at
 * the call site (props, className, a wrapper), which every kit block supports.
 */
export function kitTargetGuidance(
  cs: ChangeSet,
  files: Array<{ path: string; content: string }>,
): string {
  const notes: string[] = [];
  for (const item of cs.items) {
    const target = item.target?.toLowerCase().replace(/\s+/g, "");
    if (!target || target.length < 3) continue;
    const kitMatches = files
      .filter((f) => isKitFile(f.path))
      .filter((f) => {
        const base = f.path.split("/").pop()!.replace(/\.[jt]sx?$/, "").replace(/[-_]/g, "");
        return base.includes(target) || target.includes(base);
      })
      .slice(0, 2);
    if (kitMatches.length === 0) continue;
    const appMatches = files.filter(
      (f) => !isKitFile(f.path) && kitMatches.some((k) => f.content.includes(k.path.replace(/^src\//, "@/").replace(/\.[jt]sx?$/, ""))),
    );
    if (appMatches.length === 0) continue;
    notes.push(
      `- "${item.text}" concerns ${kitMatches.map((k) => k.path).join(", ")}, which you must NOT edit. ` +
        `Make the change where it is used instead (${appMatches.slice(0, 3).map((f) => f.path).join(", ")}) ` +
        `via props, a className, or a wrapper element. Saying it cannot be done is not an option.`,
    );
  }
  if (notes.length === 0) return "";
  return `\n\nTARGETS THAT LIVE IN PETAL-OWNED COMPONENTS:\n${notes.join("\n")}`;
}
