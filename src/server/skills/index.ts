/**
 * Skill selection and rendering.
 *
 * Deterministic: no model call, no network, no I/O. Cheap enough to run on
 * every turn, which is the point — the expensive part was loading everything.
 */
import { SKILLS } from "./catalog";
import type { Skill, SkillContext, SkillId } from "./types";
import { loadColorGuide, loadSkillKnowledge } from "@/server/agent-knowledge";

export type { Skill, SkillContext, SkillId } from "./types";
export { SKILLS } from "./catalog";

const VISUAL_RE = /\b(design|look|style|colou?r|font|type|theme|layout|spacing|hero|section|redesign|beautiful|modern|ugly)\b/i;
const COPY_RE = /\b(copy|text|wording|headline|title|label|says?|rename|rewrite|tagline|message)\b/i;
const IMAGE_RE = /\b(image|images|photo|photos|picture|pictures|icon|icons|logo|illustration|banner)\b/i;
const MOTION_RE = /\b(animate|animation|motion|transition|hover|scroll|fade|slide|parallax)\b/i;
const FORM_RE = /\b(form|sign[- ]?up|sign[- ]?in|login|submit|save|checkout|upload|field|validation|database|account)\b/i;
const SEO_RE = /\b(seo|meta|share|preview|search engine|title tag|sitemap)\b/i;

const SECTION_ARCH_RE = /\b(landing|marketing|home ?page|homepage|website|site|section|sections|layout|redesign|new page|add (?:a|an) page)\b/i;

/** Hard cap so the skill block can never become the new bloat. A first build gets one more. */
const MAX_SKILLS = 4;
const MAX_SKILLS_INITIAL = 5;

export function selectSkills(ctx: SkillContext): Skill[] {
  const picked: SkillId[] = [];
  const cap = ctx.isInitial ? MAX_SKILLS_INITIAL : MAX_SKILLS;
  const add = (id: SkillId) => {
    if (!picked.includes(id) && picked.length < cap) picked.push(id);
  };
  const text = ctx.text || "";
  const dims = ctx.dimensions ?? [];
  const has = (d: string) => dims.includes(d);

  // Editing something that already works is the highest-risk situation there
  // is, so its rulebook is always first in.
  if (!ctx.isInitial) add("redesign-safety");

  // A one-thing ask gets one skill at most beyond the safety rulebook.
  const room = ctx.scope === "micro" ? 2 : cap;
  const structural = ctx.isInitial || ctx.isCrossCutting || has("layout");

  const wants: Array<[boolean, SkillId]> = [
    [structural || has("visual"), "page-composition"],
    [(structural && SECTION_ARCH_RE.test(text)) || (ctx.scope !== "micro" && /\b(landing|marketing|sections?)\b/i.test(text)), "section-architectures"],
    [ctx.isInitial || has("copy") || COPY_RE.test(text), "copy-honesty"],
    [ctx.isInitial || has("visual") || VISUAL_RE.test(text), "typography-color"],
    [MOTION_RE.test(text) || has("motion"), "motion"],
    [ctx.isInitial || has("content") || IMAGE_RE.test(text), "imagery"],
    [ctx.touchesData === true || has("data") || FORM_RE.test(text), "forms-and-data"],
    [ctx.isInitial || SEO_RE.test(text), "findability"],
  ];
  for (const [wanted, id] of wants) {
    if (wanted && picked.length < room) add(id);
  }

  const order = new Map(SKILLS.map((s, i) => [s.id, i]));
  return picked
    .map((id) => SKILLS.find((s) => s.id === id)!)
    .filter(Boolean)
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

function knowledgeText(k: NonNullable<Skill["knowledge"]>): string {
  return k === "color-guide" ? loadColorGuide().replace(/^## Colour guide\n/, "") : loadSkillKnowledge(k);
}

export function renderSkillsBlock(
  skills: Skill[],
  opts: { includeBody?: boolean } = {},
): string {
  if (skills.length === 0) return "";
  const includeBody = opts.includeBody !== false;
  const parts = skills.map((s) => {
    const lines: string[] = [`#### ${s.title}`];
    // Canonical Markdown is the skill's content; it is never trimmed to
    // "rules only" because it is the rule source.
    if (s.knowledge) lines.push(knowledgeText(s.knowledge));
    if (s.hard.length) {
      lines.push("Never break these:");
      for (const h of s.hard) lines.push(`- ${h}`);
    }
    if (s.prefer.length) {
      lines.push("Defaults (an explicit instruction from the user wins):");
      for (const p of s.prefer) lines.push(`- ${p}`);
    }
    if (includeBody && s.body.trim()) lines.push("", s.body.trim());
    return lines.join("\n");
  });
  return `\n\n### Focused expertise for this request\nThe user's current request outranks every default below.\n\n${parts.join("\n\n")}\n`;
}

/** Convenience: select and render in one call. Returns "" when nothing applies. */
export function renderSkillsForTurn(ctx: SkillContext): { text: string; ids: SkillId[] } {
  const skills = selectSkills(ctx);
  return {
    // A one-thing ask gets the rules only — the working detail is what makes
    // requests heavy and it is not what a micro edit is missing.
    text: renderSkillsBlock(skills, { includeBody: ctx.scope !== "micro" }),
    ids: skills.map((s) => s.id),
  };
}
