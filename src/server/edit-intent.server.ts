/**
 * Targeted-edit resolver.
 *
 * When a user is iterating on an existing app ("change the hero headline to
 * X", "add a testimonials section under pricing", "remove the second card",
 * "rename Get Started to Try free"), the single thing that decides whether
 * Kimble lands the edit is: did the model SEE the exact bytes it needs to
 * quote in a `replace` op?
 *
 * The generic relevance heuristic in `trimFilesForPrompt` scores files by
 * loose token overlap and then TRUNCATES them, so the model routinely
 * writes `search` snippets from memory against a file whose tail it never
 * saw. Those ops fail to match and the turn silently under-delivers.
 *
 * This module fixes that upstream:
 *   1. Classify the edit verb (add / change / replace / remove / move /
 *      rename / restyle / fix / wire) so the prompt can carry verb-specific
 *      rules instead of one generic "make the change".
 *   2. Extract hard anchors from the message — quoted UI copy, PascalCase
 *      component names, explicit file paths, route paths, and section
 *      vocabulary ("hero", "footer", "pricing", ...).
 *   3. Locate those anchors in the real project bytes and rank the files
 *      that actually contain them.
 *   4. Emit a briefing block naming each target file, the anchor, and the
 *      line it lives on — plus the instruction to quote those bytes exactly.
 *
 * Everything here is deterministic string work: no I/O, no model call.
 */

import type { ProjectFile } from "./generate.server";

export type EditVerb =
  | "add"
  | "change"
  | "replace"
  | "remove"
  | "move"
  | "rename"
  | "restyle"
  | "fix"
  | "wire"
  | "unknown";

export interface AnchorHit {
  /** The literal text we searched for. */
  text: string;
  /** 1-based line number of the first occurrence. */
  line: number;
  /** How many times it occurs in this file. */
  count: number;
}

export interface EditTarget {
  path: string;
  score: number;
  reasons: string[];
  anchors: AnchorHit[];
}

export interface EditIntentResult {
  /** True when this reads like an edit to an existing app, not a fresh ask. */
  isTargetedEdit: boolean;
  verb: EditVerb;
  /** Literal strings we matched against project bytes. */
  anchors: string[];
  /** Section vocabulary detected ("hero", "pricing", ...). */
  sections: string[];
  targets: EditTarget[];
  /** Paths that must be force-included in prompt context, untruncated. */
  pinnedPaths: string[];
  /** Prompt block describing the targets, or "" when nothing resolved. */
  briefing: string;
}

/* ------------------------------------------------------------------ */
/* Verb classification                                                 */
/* ------------------------------------------------------------------ */

const VERB_PATTERNS: Array<[EditVerb, RegExp]> = [
  ["rename", /\b(rename|re-?label|re-?word|call it|change the (?:name|label|title|wording|copy|text) (?:of|to)|should (?:say|read))\b/i],
  ["remove", /\b(remove|delete|drop|get rid of|take (?:it |them |that )?(?:out|off)|hide|strip out|no longer (?:show|need))\b/i],
  ["replace", /\b(replace|swap(?: out)?|substitute|instead of|switch (?:it |this |that )?(?:to|for|with)|use .{1,40} instead)\b/i],
  ["move", /\b(move|reorder|re-?arrange|put (?:it|this|that|them) (?:above|below|before|after|under|on top)|drag|shift .{0,20}(?:up|down|above|below))\b/i],
  ["add", /\b(add|create|insert|include|introduce|append|bring in|put (?:in|a)|another|new (?:section|page|button|field|card|route|screen|tab|form|component))\b/i],
  ["restyle", /\b(restyle|re-?style|color|colour|font|spacing|padding|margin|rounded|shadow|gradient|theme|dark mode|bigger|smaller|bolder|align|centre|center|background)\b/i],
  ["wire", /\b(wire(?: up)?|hook (?:it )?up|connect|make (?:it|the button|the form) (?:work|functional|submit)|save to|persist|fetch from|link (?:it )?to)\b/i],
  ["fix", /\b(fix|broken|not working|doesn'?t work|bug|error|crash|misaligned|overlap|blank|empty)\b/i],
  ["change", /\b(change|update|edit|modify|adjust|tweak|make (?:it|the|this|that)|set (?:it|the)|increase|decrease|shorten|lengthen|improve)\b/i],
];

export function detectEditVerb(prompt: string): EditVerb {
  const text = prompt.slice(0, 2000);
  for (const [verb, re] of VERB_PATTERNS) {
    if (re.test(text)) return verb;
  }
  return "unknown";
}

/** Verb-specific instruction appended to the briefing. */
const VERB_RULES: Record<EditVerb, string> = {
  add: "This is an ADDITIVE ask. Keep everything that is already there. Insert the new markup/logic at the requested position with a `replace` op that quotes a nearby unique anchor and re-emits it together with the new block. Never re-send the whole file just to add something.",
  change: "This is a MODIFY ask. Change only the specific values/copy/props the user named. Every other line in the file must survive byte-identical.",
  replace: "This is a SWAP ask. Remove the old element and put the new one in its exact position, keeping surrounding layout, imports, and props intact.",
  remove: "This is a DELETION ask. Emit a `replace` op whose `search` is the exact block to delete and whose `replace` is the empty string (or just the surviving siblings). Also delete now-unused imports and helper state so nothing dangles.",
  move: "This is a REORDER ask. Emit two `replace` ops: one removing the block from its old position, one inserting the identical block at the new position. Do not rewrite the block's contents while moving it.",
  rename: "This is a RENAME/RE-WORD ask. Change every occurrence of the old string listed below — check each target file, not just the first one — and leave all structure untouched.",
  restyle: "This is a STYLING ask. Change classes/tokens only. Do not restructure JSX, rename props, or drop content while restyling.",
  fix: "This is a BUG-FIX ask. Find the actual defect in the bytes below, fix the smallest region that causes it, and do not opportunistically redesign anything else.",
  wire: "This is a WIRE-UP ask. Add the handler/state/data call and connect it to the existing element, keeping the current markup and styling in place.",
  unknown: "Make exactly the change the user described and nothing more.",
};

/* ------------------------------------------------------------------ */
/* Anchor extraction                                                   */
/* ------------------------------------------------------------------ */

/** Capitalized words that are almost never component names. */
const PASCAL_STOPWORDS = new Set([
  "I", "The", "This", "That", "Please", "Can", "Could", "Would", "Also", "And",
  "But", "For", "You", "Your", "We", "It", "Is", "Are", "Add", "Change", "Make",
  "Remove", "Move", "Fix", "Update", "Kimble", "Hi", "Hey", "Hello", "Now",
  "When", "Where", "What", "Why", "How", "Let", "Lets", "Let's", "OK", "Okay",
  "App", "Page", "Site", "UI", "UX", "API", "SEO", "CSS", "HTML", "JSON",
]);

const SECTION_VOCAB: Record<string, string[]> = {
  hero: ["hero", "banner", "masthead", "above the fold"],
  nav: ["nav", "navbar", "navigation", "menu", "header"],
  footer: ["footer"],
  pricing: ["pricing", "plans", "tiers", "subscription card"],
  faq: ["faq", "frequently asked", "questions section"],
  testimonial: ["testimonial", "reviews", "social proof"],
  cta: ["cta", "call to action", "call-to-action"],
  contact: ["contact", "get in touch"],
  about: ["about", "our story", "mission"],
  features: ["features", "benefits", "what you get"],
  gallery: ["gallery", "portfolio", "showcase", "carousel"],
  blog: ["blog", "articles", "posts"],
  dashboard: ["dashboard", "admin panel", "overview screen"],
  auth: ["login", "log in", "sign in", "signin", "sign up", "signup", "auth", "register"],
  checkout: ["checkout", "cart", "basket", "payment form"],
  profile: ["profile", "account page", "my account"],
  settings: ["settings", "preferences"],
  sidebar: ["sidebar", "side nav", "drawer"],
  modal: ["modal", "dialog", "popup", "popover"],
  form: ["form", "input field", "text field"],
  table: ["table", "data grid", "list view"],
  chart: ["chart", "graph", "analytics widget"],
};

function extractQuoted(prompt: string): string[] {
  const out: string[] = [];
  const patterns = [
    /"([^"\n]{2,90})"/g,
    /'([^'\n]{2,90})'/g,
    /[“”]([^“”\n]{2,90})[“”]/g,
    /[‘’]([^‘’\n]{2,90})[‘’]/g,
    /`([^`\n]{2,90})`/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(prompt))) {
      const v = m[1].trim();
      if (v.length >= 2) out.push(v);
    }
  }
  return out;
}

function extractFilePaths(prompt: string): string[] {
  const out: string[] = [];
  const re = /\b([\w./-]*[\w-]+\.(?:tsx|ts|jsx|js|css|json|html|svg))\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt))) out.push(m[1]);
  return out;
}

function extractPascal(prompt: string): string[] {
  const out: string[] = [];
  const re = /\b([A-Z][a-z0-9]+(?:[A-Z][a-zA-Z0-9]*)+|[A-Z][a-zA-Z0-9]{2,})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt))) {
    const w = m[1];
    if (PASCAL_STOPWORDS.has(w)) continue;
    out.push(w);
  }
  return out;
}

function extractRoutes(prompt: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\s)(\/[a-z0-9][a-z0-9\-/]{1,40})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt))) out.push(m[1].replace(/[.,;]$/, ""));
  return out;
}

function detectSections(prompt: string): string[] {
  const lower = prompt.toLowerCase();
  const hits: string[] = [];
  for (const [key, words] of Object.entries(SECTION_VOCAB)) {
    if (words.some((w) => lower.includes(w))) hits.push(key);
  }
  return hits;
}

/* ------------------------------------------------------------------ */
/* Matching anchors against real project bytes                         */
/* ------------------------------------------------------------------ */

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
}

function countOccurrences(haystack: string, needle: string): { count: number; first: number } {
  let count = 0;
  let first = -1;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    if (first === -1) first = idx;
    count++;
    from = idx + needle.length;
    if (count > 200) break;
  }
  return { count, first };
}

/** Files Kimble owns and must never hand to the model as an edit target. */
function isKitPath(path: string): boolean {
  return (
    path.startsWith("src/components/ui/") ||
    path.startsWith("src/components/blocks/") ||
    path.startsWith("src/components/examples/") ||
    path.startsWith("src/components/mobile/") ||
    path.startsWith("src/integrations/") ||
    path.startsWith("node_modules/")
  );
}

const MAX_TARGETS = 8;
const SCORE_FLOOR = 18;

export function resolveEditIntent(
  prompt: string,
  files: ProjectFile[],
): EditIntentResult {
  const empty: EditIntentResult = {
    isTargetedEdit: false,
    verb: "unknown",
    anchors: [],
    sections: [],
    targets: [],
    pinnedPaths: [],
    briefing: "",
  };
  if (!prompt || files.length === 0) return empty;

  const text = prompt.slice(0, 6000);
  const verb = detectEditVerb(text);
  const quoted = extractQuoted(text);
  const filePaths = extractFilePaths(text);
  const pascal = extractPascal(text);
  const routes = extractRoutes(text);
  const sections = detectSections(text);

  // Literal anchors, strongest first. Quoted copy is the single most
  // reliable signal: the user is pointing at bytes they can see on screen.
  const literals = Array.from(
    new Set([...quoted, ...filePaths, ...pascal, ...routes].map((s) => s.trim()).filter(Boolean)),
  ).slice(0, 24);

  const candidates = files.filter((f) => !isKitPath(f.path));
  const scored: EditTarget[] = [];

  for (const file of candidates) {
    let score = 0;
    const reasons: string[] = [];
    const anchors: AnchorHit[] = [];
    const content = file.content;
    const lowerPath = file.path.toLowerCase();
    const base = file.path.split("/").pop() ?? file.path;

    for (const lit of literals) {
      const isQuoted = quoted.includes(lit);
      const isPath = filePaths.includes(lit);
      const isRoute = routes.includes(lit);

      // Explicit file mention wins outright.
      if (isPath && (file.path === lit || file.path.endsWith(`/${lit}`) || base === lit)) {
        score += 120;
        reasons.push(`user named this file (${lit})`);
        continue;
      }

      const { count, first } = countOccurrences(content, lit);
      if (count > 0) {
        const weight = isQuoted ? 60 : isRoute ? 34 : 26;
        score += weight + Math.min(count - 1, 3) * 4;
        anchors.push({ text: lit, line: lineOf(content, first), count });
        reasons.push(
          isQuoted
            ? `contains the exact text "${lit}"`
            : `references ${lit}`,
        );
        continue;
      }

      // Case-insensitive fallback for copy the user retyped loosely.
      if (isQuoted && lit.length >= 4) {
        const ciIdx = content.toLowerCase().indexOf(lit.toLowerCase());
        if (ciIdx !== -1) {
          score += 34;
          anchors.push({ text: content.slice(ciIdx, ciIdx + lit.length), line: lineOf(content, ciIdx), count: 1 });
          reasons.push(`contains "${lit}" (different casing)`);
          continue;
        }
      }

      // Component name mentioned but not present as text — maybe it IS this file.
      if (!isQuoted && base.toLowerCase().startsWith(lit.toLowerCase())) {
        score += 70;
        reasons.push(`filename matches ${lit}`);
      }
    }

    for (const section of sections) {
      const words = SECTION_VOCAB[section] ?? [section];
      if (words.some((w) => lowerPath.includes(w.replace(/\s+/g, "")))) {
        score += 40;
        reasons.push(`path looks like the ${section} surface`);
        continue;
      }
      const lowerContent = content.toLowerCase();
      if (words.some((w) => lowerContent.includes(w))) {
        score += 10;
        reasons.push(`mentions ${section}`);
      }
    }

    if (score >= SCORE_FLOOR) {
      scored.push({ path: file.path, score, reasons: Array.from(new Set(reasons)).slice(0, 4), anchors: anchors.slice(0, 6) });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const targets = scored.slice(0, MAX_TARGETS);

  if (targets.length === 0) {
    return { ...empty, verb, anchors: literals, sections };
  }

  return {
    isTargetedEdit: true,
    verb,
    anchors: literals,
    sections,
    targets,
    pinnedPaths: targets.map((t) => t.path),
    briefing: renderEditTargetBlock({ verb, targets }),
  };
}

/* ------------------------------------------------------------------ */
/* Prompt block                                                        */
/* ------------------------------------------------------------------ */

export function renderEditTargetBlock(args: {
  verb: EditVerb;
  targets: EditTarget[];
}): string {
  const { verb, targets } = args;
  if (targets.length === 0) return "";

  const lines = targets.map((t) => {
    const anchorText = t.anchors.length
      ? t.anchors
          .map((a) => `line ${a.line}: ${JSON.stringify(a.text.slice(0, 60))}${a.count > 1 ? ` (${a.count}×)` : ""}`)
          .join("; ")
      : t.reasons[0] ?? "closest match for this request";
    return `- \`${t.path}\` — ${anchorText}`;
  });

  return [
    "",
    "",
    "### Targeted edit — resolved files",
    `Kimble matched this request against the real project bytes. Edit verb: **${verb}**.`,
    "",
    "The user is pointing at these files (their FULL current contents are included above, untrimmed):",
    ...lines,
    "",
    VERB_RULES[verb],
    "",
    "Rules for this turn:",
    "- Emit `replace` ops against the files listed above. Copy the `search` snippet character-for-character out of the contents shown above — do NOT retype it from memory, and do NOT quote a line you cannot see.",
    "- If the same anchor appears more than once in a file, widen the `search` snippet with surrounding lines until it is unique rather than guessing.",
    "- Touch only what the request implies. Files not listed above should not appear in your ops unless the change genuinely requires them (e.g. a new component needs an import in its parent).",
    "- If the request needs a brand-new file, `create` it AND emit the `replace` op that imports/renders it — an orphan file is not a completed edit.",
    "- Do not ask the user which file they meant: the resolution above is the answer.",
  ].join("\n");
}
