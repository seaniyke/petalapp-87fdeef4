/**
 * Focused expertise ("skills").
 *
 * Kimble already carries a lot of craft knowledge, but it was all loaded on
 * every single request. That made small asks expensive, made the model read
 * pages of advice irrelevant to "add a back button", and was a direct cause of
 * the oversized-request failures.
 *
 * A skill is a short, self-contained piece of expertise with:
 *   - `hard`   — non-negotiable rules. Never dropped once the skill is picked.
 *   - `prefer` — defaults that may bend to an explicit user instruction.
 *   - `body`   — the working detail, trimmed first when the budget is tight.
 *
 * Selection is deterministic (no model call) and keyed off the edit scope,
 * dimensions and the request text. Nothing here replaces the registries,
 * design director or verification — skills sit above them as the reasoning
 * layer that decides which craft rules are in play this turn.
 */

export type SkillId =
  | "redesign-safety"
  | "page-composition"
  | "typography-color"
  | "imagery"
  | "copy-honesty"
  | "motion"
  | "forms-and-data"
  | "findability"
  | "section-architectures";

export interface Skill {
  id: SkillId;
  /** Short human title, used in the prompt heading and the logs. */
  title: string;
  /** Rules that must never be broken. */
  hard: string[];
  /** Strong defaults that an explicit user instruction may override. */
  prefer: string[];
  /** Working detail. First thing trimmed when the budget is tight. */
  body: string;
  /**
   * When set, the canonical Markdown in src/server/agent-knowledge is the
   * skill's content and hard/prefer/body are left empty (one source only).
   */
  knowledge?: import("@/server/agent-knowledge").KnowledgeSkillId | "color-guide";
}

export interface SkillContext {
  /** How big the request read. */
  scope: "micro" | "targeted" | "structural" | null;
  /** What the request is about, from the edit classifier. */
  dimensions: string[];
  /** The user's own words this turn. */
  text: string;
  /** First build of a project. */
  isInitial: boolean;
  /** A redesign or other change that reaches across the whole app. */
  isCrossCutting: boolean;
  /** True when the turn is touching backend data. */
  touchesData?: boolean;
}
