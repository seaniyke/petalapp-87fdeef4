/**
 * Conversational edit focus (Edit Intelligence, phase 3).
 *
 * Users don't repeat themselves:
 *
 *   "Make the hero darker."        → Kimble edits the hero
 *   "Make the button white too."   → "the button" means the hero's CTA
 *   "Now fix checkout."            → new subject, focus moves
 *
 * Kimble only ever sent the newest message to the model, so the second turn had
 * no idea which button was meant. This module keeps a tiny focus — the surface
 * and files the last edit actually touched — and resolves bare references
 * against it.
 *
 * Rules that keep it safe:
 *  - An explicit new surface in the message always wins over the focus.
 *  - Focus expires (FOCUS_TTL_MS) so a day-old subject can never misdirect.
 *  - Pure functions, no I/O: the caller loads/saves the focus.
 */

import type { ChangeSet } from "@/server/change-set.server";

export interface EditFocus {
  /** Surface the last edit was about ("hero", "checkout", "/pricing"). */
  target: string;
  /** Files that edit actually changed, most relevant first. */
  paths: string[];
  /** Epoch ms when the focus was recorded. */
  at: number;
}

export const FOCUS_TTL_MS = 2 * 60 * 60 * 1000; // two hours of conversation

/** Bare references that only make sense against a previous turn. */
const BARE_REFERENCE =
  /\b(it|its|that|this|these|those|the same|there|the button|the heading|the title|the text|the image|the card|the cards|the section|the colou?rs?)\b/i;

const CONTINUATION = /\b(too|also|as well|instead|while you'?re|same for|and the)\b/i;

const TOPIC_SHIFT = /^\s*(now|next|ok(?:ay)?,?\s+now|forget that|different topic|switch to|move on to)\b/i;

export function isFocusFresh(focus: EditFocus | null, now = Date.now()): boolean {
  return Boolean(focus && now - focus.at < FOCUS_TTL_MS);
}

/**
 * Element words that never identify a place on their own — there is a button
 * on every page. They still need the previous turn to be resolvable.
 */
const GENERIC_TARGETS = new Set([
  "button","buttons","cta","heading","headline","title","subtitle","text","image","photo","illustration","card","cards","icon","background","colors","colours","palette","font","typography","spacing","logo","menu","form","table",
]);

function isGeneric(target: string | null): boolean {
  return target !== null && GENERIC_TARGETS.has(target.toLowerCase());
}

/** True when the message leans on the previous turn to be understood. */
export function needsFocus(prompt: string, changeSet: ChangeSet): boolean {
  const specific = changeSet.items.some((i) => i.target !== null && !isGeneric(i.target));
  if (specific) return false;
  return BARE_REFERENCE.test(prompt) || CONTINUATION.test(prompt);
}

/** True when the user has clearly moved to a different part of the app. */
export function isTopicChange(prompt: string, changeSet: ChangeSet, focus: EditFocus | null): boolean {
  if (!focus) return true;
  if (TOPIC_SHIFT.test(prompt)) return true;
  const focusToken = focus.target.toLowerCase();
  const targets = changeSet.items
    .map((i) => i.target?.toLowerCase())
    .filter((t): t is string => Boolean(t) && !GENERIC_TARGETS.has(t!));
  if (targets.length === 0) return false;
  return !targets.some((t) => t.includes(focusToken) || focusToken.includes(t));
}

/**
 * Fill in the blanks of a change set from the conversation focus. Returns the
 * paths worth pinning into prompt context and a short block telling the model
 * what "it" refers to.
 */
export function resolveWithFocus(args: {
  prompt: string;
  changeSet: ChangeSet;
  focus: EditFocus | null;
  now?: number;
}): { pinnedPaths: string[]; block: string; applied: boolean } {
  const now = args.now ?? Date.now();
  const none = { pinnedPaths: [] as string[], block: "", applied: false };
  if (!isFocusFresh(args.focus, now)) return none;
  const focus = args.focus!;
  if (!needsFocus(args.prompt, args.changeSet)) return none;
  if (isTopicChange(args.prompt, args.changeSet, focus)) return none;

  for (const item of args.changeSet.items) {
    if (!item.target) {
      item.target = focus.target;
      item.keywords = Array.from(new Set([...item.keywords, focus.target.toLowerCase()]));
    }
  }

  return {
    pinnedPaths: focus.paths.slice(0, 6),
    applied: true,
    block:
      `\n\nCONVERSATION CONTEXT — the previous turn changed the ${focus.target}` +
      `${focus.paths.length ? ` (${focus.paths.slice(0, 4).join(", ")})` : ""}. ` +
      `Unqualified references in this message ("it", "the button", "that section") mean that same area unless the user clearly names something else.`,
  };
}

/** Build the focus to carry into the next turn from what this turn changed. */
export function focusFromTurn(args: {
  changeSet: ChangeSet;
  changedPaths: string[];
  now?: number;
}): EditFocus | null {
  const target = args.changeSet.items.find((i) => i.target)?.target;
  if (!target || args.changedPaths.length === 0) return null;
  return { target, paths: args.changedPaths.slice(0, 6), at: args.now ?? Date.now() };
}
